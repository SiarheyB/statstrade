import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";

// Роут дёргает bash-скрипт, который умеет заменить базу целиком, поэтому
// spawn мокаем целиком: ни один тест не должен запустить настоящий процесс.
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("child_process", () => ({ default: { spawn: spawnMock }, spawn: spawnMock }));

vi.mock("fs/promises", () => ({
  default: { mkdir: vi.fn(), readdir: vi.fn(), stat: vi.fn(), unlink: vi.fn(), access: vi.fn() },
  mkdir: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn(),
  access: vi.fn(),
}));

import fs from "fs/promises";
import { GET, POST, DELETE } from "@/app/api/admin/backup/route";

const base = "https://example.com/api/admin/backup";

function fakeChild() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
  };
}

/** Управляемый «процесс»: тест сам решает, что скрипт напечатал и с каким
 *  кодом завершился — так проверяется всё, что роут делает ПОСЛЕ запуска. */
function controllableChild() {
  const handlers: Record<string, ((arg: unknown) => void)[]> = {};
  const child = {
    stdout: { on: (ev: string, cb: (arg: unknown) => void) => { (handlers[`stdout:${ev}`] ??= []).push(cb); } },
    stderr: { on: (ev: string, cb: (arg: unknown) => void) => { (handlers[`stderr:${ev}`] ??= []).push(cb); } },
    on: (ev: string, cb: (arg: unknown) => void) => { (handlers[ev] ??= []).push(cb); },
  };
  return {
    child,
    stdout: (line: string) => handlers["stdout:data"]?.forEach((cb) => cb(Buffer.from(line))),
    close: (code: number) => handlers["close"]?.forEach((cb) => cb(code)),
  };
}

