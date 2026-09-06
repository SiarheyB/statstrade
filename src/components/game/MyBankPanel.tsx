"use client";

// Свой банк — раздел «Мой банк» в банке.
//
// ЧТО ЭТО. Не второй центробанк: кредитов другим игрокам банк игрока не
// выдаёт. Он ЭМИТЕНТ — у него появляются акция и облигация, которые видит и
// может купить любой игрок в терминале. Для владельца это способ поднять
// деньги под своё имя, для остальных — две бумаги, за которыми стоит живой
// человек.
//
// ПОЧЕМУ ТАК ВЫГЛЯДИТ. Учреждение банка — редкое событие, лицензий на весь
// мир четыре. Форма с двумя полями рядом с таблицей процентов этого не
// передаёт вовсе, поэтому до получения лицензии раздел выглядит как
// ГРАМОТА: список условий с отметками и печать. Отметки не украшение — это
// единственный экран, где видно, чего именно не хватает.
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Landmark, Lock, ScrollText, TrendingUp } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";

interface Charter {
  deposit: number;
  prestige: number;
  contracts: number;
  reliability: number;
  ageDays: number;
}

interface Requirements {
  equity: number;
  prestige: number;
  contracts: number;
  reliability: number;
  ageDays: number;
  meets: { deposit: boolean; prestige: boolean; contracts: boolean; reliability: boolean; age: boolean };
  ready: boolean;
  slotsLeft: number;
}

interface Paper {
  kind: string;
  assetId: string;
  ticker: string;
  name: string;
  total: number;
  sold: number;
  /** Биржевая цена с сервера: по ней и пройдёт размещение. */
  price: number;
}

interface MyBank {
  id: string;
  name: string;
  motto: string | null;
  capital: number;
  bondsIssued: number;
  createdAt: number;
  papers: Paper[];
}

interface Payload {
  bank: MyBank | null;
  requirements: Requirements | null;
  charter: Charter;
}

