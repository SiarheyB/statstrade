import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UsersTable from '@/components/admin/UsersTable';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
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
      id: 'u1',
      email: 'admin@test.com',
      name: 'Admin User',
      createdAt: '2026-01-01T00:00:00Z',
      online: true,
      lastSeenAt: '2026-07-19T12:00:00Z',
      twoFactorEnabled: true,
      google: true,
      accounts: 3,
      annotations: 5,
      isAdmin: true,
      cloudStorage: [{ provider: 'google_drive', email: 'a@x.com' }],
    },
    {
      id: 'u2',
      email: 'plain@test.com',
      name: null,
      createdAt: '2026-02-01T00:00:00Z',
      online: false,
      lastSeenAt: null,
      twoFactorEnabled: false,
      google: false,
      accounts: 0,
      annotations: 0,
      isAdmin: false,
      cloudStorage: [],
    },
  ];
}

describe('UsersTable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('renders user rows with email, status, and stats', () => {
    render(<UsersTable rows={makeRows()} />);
    expect(screen.getByText('admin@test.com')).toBeInTheDocument();
    expect(screen.getByText('plain@test.com')).toBeInTheDocument();
    expect(screen.getByText('admin.users.online')).toBeInTheDocument();
    expect(screen.getByText('admin.users.offline')).toBeInTheDocument();
    expect(screen.getByText('Google Drive')).toBeInTheDocument();
  });

  it('shows empty state when no rows match filter', () => {
    render(<UsersTable rows={makeRows()} />);
    fireEvent.change(screen.getByPlaceholderText('admin.users.search'), { target: { value: 'zzz-no-match' } });
    expect(screen.getByText('admin.users.none')).toBeInTheDocument();
  });

  it('filters rows by search query', () => {
    render(<UsersTable rows={makeRows()} />);
    fireEvent.change(screen.getByPlaceholderText('admin.users.search'), { target: { value: 'plain' } });
    expect(screen.getByText('plain@test.com')).toBeInTheDocument();
    expect(screen.queryByText('admin@test.com')).not.toBeInTheDocument();
  });

  it('disables delete button for admin users', () => {
    render(<UsersTable rows={makeRows()} />);
    const deleteButtons = screen.getAllByText('admin.users.delete');
    // First row is admin -> disabled
    expect(deleteButtons[0].closest('button')).toBeDisabled();
    expect(deleteButtons[1].closest('button')).not.toBeDisabled();
  });

  it('calls reset2fa endpoint after confirm', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersTable rows={makeRows()} />);
    fireEvent.click(screen.getByText('admin.users.reset2fa'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ id: 'u1', action: 'reset2fa' }),
        }),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('removes non-admin user after confirm', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersTable rows={makeRows()} />);
    const deleteButtons = screen.getAllByText('admin.users.delete');
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users?id=u2', { method: 'DELETE' });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('does not call fetch when confirm is cancelled', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersTable rows={makeRows()} />);
    fireEvent.click(screen.getByText('admin.users.reset2fa'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows alert when delete fails', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'Nope' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UsersTable rows={makeRows()} />);
    const deleteButtons = screen.getAllByText('admin.users.delete');
    fireEvent.click(deleteButtons[1]);

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('Nope');
    });
  });
});
