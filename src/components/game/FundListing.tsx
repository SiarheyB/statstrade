"use client";

// Выход фонда на биржу.
//
// Фонд собирает деньги участников и торгует ими, но оценить его со стороны
// было нельзя: вложиться — только вступив, продать долю — только выйдя
// целиком. Листинг это меняет: у фонда появляется акция с тикером, её видно
// на графике, её можно купить и продать в любой момент, никого не спрашивая.
//
// Требования взяты по смыслу с настоящих бирж, куда не пускают кого попало:
// история работы, размер, распылённость среди владельцев и вменяемое
// руководство. Без них листинг был бы кнопкой «создать себе бумагу», а такие
// бумаги никому не нужны.
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Building2, CircleDashed } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import {
  fetchListings,
  listing as api,
  type FundListing as Listed,
  type ListingRequirements,
} from "@/lib/game/worldClient";
import { useGameStore } from "@/store/gameStore";

const MIN_AGE_DAYS = 14;
const MIN_CAPITAL = 100_000;
const MIN_MEMBERS = 3;
const MIN_OWNER_CONTRACTS = 1;

function Requirement({ met, text }: { met: boolean; text: string }) {
  const Icon = met ? BadgeCheck : CircleDashed;
  return (
    <div className={`flex items-start gap-2 text-xs ${met ? "text-profit" : "text-muted"}`}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <span>{text}</span>
    </div>
  );
}

export default function FundListingPanel() {
  const { t } = useI18n();
  const prices = useGameStore((s) => s.game.prices);
  const refreshListings = useGameStore((s) => s.refreshListings);

  const [listings, setListings] = useState<Listed[]>([]);
  const [requirements, setRequirements] = useState<ListingRequirements | null>(null);
  const [myFundId, setMyFundId] = useState<string | null>(null);
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchListings();
    if (!data) return;
    // Ряд листингов общий с банками игроков — на доску фондов идут только
    // акции фондов, иначе тут висели бы чужие бумаги.
    setListings(data.listings.filter((row) => row.kind === "fund_share"));
    setRequirements(data.requirements);
    setMyFundId(data.myFundId);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = myFundId ? listings.find((row) => row.fundId === myFundId) : undefined;

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setMessage(null);
    const result = await fn();
    if (!result.ok) setMessage(result.error ?? null);
    await load();
    // Новая бумага должна появиться в списке инструментов сразу, а не через
    // минуту: игрок только что её и выпустил.
    await refreshListings();
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Building2 size={15} className="text-accent" />
          {t("game.listing.title")}
        </div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.listing.hint")}</p>

        {!myFundId ? (
          <div className="text-xs text-faint">{t("game.listing.needFund")}</div>
        ) : mine ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-2 p-3 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-accent font-medium">{mine.ticker}</span>
                <span className="text-sm">{mine.name}</span>
                <span className="ml-auto tabular-nums">
                  {prices[mine.assetId] != null ? fmtUsd(prices[mine.assetId]) : "—"}
                </span>
              </div>
              <div className="text-[11px] text-faint">
                {t("game.listing.placed", {
                  sold: Math.round(mine.sharesSold).toLocaleString("ru-RU"),
                  total: Math.round(mine.totalShares).toLocaleString("ru-RU"),
                })}{" "}
                · {t("game.listing.book", { price: fmtUsd(mine.bookValuePerShare) })}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={t("game.listing.quantity")}
                className="input-base w-32 px-2 py-1.5 text-sm tabular-nums"
              />
              <button
                type="button"
                disabled={busy || !(Number(quantity) > 0)}
                onClick={() =>
                  void act(async () => {
                    const result = await api.place(Number(quantity));
                    if (result.ok) setQuantity("");
                    return result;
                  })
                }
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
              >
                {t("game.listing.place")}
              </button>
            </div>
            <p className="text-[11px] text-faint max-w-prose">{t("game.listing.placeHint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Requirement
                met={!!requirements?.meets.age}
                text={t("game.listing.reqAge", {
                  need: MIN_AGE_DAYS,
                  have: Math.floor(requirements?.ageDays ?? 0),
                })}
              />
              <Requirement
                met={!!requirements?.meets.capital}
                text={t("game.listing.reqCapital", {
                  need: fmtUsd(MIN_CAPITAL),
                  have: fmtUsd(requirements?.capital ?? 0),
                })}
              />
              <Requirement
                met={!!requirements?.meets.members}
                text={t("game.listing.reqMembers", { need: MIN_MEMBERS, have: requirements?.members ?? 0 })}
              />
              <Requirement
                met={!!requirements?.meets.owner}
                text={t("game.listing.reqOwner", {
                  need: MIN_OWNER_CONTRACTS,
                  have: requirements?.ownerContracts ?? 0,
                })}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={ticker}
                maxLength={5}
                onChange={(e) => setTicker(e.target.value.toUpperCase())}
                placeholder={t("game.listing.ticker")}
                className="input-base w-32 px-2 py-1.5 text-sm uppercase tracking-wider"
              />
              <button
                type="button"
                disabled={busy || !requirements?.ready || ticker.trim().length < 3}
                onClick={() => void act(() => api.list(ticker))}
                className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
              >
                {t("game.listing.go")}
              </button>
            </div>
          </div>
        )}
        {message && <div className="text-xs text-loss">{message}</div>}
      </div>

      <div className="card p-4 space-y-2">
        <div className="text-sm font-medium">{t("game.listing.board")}</div>
        {listings.length === 0 ? (
          <div className="text-xs text-faint">{t("game.listing.empty")}</div>
        ) : (
          listings.map((row) => {
            const price = prices[row.assetId];
            // Отношение цены к балансу — обычный способ понять, дорого фонд
            // оценён на бирже или дёшево.
            const pb = price != null && row.bookValuePerShare > 0 ? price / row.bookValuePerShare : null;
            return (
              <div key={row.assetId} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                <span className="font-medium text-accent w-[64px]">{row.ticker}</span>
                <span className="flex-1 min-w-[140px] truncate">{row.name}</span>
                <span className="text-xs text-faint">{row.owner}</span>
                <span className="tabular-nums">{price != null ? fmtUsd(price) : "—"}</span>
                <span className={`text-xs tabular-nums ${pb != null && pb < 1 ? "text-profit" : "text-faint"}`}>
                  {pb != null ? t("game.listing.pb", { value: pb.toFixed(2) }) : ""}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
