import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
    return Promise.resolve(jsonResponse({ files: [] }));
  });
});

describe('AdminBackupPage', () => {
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
    const deleteButtons = screen.getAllByTitle('Удалить');
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
