import { describe, it, expect } from 'vitest';
import {
  SUPPORTED_EXCHANGES,
  EXCHANGE_IDS,
  isExchangeId,
  type ExchangeId,
} from '@/lib/exchangeIds';

describe('exchangeIds', () => {
  it('lists all supported exchanges', () => {
    expect(EXCHANGE_IDS).toEqual([
      'binance',
      'bybit',
      'okx',
      'kraken',
      'kucoin',
      'bitget',
      'gate',
      'mexc',
      'htx',
    ]);
  });

  it('exposes metadata for each exchange', () => {
    for (const id of EXCHANGE_IDS) {
      const meta = SUPPORTED_EXCHANGES[id as ExchangeId];
      expect(meta).toBeDefined();
      expect(meta.id).toBe(id);
      expect(typeof meta.name).toBe('string');
      expect(typeof meta.needsPassphrase).toBe('boolean');
      expect(typeof meta.supportsDemo).toBe('boolean');
      expect(meta.docsUrl.startsWith('https://')).toBe(true);
    }
  });

  it('marks okx/kucoin/bitget as needing passphrase', () => {
    expect(SUPPORTED_EXCHANGES.okx.needsPassphrase).toBe(true);
    expect(SUPPORTED_EXCHANGES.kucoin.needsPassphrase).toBe(true);
    expect(SUPPORTED_EXCHANGES.bitget.needsPassphrase).toBe(true);
    expect(SUPPORTED_EXCHANGES.binance.needsPassphrase).toBe(false);
  });

  it('marks binance/bybit/okx as supporting demo', () => {
    expect(SUPPORTED_EXCHANGES.binance.supportsDemo).toBe(true);
    expect(SUPPORTED_EXCHANGES.bybit.supportsDemo).toBe(true);
    expect(SUPPORTED_EXCHANGES.okx.supportsDemo).toBe(true);
    expect(SUPPORTED_EXCHANGES.kraken.supportsDemo).toBe(false);
  });

  it('isExchangeId returns true for known ids', () => {
    expect(isExchangeId('binance')).toBe(true);
    expect(isExchangeId('htx')).toBe(true);
  });

  it('isExchangeId returns false for unknown ids', () => {
    expect(isExchangeId('coinbase')).toBe(false);
    expect(isExchangeId('')).toBe(false);
    expect(isExchangeId('BINANCE')).toBe(false);
    expect(isExchangeId('mt4')).toBe(false);
  });

  it('isExchangeId narrows the type', () => {
    const value: string = 'bybit';
    if (isExchangeId(value)) {
      // TypeScript should accept this assignment
      const id: ExchangeId = value;
      expect(id).toBe('bybit');
    } else {
      throw new Error('expected bybit to be an exchange id');
    }
  });
});
