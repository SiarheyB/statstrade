import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AccountsTable from '@/components/admin/AccountsTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
    locale: 'en',
  }),
}));

function makeRows() {
  return [
    {
      id: 'acc1',
      userEmail: 'user1@test.com',
      exchange: 'binance',
      label: 'Main',
      source: 'exchange',
      marketType: 'spot',
      syncStatus: 'idle',
      syncError: null,
      lastSyncAt: '2026-07-19T12:00:00Z',
      autoSync: true,
      syncIntervalMinutes: 30,
      fills: 100,
      importedTrades: 50,
    },
    {
      id: 'acc2',
      userEmail: 'user1@test.com',
      exchange: 'bybit',
      label: 'Second',
      source: 'exchange',
      marketType: 'futures',
      syncStatus: 'error',
      syncError: 'boom',
      lastSyncAt: null,
      autoSync: false,
      syncIntervalMinutes: 60,
      fills: 5,
      importedTrades: 5,
    },
  ];
}

describe('AccountsTable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('groups accounts by user email and shows summary row', () => {
    render(<AccountsTable rows={makeRows()} />);
    expect(screen.getByText('user1@test.com')).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    // Not expanded initially
    expect(screen.queryByText('Main')).not.toBeInTheDocument();
  });

  it('expands the group to show individual accounts', () => {
    render(<AccountsTable rows={makeRows()} />);
    fireEvent.click(screen.getByText('user1@test.com'));
    expect(screen.getByText(/Main/)).toBeInTheDocument();
    expect(screen.getByText(/Second/)).toBeInTheDocument();
    expect(screen.getByText(/boom/)).toBeInTheDocument();
  });

  it('shows empty state when no rows', () => {
    render(<AccountsTable rows={[]} />);
    expect(screen.getByText('admin.accounts.none')).toBeInTheDocument();
  });

  it('triggers sync action for an account', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountsTable rows={makeRows()} />);
    fireEvent.click(screen.getByText('user1@test.com'));

    const syncButtons = screen.getAllByText('admin.accounts.sync');
    fireEvent.click(syncButtons[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/accounts',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'acc1', action: 'sync' }),
        }),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('shows reset button only for syncing accounts', () => {
    const rows = makeRows();
    rows[0].syncStatus = 'syncing';
    render(<AccountsTable rows={rows} />);
    fireEvent.click(screen.getByText('user1@test.com'));
    expect(screen.getByText('admin.accounts.reset')).toBeInTheDocument();
  });

  it('shows alert when reset action fails', async () => {
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'no' }) });
    vi.stubGlobal('fetch', fetchMock);

    const rows = makeRows();
    rows[0].syncStatus = 'syncing';
    render(<AccountsTable rows={rows} />);
    fireEvent.click(screen.getByText('user1@test.com'));
    fireEvent.click(screen.getByText('admin.accounts.reset'));

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('no');
    });
  });
});
