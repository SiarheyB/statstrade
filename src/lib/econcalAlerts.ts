// Напоминания перед выходом экономических новостей.
//
// Настройки живут В БРАУЗЕРЕ (localStorage), а не в БД — как язык и часовой
// пояс (см. lib/i18n, lib/timezone). Причина та же и ещё одна сверху:
// разрешение на системные уведомления браузер выдаёт конкретному устройству,
// так что «уведомлять за 15 минут» с рабочего компьютера не имеет смысла
// переносить на телефон.

export type AlertImpact = "high" | "medium" | "low";

export const ALERT_IMPACTS: AlertImpact[] = ["high", "medium", "low"];

/** Рубежи (минуты до публикации), которые можно выбрать в настройках. */
export const LEAD_OPTIONS = [15, 10, 5, 1] as const;

export type EconAlertSettings = {
  enabled: boolean;
  impacts: AlertImpact[];
  /** Минуты до события. Несколько — напомним на каждом рубеже. */
  leads: number[];
  /** Пусто = все валюты. */
  currencies: string[];
  sound: boolean;
  /** Дублировать в системные уведомления браузера (Notification API). */
  system: boolean;
};

export const DEFAULT_ALERT_SETTINGS: EconAlertSettings = {
  enabled: true,
  impacts: ["high"],
  leads: [15, 5],
  currencies: [],
  sound: false,
  system: false,
};

export const ALERT_SETTINGS_KEY = "ts_econcal_alerts";
export const ALERT_SEEN_KEY = "ts_econcal_alerts_seen";

/** Событие изменения настроек — вкладка одна, `storage` в ней не срабатывает. */
export const ALERT_SETTINGS_EVENT = "ts:econcal-alerts";
/** Тестовый показ окна из настроек. */
export const ALERT_DEMO_EVENT = "ts:econcal-alerts-demo";

export type AlertEvent = {
  id: string;
  /** ISO-время публикации. */
  time: string;
  currency: string;
  title: string;
  impact: string;
  forecast?: string | null;
  previous?: string | null;
};

export type DueAlert = {
  event: AlertEvent;
  /** Сколько минут осталось на самом деле (а не выбранный рубеж). */
  minutesLeft: number;
  /** Ключи дедупликации: все пройденные рубежи этого события. */
  keys: string[];
};

function normalizeSettings(raw: unknown): EconAlertSettings {
  const d = DEFAULT_ALERT_SETTINGS;
  if (!raw || typeof raw !== "object") return { ...d };
  const o = raw as Record<string, unknown>;
  const impacts = Array.isArray(o.impacts)
    ? (o.impacts.filter((i): i is AlertImpact => ALERT_IMPACTS.includes(i as AlertImpact)))
    : d.impacts;
  const leads = Array.isArray(o.leads)
    ? [...new Set(o.leads.filter((l): l is number => LEAD_OPTIONS.includes(l as (typeof LEAD_OPTIONS)[number])))]
        .sort((a, b) => b - a)
    : d.leads;
  const currencies = Array.isArray(o.currencies)
    ? o.currencies.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 8)
    : d.currencies;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : d.enabled,
    // Пустые списки означали бы «не уведомлять никогда» — для этого есть
    // выключатель, а тут они выглядели бы как молча сломавшаяся функция.
    impacts: impacts.length ? impacts : d.impacts,
    leads: leads.length ? leads : d.leads,
    currencies,
    sound: typeof o.sound === "boolean" ? o.sound : d.sound,
    system: typeof o.system === "boolean" ? o.system : d.system,
  };
}

export function loadAlertSettings(): EconAlertSettings {
  if (typeof window === "undefined") return { ...DEFAULT_ALERT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(ALERT_SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_ALERT_SETTINGS };
  }
}

export function saveAlertSettings(s: EconAlertSettings): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // Приватный режим / переполненное хранилище: настройки просто не переживут
    // перезагрузку, показывать ошибку не за что.
  }
  window.dispatchEvent(new CustomEvent(ALERT_SETTINGS_EVENT, { detail: s }));
}

export const alertKey = (eventId: string, lead: number) => `${eventId}:${lead}`;

/**
 * Какие напоминания пора показать прямо сейчас.
 *
 * Рубеж считается пройденным, когда до публикации осталось не больше его
 * самого. Все пройденные рубежи события гасятся разом (`keys`), поэтому если
 * человек открыл вкладку за 3 минуты до NFP с рубежами 15/10/5, он увидит
 * ОДНО окно («через 3 минуты»), а не три подряд.
 */
export function dueAlerts(
  events: AlertEvent[],
  settings: EconAlertSettings,
  now: number,
  seen: ReadonlySet<string>,
): DueAlert[] {
  if (!settings.enabled || !settings.leads.length) return [];
  const impacts = new Set<string>(settings.impacts);
  const currencies = settings.currencies.length ? new Set(settings.currencies) : null;
  const out: DueAlert[] = [];

  for (const e of events) {
    if (!impacts.has(e.impact)) continue;
    if (currencies && !currencies.has(e.currency)) continue;
    const ts = Date.parse(e.time);
    if (!Number.isFinite(ts)) continue;
    const msLeft = ts - now;
    // Вышедшее событие — уже не предупреждение. Небольшой допуск, чтобы
    // «за минуту» не потерялось из-за того, что тик пришёл секундой позже.
    if (msLeft < -15_000) continue;
    const passed = settings.leads.filter((l) => msLeft <= l * 60_000);
    if (!passed.length) continue;
    const keys = passed.map((l) => alertKey(e.id, l));
    if (keys.every((k) => seen.has(k))) continue;
    out.push({ event: e, minutesLeft: Math.max(0, Math.round(msLeft / 60_000)), keys });
  }

  return out.sort((a, b) => Date.parse(a.event.time) - Date.parse(b.event.time));
}

/** Важность по убыванию — по ней выбирается «главное» событие пачки. */
const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/**
 * Пачки событий с одним временем публикации: в 15:30 у США регулярно выходит
 * три-четыре показателя сразу — для трейдера это одна новость, а не три
 * всплывающих окна. Внутри пачки первым идёт самое важное событие.
 */
export function groupByTime(due: DueAlert[]): { time: string; events: AlertEvent[] }[] {
  const byTime = new Map<string, AlertEvent[]>();
  for (const d of due) {
    const list = byTime.get(d.event.time) ?? [];
    list.push(d.event);
    byTime.set(d.event.time, list);
  }
  return [...byTime.entries()]
    .map(([time, events]) => ({
      time,
      events: events.sort((a, b) => (IMPACT_RANK[b.impact] ?? 0) - (IMPACT_RANK[a.impact] ?? 0)),
    }))
    .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

type SeenMap = Record<string, number>;

/** Показанные напоминания переживают F5; старые чистим по времени события. */
export function loadSeen(now: number = Date.now()): Map<string, number> {
  const map = new Map<string, number>();
  if (typeof window === "undefined") return map;
  try {
    const raw = window.localStorage.getItem(ALERT_SEEN_KEY);
    const parsed = raw ? (JSON.parse(raw) as SeenMap) : {};
    const cutoff = now - 6 * 3600_000;
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && v > cutoff) map.set(k, v);
    }
  } catch {
    // битое хранилище — начинаем с чистого листа
  }
  return map;
}

export function saveSeen(map: Map<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALERT_SEEN_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // см. saveAlertSettings
  }
}
