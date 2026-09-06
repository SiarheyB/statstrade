"use client";

// Банк.
//
// До него занять можно было только у другого игрока — а пока в мире два
// человека, занять не у кого вовсе. Банк работает всегда и сам развивается:
// капитал растёт на процентах, падает на невозвратах, и от него прямо
// зависит цена его акции. Поэтому в банк можно не только ходить за деньгами,
// но и вкладываться в него самого.
//
// Четыре вещи в одном месте, потому что они об одном — о деньгах, которых
// сейчас нет: кредит, облигация (одолжить банку под купон), акция (доля в
// банке) и витрина изъятого у неплательщиков.
import { useCallback, useEffect, useState } from "react";
import { useMarketClock } from "@/lib/game/useMarketClock";
import { Building2, Landmark, PiggyBank, ShieldAlert, TrendingUp, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import { SHOP_ITEMS, getShopItem } from "@/engine/economy/shop";
import { canPledge, collateralLoan } from "@/lib/game/credit";
import { HintLabel } from "./Hint";
import BankArt from "./BankArt";
import MyBankPanel from "./MyBankPanel";
import { symbolOf } from "@/lib/game/assetNames";

interface BankData {
  bank: {
    capital: number;
    lentOut: number;
    bondsIssued: number;
    interestEarned: number;
    lossesTaken: number;
    capacity: number;
    bookValuePerShare: number;
    sharesAvailable: number;
    totalShares: number;
    foundedAt: number;
  };
  credit: {
    score: number;
    band: string;
    currentDebt: number;
    unsecuredLimit: number;
    unsecuredRate: number;
    securedRate: number;
  };
  loans: { id: string; principal: number; ratePct: number; dueAt: number; due: number; collateralItem: string | null }[];
  bonds: { id: string; amount: number; couponPct: number; maturesAt: number; payout: number; matured: boolean }[];
  shares: { owned: number; avgPrice: number };
  repossessed: {
    id: string;
    itemId: string;
    price: number;
    shopPrice: number;
    auctionEndsAt: number;
    highestBid: number | null;
    minNextBid: number;
  }[];
  depositTerms: number[];
  depositRatePct: number;
  tickers: { share: string; bond: string };
}

export default function BankPanel() {
  const { t } = useI18n();
  const equity = useGameStore((s) => s.game.account.equity);
  const wallet = useGameStore((s) => s.game.wallet);
  const bankruptcies = useGameStore((s) => s.game.career.bankruptcies);
  const owned = useGameStore((s) => s.game.lifestyle.ownedItemIds);
  const prices = useGameStore((s) => s.game.prices);
  const applyWorldCash = useGameStore((s) => s.applyWorldCash);
  const moveToWalletFromWorld = useGameStore((s) => s.creditWallet);

  const [data, setData] = useState<BankData | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [term, setTerm] = useState(30);
  const [collateral, setCollateral] = useState("");
  const [bondAmount, setBondAmount] = useState("");
  const [bondTerm, setBondTerm] = useState(30);
  const [shareQty, setShareQty] = useState("");
  const [section, setSection] = useState<"credit" | "bonds" | "shares" | "auction" | "mine">("credit");

  const load = useCallback(async () => {
    // equity сюда больше не отправляется: сервер сам знает её из последней
    // синхронизации — это и есть тот параметр, который раньше подделывался.
    const res = await fetch(`/api/game/bank?bankruptcies=${bankruptcies}`);
    if (res.ok) setData((await res.json()) as BankData);
    setLoading(false);
  }, [equity, bankruptcies]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>, onOk: (data: Record<string, number | string>) => void) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/game/bank", {
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
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="card p-4 text-xs text-faint">{t("game.world.loading")}</div>;
  if (!data) return <div className="card p-4 text-sm text-loss">{t("game.bank.failed")}</div>;

  const { bank, credit } = data;
  // Акция и облигация банка торгуются на бирже наравне с остальными
  // инструментами — со своим тикером, графиком и историей. Банк размещает
  // акции по БИРЖЕВОЙ цене: продавай он по балансовой, пока на бирже дороже,
  // получилась бы вечная бесплатная разница.
  const shareSymbol = symbolOf(data.tickers.share);
  const bondSymbol = symbolOf(data.tickers.bond);
  const marketPrice = prices[data.tickers.share] ?? null;
  const pledgeable = SHOP_ITEMS.filter((item) => owned.includes(item.id) && canPledge(item.id));
  const pledged = collateral ? getShopItem(collateral) : undefined;
  const limit = pledged ? collateralLoan(pledged) : credit.unsecuredLimit;
  const rate = pledged ? credit.securedRate : credit.unsecuredRate;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="-mx-4 -mt-4 mb-1 overflow-hidden rounded-t-xl border-b border-border">
          <BankArt capital={bank.capital} />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <Landmark size={15} className="text-accent" />
            {t("game.bank.title")}
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.bank.capital")}</div>
            <div className="text-lg font-semibold tabular-nums">{fmtUsd(bank.capital)}</div>
          </div>
        </div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.bank.hint")}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.lentOut")}</div>
            <div className="tabular-nums">{fmtUsd(bank.lentOut)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.capacity")}</div>
            <div className="tabular-nums">{fmtUsd(bank.capacity)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.earned")}</div>
            <div className="tabular-nums text-profit">{fmtUsd(bank.interestEarned)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.losses")}</div>
            <div className="tabular-nums text-loss">{fmtUsd(bank.lossesTaken)}</div>
          </div>
        </div>
      </div>

      {/* Кредит, облигации, акции и аукцион — были одной длинной страницей:
          чтобы дойти до акций, приходилось промотать мимо скоринга и формы
          кредита. Тот же приём, что в карьере и магазине — вкладки вместо
          вертикальной свалки. */}
      <div className="flex flex-wrap items-center gap-1 w-fit rounded-lg bg-surface-2 p-1">
        {(
          [
            ["credit", Wallet],
            ["bonds", PiggyBank],
            ["shares", TrendingUp],
            ["auction", ShieldAlert],
            ["mine", Building2],
          ] as const
        ).map(([id, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition ${
              section === id ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            <Icon size={14} />
            {t(`game.bank.section.${id}`)}
          </button>
        ))}
      </div>

      {section === "credit" && (
        <>
      {/* Скоринг */}
      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-medium">
            <HintLabel text={t("game.bank.scoreHint")}>{t("game.bank.score")}</HintLabel>
          </div>
          <div className="text-2xl font-semibold tabular-nums">{credit.score}</div>
        </div>
        <div className="text-xs text-muted">{t(`game.bank.band.${credit.band}`)}</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm pt-1">
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.limit")}</div>
            <div className="tabular-nums">{fmtUsd(credit.unsecuredLimit)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.rateUnsecured")}</div>
            <div className="tabular-nums">{credit.unsecuredRate.toFixed(1)}%</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.bank.rateSecured")}</div>
            <div className="tabular-nums text-profit">{credit.securedRate.toFixed(1)}%</div>
          </div>
        </div>
      </div>

      {/* Кредит */}
      <div className="card p-4 space-y-3">
        <div className="text-sm font-medium">{t("game.bank.takeLoan")}</div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            {t("game.bank.amount")}
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="input-base mt-1 block w-32 px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="text-xs text-muted">
            {t("game.bank.term")}
            <select
              value={term}
              onChange={(e) => setTerm(Number(e.target.value))}
              className="input-base mt-1 block px-2 py-1.5 text-sm"
            >
              {[7, 30, 90, 180].map((days) => (
                <option key={days} value={days}>
                  {days}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            {t("game.bank.collateral")}
            <select
              value={collateral}
              onChange={(e) => setCollateral(e.target.value)}
              className="input-base mt-1 block px-2 py-1.5 text-sm max-w-[220px]"
            >
              <option value="">{t("game.bank.noCollateral")}</option>
              {pledgeable.map((item) => (
                <option key={item.id} value={item.id}>
                  {t(`game.shop.item.${item.id}.name`)} — {fmtUsd(collateralLoan(item))}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !(Number(amount) > 0)}
            onClick={() =>
              void act(
                {
                  action: "loan",
                  amount: Number(amount),
                  termDays: term,
                  collateralItem: collateral || null,
                  // Владение залогом сервер проверяет по этому списку:
                  // имущество живёт в браузере, и заложить чужую яхту нельзя.
                  ownedItems: owned,
                  bankruptcies,
                },
                (json) => {
                  // Деньги приходят на руки, а не сразу в рынок: положить их
                  // на брокерский счёт — отдельное решение.
                  moveToWalletFromWorld(Number(json.amount));
                  setAmount("");
                },
              )
            }
            className="px-3 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
          >
            {t("game.bank.request")}
          </button>
        </div>
        <div className="text-[11px] text-faint">
          {t("game.bank.offer", { limit: fmtUsd(limit), rate: rate.toFixed(1) })}
          {pledged && ` · ${t("game.bank.ltvHint")}`}
        </div>
        {message && <div className="text-xs text-loss">{message}</div>}

        {data.loans.length > 0 && (
          <div className="space-y-1.5 pt-1">
            {data.loans.map((loan) => (
              <div key={loan.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1.5 text-xs">
                <span className="tabular-nums font-medium">{fmtUsd(loan.principal)}</span>
                <span className="text-muted">{loan.ratePct.toFixed(1)}%</span>
                {loan.collateralItem && (
                  <span className="text-faint">
                    {t("game.bank.pledged", { item: t(`game.shop.item.${loan.collateralItem}.name`) })}
                  </span>
                )}
                <span className="text-faint">
                  {t("game.bank.dueAt", { date: new Date(loan.dueAt).toLocaleDateString("ru-RU") })}
                </span>
                <span className="ml-auto tabular-nums text-loss">{fmtUsd(loan.due)}</span>
                <button
                  type="button"
                  disabled={busy || wallet < loan.due}
                  onClick={() =>
                    void act({ action: "repay", loanId: loan.id }, (json) => {
                      applyWorldCash(0);
                      moveToWalletFromWorld(-Number(json.paid));
                    })
                  }
                  className="input-base px-2 py-1 hover:border-border-strong disabled:opacity-40"
                  title={wallet < loan.due ? t("game.bank.needCash") : undefined}
                >
                  {t("game.bank.repay")}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

        </>
      )}

      {section === "bonds" && (
        <>
      {/* Облигации */}
      <div className="card p-4 space-y-3">
        <div className="text-sm font-medium">{t("game.bank.deposits")}</div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.bank.depositsHint")}</p>
        <p className="text-[11px] text-accent">{t("game.bank.bondOnExchange", { ticker: bondSymbol })}</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted">
            {t("game.bank.amount")}
            <input
              type="number"
              value={bondAmount}
              onChange={(e) => setBondAmount(e.target.value)}
              className="input-base mt-1 block w-32 px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="text-xs text-muted">
            {t("game.bank.term")}
            <select
              value={bondTerm}
              onChange={(e) => setBondTerm(Number(e.target.value))}
              className="input-base mt-1 block px-2 py-1.5 text-sm"
            >
              {data.depositTerms.map((days) => (
                <option key={days} value={days}>
                  {days}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={busy || !(Number(bondAmount) > 0) || Number(bondAmount) > wallet}
            onClick={() =>
              void act({ action: "bond", amount: Number(bondAmount), termDays: bondTerm }, () => {
                moveToWalletFromWorld(-Number(bondAmount));
                setBondAmount("");
              })
            }
            className="px-3 py-2 rounded-lg text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {t("game.bank.openDeposit")}
          </button>
        </div>
        {data.bonds.map((bond) => (
          <div key={bond.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1.5 text-xs">
            <span className="tabular-nums font-medium">{fmtUsd(bond.amount)}</span>
            <span className="text-muted">{bond.couponPct.toFixed(1)}%</span>
            <span className="text-faint">
              {t("game.bank.maturesAt", { date: new Date(bond.maturesAt).toLocaleDateString("ru-RU") })}
            </span>
            <span className="ml-auto tabular-nums text-profit">{fmtUsd(bond.payout)}</span>
            <button
              type="button"
              disabled={busy || !bond.matured}
              onClick={() => void act({ action: "redeem", bondId: bond.id }, () => {})}
              className="input-base px-2 py-1 hover:border-border-strong disabled:opacity-40"
              title={bond.matured ? undefined : t("game.bank.notMatured")}
            >
              {t("game.bank.redeem")}
            </button>
          </div>
        ))}
      </div>

        </>
      )}

      {section === "shares" && (
        <>
      {/* Акции банка */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-sm font-medium">
            {t("game.bank.shares")}{" "}
            <span className="text-xs text-accent">{shareSymbol}</span>
          </div>
          <div className="text-sm tabular-nums">
            {marketPrice != null ? fmtUsd(marketPrice) : "—"}{" "}
            <span className="text-[11px] text-faint">
              {t("game.bank.book", { price: fmtUsd(bank.bookValuePerShare) })} ·{" "}
              {t("game.bank.sharesOwned", { count: data.shares.owned })}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.bank.sharesHint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            value={shareQty}
            onChange={(e) => setShareQty(e.target.value)}
            placeholder={t("game.bank.quantity")}
            className="input-base w-28 px-2 py-1.5 text-sm tabular-nums"
          />
          <button
            type="button"
            disabled={busy || !(Number(shareQty) > 0) || (marketPrice ?? 0) * Number(shareQty) > wallet}
            onClick={() =>
              void act({ action: "shares", quantity: Number(shareQty) }, (json) => {
                moveToWalletFromWorld(-Number(json.total));
                setShareQty("");
              })
            }
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-profit/15 text-profit hover:bg-profit/25 disabled:opacity-40"
          >
            {t("game.bank.buy")}
          </button>
          <button
            type="button"
            disabled={busy || !(Number(shareQty) > 0) || Number(shareQty) > data.shares.owned}
            onClick={() =>
              void act({ action: "shares", quantity: -Number(shareQty) }, () => setShareQty(""))
            }
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-loss/15 text-loss hover:bg-loss/25 disabled:opacity-40"
          >
            {t("game.bank.sell")}
          </button>
        </div>
      </div>

        </>
      )}

      {section === "auction" && (
      <div className="card p-4 space-y-2">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <ShieldAlert size={15} className="text-loss" />
          {t("game.bank.repossessed")}
        </div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.bank.repossessedHint")}</p>
        {data.repossessed.length === 0 ? (
          <div className="text-xs text-faint">{t("game.bank.noRepossessed")}</div>
        ) : (
          data.repossessed.map((row) => (
            <AuctionRow key={row.id} row={row} wallet={wallet} act={act} />
          ))
        )}
      </div>
      )}

      {/* Свой банк — отдельным компонентом: он про эмиссию, а не про
          обслуживание в центробанке, и делит с ним только место в меню. */}
      {section === "mine" && <MyBankPanel />}
    </div>
  );
}

/**
 * Один лот аукциона.
 *
 * Своё состояние ставки: сумма по умолчанию — минимально допустимая, чтобы
 * не заставлять игрока считать шаг самому. Обратный отсчёт тикает от общих
 * часов игры (useMarketClock) — секундная точность здесь не нужна, торг идёт
 * сутки.
 */
function AuctionRow({
  row,
  wallet,
  act,
}: {
  row: BankData["repossessed"][number];
  wallet: number;
  act: (body: Record<string, unknown>, onOk: (data: Record<string, number | string>) => void) => Promise<void>;
}) {
  const { t } = useI18n();
  const now = useMarketClock(15_000);
  const [bid, setBid] = useState<string>(String(row.minNextBid));
  const [busy, setBusy] = useState(false);

  const msLeft = row.auctionEndsAt - (now || Date.now());
  const over = msLeft <= 0;
  const hoursLeft = Math.max(0, Math.ceil(msLeft / (60 * 60 * 1000)));
  const bidNum = Number(bid);
  const canBid = !over && !busy && bidNum >= row.minNextBid && bidNum <= wallet;

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-1.5 text-xs">
      <span className="font-medium">{t(`game.shop.item.${row.itemId}.name`)}</span>
      <span className="text-faint line-through">{fmtUsd(row.shopPrice)}</span>
      <span className="ml-auto tabular-nums text-faint">
        {row.highestBid != null ? t("game.bank.currentBid", { amount: fmtUsd(row.highestBid) }) : t("game.bank.noBids", { amount: fmtUsd(row.price) })}
      </span>
      <span className={`tabular-nums ${over ? "text-loss" : "text-muted"}`}>
        {over ? t("game.bank.auctionOver") : t("game.bank.auctionHoursLeft", { hours: hoursLeft })}
      </span>
      <input
        type="number"
        value={bid}
        onChange={(e) => setBid(e.target.value)}
        min={row.minNextBid}
        disabled={over || busy}
        className="input-base w-24 px-2 py-1 text-xs tabular-nums disabled:opacity-40"
        title={t("game.bank.minBidHint", { amount: fmtUsd(row.minNextBid) })}
      />
      <button
        type="button"
        disabled={!canBid}
        onClick={async () => {
          setBusy(true);
          try {
            await act({ action: "bid", id: row.id, amount: bidNum }, () => {});
          } finally {
            setBusy(false);
          }
        }}
        className="input-base px-2 py-1 hover:border-border-strong disabled:opacity-40"
        title={bidNum > wallet ? t("game.bank.needCash") : undefined}
      >
        {t("game.bank.placeBid")}
      </button>
    </div>
  );
}
