import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertUnknownFees } from '@/lib/feeConvert';
import type { NormalizedFill } from '@/lib/exchanges';

function makeFill(over: Partial<NormalizedFill>): NormalizedFill {
  return {
    tradeId: 't1',
    orderId: null,
    symbol: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    market: 'spot',
    side: 'buy',
    price: 50000,
    amount: 0.1,
    cost: 5000,
    fee: 0.01,
    feeCurrency: 'BNB',
    realizedPnl: null,
    takerOrMaker: 'maker',
    timestamp: new Date('2024-01-01T00:00:00Z'),
    ...over,
  };
}

describe('feeConvert', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('converts stable fee on stable quote 1:1 in place', async () => {
    const fills = [makeFill({ fee: 5, feeCurrency: 'USDC' })];
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('USDT');
    expect(fills[0].fee).toBe(5);
  });

  it('skips when feeCurrency equals quote', async () => {
    const fills = [makeFill({ fee: 5, feeCurrency: 'USDT' })];
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('USDT');
  });

  it('skips when feeCurrency equals base', async () => {
    const fills = [makeFill({ fee: 5, feeCurrency: 'BTC' })];
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('BTC');
  });

  it('skips non-stable quote (no rate available)', async () => {
    const fills = [makeFill({ quote: 'BTC', feeCurrency: 'BNB' })];
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('BNB');
  });

  it('converts via network rate when available', async () => {
    const fills = [makeFill({ fee: 0.1, feeCurrency: 'BNB', timestamp: new Date('2024-03-01T00:00:00Z') })];
    // BNBUSDT daily close = 600
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [[0, 0, 0, 0, '600', 0]],
    });
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('USDT');
    expect(fills[0].fee).toBeCloseTo(0.1 * 600, 5);
  });

  it('leaves fee unchanged when network rate missing', async () => {
    const fills = [makeFill({ fee: 0.1, feeCurrency: 'BNB', timestamp: new Date('2024-04-01T00:00:00Z') })];
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => [],
    });
    await convertUnknownFees(fills);
    expect(fills[0].feeCurrency).toBe('BNB');
  });
});