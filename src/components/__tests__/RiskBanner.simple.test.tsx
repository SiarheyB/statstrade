import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/i18n/provider', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('@/lib/format', () => ({
  fmtUsd: (val: number) => `$${val}`,
}));

import RiskBanner from '@/components/RiskBanner';

describe('Basic RiskBanner rendering', () => {
  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ accounts: [] }),
    });
  });

  it('renders nothing when there are no risks', () => {
    const { container } = render(<RiskBanner accountId="all" />);
    expect(container.querySelector('*')).toBeNull();
  });
});