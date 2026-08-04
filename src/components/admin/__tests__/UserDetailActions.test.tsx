import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserDetailActions from '@/components/admin/UserDetailActions';

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
  }),
}));

describe('UserDetailActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    push.mockClear();
    refresh.mockClear();
  });

  it('shows reset-2fa button only when has2fa is true', () => {
    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={true} />);
    expect(screen.getByText('admin.userDetail.reset2fa')).toBeInTheDocument();
  });

  it('does not show reset2fa button when has2fa is false', () => {
    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={false} />);
    expect(screen.queryByText('admin.userDetail.reset2fa')).not.toBeInTheDocument();
  });

  it('disables delete button for admin users', () => {
    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={true} has2fa={false} />);
    expect(screen.getByText('admin.userDetail.delete').closest('button')).toBeDisabled();
  });

  it('calls reset2fa endpoint after confirm', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={true} />);
    fireEvent.click(screen.getByText('admin.userDetail.reset2fa'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/users',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ id: 'u1', action: 'reset2fa' }) }),
      );
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('removes user and navigates away on success', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={false} />);
    fireEvent.click(screen.getByText('admin.userDetail.delete'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/users?id=u1', { method: 'DELETE' });
    });
    expect(push).toHaveBeenCalledWith('/admin/users');
    expect(refresh).toHaveBeenCalled();
  });

  it('shows alert on delete failure', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const alertMock = vi.fn();
    vi.stubGlobal('alert', alertMock);
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'nope' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={false} />);
    fireEvent.click(screen.getByText('admin.userDetail.delete'));

    await waitFor(() => {
      expect(alertMock).toHaveBeenCalledWith('nope');
    });
    expect(push).not.toHaveBeenCalled();
  });

  it('does nothing when confirm is cancelled', () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(<UserDetailActions id="u1" email="a@b.com" isAdmin={false} has2fa={false} />);
    fireEvent.click(screen.getByText('admin.userDetail.delete'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
