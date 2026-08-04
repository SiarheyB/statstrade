import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ContentActions from '@/components/admin/ContentActions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe('ContentActions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    refresh.mockClear();
  });

  it('renders refresh button for feed type', () => {
    render(<ContentActions feed="news" />);
    expect(screen.getByText('admin.content.refresh')).toBeInTheDocument();
  });

  it('refreshes news feed and shows added count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ results: [{ added: 3 }, { upserted: 2 }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ContentActions feed="news" />);
    fireEvent.click(screen.getByText('admin.content.refresh'));

    await waitFor(() => {
      expect(screen.getByText('+5')).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/admin/content',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ feed: 'news' }) }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('shows error message on failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: 'failed' }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<ContentActions feed="econcal" />);
    fireEvent.click(screen.getByText('admin.content.refresh'));

    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument();
    });
  });

  it('shows error message on thrown exception', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    render(<ContentActions feed="econcal" />);
    fireEvent.click(screen.getByText('admin.content.refresh'));

    await waitFor(() => {
      expect(screen.getByText('network down')).toBeInTheDocument();
    });
  });
});
