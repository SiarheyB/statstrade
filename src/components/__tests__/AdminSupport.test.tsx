import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminSupport from '@/components/AdminSupport';

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

function makeTickets() {
  return [
    {
      id: 't1',
      userId: 'u1',
      subject: 'Help me',
      status: 'open',
      lastMessageAt: '2026-07-19T12:00:00Z',
      lastMessage: 'please help',
      lastAuthorRole: 'user',
      email: 'user@test.com',
      name: 'User One',
      unread: 2,
    },
    {
      id: 't2',
      userId: 'u2',
      subject: 'Closed issue',
      status: 'closed',
      lastMessageAt: '2026-07-18T12:00:00Z',
      lastMessage: 'thanks',
      lastAuthorRole: 'admin',
      email: null,
      name: null,
      unread: 0,
    },
  ];
}

describe('AdminSupport', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading then ticket list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tickets: makeTickets() }) }));

    render(<AdminSupport />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Help me')).toBeInTheDocument();
    });
    expect(screen.getByText('Closed issue')).toBeInTheDocument();
    expect(screen.getByText('Открыт')).toBeInTheDocument();
    expect(screen.getByText('Закрыт')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/Вы:/)).toBeInTheDocument();
  });

  it('shows empty state when there are no tickets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tickets: [] }) }));

    render(<AdminSupport />);

    await waitFor(() => {
      expect(screen.getByText('Обращений пока нет.')).toBeInTheDocument();
    });
  });

  it('links to ticket detail page', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tickets: makeTickets() }) }));

    render(<AdminSupport />);

    await waitFor(() => {
      expect(screen.getByText('Help me')).toBeInTheDocument();
    });
    const link = screen.getByText('Help me').closest('a');
    expect(link).toHaveAttribute('href', '/admin/support/t1');
  });

  it('shows fallback userId when email is missing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ tickets: makeTickets() }) }));

    render(<AdminSupport />);

    await waitFor(() => {
      expect(screen.getByText('u2', { exact: false })).toBeInTheDocument();
    });
  });
});
