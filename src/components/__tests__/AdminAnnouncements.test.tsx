import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import AdminAnnouncements from '@/components/AdminAnnouncements';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function makeAnnouncements() {
  return [
    { id: 'a1', title: 'Hello', body: 'World', active: true, createdAt: '2026-07-19T12:00:00Z' },
    { id: 'a2', title: 'Hidden one', body: 'Body2', active: false, createdAt: '2026-07-18T12:00:00Z' },
  ];
}

describe('AdminAnnouncements', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows loading then list of announcements', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ announcements: makeAnnouncements() }) }));

    render(<AdminAnnouncements />);
    expect(screen.getByText('common.loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
    });
    expect(screen.getByText('Hidden one')).toBeInTheDocument();
    expect(screen.getByText('hidden')).toBeInTheDocument();
  });

  it('shows empty state when no announcements', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ announcements: [] }) }));

    render(<AdminAnnouncements />);

    await waitFor(() => {
      expect(screen.getByText('admin.announcements.empty')).toBeInTheDocument();
    });
  });

  it('opens create modal, fills fields, and creates an announcement', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ announcements: makeAnnouncements() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminAnnouncements />);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());

    fireEvent.click(screen.getByText('admin.announcements.create'));

    const titleInput = screen.getByPlaceholderText('admin.announcements.createTitle');
    const bodyInput = screen.getByPlaceholderText('admin.announcements.createBody');
    fireEvent.change(titleInput, { target: { value: 'New title' } });
    fireEvent.change(bodyInput, { target: { value: 'New body' } });

    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/announcements',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ title: 'New title', body: 'New body' }),
        }),
      );
    });
  });

  it('does not submit create with empty fields (button disabled)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ announcements: [] }) }));

    render(<AdminAnnouncements />);
    await waitFor(() => expect(screen.getByText('admin.announcements.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByText('admin.announcements.create'));
    const saveBtn = screen.getByText('common.save');
    expect(saveBtn).toBeDisabled();
  });

  it('cancels the create modal without submitting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ announcements: [] }) }));

    render(<AdminAnnouncements />);
    await waitFor(() => expect(screen.getByText('admin.announcements.empty')).toBeInTheDocument());

    fireEvent.click(screen.getByText('admin.announcements.create'));
    expect(screen.getByPlaceholderText('admin.announcements.createTitle')).toBeInTheDocument();

    fireEvent.click(screen.getByText('common.cancel'));
    expect(screen.queryByPlaceholderText('admin.announcements.createTitle')).not.toBeInTheDocument();
  });

  it('toggles (hides) an active announcement via DELETE', async () => {
    const fetchMock = vi.fn((url: string, opts?: any) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ announcements: makeAnnouncements() }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AdminAnnouncements />);
    await waitFor(() => expect(screen.getByText('Hello')).toBeInTheDocument());

    fireEvent.click(screen.getByText('admin.announcements.hide'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/admin/announcements/a1', { method: 'DELETE' });
    });
  });
});
