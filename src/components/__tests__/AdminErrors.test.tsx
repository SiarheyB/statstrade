import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminErrors from '@/components/AdminErrors';

function makeErrors() {
  return [
    { id: 'e1', message: 'Boom', path: '/api/x', stack: 'Error: Boom\n at foo', createdAt: '2026-07-19T12:00:00Z', readAt: null },
    { id: 'e2', message: 'Oops', path: null, stack: null, createdAt: '2026-07-18T12:00:00Z', readAt: null },
  ];
}

describe('AdminErrors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading then error list with count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ errors: makeErrors() }) }));

    render(<AdminErrors />);
    expect(screen.getByText('Загрузка…')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Boom')).toBeInTheDocument();
    });
    expect(screen.getByText('Oops')).toBeInTheDocument();
    expect(screen.getByText('Всего записей: 2')).toBeInTheDocument();
    expect(screen.getByText('/api/x')).toBeInTheDocument();
  });

  it('shows empty state when no errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ errors: [] }) }));

    render(<AdminErrors />);

    await waitFor(() => {
      expect(screen.getByText('Ошибок не зафиксировано.')).toBeInTheDocument();
    });
    expect(screen.getByText('Очистить всё').closest('button')).toBeDisabled();
  });

  it('expands and collapses the stack trace', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ errors: makeErrors() }) }));

    render(<AdminErrors />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());

    expect(screen.queryByText(/at foo/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTitle('Стек вызова'));
    expect(screen.getByText(/at foo/)).toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Стек вызова'));
    expect(screen.queryByText(/at foo/)).not.toBeInTheDocument();
  });

  it('removes a single error entry', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ errors: makeErrors() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminErrors />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());

    const deleteButtons = screen.getAllByTitle('Удалить');
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(screen.queryByText('Boom')).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/errors',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ id: 'e1' }) }),
    );
  });

  it('clears all errors after confirm', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ errors: makeErrors() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminErrors />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Очистить всё'));

    await waitFor(() => {
      expect(screen.getByText('Ошибок не зафиксировано.')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/errors',
      expect.objectContaining({ method: 'DELETE', body: JSON.stringify({ all: true }) }),
    );
  });

  it('does not clear all when confirm is cancelled', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ errors: makeErrors() }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminErrors />);
    await waitFor(() => expect(screen.getByText('Boom')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Очистить всё'));
    expect(screen.getByText('Boom')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
