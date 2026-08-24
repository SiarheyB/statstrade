import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { join } from "path";
import fs from "fs/promises";
import { getAdminSession, notFound, recordAudit } from "@/lib/admin";
import { badRequest } from "@/lib/api";

export const dynamic = "force-dynamic";

const PROJECT_ROOT = process.cwd();
const BACKUP_SCRIPT = join(PROJECT_ROOT, "backup", "db-backup-functions.sh");
const TMP_DIR = join(PROJECT_ROOT, "backup", "tmp");
const LOG_FILE = join(PROJECT_ROOT, "backup", "db-backup-functions.log");

// Роут запускает bash-скрипт, который умеет ПОЛНОСТЬЮ заменить базу
// (import_clean). Поэтому здесь три независимых рубежа:
//   1) getAdminSession() в каждом методе (раньше не было вообще — роут был
//      открыт анонимно, см. SECURITY_AUDIT.md);
//   2) белый список команд — action не может быть произвольной строкой;
//   3) имя файла только базовое (без путей) и только .sql/.jsonl.
const ALLOWED_ACTIONS = [
  "export_full",
  "export_data_only",
  "export_analytics",
  "import_with_dedup",
  "import_clean",
  "create_basic_dump",
] as const;
type BackupAction = (typeof ALLOWED_ACTIONS)[number];

// Командам импорта файл обязателен, экспортам — запрещён.
const ACTIONS_NEEDING_FILE: ReadonlySet<BackupAction> = new Set<BackupAction>([
  "import_with_dedup",
  "import_clean",
]);

function isAllowedAction(v: unknown): v is BackupAction {
  return typeof v === "string" && (ALLOWED_ACTIONS as readonly string[]).includes(v);
}

// Только базовое имя: ни "/", ни "..", ни абсолютных путей — join(TMP_DIR, …)
// с такой строкой физически не может выйти за каталог.
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function isSafeBackupName(name: unknown): name is string {
  if (typeof name !== "string" || name.length === 0 || name.length > 200) return false;
  if (!SAFE_NAME.test(name)) return false;
  if (name.includes("..")) return false;
  return name.endsWith(".sql") || name.endsWith(".jsonl");
}

// Дочернему процессу отдаём только то, что реально нужно скрипту, а не весь
// process.env (там JWT_SECRET, ENCRYPTION_KEY, ключи бирж).
const ENV_ALLOWLIST = [
  "PATH", "HOME", "LANG", "LC_ALL", "TZ", "NODE_ENV",
  "DATABASE_URL", "DB_HOST", "DB_PORT", "DB_NAME", "DB_USER", "DB_PASSWORD",
  "PGUSER", "PGPASSWORD", "COMPOSE_FILE",
] as const;
function scriptEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of ENV_ALLOWLIST) {
    const val = process.env[key];
    if (val !== undefined) env[key] = val;
  }
  // NODE_ENV в типе ProcessEnv объявлен обязательным, но здесь мы намеренно
  // отдаём урезанный набор переменных, поэтому приводим тип явно.
  return env as NodeJS.ProcessEnv;
}

type Operation = {
  id: string;
  /** Что запускали — нужно, чтобы журнал восстанавливался после перезагрузки
   *  страницы: без действия строку не подписать. */
  action: BackupAction;
  status: "pending" | "running" | "success" | "error";
  logs: string[];
  startedAt: number;
  completedAt?: number;
  /** Файл, который создал экспорт — страница сразу отдаёт его браузеру. */
  file?: string;
  /** Порядковый номер запуска: две операции легко попадают в одну
   *  миллисекунду, и сортировка по startedAt тогда даёт случайный порядок. */
  seq: number;
};

let operationSeq = 0;

/** Сколько операций помним для журнала. */
const MAX_OPERATIONS = 20;

// in-memory store for ops
const operations: Record<string, Operation> = {};

// Вывод скрипта не обрезался — длинный дамп мог раздуть память процесса.
const MAX_LOG_LINES = 2000;
function pushLog(op: Operation, line: string) {
  op.logs.push(line);
  if (op.logs.length > MAX_LOG_LINES) op.logs.splice(0, op.logs.length - MAX_LOG_LINES);
}

// Скрипт печатает путь созданного файла последней строкой вывода. Ловим его,
// чтобы страница могла сразу скачать дамп на машину пользователя: экспорт
// нужен «себе на диск», а не «в контейнер на сервере».
function extractProducedFile(logs: string[]): string | undefined {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i].trim();
    if (!line.startsWith(TMP_DIR)) continue;
    const name = line.slice(TMP_DIR.length).replace(/^[/\\]/, "");
    if (isSafeBackupName(name)) return name;
  }
  return undefined;
}

function generateId() {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const operationId = searchParams.get("operationId");

  if (action === "list") {
    try {
      await ensureTmpDir();
      const files = await fs.readdir(TMP_DIR);
      const fileInfos = await Promise.all(
        files
          .filter((f) => f.endsWith(".sql") || f.endsWith(".jsonl"))
          .map(async (f) => {
            const stat = await fs.stat(join(TMP_DIR, f));
            // Абсолютный путь наружу не отдаём — UI работает по имени файла.
            return { name: f, size: stat.size, modified: stat.mtime.getTime() };
          }),
      );
      return json({ files: fileInfos });
    } catch {
      return json({ error: "Failed to list files" }, 500);
    }
  }

  // Журнал операций: страница подтягивает его при загрузке, иначе после
  // обновления вкладки история пропадала целиком — даже у операции, которая
  // прямо сейчас идёт на сервере.
  if (action === "operations") {
    const list = Object.values(operations)
      .sort((a, b) => b.seq - a.seq)
      .map((op) => ({
        id: op.id,
        action: op.action,
        status: op.status,
        startedAt: op.startedAt,
        completedAt: op.completedAt,
        file: op.file,
        logs: op.logs.slice(-200),
      }));
    return json({ operations: list });
  }

  // Handle operation status polling for backup operations
  if (operationId && (!action || action === "status" || action === "")) {
    const op = operations[operationId];
    if (!op) return json({ error: "Operation not found" }, 404);
    return json({
      logs: op.logs,
      status: op.status,
      startedAt: op.startedAt,
      file: op.file,
      updatedAt: new Date().toISOString(),
    });
  }

  if (action === "logs" && operationId) {
    const op = operations[operationId];
    if (!op) return json({ error: "Operation not found" }, 404);
    return json({ logs: op.logs, status: op.status });
  }

  return json({ error: "Invalid action" }, 400);
}

