"use client";

// Вкладка «Мир» — всё, что делает игру не одиночной: рейтинг, лента событий,
// биржа займов и фонды.
//
// Важно про деньги: сервер не хранит игровой баланс (симуляция целиком в
// браузере), он хранит ОБЯЗАТЕЛЬСТВА. Поэтому каждая денежная кнопка здесь
// сначала спрашивает сервер, и только после его «да» стор двигает баланс
// (gameStore.applyWorldCash). Если сервер отказал — в игре ничего не
// изменилось.
import { useCallback, useEffect, useState } from "react";
import { Coins, Crown, Landmark, MessagesSquare, RefreshCw, ScrollText, ShieldCheck, Store, Trophy } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import SeasonPanel from "./SeasonPanel";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import { fetchWorld, updateProfile, type WorldState } from "@/lib/game/worldClient";
import type { GameDrawing } from "@/engine/entities/types";
import ChatPanel from "./ChatPanel";
import StrategyMarket from "./StrategyMarket";

const SECTIONS = ["ranking", "season", "chat", "strategies", "loans", "funds", "feed"] as const;
type Section = (typeof SECTIONS)[number];

const SECTION_ICON: Record<Section, typeof Crown> = {
  ranking: Crown,
  season: Trophy,
  chat: MessagesSquare,
  strategies: Store,
  loans: Coins,
  funds: Landmark,
  feed: ScrollText,
};

function repayDue(amount: number, interestPct: number): number {
  return Math.round(amount * (1 + interestPct / 100) * 100) / 100;
}

