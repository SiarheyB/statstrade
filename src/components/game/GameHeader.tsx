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
import type { GameState } from "@/engine/gameLoop";
import type { TradingStyle } from "@/engine/entities/types";
import MarketRegimeBadge from "./MarketRegimeBadge";

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: "profit" | "loss"; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
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
}: {
  game: GameState;
  styleLabel: string;
}) {
  const { t } = useI18n();
  const style: TradingStyle = game.activeStyle.style;
  const skill = game.account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
  const xpPct = Math.min(100, (skill.xp / (skill.xpToNextLevel || 1)) * 100);

  const rankKey = traderRankKey(game.account.reputation);
  const next = nextRank(game.account.reputation);

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
            {game.lifestyle.fundName || t("game.header.independentTrader")}
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
        />
        <Metric
          label={t("game.stat.balance")}
          value={fmtUsd(game.account.balance)}
          hint={marginUsed > 0 ? t("game.header.marginUsed", { amount: fmtUsd(marginUsed) }) : undefined}
        />
        <Metric label={t("game.stat.day")} value={String(game.gameCalendarDay + 1)} hint={styleLabel} />

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

        <div className="ml-auto">
          <MarketRegimeBadge regime={game.marketRegime} />
        </div>
      </div>
    </div>
  );
}
