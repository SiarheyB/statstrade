"use client";

// Турнир: короткая дистанция с понятным концом.
//
// Сезон длится месяц, общий рейтинг не кончается вовсе — а игроку нужно и
// «зашёл, три дня поторговал, увидел итог». Взнос обязателен: без него турнир
// превращается в бесплатную лотерею, куда выгодно записаться и не играть.
// Призовой фонд собран из взносов, поэтому его размер честно говорит,
// сколько людей пришло.
import { useCallback, useEffect, useState } from "react";
import { Swords } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { fetchTournament, joinTournament, type TournamentStandings } from "@/lib/game/worldClient";
import { useGameStore } from "@/store/gameStore";

function hoursLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / (60 * 60 * 1000)));
}

export default function TournamentPanel({ nickname }: { nickname: string | null }) {
  const { t } = useI18n();
  const equity = useGameStore((s) => s.game.account.equity);
  const balance = useGameStore((s) => s.game.account.balance);
  const applyWorldCash = useGameStore((s) => s.applyWorldCash);

  const [data, setData] = useState<TournamentStandings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    const result = await fetchTournament();
    setData(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    setNow(Date.now());
    void load();
  }, [load]);

  if (loading) return <div className="card p-4 text-xs text-faint">{t("game.world.loading")}</div>;
  if (!data) return <div className="card p-4 text-sm text-loss">{t("game.tournament.failed")}</div>;

  const { tournament, rows, joined } = data;
  const short = tournament.players < tournament.minPlayers;
  const canPay = balance >= tournament.entryFee;

  async function join() {
    setBusy(true);
    setMessage(null);
    const result = await joinTournament(equity);
    if (!result.ok) {
      setMessage(result.error);
      setBusy(false);
      return;
    }
    // Взнос списывает клиент: игровой баланс живёт в браузере, сервер копит
    // только фонд.
    applyWorldCash(-result.data.entryFee);
    setMessage(t("game.tournament.joined"));
    await load();
    setBusy(false);
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <Swords size={15} className="text-accent" />
            {t("game.tournament.title", { index: tournament.index })}
          </div>
          <div className="text-xs text-faint mt-0.5">{t("game.tournament.hint")}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium tabular-nums">
            {now > 0 ? t("game.tournament.hoursLeft", { hours: hoursLeft(tournament.endsAt, now) }) : ""}
          </div>
          <div className="text-xs text-faint">
            {t("game.tournament.pool", { amount: fmtUsd(tournament.prizePool) })} ·{" "}
            {t("game.season.players", { count: tournament.players })}
          </div>
        </div>
      </div>

      {short && (
        <div className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
          {t("game.tournament.tooFew", { need: tournament.minPlayers })}
        </div>
      )}

      {!joined && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !canPay}
            onClick={() => void join()}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
          >
            {t("game.tournament.join", { fee: fmtUsd(tournament.entryFee) })}
          </button>
          {!canPay && <span className="text-xs text-loss">{t("game.tournament.noMoney")}</span>}
          {message && <span className="text-xs text-muted">{message}</span>}
        </div>
      )}
      {joined && <div className="text-xs text-profit">{t("game.tournament.inPlay")}</div>}

      {rows.length === 0 ? (
        <div className="text-sm text-faint">{t("game.tournament.empty")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted">
                <th className="text-left font-medium py-2">#</th>
                <th className="text-left font-medium">{t("game.world.player")}</th>
                <th className="text-right font-medium">{t("game.season.result")}</th>
                <th className="text-right font-medium">{t("game.season.prize")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const share = tournament.prizeShares[i] ?? 0;
                const prize = short ? 0 : tournament.prizePool * share;
                const me = nickname != null && row.nickname === nickname;
                return (
                  <tr key={row.playerId} className={`border-t border-border ${me ? "bg-accent/5" : ""}`}>
                    <td className="py-2 tabular-nums text-faint">{i + 1}</td>
                    <td className="py-2 font-medium">{row.nickname}</td>
                    <td className={`py-2 text-right tabular-nums ${row.resultPct >= 0 ? "text-profit" : "text-loss"}`}>
                      {row.resultPct >= 0 ? "+" : ""}
                      {row.resultPct.toFixed(2)}%
                    </td>
                    <td className="py-2 text-right tabular-nums text-faint">{prize > 0 ? fmtUsd(prize) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
