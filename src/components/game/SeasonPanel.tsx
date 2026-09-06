"use client";

// Таблица сезона.
//
// Общий рейтинг отвечает на вопрос «кто прошёл больше всех за всё время» —
// и этим бесполезен для пришедшего вчера: догнать первых он не сможет
// никогда. Сезон отвечает на другой вопрос: «кто лучше всех торгует ПРЯМО
// СЕЙЧАС», и на него у новичка шансы ровно те же, что у ветерана.
//
// Считается рост от эквити на входе в сезон, а не абсолютные деньги: иначе
// побеждал бы тот, кто дольше играет, и сезон повторял бы общий рейтинг.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fetchSeason, type SeasonStandings } from "@/lib/game/worldClient";
import { seasonPrize, SEASON_PRIZE_PLACES } from "@/lib/game/seasons";
import { fmtUsd } from "@/lib/format";
import TournamentPanel from "./TournamentPanel";

function daysLeft(endsAt: number): number {
  return Math.max(0, Math.ceil((endsAt - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function SeasonPanel({ nickname }: { nickname: string | null }) {
  const { t } = useI18n();
  const [data, setData] = useState<SeasonStandings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await fetchSeason();
      if (!alive) return;
      setData(result);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div className="card p-4 text-xs text-faint">{t("game.world.loading")}</div>;
  if (!data) return <div className="card p-4 text-sm text-loss">{t("game.season.failed")}</div>;

  const { season, rows } = data;
  const short = season.players < season.minPlayers;

  return (
    <div className="space-y-4">
    <TournamentPanel nickname={nickname} />
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium">{t("game.season.title", { index: season.index })}</div>
          <div className="text-xs text-faint mt-0.5">{t("game.season.hint")}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">{t("game.season.daysLeft", { days: daysLeft(season.endsAt) })}</div>
          <div className="text-xs text-faint">{t("game.season.players", { count: season.players })}</div>
        </div>
      </div>

      {short && (
        // Честнее сказать заранее, чем подвести итоги без наград и оставить
        // игроков гадать, почему они ничего не получили.
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {t("game.season.tooFew", { need: season.minPlayers })}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="text-sm text-faint">{t("game.season.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[460px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="text-left font-medium py-2">#</th>
                <th className="text-left font-medium">{t("game.world.player")}</th>
                <th className="text-left font-medium">{t("game.world.style")}</th>
                <th className="text-right font-medium">{t("game.season.result")}</th>
                <th className="text-right font-medium">{t("game.season.prize")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const prize = short ? { cash: 0 } : seasonPrize(i + 1);
                const me = nickname != null && row.nickname === nickname;
                return (
                  <tr key={row.id} className={`border-t border-border ${me ? "bg-accent/5" : ""}`}>
                    <td className="py-2 tabular-nums text-faint">{i + 1}</td>
                    <td className="py-2 font-medium">{row.nickname}</td>
                    <td className="py-2 text-muted">{t(`game.style.${row.activeStyle}`)}</td>
                    <td className={`py-2 text-right tabular-nums ${row.returnPct >= 0 ? "text-profit" : "text-loss"}`}>
                      {row.returnPct >= 0 ? "+" : ""}
                      {row.returnPct.toFixed(2)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-faint">
                      {i < SEASON_PRIZE_PLACES && prize.cash > 0 ? fmtUsd(prize.cash) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </div>
  );
}