export async function POST(request: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  let body: { action?: unknown; file?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest("Некорректный запрос");
  }

  const { action, file } = body;
  if (!action) return badRequest("Missing action");
  if (!isAllowedAction(action)) return badRequest("Unknown action");

  const needsFile = ACTIONS_NEEDING_FILE.has(action);
  if (needsFile && !isSafeBackupName(file)) {
    return badRequest("Нужно корректное имя файла (.sql или .jsonl)");
  }
  if (!needsFile && file) {
    return badRequest("Этой операции файл не нужен");
  }

  try {
    await ensureTmpDir();
  } catch (err) {
    return json({ error: `Failed to start operation: ${(err as Error).message}` }, 500);
  }

  // Файл для импорта должен существовать — иначе скрипт молча отработает вхолостую.
  if (needsFile) {
    try {
      await fs.access(join(TMP_DIR, file as string));
    } catch {
      return badRequest("Файл не найден");
    }
  }

  const operationId = generateId();
  const op: Operation = { id: operationId, action, status: "pending", logs: [], startedAt: Date.now(), seq: ++operationSeq };
  operations[operationId] = op;
  // Держим только последние: иначе журнал растёт в памяти процесса до перезапуска.
  const ids = Object.keys(operations).sort((a, b) => operations[a].seq - operations[b].seq);
  for (const id of ids.slice(0, Math.max(0, ids.length - MAX_OPERATIONS))) delete operations[id];

  await recordAudit(session, `backup.${action}`, {
    targetType: "backup",
    targetLabel: needsFile ? (file as string) : undefined,
  });

  // run in background
  op.status = "running";
  pushLog(op, `[${new Date().toISOString()}] Starting ${action}`);
  const args: string[] = [action];
  if (needsFile) args.push(join(TMP_DIR, file as string));

  const child = spawn("bash", [BACKUP_SCRIPT, ...args], { cwd: PROJECT_ROOT, env: scriptEnv() });
  child.stdout.on("data", (data: Buffer) => pushLog(op, data.toString().trim()));
  child.stderr.on("data", (data: Buffer) => pushLog(op, `[ERROR] ${data.toString().trim()}`));
  child.on("error", (err) => {
    op.status = "error";
    pushLog(op, `[ERROR] ${err.message}`);
  });
  child.on("close", (code) => {
    op.completedAt = Date.now();
    op.status = code === 0 ? "success" : "error";
    if (op.status === "success") op.file = extractProducedFile(op.logs);
    pushLog(op, `[${new Date().toISOString()}] Process exited with code ${code}`);
  });

  return json({ operationId });
}

export async function DELETE(request: Request) {
  const session = await getAdminSession();
  if (!session) return notFound();

  try {
    let action = "delete-file";
    let filename: string | null = null;

    try {
      const body = await request.json();
      if (typeof body?.action === "string") action = body.action;
      if (typeof body?.filename === "string") filename = body.filename;
    } catch {
      // тела нет — имя файла берём из query
    }

    if (action === "clear-logs") {
      try {
        await fs.unlink(LOG_FILE);
      } catch {
        // лога может не быть — это не ошибка
      }
      for (const id of Object.keys(operations)) delete operations[id];
      await recordAudit(session, "backup.clear-logs", { targetType: "backup" });
      return json({ success: true });
    }

    if (action === "clear-all") {
      await ensureTmpDir();
      const files = await fs.readdir(TMP_DIR);
      await Promise.all(
        files
          .filter((f) => f.endsWith(".sql") || f.endsWith(".jsonl"))
          .map((f) => fs.unlink(join(TMP_DIR, f))),
      );
      for (const id of Object.keys(operations)) delete operations[id];
      await recordAudit(session, "backup.clear-all", { targetType: "backup" });
      return json({ success: true });
    }

    if (action !== "delete-file") return badRequest("Unknown action");

    await ensureTmpDir();
    const { searchParams } = new URL(request.url);
    const fileToDelete = filename ?? searchParams.get("file");
    if (!fileToDelete) return badRequest("Missing file parameter");
    if (!isSafeBackupName(fileToDelete)) return badRequest("Некорректное имя файла");

    const filePath = join(TMP_DIR, fileToDelete);
    try {
      await fs.access(filePath);
      await fs.unlink(filePath);
    } catch (e) {
      return json({ error: `Failed to delete file: ${(e as Error).message}` }, 500);
    }

    for (const [id, op] of Object.entries(operations)) {
      if (op.logs.some((l) => l.includes(fileToDelete))) delete operations[id];
    }
    await recordAudit(session, "backup.delete-file", {
      targetType: "backup",
      targetLabel: fileToDelete,
    });
    return json({ success: true });
  } catch (err) {
    return json({ error: `Delete error: ${(err as Error).message}` }, 500);
  }
}
