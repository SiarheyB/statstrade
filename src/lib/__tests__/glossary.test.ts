import { describe, it, expect } from 'vitest';
import { GLOSSARY, matchTerm } from '@/lib/glossary';

describe('glossary', () => {
  it('defines descriptions for common terms', () => {
    expect(GLOSSARY['P&L']).toContain('Profit');
    expect(GLOSSARY['MFE']).toContain('Maximum Favorable');
    expect(GLOSSARY['Sharpe']).toContain('Шарпа');
  });

  it('matchTerm returns exact key when present', () => {
    expect(matchTerm('MFE')).toBe('MFE');
    expect(matchTerm('P&L')).toBe('P&L');
    expect(matchTerm('Profit Factor')).toBe('Profit Factor');
  });

  it('matchTerm finds substring terms inside a longer label', () => {
    expect(matchTerm('Мой Win Rate составил 60%')).toBe('Win Rate');
    expect(matchTerm('Sharpe ratio упал')).toBe('Sharpe');
    expect(matchTerm('Посмотри на RR сделки')).toBe('RR');
  });

  it('matchTerm prefers longer multi-word terms over substrings', () => {
    // "Profit Factor" should win over "Payoff" / "ROI" etc.
    expect(matchTerm('Анализ Profit Factor по неделе')).toBe('Profit Factor');
    expect(matchTerm('Recovery Factor высокий')).toBe('Recovery Factor');
    expect(matchTerm('Downside deviation маленький')).toBe('Downside deviation');
  });

  it('matchTerm returns undefined when no term matches', () => {
    expect(matchTerm('Случайный русский текст')).toBeUndefined();
    expect(matchTerm('')).toBeUndefined();
  });
});