import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET, DELETE } from '../route';

// Mock the auth and log service
vi.mock('@/lib/admin', () => ({
  requireAdmin: vi.fn(),
}));

vi.mock('@/lib/log.service', () => ({
  LogService: {
    fetchPage: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

import { requireAdmin } from '@/lib/admin';
import { LogService } from '@/lib/log.service';

const mockAdminSession = {
  userId: 'admin1',
  email: 'admin@test.com',
};

const mockNonAdminSession = {
  userId: 'user1',
  email: 'user@test.com',
};

const mockLogsResponse = {
  data: [
    {
      id: '550e8400-e29b-41d4-a716-446655440000',
      module: 'import',
      accountId: 'acc1',
      eventType: 'FILE_RECEIVED',
      message: 'File received',
      level: 'info',
      timestamp: new Date().toISOString(),
      details: { size: 1024 },
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
  pages: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/admin/logs', () => {
  it('returns 401 for non-admin users', async () => {
    requireAdmin.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 })
    );

    const request = new Request('http://localhost/api/admin/logs');
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('returns paginated logs for admin users', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.fetchPage.mockResolvedValueOnce(mockLogsResponse);

    const request = new Request('http://localhost/api/admin/logs?page=1&limit=20');
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toEqual(mockLogsResponse);
    expect(LogService.fetchPage).toHaveBeenCalledWith(1, 20, expect.any(Object));
  });

  it('handles filter parameters correctly', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.fetchPage.mockResolvedValueOnce(mockLogsResponse);

    const request = new Request('http://localhost/api/admin/logs?module=import&level=error&search=test&page=2&limit=10');
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(LogService.fetchPage).toHaveBeenCalledWith(
      2,
      10,
      expect.objectContaining({
        module: 'import',
        level: 'error',
        search: 'test',
      })
    );
  });

  it('handles date filters', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.fetchPage.mockResolvedValueOnce(mockLogsResponse);

    const startDate = '2024-01-01';
    const endDate = '2024-12-31';
    const request = new Request(`http://localhost/api/admin/logs?startDate=${startDate}&endDate=${endDate}`);
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(LogService.fetchPage).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      })
    );
  });

  it('handles fetch errors gracefully', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.fetchPage.mockRejectedValueOnce(new Error('Database error'));

    const request = new Request('http://localhost/api/admin/logs');
    const response = await GET(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to fetch logs');
  });
});

describe('DELETE /api/admin/logs', () => {
  it('returns 401 for non-admin users', async () => {
    requireAdmin.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Admin access required' }), { status: 401 })
    );

    const request = new Request('http://localhost/api/admin/logs', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await DELETE(request);
    expect(response.status).toBe(401);
  });

  it('returns 400 when no ids provided', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);

    const request = new Request('http://localhost/api/admin/logs', {
      method: 'DELETE',
      body: JSON.stringify({ ids: [] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await DELETE(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBe('ids array is required');
  });

  it('deletes logs and returns success', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.deleteMany.mockResolvedValueOnce(undefined);

    const request = new Request('http://localhost/api/admin/logs', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await DELETE(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.deletedIds).toEqual(['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002']);
    expect(LogService.deleteMany).toHaveBeenCalledWith(['550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440001', '550e8400-e29b-41d4-a716-446655440002']);
  });

  it('handles delete errors gracefully', async () => {
    requireAdmin.mockResolvedValueOnce(mockAdminSession);
    LogService.deleteMany.mockRejectedValueOnce(new Error('Database error'));

    const request = new Request('http://localhost/api/admin/logs', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['550e8400-e29b-41d4-a716-446655440000'] }),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await DELETE(request);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBe('Failed to delete logs');
  });
});