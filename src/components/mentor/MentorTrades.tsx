/**
 * MentorTrades — журнал сделок на публичной странице «Режим ментора».
 *
 * Ментор смотрит не на деньги, а на то, КАК торгуют: паттерн, точку входа, тип
 * входа, ошибку, комментарий и скриншот. Поэтому строка таблицы — короткая
 * (что, куда, когда, сколько R), а разбор раскрывается по клику.
 *
 * Ни одной денежной величины: P&L, комиссий, объёма и баланса тут нет и быть
 * не может — они не приезжают с сервера (см. lib/mentorShare.ts).
 */
"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ImageIcon, Filter, X, StickyNote } from "lucide-react";
import clsx from "clsx";
import { useI18n } from "@/lib/i18n/provider";
import { fmtPct, fmtDuration, fmtPrice, fmtSymbol } from "@/lib/format";
import { ianaFor, type TimezoneId } from "@/lib/timezone";
import ImagePreviewModal from "@/components/ImagePreviewModal";
import type { PublicAccountTrades, PublicTrade } from "@/lib/mentorShare";

type FilterKey = "pattern" | "entryPoint" | "entryType" | "mistake";
type Filters = Record<FilterKey, string>;

const ALL = "";
const EMPTY_FILTERS: Filters = { pattern: ALL, entryPoint: ALL, entryType: ALL, mistake: ALL };

// Порядок колонок разбора — он же порядок фильтров сверху.
const FILTER_KEYS: FilterKey[] = ["pattern", "entryPoint", "entryType", "mistake"];

