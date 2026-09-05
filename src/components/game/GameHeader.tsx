"use client";

// Шапка терминала — «HUD» игрока, а не набор карточек-статов.
//
// Почему так: в браузерных экономических играх (Torn, Neopets, идлеры типа
// AdVenture Capitalist, менеджерские симуляторы) главные цифры всегда висят
// одной полосой сверху и не уезжают при скролле — игрок должен видеть
// «сколько у меня» и «как я расту» в любой момент, не отматывая страницу.
// Раньше эти цифры были четырьмя большими карточками, которые занимали
// первый экран и уезжали, стоило открыть график.
//
// Что здесь: кто ты (имя фонда + ранг), сколько у тебя (эквити с дневным
// результатом, свободные деньги, занятая маржа), где ты (игровой день +
// режим рынка) и куда растёшь (уровень навыка + полоса опыта).
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { xpToNextLevel } from "@/engine/player/progression";
import { nextRank, traderRankKey } from "@/engine/economy/shop";
import { contractProgress } from "@/engine/player/contracts";
import { stressLevel } from "@/engine/player/psychology";
import type { GameState } from "@/engine/gameLoop";
import type { TradingStyle } from "@/engine/entities/types";
import MarketRegimeBadge from "./MarketRegimeBadge";
import { HintLabel } from "./Hint";
import { useMarketClock } from "@/lib/game/useMarketClock";

