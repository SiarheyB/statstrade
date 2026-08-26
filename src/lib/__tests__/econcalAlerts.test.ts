import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ALERT_SETTINGS,
  alertKey,
  dueAlerts,
  groupByTime,
  type AlertEvent,
  type EconAlertSettings,
} from '@/lib/econcalAlerts';

const NOW = Date.parse('2026-08-26T12:00:00.000Z');

const ev = (over: Partial<AlertEvent> = {}): AlertEvent => ({
  id: 'e1',
  time: new Date(NOW + 15 * 60_000).toISOString(),
  currency: 'USD',
  title: 'Non-Farm Employment Change',
  impact: 'high',
  forecast: '190K',
  previous: '227K',
  ...over,
});

const settings = (over: Partial<EconAlertSettings> = {}): EconAlertSettings => ({
  ...DEFAULT_ALERT_SETTINGS,
  ...over,
});

describe('dueAlerts', () => {
  it('срабатывает ровно на рубеже и молчит до него', () => {
    const s = settings({ leads: [15, 5] });
    expect(dueAlerts([ev()], s, NOW, new Set())).toHaveLength(1);
    // за 16 минут — ещё рано
    expect(dueAlerts([ev()], s, NOW - 60_000, new Set())).toHaveLength(0);
  });

  it('не повторяет уже показанный рубеж, но напоминает на следующем', () => {
    const s = settings({ leads: [15, 5] });
    const seen = new Set([alertKey('e1', 15)]);
    expect(dueAlerts([ev()], s, NOW, seen)).toHaveLength(0);
    // до события 5 минут — второй рубеж ещё не гасили
    const later = NOW + 10 * 60_000;
    expect(dueAlerts([ev()], s, later, seen)).toHaveLength(1);
  });

  it('на позднем заходе показывает одно окно и гасит все пройденные рубежи', () => {
    const s = settings({ leads: [15, 10, 5] });
    // до события 3 минуты: пройдены все три рубежа
    const due = dueAlerts([ev()], s, NOW + 12 * 60_000, new Set());
    expect(due).toHaveLength(1);
    expect(due[0].minutesLeft).toBe(3);
    expect(due[0].keys.sort()).toEqual(['e1:10', 'e1:15', 'e1:5']);
  });

  it('фильтрует по важности и валютам', () => {
    const events = [
      ev({ id: 'high-usd' }),
      ev({ id: 'med-eur', impact: 'medium', currency: 'EUR' }),
      ev({ id: 'low-gbp', impact: 'low', currency: 'GBP' }),
    ];
    const onlyHigh = dueAlerts(events, settings(), NOW, new Set());
    expect(onlyHigh.map((d) => d.event.id)).toEqual(['high-usd']);

    const eurMedium = dueAlerts(
      events,
      settings({ impacts: ['medium'], currencies: ['EUR'] }),
      NOW,
      new Set(),
    );
    expect(eurMedium.map((d) => d.event.id)).toEqual(['med-eur']);

    const gbpButHighOnly = dueAlerts(events, settings({ currencies: ['GBP'] }), NOW, new Set());
    expect(gbpButHighOnly).toHaveLength(0);
  });

  it('молчит при выключенных уведомлениях и по вышедшим событиям', () => {
    expect(dueAlerts([ev()], settings({ enabled: false }), NOW, new Set())).toHaveLength(0);
    // публикация была минуту назад
    const past = NOW + 16 * 60_000;
    expect(dueAlerts([ev()], settings(), past, new Set())).toHaveLength(0);
  });

  it('праздники и прочие импакты вне списка не уведомляют', () => {
    expect(
      dueAlerts([ev({ impact: 'holiday' })], settings({ impacts: ['high', 'medium', 'low'] }), NOW, new Set()),
    ).toHaveLength(0);
  });

  it('сортирует по времени публикации', () => {
    const events = [
      ev({ id: 'later', time: new Date(NOW + 14 * 60_000).toISOString() }),
      ev({ id: 'sooner', time: new Date(NOW + 4 * 60_000).toISOString() }),
    ];
    const due = dueAlerts(events, settings({ leads: [15] }), NOW, new Set());
    expect(due.map((d) => d.event.id)).toEqual(['sooner', 'later']);
  });
});

describe('groupByTime', () => {
  it('собирает события одной минуты в одну пачку, важное — первым', () => {
    const same = new Date(NOW + 15 * 60_000).toISOString();
    const due = dueAlerts(
      [
        ev({ id: 'medium', impact: 'medium', title: 'Unemployment Rate', time: same }),
        ev({ id: 'high', time: same }),
        ev({ id: 'other-time', time: new Date(NOW + 10 * 60_000).toISOString() }),
      ],
      settings({ impacts: ['high', 'medium'], leads: [15] }),
      NOW,
      new Set(),
    );
    const groups = groupByTime(due);
    expect(groups).toHaveLength(2);
    expect(groups[0].events.map((e) => e.id)).toEqual(['other-time']);
    expect(groups[1].events.map((e) => e.id)).toEqual(['high', 'medium']);
  });
});
