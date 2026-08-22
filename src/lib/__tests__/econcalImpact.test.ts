import { describe, it, expect } from 'vitest';
import { investingImpact, resolveImpact } from '@/lib/econcalImpact';

describe('econcalImpact', () => {
  it('поднимает то, что у investing на три звезды, а у фида «low»', () => {
    expect(resolveImpact('Flash Manufacturing PMI', 'USD', 'low')).toBe('high');
    expect(resolveImpact('Flash Services PMI', 'USD', 'low')).toBe('high');
    expect(resolveImpact('Unemployment Claims', 'USD', 'medium')).toBe('high');
    expect(resolveImpact('Crude Oil Inventories', 'USD', 'low')).toBe('high');
    expect(resolveImpact('Final CPI y/y', 'EUR', 'low')).toBe('high');
  });

  it('опускает то, что у investing на две звезды, а у фида «high»', () => {
    expect(resolveImpact('CPI m/m', 'CAD', 'high')).toBe('medium');
    expect(resolveImpact('Claimant Count Change', 'GBP', 'high')).toBe('medium');
    expect(resolveImpact('Employment Change', 'AUD', 'high')).toBe('medium');
  });

  it('различает страны под одной валютой и одинаковые названия у разных валют', () => {
    expect(investingImpact('Flash Manufacturing PMI', 'USD')).toBe('high');
    expect(investingImpact('German Flash Manufacturing PMI', 'EUR')).toBe('medium');
    expect(investingImpact('Flash Manufacturing PMI', 'JPY')).toBe('low');
    expect(investingImpact('Unemployment Rate', 'GBP')).toBe('medium');
  });

  it('ставит верхнюю ступень решениям по ставке независимо от валюты', () => {
    expect(investingImpact('Federal Funds Rate', 'USD')).toBe('high');
    expect(investingImpact('Official Bank Rate', 'GBP')).toBe('high');
    expect(investingImpact('RBA Rate Statement', 'AUD')).toBe('high');
    expect(investingImpact('FOMC Statement', 'USD')).toBe('high');
  });

  it('держит речи центробанкиров на средней ступени, кроме отдельно заданных', () => {
    expect(investingImpact('FOMC Member Musalem Speaks', 'USD')).toBe('medium');
    expect(investingImpact('ECB President Lagarde Speaks', 'EUR')).toBe('medium');
    expect(investingImpact('Fed Chair Powell Speaks', 'USD')).toBe('high');
  });

  it('оставляет импакт фида для незнакомых событий и не трогает выходные', () => {
    expect(investingImpact('RBNZ Offshore Holdings', 'NZD')).toBeNull();
    expect(resolveImpact('RBNZ Offshore Holdings', 'NZD', 'low')).toBe('low');
    expect(resolveImpact('Bank Holiday', 'USD', 'holiday')).toBe('holiday');
  });

  it('берёт русскую шкалу там, где она расходится с англоязычной', () => {
    // ru.investing: две звезды, investing.com: одна.
    expect(investingImpact('Trade Balance', 'NZD')).toBe('medium');
    // ru.investing: одна звезда, investing.com: две.
    expect(investingImpact('Flash Manufacturing PMI', 'GBP')).toBe('low');
    expect(investingImpact('Flash Services PMI', 'GBP')).toBe('medium');
  });

  it('не зависит от регистра и лишних пробелов в названии', () => {
    expect(investingImpact('  flash   services pmi ', 'USD')).toBe('high');
  });
});
