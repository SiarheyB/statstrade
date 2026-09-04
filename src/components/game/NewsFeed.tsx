"use client";

// Новостная лента — раздел 3.5 спеки. Без неё скачок цены выглядел как
// поломка симуляции («цена непонятно где летает»): теперь у каждого рывка
// есть заголовок, время и понятно, кого он задел.
//
// Заголовки приходят готовой строкой из движка (шаблоны в
// newsTemplates.json только на русском — см. комментарий у NewsEvent), в
// отличие от подписей вокруг, которые переводятся как обычно.
import { useI18n } from "@/lib/i18n/provider";
import { fmtGameClock } from "@/lib/gameTime";
import { GLOBAL_TARGET } from "@/engine/market/newsEngine";
import type { Asset, NewsEvent, NewsImpact } from "@/engine/entities/types";

const IMPACT_STYLE: Record<NewsImpact, string> = {
  low: "bg-surface-2 text-muted",
  medium: "bg-accent/15 text-accent",
  high: "bg-loss/15 text-loss",
  black_swan: "bg-loss text-white",
};

function targetLabel(news: NewsEvent, assets: Asset[], globalLabel: string): string {
  if (news.affectedAssets.includes(GLOBAL_TARGET)) return globalLabel;
  const symbols = news.affectedAssets
    .map((id) => assets.find((a) => a.id === id)?.symbol)
    .filter((s): s is string => !!s);
  // Секторная новость задевает десяток бумаг — в строку они не влезут, да и
  // читать их там незачем: показываем первые три и остаток числом.
  if (symbols.length > 3) return `${symbols.slice(0, 3).join(", ")} +${symbols.length - 3}`;
  return symbols.join(", ");
}

export default function NewsFeed({
  news,
  assets,
  gameElapsedMs,
}: {
  news: NewsEvent[];
  assets: Asset[];
  gameElapsedMs: number;
}) {
  const { t } = useI18n();

  return (
    <div className="card p-4 space-y-2">
      <div className="text-sm font-medium">{t("game.news.title")}</div>
      {news.length === 0 ? (
        <div className="text-xs text-faint">{t("game.news.empty")}</div>
      ) : (
        <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
          {news.map((item) => {
            // «Живая» новость — та, чей всплеск волатильности ещё не истёк:
            // именно она объясняет, почему график сейчас дёргается сильнее
            // обычного.
            const live = item.expiresAt > gameElapsedMs;
            const up = item.priceShockPct >= 0;
            return (
              <div key={item.id} className={`flex items-start gap-2 text-xs ${live ? "" : "opacity-60"}`}>
                <span className={`px-1.5 py-0.5 rounded shrink-0 ${IMPACT_STYLE[item.impact]}`}>
                  {t(`game.news.impact.${item.impact}`)}
                </span>
                <span className="text-faint tabular-nums shrink-0">{fmtGameClock(item.timestamp)}</span>
                <span className="flex-1 min-w-0">{item.headline}</span>
                <span className="text-faint shrink-0">{targetLabel(item, assets, t("game.news.global"))}</span>
                <span className={`tabular-nums shrink-0 w-14 text-right ${up ? "text-profit" : "text-loss"}`}>
                  {up ? "+" : ""}
                  {(item.priceShockPct * 100).toFixed(1)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