function Metric({
  label,
  value,
  tone,
  hint,
  tip,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
  hint?: string;
  /** Что эта цифра означает. Без пояснения половина шапки — набор терминов. */
  tip?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted">
        {tip ? <HintLabel text={tip}>{label}</HintLabel> : label}
      </div>
      <div
        className={`text-lg font-semibold tabular-nums truncate ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </div>
      {hint && <div className="text-[11px] text-faint truncate">{hint}</div>}
    </div>
  );
}

export default function GameHeader({
  game,
  styleLabel,
  playerName,
}: {
  game: GameState;
  styleLabel: string;
  // Имя из профиля проекта. Пока фонд не зарегистрирован, в шапке стоит оно —
  // человек должен видеть в игре себя, а не безличное «частный трейдер».
  playerName: string | null;
}) {
  const { t } = useI18n();
  const style: TradingStyle = game.activeStyle.style;
  const skill = game.account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
  const xpPct = Math.min(100, (skill.xp / (skill.xpToNextLevel || 1)) * 100);

  const now = useMarketClock(30_000);
  // Часы берём из состояния, а не из Date.now() в рендере: читать часы во
  // время рендера React справедливо считает нечистотой.
  const clock = now > 0 ? new Date(now).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";

  const rankKey = traderRankKey(game.account.reputation);
  const next = nextRank(game.account.reputation);

  const contract = game.contracts.active
    ? contractProgress(game.contracts.active, game.account.equity, game.gameCalendarDay)
    : null;
  // Красим просадку, когда до провала осталось меньше четверти лимита —
  // это единственное место, где игре уместно повысить голос.
  const dangerZone = contract ? contract.drawdownPct > contract.contract.maxDrawdownPct * 0.75 : false;

  const stress = stressLevel(game.account.psychology.stress);

  const dayPnl = game.account.equity - (game.dayStartEquity || game.account.equity);
  const dayPnlPct = game.dayStartEquity ? (dayPnl / game.dayStartEquity) * 100 : 0;
  const marginUsed = game.account.marginUsed;

  return (
    // sticky: цифры не уезжают при скролле — это приборная панель, а не
    // блок контента. top-0 и фон обязательны, иначе под ней просвечивает
    // график.
    <div className="sticky top-0 z-20 -mx-4 md:-mx-6 px-4 md:px-6 py-3 glass-panel border-b border-border">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">
            {game.lifestyle.fundName || playerName || t("game.header.independentTrader")}
          </div>
          <div className="text-[11px] text-accent">
            {t(`game.shop.rank.${rankKey}`)}
            {next && <span className="text-faint"> · {t("game.header.toNextRank", { prestige: next.remaining })}</span>}
          </div>
        </div>

        <Metric
          label={t("game.stat.equity")}
          value={fmtUsd(game.account.equity)}
          tone={dayPnl >= 0 ? "profit" : "loss"}
          hint={t("game.header.today", {
            amount: `${dayPnl >= 0 ? "+" : ""}${fmtUsd(dayPnl)}`,
            pct: `${dayPnl >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%`,
          })}
          tip={t("game.tip.equity")}
        />
        <Metric
          label={t("game.stat.balance")}
          value={fmtUsd(game.account.balance)}
          hint={marginUsed > 0 ? t("game.header.marginUsed", { amount: fmtUsd(marginUsed) }) : undefined}
          tip={t("game.tip.balance")}
        />
        {/* День карьеры и часы. Номер дня сам по себе ничего не объяснял:
            «день 281» человек читает как ошибку, пока ему не скажут, что это
            281-е сутки С НАЧАЛА ЕГО ПАРТИИ. Время рядом — потому что от него
            зависит, какие рынки сейчас открыты. */}
        <Metric
          label={t("game.stat.day")}
          value={String(game.gameCalendarDay + 1)}
          hint={now > 0 ? `${clock} · ${styleLabel}` : styleLabel}
          tip={t("game.tip.day", { days: game.gameCalendarDay + 1 })}
        />

        <div className="min-w-[150px]">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              {t("game.skill.level", { level: skill.level })}
            </span>
            <span className="text-[11px] text-faint tabular-nums">
              {Math.round(skill.xp)} / {skill.xpToNextLevel}
            </span>
          </div>
          {/* Полоса опыта — самый дешёвый способ показать «ты растёшь»:
              цифра XP сама по себе ничего не сообщает, полоса сообщает. */}
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
            <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${xpPct}%` }} />
          </div>
        </div>

        {/* Долг спонсору. Показываем, пока он есть: игрок должен видеть, что
            часть его прибыли сейчас чужая, — иначе удержание выглядит
            ошибкой расчёта. */}
        {game.sponsor && (
          <Metric
            label={t("game.sponsor.debtLabel")}
            value={fmtUsd(game.sponsor.owed)}
            tone="loss"
            hint={t("game.sponsor.share") + `: ${game.sponsor.sharePct}%`}
            tip={t("game.tip.sponsorDebt")}
          />
        )}

        {/* Стресс показывается, только когда он уже влияет на исполнение:
            спокойному игроку эта шкала не нужна и только шумит. */}
        {stress !== "calm" && (
          <div className="min-w-[110px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                <HintLabel text={t("game.tip.stress")}>{t("game.psy.stress")}</HintLabel>
              </span>
              <span className={`text-[11px] tabular-nums ${stress === "high" ? "text-loss" : "text-muted"}`}>
                {Math.round(game.account.psychology.stress)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
              <div
                className={`h-full rounded-full ${stress === "high" ? "bg-loss" : "bg-accent"}`}
                style={{ width: `${Math.min(100, game.account.psychology.stress)}%` }}
              />
            </div>
          </div>
        )}

        <div className="ml-auto">
          <MarketRegimeBadge regime={game.marketRegime} />
        </div>
      </div>

      {/* Активное испытание — вторая строка HUD. Цель игрока должна быть
          перед глазами всегда, а не в отдельной вкладке: именно от неё
          зависит каждое решение по риску. */}
      {contract && (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs">
          <span className="font-medium text-accent">{t(`game.contract.${contract.contract.id}.name`)}</span>
          <span className="text-muted">
            {t("game.contract.hudTarget")}:{" "}
            <span className={`tabular-nums ${contract.profitPct >= 0 ? "text-profit" : "text-loss"}`}>
              {contract.profitPct >= 0 ? "+" : ""}
              {contract.profitPct.toFixed(2)}%
            </span>
            <span className="text-faint"> / +{contract.contract.targetPct}%</span>
          </span>
          <span className="text-muted">
            {t("game.contract.hudDrawdown")}:{" "}
            <span className={`tabular-nums ${dangerZone ? "text-loss font-semibold" : ""}`}>
              −{contract.drawdownPct.toFixed(2)}%
            </span>
            <span className="text-faint"> / −{contract.contract.maxDrawdownPct}%</span>
          </span>
          <span className="text-muted tabular-nums">
            {t("game.contract.daysLeft")}: {contract.daysLeft}
          </span>
          <div className="flex-1 min-w-[120px] h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${Math.max(0, Math.min(100, (contract.profitPct / contract.contract.targetPct) * 100))}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