export default function MyBankPanel() {
  const { t } = useI18n();
  const prices = useGameStore((s) => s.game.prices);
  const applyWorldCash = useGameStore((s) => s.applyWorldCash);
  const refreshListings = useGameStore((s) => s.refreshListings);

  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [motto, setMotto] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch("/api/game/userbank");
    if (res.ok) setData((await res.json()) as Payload);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, onOk: (json: Record<string, number | string>) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/game/userbank", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? t("game.bank.failed"));
        return;
      }
      onOk(json);
      await load();
      // Бумаги нового банка должны появиться в терминале сразу, а не после
      // перезахода: слот в справочнике безымянный, пока не прочитан листинг.
      await refreshListings();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card p-4 text-xs text-faint">{t("game.world.loading")}</div>;
  if (!data) return <div className="card p-4 text-sm text-loss">{t("game.bank.failed")}</div>;

  const { charter, requirements: req } = data;

  // ── Банк уже есть: пульт эмитента ──────────────────────────────────────
  if (data.bank) {
    const bank = data.bank;
    const equityValue = bank.capital - bank.bondsIssued;
    return (
      <div className="space-y-4">
        <div className="card overflow-hidden">
          {/* Шапка с гербом: имя банка — то, под чем его бумаги висят на
              бирже, и оно должно читаться первым. */}
          <div className="flex items-start gap-3 border-b border-border bg-surface-2 p-4">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
              <Landmark size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{bank.name}</div>
              {bank.motto && <div className="truncate text-xs italic text-muted">«{bank.motto}»</div>}
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.userbank.capital")}</div>
              <div className="text-lg font-semibold tabular-nums">{fmtUsd(bank.capital)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 p-4 text-sm md:grid-cols-3">
            <div>
              <div className="text-[11px] text-muted">{t("game.userbank.debt")}</div>
              <div className="tabular-nums text-loss">{fmtUsd(bank.bondsIssued)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t("game.userbank.own")}</div>
              <div className="tabular-nums text-profit">{fmtUsd(equityValue)}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t("game.userbank.since")}</div>
              <div className="tabular-nums">{new Date(bank.createdAt).toLocaleDateString()}</div>
            </div>
          </div>
        </div>

        <p className="max-w-prose text-[11px] text-faint">{t("game.userbank.issuerHint")}</p>

        {bank.papers.map((paper) => {
          const price = paper.price || (prices[paper.assetId] ?? 0);
          const left = paper.total - paper.sold;
          const placed = paper.total > 0 ? (paper.sold / paper.total) * 100 : 0;
          const value = Number(qty[paper.kind] ?? "");
          const proceeds = Number.isFinite(value) && value > 0 ? Math.min(value, left) * price : 0;
          return (
            <div key={paper.kind} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-medium">
                  {paper.kind === "bank_bond" ? (
                    <ScrollText size={15} className="text-accent" />
                  ) : (
                    <TrendingUp size={15} className="text-accent" />
                  )}
                  {t(`game.userbank.paper.${paper.kind}`)}
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-muted">
                    {paper.ticker}
                  </span>
                </div>
                <div className="text-sm tabular-nums">
                  {price > 0 ? fmtUsd(price) : "—"}
                  <span className="ml-1 text-[11px] text-muted">{t("game.userbank.market")}</span>
                </div>
              </div>

              {/* Полоса размещения: сколько бумаги уже ушло на рынок. Число
                  «продано/выпущено» само по себе не читается — доля читается. */}
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, placed)}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-muted tabular-nums">
                  <span>{t("game.userbank.placed", { pct: placed.toFixed(1) })}</span>
                  <span>{t("game.userbank.left", { n: Math.round(left).toLocaleString() })}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-muted">
                  {t("game.userbank.quantity")}
                  <input
                    type="number"
                    value={qty[paper.kind] ?? ""}
                    onChange={(e) => setQty((s) => ({ ...s, [paper.kind]: e.target.value }))}
                    className="input-base mt-1 block w-32 px-2 py-1.5 text-sm tabular-nums"
                  />
                </label>
                <button
                  type="button"
                  disabled={busy || left <= 0 || price <= 0 || !(value > 0)}
                  onClick={() =>
                    void post({ action: "issue", kind: paper.kind, quantity: Math.floor(value) }, (json) => {
                      setQty((s) => ({ ...s, [paper.kind]: "" }));
                      setMessage(
                        t("game.userbank.issued", {
                          n: Number(json.sold).toLocaleString(),
                          sum: fmtUsd(Number(json.total)),
                        }),
                      );
                    })
                  }
                  className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
                >
                  {t("game.userbank.issue")}
                </button>
                {proceeds > 0 && (
                  <span className="text-xs text-muted tabular-nums">
                    {t("game.userbank.proceeds", { sum: fmtUsd(proceeds) })}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {message && <div className="text-xs text-muted">{message}</div>}
      </div>
    );
  }

  // ── Банка ещё нет: грамота с условиями ─────────────────────────────────
  const rows: Array<{ key: string; ok: boolean; have: string; need: string }> = req
    ? [
        {
          key: "deposit",
          ok: req.meets.deposit,
          have: fmtUsd(req.equity),
          need: fmtUsd(charter.deposit),
        },
        { key: "prestige", ok: req.meets.prestige, have: String(req.prestige), need: String(charter.prestige) },
        { key: "contracts", ok: req.meets.contracts, have: String(req.contracts), need: String(charter.contracts) },
        {
          key: "reliability",
          ok: req.meets.reliability,
          have: String(req.reliability),
          need: String(charter.reliability),
        },
        {
          key: "age",
          ok: req.meets.age,
          have: t("game.userbank.days", { n: Math.floor(req.ageDays) }),
          need: t("game.userbank.days", { n: charter.ageDays }),
        },
      ]
    : [];
  const ready = req?.ready === true && (req?.slotsLeft ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="border-b border-border bg-surface-2 p-4">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <ScrollText size={15} className="text-accent" />
            {t("game.userbank.charterTitle")}
          </div>
          <p className="mt-1 max-w-prose text-[11px] text-faint">{t("game.userbank.charterHint")}</p>
          <div className="mt-2 text-[11px] text-muted">
            {t("game.userbank.slotsLeft", { n: req?.slotsLeft ?? 0 })}
          </div>
        </div>

        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              {row.ok ? (
                <BadgeCheck size={16} className="shrink-0 text-profit" />
              ) : (
                <Lock size={16} className="shrink-0 text-faint" />
              )}
              <div className="min-w-0 flex-1">
                <div className={row.ok ? "" : "text-muted"}>{t(`game.userbank.req.${row.key}`)}</div>
                <div className="text-[11px] text-faint">{t(`game.userbank.reqHint.${row.key}`)}</div>
              </div>
              <div className="text-right tabular-nums">
                <div className={row.ok ? "text-profit" : "text-loss"}>{row.have}</div>
                <div className="text-[11px] text-muted">{row.need}</div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="card space-y-3 p-4">
        <div className="text-sm font-medium">{t("game.userbank.found")}</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            {t("game.userbank.name")}
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="input-base mt-1 block w-56 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-muted">
            {t("game.userbank.ticker")}
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 5))}
              className="input-base mt-1 block w-24 px-2 py-1.5 font-mono text-sm uppercase"
            />
          </label>
        </div>
        <label className="block text-xs text-muted">
          {t("game.userbank.motto")}
          <input
            value={motto}
            onChange={(e) => setMotto(e.target.value)}
            maxLength={120}
            className="input-base mt-1 block w-full max-w-md px-2 py-1.5 text-sm"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={busy || !ready || name.trim().length < 3 || ticker.length < 3}
            onClick={() =>
              void post({ action: "found", name: name.trim(), ticker, motto: motto.trim() || undefined }, (json) => {
                // Взнос уходит регулятору безвозвратно — списываем его у себя
                // ровно на ту сумму, которую подтвердил сервер.
                applyWorldCash(-Number(json.deposit));
                setMessage(t("game.userbank.founded"));
              })
            }
            className="btn-primary px-3 py-1.5 text-sm disabled:opacity-40"
          >
            {t("game.userbank.foundAction")}
          </button>
          <span className="text-[11px] text-faint">
            {t("game.userbank.depositNote", { sum: fmtUsd(charter.deposit) })}
          </span>
        </div>
        {message && <div className="text-xs text-loss">{message}</div>}
      </div>
    </div>
  );
}
