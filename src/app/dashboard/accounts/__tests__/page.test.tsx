import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import AccountsPage from "../page";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, unknown>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    locale: "ru",
    timezone: "auto",
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

const mockSyncAccount = vi.fn();
const mockSetNotice = vi.fn();
const mockImportReport = vi.fn();
let syncState = {
  progress: {} as Record<string, { done: number; total: number; imported: number; phase: string | null }>,
  syncing: {} as Record<string, boolean>,
  // Импорт отчёта тоже идёт через провайдер — чтобы переживать уход со страницы.
  importing: {} as Record<string, { phase: "upload" | "processing"; loaded: number; total: number }>,
  completedAt: 0,
  notice: null as string | null,
};

vi.mock("@/components/SyncProvider", () => ({
  useSync: () => ({
    progress: syncState.progress,
    syncing: syncState.syncing,
    importing: syncState.importing,
    importReport: mockImportReport,
    completedAt: syncState.completedAt,
    notice: syncState.notice,
    setNotice: mockSetNotice,
    syncAccount: mockSyncAccount,
  }),
}));

const account1 = {
  id: "acc1",
  exchange: "binance",
  label: "My Binance",
  source: "binance",
  accountCurrency: "USD",
  importedCount: 0,
  marketType: "both",
  demoTrading: false,
  apiKeyMasked: "abc***xyz",
  lastSyncAt: new Date().toISOString(),
  syncStatus: "ok",
  syncError: null,
  syncPhase: null,
  syncCursor: 0,
  syncTotal: 0,
  syncImported: 0,
  fullSyncAt: null,
  autoSync: false,
  syncIntervalMinutes: 60,
  fillCount: 5,
};

const mtAccount = {
  ...account1,
  id: "acc-mt",
  exchange: "mt4",
  source: "mt4",
  label: "My MT4",
  importedCount: 3,
  apiKeyMasked: null,
};

function jsonRes(body: unknown, ok = true) {
  return Promise.resolve({ ok, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  syncState = {
    progress: {},
    syncing: {},
    importing: {},
    completedAt: 0,
    notice: null,
  };
  global.confirm = vi.fn(() => true) as unknown as typeof confirm;
  global.fetch = vi.fn((url: string) => {
    if (url === "/api/accounts") return jsonRes([]);
    return jsonRes({});
  }) as unknown as typeof fetch;
});

describe("AccountsPage", () => {
  it("shows loading state initially", () => {
    render(<AccountsPage />);
    expect(screen.getByText("common.loading")).toBeInTheDocument();
  });

  it("shows empty state when there are no accounts", async () => {
    render(<AccountsPage />);
    expect(await screen.findByText("acc.empty")).toBeInTheDocument();
    expect(screen.getByText("acc.connectFirst")).toBeInTheDocument();
  });

  it("renders accounts once loaded", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([account1]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    expect(await screen.findByText("My Binance")).toBeInTheDocument();
    expect(screen.getByText(/abc\*\*\*xyz/)).toBeInTheDocument();
  });

  it("renders MT account with import/rollback controls instead of sync", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([mtAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    expect(await screen.findByText("My MT4")).toBeInTheDocument();
    expect(screen.getByText("acc.mt.import")).toBeInTheDocument();
    expect(screen.getByText("acc.mt.rollback")).toBeInTheDocument();
    // non-MT-only sync button should not appear
    expect(screen.queryByText("acc.sync")).not.toBeInTheDocument();
  });

  it("opens the add-account form when clicking the add button", async () => {
    render(<AccountsPage />);
    await screen.findByText("acc.empty");
    fireEvent.click(screen.getByText("acc.add"));
    expect(await screen.findByText("acc.form.title")).toBeInTheDocument();
  });

  it("calls syncAccount when clicking sync on a non-MT account", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([account1]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    await screen.findByText("My Binance");
    fireEvent.click(screen.getByText("acc.sync"));
    expect(mockSyncAccount).toHaveBeenCalledWith("acc1");
  });

  it("removes an account after confirming deletion", async () => {
    global.fetch = vi.fn((url: string, opts?: RequestInit) => {
      if (url === "/api/accounts" && (!opts || opts.method === undefined)) return jsonRes([account1]);
      if (url === "/api/accounts/acc1" && opts?.method === "DELETE") return jsonRes({});
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    await screen.findByText("My Binance");
    const delBtn = document.querySelector('button.hover\\:text-loss') as HTMLElement;
    fireEvent.click(delBtn);
    expect(global.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/accounts/acc1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });

  it("shows a permission-error banner for sync errors matching known keywords", async () => {
    const errAccount = { ...account1, syncError: "HTTP 403 forbidden" };
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([errAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    await screen.findByText("My Binance");
    expect(await screen.findByText(/Ошибка прав доступа API-ключа/)).toBeInTheDocument();
  });

  it("shows plain error text for non-permission sync errors", async () => {
    const errAccount = { ...account1, syncError: "Some random failure" };
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([errAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    await screen.findByText("My Binance");
    expect(await screen.findByText("Some random failure")).toBeInTheDocument();
  });

  it("dismisses the notice banner", async () => {
    syncState.notice = "Some notice";
    render(<AccountsPage />);
    expect(await screen.findByText("Some notice")).toBeInTheDocument();
    const closeButtons = document.querySelectorAll("button");
    // find the X button next to the notice (first button with no text content near notice)
    const noticeBox = screen.getByText("Some notice").closest("div");
    const btn = noticeBox?.querySelector("button");
    if (btn) fireEvent.click(btn);
    expect(mockSetNotice).toHaveBeenCalledWith(null);
  });
});

// Импорт отчёта показывает прогресс и не блокирует уход со страницы: сама
// загрузка живёт в SyncProvider (layout дашборда), карточка лишь отражает её
// состояние.
describe("AccountsPage — прогресс импорта", () => {
  it("shows the upload percentage while the file is being sent", async () => {
    syncState.importing = { "acc-mt": { phase: "upload", loaded: 512, total: 1024 } };
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([mtAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    expect(await screen.findByText("acc.mt.import.uploading")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  // На разборе отчёта сервер не сообщает прогресс, поэтому процент не рисуем —
  // выдуманное число хуже честной «бегущей» полосы.
  it("shows the processing phase without a percentage", async () => {
    syncState.importing = { "acc-mt": { phase: "processing", loaded: 1024, total: 1024 } };
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([mtAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    expect(await screen.findByText("acc.mt.import.processing")).toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });

  it("renders no import progress when nothing is running", async () => {
    global.fetch = vi.fn((url: string) => {
      if (url === "/api/accounts") return jsonRes([mtAccount]);
      return jsonRes({});
    }) as unknown as typeof fetch;

    render(<AccountsPage />);
    await screen.findByText("My MT4");
    expect(screen.queryByText("acc.mt.import.uploading")).not.toBeInTheDocument();
  });
});
