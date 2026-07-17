import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import LogsPage from '../page';

// Mock the entire log.service module
vi.mock('@/lib/log.service', () => {
  return {
    LogService: {
      fetchPage: vi.fn(),
      deleteMany: vi.fn(),
      record: vi.fn(),
    },
  };
});

import * as logServiceMock from '@/lib/log.service';

const mockFetchPageResponse = {
  data: [
    {
      id: '1',
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
  logServiceMock.LogService.fetchPage.mockResolvedValue(mockFetchPageResponse);
});

describe('LogsPage', () => {
  it('renders loading state initially', () => {
    render(<LogsPage />);
    expect(screen.getByText('Загрузка...')).toBeInTheDocument();
  });

  it('renders error when fetch fails', async () => {
    logServiceMock.LogService.fetchPage.mockRejectedValue(new Error('Test error'));
    render(<LogsPage />);
    // The page shows the error message from the caught error
    expect(await screen.findByText('Test error')).toBeInTheDocument();
  });

  it('applies filters and fetches logs', async () => {
    const mockData = [
      {
        id: '1',
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
    logServiceMock.LogService.fetchPage.mockResolvedValue(mockResponse);

    render(<LogsPage />);
    // Wait for data to load
    expect(await screen.findByText(/File received/)).toBeInTheDocument();
    // verify fetchPage called
    expect(logServiceMock.LogService.fetchPage).toHaveBeenCalledWith(1, 20, expect.any(Object));
  });
});
