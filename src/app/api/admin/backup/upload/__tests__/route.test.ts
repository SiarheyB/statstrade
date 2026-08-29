import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ReadableStream } from "node:stream/web";
import { join } from "node:path";
import { readFile, rm, readdir } from "node:fs/promises";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/admin/backup/upload/route";

// Файловую систему НЕ мокаем. Роут пишет файл потоком —
// pipeline(Readable.fromWeb(file.stream()), счётчик, createWriteStream(...)) —
// и подменённые звенья этой цепочки проверяли бы мок, а не поведение (первая
// попытка так и вышла: тест «проходил» на реализации, которая теряла данные).
// Пишем в настоящий backup/tmp — это и есть рабочий каталог роута — и убираем
// за собой. Заодно видно, что на диск попало ровно то, что прислали.
const TMP_DIR = join(process.cwd(), "backup", "tmp");
const base = "https://example.com/api/admin/backup/upload";

// Раньше здесь стояло «this route performs no auth check (admin gating is at
// the infra/proxy layer)» — это было неверно: никакого гейта на уровне прокси
// нет, и роут принимал файлы от анонима. Первый тест ниже это и стережёт.

/**
 * File из jsdom не реализует stream(), а в реальном рантайме (undici) он есть.
 * Дописываем его настоящим потоком, сохраняя сам File — иначе проверка
 * `file instanceof File` в роуте перестала бы выполняться.
 */
function fileWithStream(value: string, name: string): File {
  const file = new File([value], name);
  const bytes = new TextEncoder().encode(value);
  Object.defineProperty(file, "stream", {
    value: () =>
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
  });
  return file;
}

function buildForm(fields: Array<{ name: string; value: string; filename?: string }>): FormData {
  const form = new FormData();
  for (const f of fields) {
    if (f.filename) form.set(f.name, fileWithStream(f.value, f.filename));
    else form.set(f.name, f.value);
  }
  return form;
}

// jsdom's Request/FormData do not interop for multipart bodies, so
// req.formData() rejects. Роуту нужны formData() и заголовки — подсовываем
// минимальный запрос с тем и другим.
function postForm(form: FormData, headers: Record<string, string> = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    url: base,
    method: "POST",
    headers: { get: (k: string) => map.get(k.toLowerCase()) ?? null },
    formData: async () => form,
  } as unknown as Request;
}

/** Что лежит в каталоге — для проверки «огрызков не осталось». */
const tmpFiles = () => readdir(TMP_DIR).catch(() => [] as string[]);

const created: string[] = [];
/** Пометить файл на удаление после теста и вернуть его имя. */
function track(name: string): string {
  created.push(name);
  return name;
}

describe("POST /api/admin/backup/upload", () => {
  beforeEach(() => {
    mockGetAdminSession.mockReset();
    mockRecordAudit.mockReset();
    created.length = 0;
    asAdmin();
  });

  afterEach(async () => {
    for (const name of created) await rm(join(TMP_DIR, name), { force: true });
  });

  it("не даёт загрузить файл без прав админа и ничего не пишет на диск", async () => {
    asNonAdmin();
    const before = await tmpFiles();
    const res = await POST(postForm(buildForm([{ name: "file", value: "x", filename: "evil.sql" }])));
    expect(res.status).toBe(404);
    expect(await tmpFiles()).toEqual(before);
  });

  it("returns 400 when no file is provided", async () => {
    const res = await POST(postForm(buildForm([{ name: "foo", value: "bar" }])));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a non-sql/non-jsonl file", async () => {
    const res = await POST(postForm(buildForm([{ name: "file", value: "x", filename: "dump.txt" }])));
    expect(res.status).toBe(400);
  });

  it("вычищает из имени файла всё, чем можно выйти из каталога", async () => {
    const res = await POST(
      postForm(buildForm([{ name: "file", value: "x", filename: "../../evil.sql" }])),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(track("_evil.sql"));
    // Файл лежит именно в backup/tmp, а не двумя каталогами выше.
    await expect(readFile(join(TMP_DIR, "_evil.sql"), "utf8")).resolves.toBe("x");
  });

  it("имя без основы не теряет расширение", async () => {
    // ".sql" раньше схлопывалось в "_sql" — без расширения, и файл переставал
    // проходить проверку в роуте восстановления, то есть загружался в никуда.
    // Теперь расширение сохраняется, а пустая основа заменяется на "backup".
    const res = await POST(postForm(buildForm([{ name: "file", value: "x", filename: ".sql" }])));
    expect((await res.json()).name).toBe(track("backup.sql"));
  });

  it("uploads a .sql file successfully", async () => {
    const content = "SELECT 1;";
    const res = await POST(postForm(buildForm([{ name: "file", value: content, filename: "dump.sql" }])));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.name).toBe(track("dump.sql"));
    expect(body.size).toBe(Buffer.byteLength(content));
    // На диск попало ровно то, что прислали — звено-счётчик не съело данные.
    await expect(readFile(join(TMP_DIR, "dump.sql"), "utf8")).resolves.toBe(content);
  });

  it("uploads a .jsonl file successfully", async () => {
    const content = '{"a":1}';
    const res = await POST(postForm(buildForm([{ name: "file", value: content, filename: "dump.jsonl" }])));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe(track("dump.jsonl"));
    await expect(readFile(join(TMP_DIR, "dump.jsonl"), "utf8")).resolves.toBe(content);
  });

  // Раньше и formData(), и arrayBuffer() поднимали файл в память целиком, и
  // только потом сверялся размер. nginx для этого пути пропускает до 256 МБ и
  // не буферизует — тело доезжало до Node полностью.
  it("слишком большое тело отклоняется ДО чтения", async () => {
    const req = postForm(buildForm([{ name: "file", value: "x", filename: "dump.sql" }]), {
      "content-length": String(300 * 1024 * 1024),
    });
    const spy = vi.spyOn(req, "formData");
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });
});
