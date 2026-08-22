import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the prisma module properly to avoid initialization errors
const mocks = vi.hoisted(() => ({
  tradeFindMany: vi.fn().mockResolvedValue([]),
  importedTradeFindMany: vi.fn().mockResolvedValue([]),
  exchangeAccountFindMany: vi.fn().mockResolvedValue([]),
  tradeAnnotationFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/db', () => ({
  prisma: {
    trade: { findMany: mocks.tradeFindMany },
    importedTrade: { findMany: mocks.importedTradeFindMany },
    exchangeAccount: { findMany: mocks.exchangeAccountFindMany },
    tradeAnnotation: { findMany: mocks.tradeAnnotationFindMany },
  },
}));

vi.mock('@/lib/analytics/metrics', () => ({
  computeMetrics: vi.fn().mockReturnValue({
    winRate: 0.5,
    profitFactor: 1.2,
    totalNetPnl: 100,
    expectancy: 10,
    maxDrawdownPct: 5,
    equityCurve: [],
    totalTrades: 10,
  }),
}));

import {
  computePublicSummary,
  expiryFrom,
  isExpired,
  computePublicTrades,
  formatRangeDate,
  generateShareToken,
  parseRangeDate,
} from '@/lib/mentorShare';

describe('mentorShare module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tradeFindMany.mockResolvedValue([]);
    mocks.importedTradeFindMany.mockResolvedValue([]);
    mocks.exchangeAccountFindMany.mockResolvedValue([]);
    mocks.tradeAnnotationFindMany.mockResolvedValue([]);
  });

  it('scopes trades by the user accounts and selects only needed columns', async () => {
    mocks.exchangeAccountFindMany.mockResolvedValue([{ id: 'a1', balance: 500 }]);
    await computePublicSummary('user123');

    for (const call of [mocks.tradeFindMany, mocks.importedTradeFindMany]) {
      const args = call.mock.calls[0][0];
      // Публичная ссылка открывается без входа и сколько угодно раз — тянуть
      // все колонки всей истории тут нельзя.
      expect(args.select).toBeTruthy();
      expect(args.where).toEqual({ accountId: { in: ['a1'] } });
    }
  });

  it('returns default capital when no accounts found', async () => {
    const result = await computePublicSummary('user123');
    expect(result.totalTrades).toBe(0);
    expect(result.netPnl).toBe(100);
    expect(result.profitFactor).toBe(1.2);
    // With no accounts, computeMetrics is called with the default capital 10000
    const { computeMetrics } = await import('@/lib/analytics/metrics');
    expect(computeMetrics).toHaveBeenCalledWith(expect.any(Array), 10000);
  });

  it('includes first and last trade dates from data', async () => {
    // Mock the trade data
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't1',
        accountId: 'acc1',
        symbol: 'BTC/USDT',
        base: 'BTC',
        quote: 'USDT',
        market: 'spot',
        exchange: 'bybit',
        side: 'buy',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-01T01:00:00Z'),
        qty: 0.1,
        entryPrice: 50000,
        exitPrice: 52000,
        grossPnl: 200,
        fees: 5,
        netPnl: 195,
        returnPct: 0.0039,
        fillCount: 1,
        result: 'win',
      },
    ]);

    const result = await computePublicSummary('user123');
    expect(result.firstTradeAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.lastTradeAt).toBe('2026-01-01T01:00:00.000Z');
  });

  it('computes netPnl from metrics (default capital path)', async () => {
    // Mock the trade data
    mocks.tradeFindMany.mockResolvedValue([
      {
        id: 't1',
        accountId: 'acc1',
        symbol: 'BTC/USDT',
        base: 'BTC',
        quote: 'USDT',
        market: 'spot',
        exchange: 'bybit',
        side: 'sell',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-02T00:00:00Z'),
        qty: 1,
        entryPrice: 50000,
        exitPrice: 52000,
        grossPnl: 2000,
        fees: 10,
        netPnl: 1990,
        returnPct: 0.04,
        fillCount: 1,
        result: 'win',
      },
    ]);

    const result = await computePublicSummary('user123');
    // netPnl comes from the mocked computeMetrics (totalNetPnl: 100)
    expect(result.netPnl).toBe(100);
    expect(result.totalTrades).toBe(1);
  });

  it('generateShareToken returns a 48-char hex string (192 bits)', () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[0-9a-f]{48}$/);
    expect(generateShareToken()).not.toBe(generateShareToken());
  });

  it('covers imported trades branch (result win/loss/breakeven, grossPnl = netProfit + swap)', async () => {
    mocks.importedTradeFindMany.mockResolvedValue([
      {
        accountId: 'acc1',
        externalId: 'ext1',
        symbol: 'BTC/USDT',
        base: 'BTC',
        quote: 'USDT',
        market: 'spot',
        source: 'bybit',
        side: 'buy',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-01T02:00:00Z'),
        qty: 0.1,
        entryPrice: 50000,
        exitPrice: 52000,
        grossProfit: 200,
        swap: -5,
        commission: 3,
        netPnl: 192,
        lots: 0.1,
        pips: 50,
      },
    ]);
    mocks.exchangeAccountFindMany.mockResolvedValue([{ balance: 5000 }]);

    const result = await computePublicSummary('user123');
    // 0 крипто + 1 импортированная
    expect(result.totalTrades).toBe(1);
    const { computeMetrics } = await import('@/lib/analytics/metrics');
    const passedTrades = (computeMetrics as any).mock.calls[0][0];
    expect(passedTrades[0].grossPnl).toBe(195); // netProfit + swap
    expect(passedTrades[0].fees).toBe(3);
    expect(passedTrades[0].result).toBe('win');
    // capital = сумма балансов аккаунтов
    expect(computeMetrics).toHaveBeenCalledWith(expect.any(Array), 5000);
  });

  it('classifies an imported trade as breakeven when netPnl ~ 0', async () => {
    mocks.importedTradeFindMany.mockResolvedValue([
      {
        accountId: 'acc1',
        externalId: 'ext2',
        symbol: 'ETH/USDT',
        base: 'ETH',
        quote: 'USDT',
        market: 'spot',
        source: 'binance',
        side: 'sell',
        entryTime: new Date('2026-01-01T00:00:00Z'),
        exitTime: new Date('2026-01-01T01:00:00Z'),
        qty: 1,
        entryPrice: 3000,
        exitPrice: 3000,
        grossProfit: 0,
        swap: 0,
        commission: 0,
        netPnl: 0,
        lots: 1,
        pips: 0,
      },
    ]);

    await computePublicSummary('user123');
    const { computeMetrics } = await import('@/lib/analytics/metrics');
    const passedTrades = (computeMetrics as any).mock.calls[0][0];
    expect(passedTrades[0].result).toBe('breakeven');
  });

  describe('computePublicTrades', () => {
    const account = { id: 'a1', label: 'Основной', exchange: 'bybit' };
    const trade = {
      id: 't1', accountId: 'a1', symbol: 'BTC/USDT', market: 'spot', side: 'long',
      entryTime: new Date('2026-06-01T10:00:00Z'), exitTime: new Date('2026-06-01T12:00:00Z'),
      entryPrice: 60000, exitPrice: 61200, returnPct: 0.02, rr: 2.4, result: 'win',
    };

    it('не выбирает из базы ни одной денежной колонки', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      mocks.tradeFindMany.mockResolvedValue([trade]);
      await computePublicTrades('u1');

      // Счёт: без balance и capital — по ним виден размер депозита.
      const accountSelect = mocks.exchangeAccountFindMany.mock.calls[0][0].select;
      expect(accountSelect).toEqual({ id: true, label: true, exchange: true });

      // Сделки: без netPnl, grossPnl, fees и qty (объём × цена — те же деньги).
      const tradeSelect = mocks.tradeFindMany.mock.calls[0][0].select;
      for (const money of ['netPnl', 'grossPnl', 'fees', 'qty']) {
        expect(tradeSelect).not.toHaveProperty(money);
      }
    });

    it('группирует сделки по счетам и подставляет публичную ссылку на скриншот', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account, { id: 'a2', label: 'Форекс', exchange: 'mt5' }]);
      mocks.tradeFindMany.mockResolvedValue([trade, { ...trade, id: 't2', accountId: 'a2' }]);
      mocks.tradeAnnotationFindMany.mockResolvedValue([
        { tradeKey: 't1', imagePublicUrl: 'https://drive.example/abc' },
      ]);

      const out = await computePublicTrades('u1');

      expect(out.map((a) => a.accountId)).toEqual(['a1', 'a2']);
      expect(out[0].trades[0].imageUrl).toBe('https://drive.example/abc');
      expect(out[1].trades[0].imageUrl).toBeNull();
      // Структура сделки на месте, денег в ней нет.
      expect(out[0].trades[0]).toMatchObject({ symbol: 'BTC/USDT', side: 'long', rr: 2.4, result: 'win' });
      expect(Object.keys(out[0].trades[0])).not.toContain('netPnl');
    });

    it('ссылка на один счёт не выходит за его пределы', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      mocks.tradeFindMany.mockResolvedValue([trade]);

      await computePublicTrades('u1', 'a1');

      // Счёт ищем среди счетов владельца ссылки: подставленный чужой id не
      // должен открыть чужие сделки.
      expect(mocks.exchangeAccountFindMany.mock.calls[0][0].where).toEqual({ userId: 'u1', id: 'a1' });
      // Сделки — только по найденным счетам.
      expect(mocks.tradeFindMany.mock.calls[0][0].where).toEqual({ accountId: { in: ['a1'] } });
    });

    it('сужает выборку выбранным периодом', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      const from = new Date('2026-06-01T00:00:00Z');
      const to = new Date('2026-07-01T00:00:00Z'); // начало следующих суток после 30 июня

      await computePublicTrades('u1', null, { from, to });

      // Границы по времени ВЫХОДА: конец строгий, потому что это уже 1 июля.
      expect(mocks.tradeFindMany.mock.calls[0][0].where.exitTime).toEqual({ gte: from, lt: to });
      // Импортированные сделки режутся тем же окном.
      expect(mocks.importedTradeFindMany.mock.calls[0][0].where.exitTime).toEqual({ gte: from, lt: to });
    });

    it('одна граница работает без второй', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      const from = new Date('2026-06-01T00:00:00Z');

      await computePublicTrades('u1', null, { from, to: null });

      expect(mocks.tradeFindMany.mock.calls[0][0].where.exitTime).toEqual({ gte: from });
    });

    it('без периода берёт всю историю', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      await computePublicTrades('u1', null, null);
      expect(mocks.tradeFindMany.mock.calls[0][0].where.exitTime).toBeUndefined();
    });

    it('без счёта берёт все счета пользователя', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account]);
      await computePublicTrades('u1', null);
      expect(mocks.exchangeAccountFindMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
    });

    it('счёт без сделок не показываем', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([account, { id: 'a2', label: 'Пустой', exchange: 'okx' }]);
      mocks.tradeFindMany.mockResolvedValue([trade]);

      const out = await computePublicTrades('u1');
      expect(out.map((a) => a.label)).toEqual(['Основной']);
    });

    it('импортированные сделки берёт под тем же ключом, что и аннотации', async () => {
      mocks.exchangeAccountFindMany.mockResolvedValue([{ id: 'a2', label: 'Форекс', exchange: 'mt5' }]);
      mocks.importedTradeFindMany.mockResolvedValue([
        {
          accountId: 'a2', externalId: '777', symbol: 'EURUSD', market: 'forex', side: 'short',
          entryTime: new Date('2026-06-02T08:00:00Z'), exitTime: new Date('2026-06-02T09:00:00Z'),
          entryPrice: 1.1, exitPrice: 1.09, rr: 1.5, netPnl: -25,
        },
      ]);
      mocks.tradeAnnotationFindMany.mockResolvedValue([
        { tradeKey: 'a2:777', imagePublicUrl: 'https://drive.example/eur' },
      ]);

      const out = await computePublicTrades('u1');
      expect(out[0].trades[0].id).toBe('a2:777');
      expect(out[0].trades[0].imageUrl).toBe('https://drive.example/eur');
      // Из netPnl наружу уходит только знак — как результат сделки.
      expect(out[0].trades[0].result).toBe('loss');
      expect(JSON.stringify(out)).not.toContain('-25');
    });
  });

  describe('границы периода из календаря', () => {
    it('конец периода — начало следующих суток, чтобы день попал целиком', () => {
      expect(parseRangeDate('2026-06-30', 'to')).toEqual(new Date('2026-07-01T00:00:00.000Z'));
      expect(parseRangeDate('2026-06-01', 'from')).toEqual(new Date('2026-06-01T00:00:00.000Z'));
    });

    it('пустая и кривая дата — это «без границы»', () => {
      expect(parseRangeDate('', 'from')).toBeNull();
      expect(parseRangeDate(null, 'to')).toBeNull();
      expect(parseRangeDate('30.06.2026', 'from')).toBeNull();
    });

    it('обратно в дату календаря отдаёт выбранный пользователем день', () => {
      expect(formatRangeDate(new Date('2026-07-01T00:00:00.000Z'), 'to')).toBe('2026-06-30');
      expect(formatRangeDate(new Date('2026-06-01T00:00:00.000Z'), 'from')).toBe('2026-06-01');
      expect(formatRangeDate(null, 'from')).toBe('');
    });
  });

  describe('срок жизни ссылки', () => {
    const now = Date.parse('2026-08-22T12:00:00Z');

    it('часы и дни считаются от «сейчас»', () => {
      expect(expiryFrom('hours', 48, now)).toEqual(new Date('2026-08-24T12:00:00Z'));
      // Дней может быть сколько угодно — и 2, и 102.
      expect(expiryFrom('days', 102, now)).toEqual(new Date('2026-12-02T12:00:00Z'));
      expect(expiryFrom('days', 2, now)).toEqual(new Date('2026-08-24T12:00:00Z'));
    });

    it('бессрочная ссылка и мусор на входе дают null', () => {
      expect(expiryFrom('forever', 10, now)).toBeNull();
      expect(expiryFrom(null, null, now)).toBeNull();
      expect(expiryFrom('days', 0, now)).toBeNull();
      expect(expiryFrom('days', -5, now)).toBeNull();
    });

    it('срок упирается в потолок — защита от опечатки', () => {
      // 10 000 дней превращаются в 3650: столько же, сколько «десять лет».
      expect(expiryFrom('days', 10_000, now)).toEqual(expiryFrom('days', 3650, now));
      expect(expiryFrom('hours', 99_999, now)).toEqual(expiryFrom('hours', 8760, now));
    });

    it('истёкшей считается ссылка, у которой срок уже наступил', () => {
      expect(isExpired(new Date(now - 1), now)).toBe(true);
      expect(isExpired(new Date(now), now)).toBe(true);
      expect(isExpired(new Date(now + 1), now)).toBe(false);
      // Бессрочная не истекает никогда.
      expect(isExpired(null, now)).toBe(false);
    });
  });
});
