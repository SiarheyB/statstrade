import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BackupPage from '../page';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (k: string, params?: Record<string, any>) =>
      params ? `${k}:${JSON.stringify(params)}` : k,
    locale: 'ru',
    timezone: 'auto',
    setLocale: vi.fn(),
    setTimezone: vi.fn(),
  }),
}));

const mockFiles = [
  { name: 'backup1.sql', path: '/backups/backup1.sql', size: 2048, modified: 1700000000000 },
  { name: 'backup2.jsonl', path: '/backups/backup2.jsonl', size: 5 * 1024 * 1024, modified: 1700000001000 },
];

function jsonResponse(body: any, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  window.confirm = vi.fn().mockReturnValue(true);
  window.alert = vi.fn();
  global.fetch = vi.fn().mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('action=list')) {
      return Promise.resolve(jsonResponse({ files: mockFiles }));
    }
    if (typeof url === 'string' && url.includes('action=operations')) {
      return Promise.resolve(jsonResponse({ operations: [] }));
    }
    return Promise.resolve(jsonResponse({ files: [] }));
  });
});

describe('AdminBackupPage', () => {
  it('потерянная операция не крутится вечно, а помечается ошибкой', { timeout: 15000 }, async () => {
    // приложение перезапустилось — статус операции сервер уже не помнит (404)
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('action=list')) return Promise.resolve(jsonResponse({ files: [] }));
      if (typeof url === 'string' && url.includes('action=operations')) return Promise.resolve(jsonResponse({ operations: [] }));
      if (init?.method === 'POST') return Promise.resolve(jsonResponse({ operationId: 'gone' }));
      if (typeof url === 'string' && url.includes('operationId=gone')) {
        return Promise.resolve(jsonResponse({ error: 'Operation not found' }, false));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const user = userEvent.setup();
    render(<BackupPage />);
    await user.click(screen.getByText('admin.backup.exportFull.title'));
    // сообщение видно и в полоске состояния, и в журнале операции
    const shown = await screen.findAllByText('admin.backup.lost', {}, { timeout: 10000 });
    expect(shown.length).toBeGreaterThanOrEqual(1);
    // и полоска перестала «крутиться»
    expect(document.querySelector('.animate-spin')).toBeNull();
    // и никакого «undefined» в строке прогресса
    expect(screen.queryByText(/undefined/)).toBeNull();
  });

  it('идущую операцию из журнала доводит до конца после перезагрузки', { timeout: 15000 }, async () => {
    let statusCalls = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('action=list')) return Promise.resolve(jsonResponse({ files: [] }));
      if (typeof url === 'string' && url.includes('action=operations')) {
        return Promise.resolve(jsonResponse({
          operations: [{ id: 'live', action: 'import_clean', status: 'running', startedAt: 1, logs: ['идёт'] }],
        }));
      }
      if (typeof url === 'string' && url.includes('operationId=live')) {
        statusCalls++;
        return Promise.resolve(jsonResponse({ status: 'success', logs: ['идёт', 'готово'] }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    render(<BackupPage />);
    expect(await screen.findByText('идёт')).toBeInTheDocument();
    await waitFor(() => expect(statusCalls).toBeGreaterThan(0), { timeout: 5000 });
    expect(await screen.findByText('готово', {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('восстанавливает журнал операций после перезагрузки страницы', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('action=list')) {
        return Promise.resolve(jsonResponse({ files: mockFiles }));
      }
      if (typeof url === 'string' && url.includes('action=operations')) {
        return Promise.resolve(jsonResponse({
          operations: [{
            id: 'op1', action: 'export_full', status: 'success',
            startedAt: 1700000000000, completedAt: 1700000005000,
            file: 'db-export.sql', logs: ['done'],
          }],
        }));
      }
      return Promise.resolve(jsonResponse({}));
    });
    render(<BackupPage />);
    expect(await screen.findByText('done')).toBeInTheDocument();
    // заголовок операции есть и на кнопке экспорта, и в строке журнала
    expect(screen.getAllByText('admin.backup.exportFull.title')).toHaveLength(2);
  });

  it('после успешного экспорта дамп сразу уезжает в браузер', { timeout: 15000 }, async () => {
    const clicks: string[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag) as HTMLElement;
      if (tag === 'a') {
        // клик по <a download> — это и есть «файл сохраняется на машине»
        (el as HTMLAnchorElement).click = () => { clicks.push((el as HTMLAnchorElement).href); };
      }
      return el;
    });

    let polled = false;
    global.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('action=list')) return Promise.resolve(jsonResponse({ files: [] }));
      if (typeof url === 'string' && url.includes('action=operations')) return Promise.resolve(jsonResponse({ operations: [] }));
      if (init?.method === 'POST') return Promise.resolve(jsonResponse({ operationId: 'op42' }));
      if (typeof url === 'string' && url.includes('operationId=op42')) {
        polled = true;
        return Promise.resolve(jsonResponse({ status: 'success', logs: ['ok'], file: 'db-export_1.sql' }));
      }
      return Promise.resolve(jsonResponse({}));
    });

    const user = userEvent.setup();
    render(<BackupPage />);
    await user.click(screen.getByText('admin.backup.exportFull.title'));
    // опрос статуса идёт раз в 1.5 с — ждём дольше дефолтной секунды
    await waitFor(() => expect(polled).toBe(true), { timeout: 5000 });
    await waitFor(() => expect(clicks.length).toBeGreaterThan(0), { timeout: 5000 });
    expect(clicks[0]).toContain('/api/admin/backup/download?file=db-export_1.sql');
  });

  it('у каждого файла есть ссылка на скачивание', async () => {
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    const links = screen.getAllByTitle('admin.backup.download');
    expect(links).toHaveLength(mockFiles.length);
    // качаем именно этот файл и именно как файл (download), а не открываем в табе
    expect(links[0]).toHaveAttribute('href', '/api/admin/backup/download?file=backup1.sql');
    expect(links[0]).toHaveAttribute('download', 'backup1.sql');
  });

  it('shows files loading then renders list of files', async () => {
    render(<BackupPage />);
    expect(await screen.findByText('backup1.sql')).toBeInTheDocument();
    expect(screen.getByText('backup2.jsonl')).toBeInTheDocument();
  });

  it('renders empty state when there are no files', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
    render(<BackupPage />);
    expect(await screen.findByText('admin.backup.noFiles')).toBeInTheDocument();
  });

  it('renders export/import operation cards with titles', async () => {
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    expect(screen.getByText('admin.backup.exportFull.title')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.exportData.title')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.exportAnalytics.title')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.importDedup.title')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.importClean.title')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.basicDump.title')).toBeInTheDocument();
  });

  it('selects a file on click, showing chosen indicator', async () => {
    const user = userEvent.setup();
    render(<BackupPage />);
    const fileRow = await screen.findByText('backup1.sql');
    await user.click(fileRow);
    expect(await screen.findByText('backup1.sql', { selector: 'span.font-medium' })).toBeInTheDocument();
    expect(screen.getByText('admin.backup.chosen')).toBeInTheDocument();
  });

  it('starts an export operation and polls for status until success', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let pollCount = 0;
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('action=list')) {
        return Promise.resolve(jsonResponse({ files: mockFiles }));
      }
      if (typeof url === 'string' && url.includes('operationId=')) {
        pollCount += 1;
        if (pollCount >= 2) {
          return Promise.resolve(jsonResponse({ status: 'success', logs: ['done'] }));
        }
        return Promise.resolve(jsonResponse({ status: 'running', logs: ['working'] }));
      }
      // POST to start operation
      return Promise.resolve(jsonResponse({ operationId: 'op-1' }));
    });

    render(<BackupPage />);
    await vi.waitFor(() => expect(screen.getByText('admin.backup.exportFull.title')).toBeInTheDocument());

    const card = screen.getByText('admin.backup.exportFull.title').closest('button')!;
    await vi.waitFor(() => card.click());

    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);

    await vi.waitFor(() => {
      expect(screen.getByText('admin.backup.success')).toBeInTheDocument();
    });

    vi.useRealTimers();
  });

  it('shows error progress message when start operation fails', async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('action=list')) {
        return Promise.resolve(jsonResponse({ files: mockFiles }));
      }
      return Promise.resolve(jsonResponse({ error: 'boom' }));
    });
    const user = userEvent.setup();
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    // Re-query right before clicking — the earlier list-load re-render can
    // replace this subtree, so a reference captured before that await would
    // be stale/detached from the document.
    await user.click(screen.getByText('admin.backup.exportFull.title').closest('button')!);
    expect(await screen.findByText(/admin\.backup\.error/)).toBeInTheDocument();
  });

  it('alerts when trying to import without a selected file and none available', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ files: [] }));
    const user = userEvent.setup();
    render(<BackupPage />);
    await screen.findByText('admin.backup.noFiles');
    const importCard = screen.getByText('admin.backup.importDedup.title');
    await user.click(importCard.closest('button')!);
    expect(window.alert).toHaveBeenCalledWith('admin.backup.pickFirst');
  });

  it('deletes a file after confirm', async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn().mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve(jsonResponse({}));
      }
      return Promise.resolve(jsonResponse({ files: mockFiles }));
    });
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    const deleteButtons = screen.getAllByTitle('admin.backup.deleteFile');
    await user.click(deleteButtons[0]);
    expect(window.confirm).toHaveBeenCalled();
  });

  it('clears all files after confirm', async () => {
    const user = userEvent.setup();
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    await user.click(screen.getByText('admin.backup.clearAll'));
    expect(window.confirm).toHaveBeenCalledWith('admin.backup.clearAllConfirm');
  });

  it('refreshes files when refresh button clicked', async () => {
    const user = userEvent.setup();
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    const initialCalls = (global.fetch as any).mock.calls.length;
    await user.click(screen.getByText('admin.backup.refresh'));
    await waitFor(() => {
      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(initialCalls);
    });
  });

  it('shows no operations message initially', async () => {
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    expect(screen.getByText('admin.backup.noOperations')).toBeInTheDocument();
  });

  it('selecting an upload file shows file info and upload button', async () => {
    render(<BackupPage />);
    await screen.findByText('backup1.sql');
    const file = new File(['dummy'], 'restore.sql', { type: 'application/sql' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const user = userEvent.setup();
    await user.upload(input, file);
    expect(await screen.findByText('restore.sql')).toBeInTheDocument();
    expect(screen.getByText('admin.backup.upload')).toBeInTheDocument();
  });
});
