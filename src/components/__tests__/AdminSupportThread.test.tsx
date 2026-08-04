import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminSupportThread from '@/components/AdminSupportThread';

vi.mock('next/link', () => ({
  default: ({ href, children }: any) => <a href={href}>{children}</a>,
}));

// jsdom doesn't implement scrollTo on elements.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = vi.fn();
}

function makeResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    ticket: { id: 't1', subject: 'Need help', status: 'open', createdAt: '2026-07-19T12:00:00Z' },
    messages: [
      { id: 'm1', authorRole: 'user', message: 'Hi there', createdAt: '2026-07-19T12:00:00Z' },
      { id: 'm2', authorRole: 'admin', message: 'Hello!', createdAt: '2026-07-19T12:01:00Z' },
    ],
    user: { email: 'user@test.com', name: 'User One' },
    ...overrides,
  };
}

describe('AdminSupportThread', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads and shows ticket subject, user, and messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeResponse()) }));

    render(<AdminSupportThread ticketId="t1" />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Need help')).toBeInTheDocument();
    });
    expect(screen.getByText(/user@test.com/)).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.getByText('Открыт')).toBeInTheDocument();
  });

  it('shows empty message state when no messages exist', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeResponse({ messages: [] })) }));

    render(<AdminSupportThread ticketId="t1" />);

    await waitFor(() => {
      expect(screen.getByText('Сообщений пока нет.')).toBeInTheDocument();
    });
  });

  it('sends a reply message', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSupportThread ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Need help')).toBeInTheDocument());

    const textarea = screen.getByPlaceholderText('Ваш ответ…');
    fireEvent.change(textarea, { target: { value: 'Reply text' } });
    fireEvent.click(screen.getByTitle('Отправить'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/support/t1',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ message: 'Reply text' }) }),
      );
    });
  });

  it('shows error message when sending fails', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Send failed' }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSupportThread ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Need help')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Ваш ответ…'), { target: { value: 'Reply text' } });
    fireEvent.click(screen.getByTitle('Отправить'));

    await waitFor(() => {
      expect(screen.getByText('Send failed')).toBeInTheDocument();
    });
  });

  it('does not send an empty message', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeResponse()) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSupportThread ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Need help')).toBeInTheDocument());

    const sendBtn = screen.getByTitle('Отправить');
    expect(sendBtn).toBeDisabled();
  });

  it('toggles ticket status closed then open', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ticket: { id: 't1', subject: 'Need help', status: 'closed', createdAt: '2026-07-19T12:00:00Z' } }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(makeResponse()) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminSupportThread ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Need help')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Закрыть тикет'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/support/t1',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ status: 'closed' }) }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText('Открыть заново')).toBeInTheDocument();
    });
  });

  it('has a back link to the support list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(makeResponse()) }));

    render(<AdminSupportThread ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Need help')).toBeInTheDocument());

    const link = screen.getByText('Все обращения').closest('a');
    expect(link).toHaveAttribute('href', '/admin/support');
  });
});