export default function MentorTrades({ accounts }: { accounts: PublicAccountTrades[] }) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Варианты для выпадающих списков собираются из самих сделок: у каждого
  // трейдера свой набор паттернов и ошибок (их можно настроить под себя).
  const options = useMemo(() => {
    const acc: Record<FilterKey, Set<string>> = {
      pattern: new Set(), entryPoint: new Set(), entryType: new Set(), mistake: new Set(),
    };
    for (const a of accounts) {
      for (const tr of a.trades) {
        for (const key of FILTER_KEYS) {
          const v = tr[key];
          if (v) acc[key].add(v);
        }
      }
    }
    return Object.fromEntries(
      FILTER_KEYS.map((k) => [k, [...acc[k]].sort((x, y) => x.localeCompare(y))]),
    ) as Record<FilterKey, string[]>;
  }, [accounts]);

  const filtered = useMemo(
    () =>
      accounts
        .map((a) => ({
          ...a,
          trades: a.trades.filter((tr) => FILTER_KEYS.every((k) => !filters[k] || tr[k] === filters[k])),
        }))
        .filter((a) => a.trades.length > 0),
    [accounts, filters],
  );

  const shown = filtered.reduce((n, a) => n + a.trades.length, 0);
  const total = accounts.reduce((n, a) => n + a.trades.length, 0);
  const active = FILTER_KEYS.filter((k) => filters[k]).length;

  // Плоский список сделок со скриншотами — в том же порядке, что на экране.
  // Листаем именно по нему: то, что скрыто фильтром, в просмотре не всплывает.
  const gallery = useMemo(
    () => filtered.flatMap((a) => a.trades.filter((tr) => tr.imageUrl)),
    [filtered],
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const index = gallery.findIndex((tr) => tr.id === previewId);
  const current = index >= 0 ? gallery[index] : null;
  // Листание закольцовано: с последнего скриншота стрелка вправо ведёт к
  // первому. Иначе на краю кнопка просто перестаёт отвечать и выглядит сломанной.
  // Без useCallback: функция дешёвая, а компилятору React проще без ручной
  // мемоизации вокруг функционального setState.
  function step(delta: number) {
    setPreviewId((openId) => {
      if (gallery.length === 0) return openId;
      const at = gallery.findIndex((tr) => tr.id === openId);
      return gallery[(at + delta + gallery.length) % gallery.length].id;
    });
  }

  return (
    <>
      <div className="card mt-5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter size={14} className="text-accent" />
          {t("mentorPage.filters")}
          {active > 0 && (
            <button
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-fg"
            >
              <X size={12} /> {t("mentorPage.reset")}
            </button>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FILTER_KEYS.map((key) => (
            <label key={key} className="block">
              <span className="mb-1 block text-xs text-faint">{t(`mentorPage.col.${key}`)}</span>
              <select
                value={filters[key]}
                onChange={(e) => setFilters((prev) => ({ ...prev, [key]: e.target.value }))}
                disabled={options[key].length === 0}
                className="input-base w-full px-3 py-1.5 text-sm disabled:opacity-40"
              >
                <option value={ALL}>{t("mentorPage.any")}</option>
                {options[key].map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {active > 0 && (
          <p className="mt-3 text-xs text-faint">
            {t("mentorPage.filtered", { shown, total })}
          </p>
        )}
      </div>

      {filtered.map((account) => (
        <AccountTable key={account.accountId} account={account} onPreview={setPreviewId} />
      ))}

      {filtered.length === 0 && (
        <div className="card mt-5 p-10 text-center text-sm text-muted">{t("mentorPage.nothing")}</div>
      )}

      {current?.imageUrl && (
        // key — чтобы при листании сбрасывался зум предыдущей картинки.
        <ImagePreviewModal
          key={current.id}
          url={current.imageUrl}
          externalUrl={current.imageUrl}
          caption={`${fmtSymbol(current.symbol)} · ${current.entryTime.slice(0, 10)}`}
          position={{ index: index + 1, total: gallery.length }}
          onPrev={gallery.length > 1 ? () => step(-1) : undefined}
          onNext={gallery.length > 1 ? () => step(1) : undefined}
          onClose={() => setPreviewId(null)}
        />
      )}
    </>
  );
}

function AccountTable({
  account,
  onPreview,
}: {
  account: PublicAccountTrades;
  onPreview: (tradeId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="card mt-5 overflow-hidden p-0">
      <div className="flex items-baseline gap-2 border-b border-border px-4 py-3">
        <h3 className="text-sm font-medium">{account.label}</h3>
        <span className="text-xs uppercase tracking-wide text-faint">{account.exchange}</span>
        <span className="ml-auto text-xs text-faint">
          {t("mentorPage.tradesCount", { n: account.trades.length })}
        </span>
      </div>
      <p className="border-b border-border px-4 py-2 text-xs text-faint">{t("mentorPage.rowHint")}</p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <Th>{t("mentorPage.col.symbol")}</Th>
              <Th>{t("mentorPage.col.side")}</Th>
              <Th right>{t("mentorPage.col.prices")}</Th>
              <Th>{t("mentorPage.col.pattern")}</Th>
              <Th>{t("mentorPage.col.entryPoint")}</Th>
              <Th>{t("mentorPage.col.entryType")}</Th>
              <Th>{t("mentorPage.col.mistake")}</Th>
              <Th />
              <Th>{t("mentorPage.col.screenshot")}</Th>
              <Th right>{t("mentorPage.col.result")}</Th>
            </tr>
          </thead>
          <tbody>
            {account.trades.map((tr) => (
              <TradeRow key={tr.id} trade={tr} onPreview={onPreview} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TradeRow({ trade, onPreview }: { trade: PublicTrade; onPreview: (tradeId: string) => void }) {
  const { t, timezone, locale } = useI18n();
  const [open, setOpen] = useState(false);
  // Раскрывать есть что, только если трейдер что-то записал.
  const hasDetails = Boolean(
    trade.note || trade.mistake || trade.entryType || trade.imageUrl || trade.entryPoint || trade.pattern,
  );

  return (
    <>
      <tr
        onClick={() => hasDetails && setOpen((v) => !v)}
        className={clsx(
          "border-b border-border last:border-0",
          hasDetails && "cursor-pointer hover:bg-surface-2/50",
          open && "bg-surface-2/40",
        )}
      >
        <Td>
          <span className="inline-flex items-center gap-1.5">
            {/* Убыток больше запланированного 1R — тот же знак, что в журнале
                сделок (/dashboard/trades): ментору это первое, что нужно видеть. */}
            {trade.rr !== null && trade.rr < -1 && (
              <span className="group relative inline-flex shrink-0" title={t("trades.riskWarning")}>
                <AlertTriangle size={14} className="text-loss" />
                <span className="pointer-events-none absolute left-0 top-full z-30 mt-1 hidden w-56 whitespace-normal rounded-md border border-loss/40 bg-bg px-2.5 py-1.5 text-xs text-loss shadow-lg group-hover:block">
                  {t("trades.riskWarning")}
                </span>
              </span>
            )}
            <span className="font-medium">{fmtSymbol(trade.symbol)}</span>
          </span>
        </Td>
        <Td>
          <span className={trade.side === "long" ? "text-profit" : "text-loss"}>
            {t(`mentorPage.side.${trade.side === "long" ? "long" : "short"}`)}
          </span>
        </Td>
        <Td right>
          <div>
            {fmtPrice(trade.entryPrice)} <span className="text-faint">→</span> {fmtPrice(trade.exitPrice)}
          </div>
          <div className="text-[11px] text-faint">
            {trade.stopLoss === null ? (
              <span className="text-faint/60">{t("mentorPage.noStop")}</span>
            ) : (
              <>
                {t("mentorPage.col.stop")} <span className="text-loss/80">{fmtPrice(trade.stopLoss)}</span>
              </>
            )}
          </div>
        </Td>
        <Td>{trade.pattern ? <Chip text={trade.pattern} /> : <Dash />}</Td>
        <Td>{trade.entryPoint ? <Chip text={trade.entryPoint} /> : <Dash />}</Td>
        <Td>{trade.entryType ? <Chip text={trade.entryType} /> : <Dash />}</Td>
        <Td>{trade.mistake ? <Chip text={trade.mistake} tone="warn" /> : <Dash />}</Td>
        <Td>
          <span className="flex items-center justify-end gap-1.5 text-faint">
            {trade.note && <StickyNote size={13} />}
            {hasDetails && (
              <ChevronDown size={14} className={clsx("transition-transform", open && "rotate-180")} />
            )}
          </span>
        </Td>
        <Td>
          {trade.imageUrl ? (
            <button
              type="button"
              // Клик по кнопке не должен заодно раскрывать разбор.
              onClick={(e) => {
                e.stopPropagation();
                onPreview(trade.id);
              }}
              className="inline-flex items-center gap-1 rounded border border-accent/30 bg-accent/5 px-2 py-0.5 text-xs text-accent transition-colors hover:border-accent/60 hover:bg-accent/10"
            >
              <ImageIcon size={12} /> {t("mentorPage.open")}
            </button>
          ) : (
            <Dash />
          )}
        </Td>
        <Td right>
          <div className={resultTone(trade.returnPct)}>
            {trade.returnPct === null ? <Dash /> : fmtPct(trade.returnPct, 2)}
          </div>
          <div className="text-[11px]">
            {trade.rr === null ? (
              <span className="text-faint/60">—</span>
            ) : (
              <span className={resultTone(trade.rr)}>
                {trade.rr > 0 ? "+" : ""}
                {trade.rr.toFixed(2)}R
              </span>
            )}
          </div>
        </Td>
      </tr>

      {open && (
        <tr className="border-b border-border bg-surface-2/30 last:border-0">
          <td colSpan={10} className="px-4 pb-4 pt-1">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <Detail
                label={t("mentorPage.col.open")}
                value={localTime(trade.entryTime, timezone, locale, true)}
              />
              <Detail
                label={t("mentorPage.col.close")}
                value={localTime(trade.exitTime, timezone, locale, true)}
              />
              <Detail label={t("mentorPage.col.duration")} value={fmtDuration(trade.durationMs)} />
            </div>

            <div className="mt-2 rounded-lg border border-border bg-bg/40 p-3">
              <div className="flex items-center gap-1.5 text-xs text-faint">
                <StickyNote size={12} /> {t("mentorPage.col.note")}
              </div>
              <p
                className={clsx(
                  "mt-1.5 whitespace-pre-wrap text-sm leading-relaxed",
                  trade.note ? "text-fg" : "text-faint",
                )}
              >
                {trade.note || t("mentorPage.noNote")}
              </p>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <div className="text-xs text-faint">{label}</div>
      <div className="mt-1 text-sm tabular-nums">{value}</div>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone?: "warn" }) {
  return (
    <span
      title={text}
      className={clsx(
        "inline-block max-w-[8.5rem] truncate rounded-full border px-2 py-0.5 text-xs",
        tone === "warn"
          ? "border-warn/30 bg-warn/10 text-warn"
          : "border-border bg-surface-2 text-muted",
      )}
    >
      {text}
    </span>
  );
}

function resultTone(v: number | null): string {
  if (v === null) return "text-faint";
  return v >= 0 ? "text-profit" : "text-loss";
}

function Dash() {
  return <span className="text-faint">—</span>;
}

// Время показываем в поясе зрителя: ментор и трейдер могут сидеть в разных
// странах, и «18:46» без пояса читалось бы неверно. Пояс берётся из той же
// настройки, что и везде в приложении (см. lib/timezone.ts).
function localTime(iso: string, timezone: TimezoneId, locale: string, withYear = false): string {
  const tz = ianaFor(timezone);
  return new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : "en-CA", {
    ...(withYear ? { year: "numeric" as const } : {}),
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(iso));
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={clsx("whitespace-nowrap px-2.5 py-2 font-normal", right ? "text-right" : "text-left")}>
      {children}
    </th>
  );
}

function Td({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <td className={clsx("whitespace-nowrap px-2.5 py-2 tabular-nums", right ? "text-right" : "text-left")}>
      {children}
    </td>
  );
}
