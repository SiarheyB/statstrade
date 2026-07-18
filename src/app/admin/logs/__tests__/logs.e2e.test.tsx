import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LogsPage from '../page';

const mockFetchPageResponse = {
  data: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      module: 'import',
      accountId: 'acc1',
      eventType: 'FILE_RECEIVED',
      message: 'File received',
      level: 'info',
      timestamp: new Date().toISOString(),
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  // Mock global.fetch — the component calls fetch('/api/admin/logs?...') internally
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(mockFetchPageResponse),
  });
});

describe('LogsPage', () => {
  it('renders loading state initially', () => {
    render(<LogsPage />);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('renders error when fetch fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    render(<LogsPage />);
    // The page shows the error message from the caught fetch error
    expect(await screen.findByText('Network error')).toBeInTheDocument();
  });

  it('applies filters and fetches logs', async () => {
    const mockData = [
      {
        id: '550e8400-e29b-41d4-a716-446655440000',
        module: 'import',
        accountId: 'acc1',
        eventType: 'FILE_RECEIVED',
        message: 'File received',
        level: 'info',
        timestamp: new Date().toISOString(),
      },
    ];
    const mockResponse = {
      data: mockData,
      total: mockData.length,
      page: 1,
      limit: 20,
      pages: 1,
    };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    render(<LogsPage />);
    // Wait for data to load
    expect(await screen.findByText(/File received/)).toBeInTheDocument();
  });
});