function post(body: unknown) {
  return new Request(base, { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
  spawnMock.mockReset().mockImplementation(() => fakeChild());
  vi.mocked(fs.mkdir).mockReset().mockResolvedValue(undefined);
  vi.mocked(fs.readdir).mockReset().mockResolvedValue([] as never);
  vi.mocked(fs.stat).mockReset().mockResolvedValue({ size: 10, mtime: new Date(0) } as never);
  vi.mocked(fs.unlink).mockReset().mockResolvedValue(undefined);
  vi.mocked(fs.access).mockReset().mockResolvedValue(undefined);
  asAdmin();
});

describe("админский гард", () => {
  it("GET без прав админа → 404 и каталог не читается", async () => {
    asNonAdmin();
    const res = await GET(new Request(`${base}?action=list`));
    expect(res.status).toBe(404);
    expect(fs.readdir).not.toHaveBeenCalled();
  });

  it("POST без прав админа не запускает скрипт", async () => {
    asNonAdmin();
    const res = await POST(post({ action: "import_clean", file: "evil.sql" }));
    expect(res.status).toBe(404);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("DELETE без прав админа ничего не удаляет", async () => {
    asNonAdmin();
    const res = await DELETE(new Request(`${base}?file=dump.sql`, { method: "DELETE" }));
    expect(res.status).toBe(404);
    expect(fs.unlink).not.toHaveBeenCalled();
  });
});

describe("белый список команд", () => {
  it("произвольная команда не доходит до bash", async () => {
    const res = await POST(post({ action: "show_help" }));
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("разрешённый экспорт запускается", async () => {
    const res = await POST(post({ action: "export_full" }));
    expect(res.status).toBe(200);
    expect(spawnMock).toHaveBeenCalledOnce();
    const [cmd, args] = spawnMock.mock.calls[0];
    expect(cmd).toBe("bash");
    expect(args[1]).toBe("export_full");
  });

  it("экспорту нельзя подсунуть файл", async () => {
    const res = await POST(post({ action: "export_full", file: "dump.sql" }));
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("имя файла", () => {
  it.each(["../../../etc/passwd.sql", "/etc/passwd.sql", "a/b.sql", "..sql", "dump.txt"])(
    "%s отвергается",
    async (name) => {
      const res = await POST(post({ action: "import_clean", file: name }));
      expect(res.status).toBe(400);
      expect(spawnMock).not.toHaveBeenCalled();
    },
  );

  it("импорт существующего файла уходит в скрипт абсолютным путём внутри tmp", async () => {
    const res = await POST(post({ action: "import_clean", file: "dump.sql" }));
    expect(res.status).toBe(200);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args[1]).toBe("import_clean");
    expect(args[2].endsWith("/backup/tmp/dump.sql")).toBe(true);
  });

  it("несуществующий файл не запускает импорт", async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
    const res = await POST(post({ action: "import_with_dedup", file: "nope.sql" }));
    expect(res.status).toBe(400);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});

describe("утечки", () => {
  it("список файлов не отдаёт абсолютные пути", async () => {
    vi.mocked(fs.readdir).mockResolvedValue(["dump.sql"] as never);
    const res = await GET(new Request(`${base}?action=list`));
    const body = await res.json();
    expect(body.files[0].name).toBe("dump.sql");
    expect(body.files[0].path).toBeUndefined();
  });

  it("скрипту не передаётся весь process.env", async () => {
    process.env.JWT_SECRET = "super-secret";
    await POST(post({ action: "export_full" }));
    const opts = spawnMock.mock.calls[0][2] as { env: Record<string, string> };
    expect(opts.env.JWT_SECRET).toBeUndefined();
    expect("DATABASE_URL" in opts.env || process.env.DATABASE_URL === undefined).toBe(true);
  });
});

describe("удаление", () => {
  it("удаляет файл по имени", async () => {
    const res = await DELETE(new Request(`${base}?file=dump.sql`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    const target = vi.mocked(fs.unlink).mock.calls[0][0] as string;
    expect(target.endsWith("/backup/tmp/dump.sql")).toBe(true);
  });

  it("не удаляет файл по пути наружу", async () => {
    const res = await DELETE(new Request(`${base}?file=../../.env`, { method: "DELETE" }));
    expect(res.status).toBe(400);
    expect(fs.unlink).not.toHaveBeenCalled();
  });
});


describe("журнал операций и созданный файл", () => {
  beforeEach(() => {
    mockGetAdminSession.mockReset();
    spawnMock.mockReset();
    vi.mocked(fs.mkdir).mockReset().mockResolvedValue(undefined);
    asAdmin();
  });

  it("после экспорта отдаёт имя созданного файла — его страница и скачивает", async () => {
    const ctrl = controllableChild();
    spawnMock.mockImplementation(() => ctrl.child);

    const res = await POST(post({ action: "export_full" }));
    const { operationId } = await res.json();

    // скрипт печатает абсолютный путь файла последней строкой
    ctrl.stdout(`${process.cwd()}/backup/tmp/db-export_20260825_101500.sql`);
    ctrl.close(0);

    const status = await (await GET(new Request(`${base}?operationId=${operationId}`))).json();
    expect(status.status).toBe("success");
    expect(status.file).toBe("db-export_20260825_101500.sql");
  });

  it("посторонний путь в выводе за файл не принимается", async () => {
    const ctrl = controllableChild();
    spawnMock.mockImplementation(() => ctrl.child);
    const res = await POST(post({ action: "export_full" }));
    const { operationId } = await res.json();

    ctrl.stdout("/etc/passwd");
    ctrl.stdout(`${process.cwd()}/backup/tmp/../../../etc/passwd`);
    ctrl.close(0);

    const status = await (await GET(new Request(`${base}?operationId=${operationId}`))).json();
    expect(status.status).toBe("success");
    expect(status.file).toBeUndefined();
  });

  it("упавшая операция файла не отдаёт", async () => {
    const ctrl = controllableChild();
    spawnMock.mockImplementation(() => ctrl.child);
    const res = await POST(post({ action: "export_full" }));
    const { operationId } = await res.json();

    ctrl.stdout(`${process.cwd()}/backup/tmp/half-written.sql`);
    ctrl.close(1);

    const status = await (await GET(new Request(`${base}?operationId=${operationId}`))).json();
    expect(status.status).toBe("error");
    expect(status.file).toBeUndefined();
  });

  it("action=operations возвращает журнал новыми сверху и с действием", async () => {
    spawnMock.mockImplementation(() => fakeChild());
    await POST(post({ action: "export_analytics" }));
    await POST(post({ action: "create_basic_dump" }));

    const data = await (await GET(new Request(`${base}?action=operations`))).json();
    expect(data.operations.length).toBeGreaterThanOrEqual(2);
    expect(data.operations[0].action).toBe("create_basic_dump");
    expect(data.operations[0]).toHaveProperty("startedAt");
    expect(data.operations[0].status).toBe("running");
  });

  it("журнал закрыт для не-админа", async () => {
    asNonAdmin();
    const res = await GET(new Request(`${base}?action=operations`));
    expect(res.status).toBe(404);
  });
});