export default function WorldPanel({
  currentAssetId,
  currentSymbol,
  drawings,
  onOpenIdea,
}: {
  currentAssetId: string | undefined;
  currentSymbol: string;
  drawings: GameDrawing[];
  onOpenIdea: (assetId: string) => void;
}) {
  const { t } = useI18n();
  const balance = useGameStore((s) => s.game.account.balance);
  const gameDay = useGameStore((s) => s.game.gameCalendarDay);
  const syncWorld = useGameStore((s) => s.syncWorld);
  const offerLoan = useGameStore((s) => s.offerLoan);
  const cancelLoanOffer = useGameStore((s) => s.cancelLoanOffer);
  const takeLoan = useGameStore((s) => s.takeLoan);
  const repayLoan = useGameStore((s) => s.repayLoan);
  const createFund = useGameStore((s) => s.createFund);
  const joinFund = useGameStore((s) => s.joinFund);
  const leaveFund = useGameStore((s) => s.leaveFund);
  const depositToFund = useGameStore((s) => s.depositToFund);
  const withdrawFromFund = useGameStore((s) => s.withdrawFromFund);
  const payoutFund = useGameStore((s) => s.payoutFund);

  const [world, setWorld] = useState<WorldState | null>(null);
  const [section, setSection] = useState<Section>("ranking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [nickDraft, setNickDraft] = useState("");
  const [loanAmount, setLoanAmount] = useState("1000");
  const [loanInterest, setLoanInterest] = useState("10");
  const [loanTerm, setLoanTerm] = useState("30");
  const [fundName, setFundName] = useState("");
  const [fundMotto, setFundMotto] = useState("");
  const [fundAmount, setFundAmount] = useState("1000");

  const reload = useCallback(async () => {
    const data = await fetchWorld();
    if (data) {
      setWorld(data);
      setNickDraft((prev) => (prev === "" ? data.me.nickname : prev));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Перед первым чтением отправляем свои цифры: иначе игрок увидит себя в
      // рейтинге с прошлыми показателями или вовсе без профиля.
      await syncWorld();
      const data = await fetchWorld();
      if (alive && data) {
        setWorld(data);
        setNickDraft(data.me.nickname);
      }
    })();
    // Мир обновляется, пока вкладка открыта: чужие сделки и займы должны
    // появляться сами, без кнопки «обновить».
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void reload();
    }, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [reload, syncWorld]);

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, successKey: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage(result.ok ? t(successKey) : result.error);
      await syncWorld();
      await reload();
    } finally {
      setBusy(false);
    }
  }

  if (!world) {
    return <div className="card p-6 text-sm text-faint">{t("game.world.loading")}</div>;
  }

  const me = world.me;
  const activeDebt = world.loans.mine.filter((l) => l.status === "active");
  const totalDebt = activeDebt.reduce((sum, l) => sum + repayDue(l.amount, l.interestPct), 0);

  return (
    <div className="space-y-4">
      {/* Профиль в мире */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px]">
            <label className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.world.nickname")}</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                value={nickDraft}
                maxLength={20}
                onChange={(e) => setNickDraft(e.target.value)}
                className="input-base px-2 py-1 text-sm w-44"
              />
              <button
                type="button"
                disabled={busy || nickDraft.trim() === me.nickname}
                onClick={async () => {
                  setBusy(true);
                  const result = await updateProfile({ nickname: nickDraft });
                  setMessage(result.ok ? t("game.world.nicknameSaved") : result.error);
                  setBusy(false);
                  await reload();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
              >
                {t("common.save")}
              </button>
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.world.reliability")}</div>
            <div className={`text-lg font-semibold tabular-nums ${me.reliability < 50 ? "text-loss" : "text-profit"}`}>
              {me.reliability}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.world.creditLimit")}</div>
            <div className="text-lg font-semibold tabular-nums">{fmtUsd(me.creditLimit)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.world.debt")}</div>
            <div className={`text-lg font-semibold tabular-nums ${totalDebt > 0 ? "text-loss" : ""}`}>
              {fmtUsd(totalDebt)}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer ml-auto">
            <input
              type="checkbox"
              checked={me.isPublic}
              disabled={busy}
              onChange={async (e) => {
                await updateProfile({ isPublic: e.target.checked });
                await reload();
              }}
              className="accent-accent"
            />
            {t("game.world.public")}
          </label>
          <button
            type="button"
            onClick={() => void reload()}
            className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
          >
            <RefreshCw size={12} />
            {t("game.world.refresh")}
          </button>
        </div>

        {message && <div className="text-xs text-accent">{message}</div>}
      </div>

      <div className="flex flex-wrap items-center gap-1 card p-1 w-fit">
        {SECTIONS.map((name) => {
          const Icon = SECTION_ICON[name];
          return (
            <button
              key={name}
              type="button"
              onClick={() => setSection(name)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition ${
                section === name ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              <Icon size={14} />
              {t(`game.world.section.${name}`)}
            </button>
          );
        })}
      </div>

      {section === "season" && <SeasonPanel nickname={world.me?.nickname ?? null} />}

      {section === "ranking" && (
        <div className="card p-4">
          <div className="text-sm font-medium mb-1">{t("game.world.rankingTitle")}</div>
          <div className="text-xs text-faint mb-3">{t("game.world.rankingHint")}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-muted">
                  <th className="text-left font-medium py-2">#</th>
                  <th className="text-left font-medium">{t("game.world.player")}</th>
                  <th className="text-left font-medium">{t("game.shop.rank")}</th>
                  <th className="text-right font-medium">{t("game.world.contracts")}</th>
                  <th className="text-right font-medium">{t("game.shop.prestige")}</th>
                  <th className="text-right font-medium">{t("game.world.best")}</th>
                  <th className="text-right font-medium">{t("game.stat.equity")}</th>
                </tr>
              </thead>
              <tbody>
                {world.leaderboard.map((player, i) => (
                  <tr
                    key={player.id}
                    className={`border-t border-border ${player.id === me.id ? "bg-accent/5" : ""}`}
                  >
                    <td className="py-2 tabular-nums text-faint">{i + 1}</td>
                    <td className="py-2">
                      <span className="font-medium">{player.nickname}</span>
                      {player.fund && <span className="text-xs text-faint"> · {player.fund.name}</span>}
                    </td>
                    <td className="py-2 text-xs text-accent">{t(`game.shop.rank.${player.rankKey}`)}</td>
                    <td className="py-2 text-right tabular-nums">{player.contractsPassed}</td>
                    <td className="py-2 text-right tabular-nums">{player.prestige}</td>
                    <td className="py-2 text-right tabular-nums text-profit">
                      {player.bestContractPct > 0 ? `+${player.bestContractPct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="py-2 text-right tabular-nums text-faint">{fmtUsd(player.equity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {section === "chat" && (
        <ChatPanel
          inFund={!!me.fundId}
          currentAssetId={currentAssetId}
          currentSymbol={currentSymbol}
          drawings={drawings}
          onOpenIdea={onOpenIdea}
        />
      )}

      {section === "strategies" && <StrategyMarket />}

      {section === "loans" && (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <div>
              <div className="text-sm font-medium">{t("game.world.lendTitle")}</div>
              <div className="text-xs text-faint">{t("game.world.lendHint")}</div>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[11px] text-muted block">{t("game.world.amount")}</label>
                <input
                  type="number"
                  value={loanAmount}
                  onChange={(e) => setLoanAmount(e.target.value)}
                  className="input-base px-2 py-1 text-sm w-32 tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted block">{t("game.world.interest")}</label>
                <input
                  type="number"
                  value={loanInterest}
                  onChange={(e) => setLoanInterest(e.target.value)}
                  className="input-base px-2 py-1 text-sm w-24 tabular-nums"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted block">{t("game.world.termDays")}</label>
                <input
                  type="number"
                  value={loanTerm}
                  onChange={(e) => setLoanTerm(e.target.value)}
                  className="input-base px-2 py-1 text-sm w-24 tabular-nums"
                />
              </div>
              <button
                type="button"
                disabled={busy || Number(loanAmount) > balance}
                onClick={() =>
                  run(() => offerLoan(Number(loanAmount), Number(loanInterest), Number(loanTerm)), "game.world.offerCreated")
                }
                className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
              >
                {t("game.world.offer")}
              </button>
            </div>
          </div>

          <div className="card p-4">
            <div className="text-sm font-medium mb-2">{t("game.world.offers")}</div>
            {world.loans.offers.length === 0 ? (
              <div className="text-xs text-faint">{t("game.world.noOffers")}</div>
            ) : (
              <div className="space-y-2">
                {world.loans.offers.map((offer) => {
                  const mine = offer.lender?.id === me.id;
                  return (
                    <div key={offer.id} className="flex flex-wrap items-center gap-3 text-sm border-t border-border pt-2">
                      <span className="font-medium">{fmtUsd(offer.amount)}</span>
                      <span className="text-xs text-muted">
                        {t("game.world.underPct", { pct: offer.interestPct })} · {t("game.world.forDays", { days: offer.dueGameDay })}
                      </span>
                      <span className="text-xs text-faint">
                        {offer.lender?.nickname ?? "—"}
                        {offer.lender && (
                          <span className={offer.lender.reliability < 50 ? "text-loss" : ""}>
                            {" "}
                            · <ShieldCheck size={10} className="inline" /> {offer.lender.reliability}
                          </span>
                        )}
                      </span>
                      <span className="ml-auto">
                        {mine ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(() => cancelLoanOffer(offer.id), "game.world.offerCancelled")}
                            className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-loss"
                          >
                            {t("game.world.cancel")}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(() => takeLoan(offer.id), "game.world.loanTaken")}
                            className="px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
                          >
                            {t("game.world.take")}
                          </button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-4">
            <div className="text-sm font-medium mb-2">{t("game.world.myDebts")}</div>
            {world.loans.mine.length === 0 ? (
              <div className="text-xs text-faint">{t("game.world.noDebts")}</div>
            ) : (
              <div className="space-y-2">
                {world.loans.mine.map((loan) => {
                  const due = repayDue(loan.amount, loan.interestPct);
                  const overdue = loan.status === "defaulted";
                  const daysLeft = loan.dueGameDay - gameDay;
                  return (
                    <div key={loan.id} className="flex flex-wrap items-center gap-3 text-sm border-t border-border pt-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${overdue ? "bg-loss/15 text-loss" : "bg-surface-2 text-muted"}`}>
                        {t(`game.world.loanStatus.${loan.status}`)}
                      </span>
                      <span className="font-medium tabular-nums">{fmtUsd(due)}</span>
                      <span className="text-xs text-faint">
                        {loan.lender?.nickname ?? "—"} ·{" "}
                        {overdue ? t("game.world.overdue") : t("game.world.daysLeftShort", { days: Math.max(0, daysLeft) })}
                      </span>
                      {!overdue && (
                        <button
                          type="button"
                          disabled={busy || due > balance}
                          onClick={() => run(() => repayLoan(loan.id, due), "game.world.loanRepaid")}
                          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                        >
                          {t("game.world.repay")}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {section === "funds" && (
        <div className="space-y-4">
          {world.myFund ? (
            <div className="card p-4 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{world.myFund.name}</div>
                  <div className="text-xs text-faint">
                    {world.myFund.motto || t("game.world.noMotto")} · {t("game.world.fundOwner", { name: world.myFund.owner.nickname })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-muted">{t("game.world.fundCapital")}</div>
                  <div className="text-lg font-semibold tabular-nums">{fmtUsd(world.myFund.capital)}</div>
                  <div className="text-[11px] text-faint">{t("game.world.myShare", { amount: fmtUsd(me.fundShare) })}</div>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-[11px] text-muted block">{t("game.world.amount")}</label>
                  <input
                    type="number"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="input-base px-2 py-1 text-sm w-32 tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => depositToFund(Number(fundAmount)), "game.world.deposited")}
                  className="px-3 py-2 rounded-lg text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25"
                >
                  {t("game.world.deposit")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => withdrawFromFund(Number(fundAmount)), "game.world.withdrawn")}
                  className="px-3 py-2 rounded-lg text-sm font-medium text-muted hover:text-fg"
                >
                  {t("game.world.withdraw")}
                </button>
                {world.myFund.ownerId === me.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => payoutFund(Number(fundAmount)), "game.world.paidOut")}
                    className="px-3 py-2 rounded-lg text-sm font-medium bg-profit/15 text-profit hover:bg-profit/25"
                  >
                    {t("game.world.payout")}
                  </button>
                )}
                {world.myFund.ownerId !== me.id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => leaveFund(), "game.world.left")}
                    className="ml-auto px-3 py-2 rounded-lg text-sm text-muted hover:text-loss"
                  >
                    {t("game.world.leave")}
                  </button>
                )}
              </div>

              <div>
                <div className="text-sm font-medium mb-1">{t("game.world.members")}</div>
                <div className="space-y-1">
                  {world.myFund.members.map((member) => (
                    <div key={member.id} className="flex items-center gap-2 text-xs border-t border-border pt-1.5">
                      <span className="font-medium">{member.nickname}</span>
                      <span className="text-accent">{t(`game.shop.rank.${member.rankKey}`)}</span>
                      <span className="ml-auto text-faint tabular-nums">
                        {t("game.world.contracts")}: {member.contractsPassed}
                      </span>
                      <span className="tabular-nums w-24 text-right">{fmtUsd(member.equity)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="card p-4 space-y-3">
              <div>
                <div className="text-sm font-medium">{t("game.world.createFund")}</div>
                <div className="text-xs text-faint">{t("game.world.createFundHint")}</div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-[11px] text-muted block">{t("game.world.fundNameLabel")}</label>
                  <input
                    value={fundName}
                    maxLength={32}
                    onChange={(e) => setFundName(e.target.value)}
                    className="input-base px-2 py-1 text-sm w-48"
                  />
                </div>
                <div className="flex-1 min-w-[200px]">
                  <label className="text-[11px] text-muted block">{t("game.world.fundMotto")}</label>
                  <input
                    value={fundMotto}
                    maxLength={120}
                    onChange={(e) => setFundMotto(e.target.value)}
                    className="input-base px-2 py-1 text-sm w-full"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy || fundName.trim().length < 3}
                  onClick={() => run(() => createFund(fundName, fundMotto, 20), "game.world.fundCreated")}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
                >
                  {t("game.world.create")}
                </button>
              </div>
            </div>
          )}

          <div className="card p-4">
            <div className="text-sm font-medium mb-2">{t("game.world.fundBoard")}</div>
            <div className="space-y-2">
              {world.funds.map((fund, i) => (
                <div key={fund.id} className="flex flex-wrap items-center gap-3 text-sm border-t border-border pt-2">
                  <span className="text-faint tabular-nums w-5">{i + 1}</span>
                  <span className="font-medium">{fund.name}</span>
                  <span className="text-xs text-faint">
                    {t("game.world.membersCount", { count: fund.memberCount })} · {fund.owner.nickname}
                  </span>
                  <span className="ml-auto text-xs text-muted tabular-nums">
                    {t("game.world.fundCapital")}: {fmtUsd(fund.capital)}
                  </span>
                  <span className="tabular-nums w-28 text-right">{fmtUsd(fund.power)}</span>
                  {!me.fundId && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => joinFund(fund.id), "game.world.joined")}
                      className="px-3 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
                    >
                      {t("game.world.join")}
                    </button>
                  )}
                </div>
              ))}
              {world.funds.length === 0 && <div className="text-xs text-faint">{t("game.world.noFunds")}</div>}
            </div>
          </div>
        </div>
      )}

      {section === "feed" && (
        <div className="card p-4">
          <div className="text-sm font-medium mb-2">{t("game.world.feedTitle")}</div>
          {world.feed.length === 0 ? (
            <div className="text-xs text-faint">{t("game.world.feedEmpty")}</div>
          ) : (
            <div className="space-y-1.5">
              {world.feed.map((event) => (
                <div key={event.id} className="flex items-start gap-2 text-xs border-t border-border pt-1.5">
                  <span className="text-faint tabular-nums shrink-0">
                    {new Date(event.createdAt).toLocaleString()}
                  </span>
                  <span>
                    {t(`game.world.event.${event.kind}`, {
                      nickname: String(event.payload.nickname ?? "—"),
                      amount: fmtUsd(Number(event.payload.amount ?? 0)),
                      count: String(event.payload.count ?? ""),
                      fund: String(event.payload.fund ?? ""),
                      rank: event.payload.rankKey ? t(`game.shop.rank.${event.payload.rankKey}`) : "",
                      pct: String(event.payload.resultPct ?? ""),
                      interest: String(event.payload.interestPct ?? ""),
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
