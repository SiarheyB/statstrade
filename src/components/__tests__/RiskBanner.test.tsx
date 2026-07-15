import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import RiskBanner from '@/components/RiskBanner';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// Mock global fetch
vi.mock('@/lib/api', () => ({
  GET: vi.fn(),
}));

// Mock GET endpoint
const mockAdminSession = { id: 'test-admin' } as any;
vi.mock('@/lib/admin', () => ({
  getAdminSession: vi.fn().mockResolvedValue(mockAdminSession),
}));

describe('RiskBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [] }),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders without errors', async () => {
    render(<RiskBanner accountId="all" />);
    await waitFor(() => {
      expect(screen.queryByText('risk.banner.breached')).not.toBeInTheDocument();
    });
  });
});