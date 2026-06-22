"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { CalendarClock, RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";

type Ev = {
  id: string;
  time: string;
  currency: string;
  country: string;
  title: string;
  impact: string;
  category: string | null;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
};

const FLAGS: Record<string, string> = {
  USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", JPY: "🇯🇵", CHF: "🇨🇭",
  AUD: "🇦🇺", CAD: "🇨🇦", NZD: "🇳🇿", CNY: "🇨🇳",
};
const flag = (c: string) => FLAGS[c] ?? "🏳️";

const IMPACTS = ["high", "medium", "low"] as const;
const IMPACT_DOT: Record<string, string> = {
  high: "bg-loss", medium: "bg-warn", low: "bg-faint", holiday: "bg-accent",
};

// Monday 00:00 of the week containing `base`, shifted by `offsetWeeks`.
function weekStart(offsetWeeks: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow + offsetWeeks * 7);
  return d;
}

export default function EconCalPage() {
  const { t, locale } = useI18n();
  const [events, setEvents] = useState<Ev[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [curFilter, setCurFilter] = useState<Set<string>>(new Set());
  const [impFilter, setImpFilter] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState("all");

  // Current week only (the free feed serves just this week).
  const range = useMemo(() => {
    const from = weekStart(0);
    const to = new Date(from);
    to.setDate(to.getDate() + 7);
    return { from, to };
  }, []);

  const load = useCallback(
    async (force = false) => {
      if (force) setRefreshing(true);
      else setLoading(true);
      try {
        const p = new URLSearchParams({
          from: range.from.toISOString(),
          to: range.to.toISOString(),
        });
        if (force) p.set("refresh", "1");
        const res = await fetch(`/api/econcal?${p}`);
        if (res.ok) {
          const d = await res.json();
          setEvents(d.events ?? []);
          setCurrencies(d.currencies ?? []);
          setCategories(d.categories ?? []);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range],
  );

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (set: Set<string>, v: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };

  const shown = events.filter(
    (e) =>
      (curFilter.size === 0 || curFilter.has(e.currency)) &&
      (impFilter.size === 0 || impFilter.has(e.impact)) &&
      (category === "all" || e.category === category),
  );

  // Group by calendar day (local).
  const days = useMemo(() => {
    const map = new Map<string, Ev[]>();
    for (const e of shown) {
      const key = new Date(e.time).toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
        weekday: "long", day: "numeric", month: "long",
      });
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    return Array.from(map.entries());
  }, [shown, locale]);

  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString(locale === "ru" ? "ru-RU" : "en-US", {
      hour: "2-digit", minute: "2-digit",
    });

  const loc = locale === "ru" ? "ru-RU" : "en-US";
  const weekLabel = `${range.from.toLocaleDateString(loc, { day: "numeric", month: "long" })} – ${new Date(range.to.getTime() - 1).toLocaleDateString(loc, { day: "numeric", month: "long" })}`;

  return (
    <div className="px-6 py-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <CalendarClock size={20} className="text-accent" />
          {t("econcal.title")}
        </h1>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg input-base text-sm hover:border-border-strong disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
          {t("econcal.refresh")}
        </button>
      </div>
      <p className="text-sm text-muted mt-1">{t("econcal.subtitle")}</p>
      <div className="inline-flex items-center gap-2 mt-2 mb-4 text-sm">
        <span className="text-faint">{t("econcal.thisWeek")}:</span>
        <span className="font-medium tabular-nums">{weekLabel}</span>
      </div>

      {/* Filters */}
      <div className="space-y-2 mb-5">
        <div className="flex flex-wrap items-center gap-1.5">
          {currencies.map((c) => (
            <button
              key={c}
              onClick={() => toggle(curFilter, c, setCurFilter)}
              className={clsx(
                "px-2 py-1 rounded-full text-xs border transition inline-flex items-center gap-1",
                curFilter.has(c) ? "bg-accent/15 text-accent border-accent/30" : "text-muted border-border hover:text-fg",
              )}
            >
              <span>{flag(c)}</span> {c}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {IMPACTS.map((im) => (
            <button
              key={im}
              onClick={() => toggle(impFilter, im, setImpFilter)}
              className={clsx(
                "px-2.5 py-1 rounded-full text-xs border transition inline-flex items-center gap-1.5",
                impFilter.has(im) ? "bg-accent/15 text-accent border-accent/30" : "text-muted border-border hover:text-fg",
              )}
            >
              <span className={clsx("h-2 w-2 rounded-full", IMPACT_DOT[im])} /> {t(`econcal.impact.${im}`)}
            </button>
          ))}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input-base text-xs py-1 cursor-pointer ml-1"
          >
            <option value="all">{t("econcal.allTypes")}</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : days.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("econcal.empty")}</div>
      ) : (
        <div className="space-y-5">
          {days.map(([day, evs]) => (
            <div key={day}>
              <div className="text-xs uppercase tracking-wide text-faint mb-2">{day}</div>
              <div className="card divide-y divide-border overflow-hidden">
                {evs.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="text-faint tabular-nums w-12 shrink-0">{fmtTime(e.time)}</span>
                    <span className="shrink-0" title={e.country}>{flag(e.currency)}</span>
                    <span className="text-xs text-faint w-9 shrink-0">{e.currency}</span>
                    <span className={clsx("h-2 w-2 rounded-full shrink-0", IMPACT_DOT[e.impact])} title={e.impact} />
                    <span className="flex-1 min-w-0 truncate">{e.title}</span>
                    <div className="hidden sm:flex items-center gap-3 text-xs tabular-nums shrink-0">
                      <Val label={t("econcal.actual")} v={e.actual} highlight />
                      <Val label={t("econcal.forecast")} v={e.forecast} />
                      <Val label={t("econcal.previous")} v={e.previous} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Val({ label, v, highlight }: { label: string; v: string | null; highlight?: boolean }) {
  return (
    <div className="w-16 text-right">
      <div className="text-[10px] text-faint">{label}</div>
      <div className={highlight && v ? "text-fg font-medium" : "text-muted"}>{v ?? "—"}</div>
    </div>
  );
}
