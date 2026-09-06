"use client";

// Игровой профиль пользователя в его карточке — и правка серверной части.
//
// Проверить игру целиком, торгуя вручную, нельзя: испытание идёт неделю,
// рейтинг набирается месяц, фонды и займы требуют второго человека. Админу
// нужно уметь поставить состояние, из которого он проверяет нужный экран.
//
// Про деньги отдельно. Игровой баланс живёт в браузере игрока, сервер хранит
// только обязательства и снимок для рейтинга. Поэтому здесь не «поле
// баланса», а НАЧИСЛЕНИЕ: сумма кладётся в ту же очередь, которой приходят
// проценты по займам и призы сезона, и становится настоящими деньгами при
// следующей синхронизации. Поле «эквити» правке не подлежит вовсе — это
// снимок, который клиент перезапишет через минуту.
import { useState } from "react";
import { money } from "./types";

export type PlayerGame = {
  nickname: string;
  rankKey: string;
  prestige: number;
  level: number;
  equity: number;
  peakEquity: number;
  contractsPassed: number;
  bestContractPct: number;
  reliability: number;
  activeStyle: string;
  gameDay: number;
  pendingPayout: number;
  isPublic: boolean;
  mutedUntil: number | null;
  fundName: string | null;
  lastSyncAt: string | null;
  seasonReturnPct: number | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5">
      <span className="text-muted">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export default function PlayerGameCard({ userId, player }: { userId: string; player: PlayerGame | null }) {
  const [draft, setDraft] = useState({
    nickname: player?.nickname ?? "",
    prestige: player?.prestige ?? 0,
    level: player?.level ?? 0,
    contractsPassed: player?.contractsPassed ?? 0,
    reliability: player?.reliability ?? 100,
    grant: 0,
    muteMinutes: 0,
  });
  const [state, setState] = useState(player);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!player || !state) {
    return (
      <div className="card p-4 text-sm text-faint">
        Этот пользователь ещё не заходил в игру — игрового профиля у него нет.
      </div>
    );
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/game/player", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Не получилось");
        return;
      }
      setState((prev) => (prev ? { ...prev, ...data.player } : prev));
      setDraft((d) => ({ ...d, grant: 0, muteMinutes: 0 }));
      setMessage("Сохранено");
    } catch {
      setMessage("Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const muted = (state.mutedUntil ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="card p-4 text-sm space-y-2">
        <div className="text-sm font-medium">Игровой профиль</div>
        <Row label="Имя в мире">{state.nickname}</Row>
        <Row label="Ранг">{state.rankKey}</Row>
        <Row label="Стиль">{state.activeStyle}</Row>
        <Row label="Эквити (снимок клиента)">
          <span className="tabular-nums">{money(state.equity)}</span>
          <span className="ml-2 text-[11px] text-faint">пик {money(state.peakEquity)}</span>
        </Row>
        <Row label="Испытаний пройдено">
          <span className="tabular-nums">{state.contractsPassed}</span>
          <span className="ml-2 text-[11px] text-faint">лучшее +{state.bestContractPct.toFixed(1)}%</span>
        </Row>
        <Row label="Престиж / уровень">
          <span className="tabular-nums">
            {state.prestige} / {state.level}
          </span>
        </Row>
        <Row label="Кредитная репутация">
          <span className={`tabular-nums ${state.reliability < 50 ? "text-loss" : ""}`}>{state.reliability}</span>
        </Row>
        <Row label="Ждёт получения">
          <span className="tabular-nums">{money(state.pendingPayout)}</span>
        </Row>
        <Row label="Сезон">
          {state.seasonReturnPct == null ? (
            <span className="text-faint">не участвует</span>
          ) : (
            <span className={`tabular-nums ${state.seasonReturnPct >= 0 ? "text-profit" : "text-loss"}`}>
              {state.seasonReturnPct >= 0 ? "+" : ""}
              {state.seasonReturnPct.toFixed(2)}%
            </span>
          )}
        </Row>
        <Row label="Фонд">{state.fundName ?? <span className="text-faint">—</span>}</Row>
        <Row label="В рейтинге">{state.isPublic ? "виден" : <span className="text-faint">скрыт</span>}</Row>
        <Row label="Чат">
          {muted ? (
            <span className="text-loss">мут до {new Date(state.mutedUntil!).toLocaleString("ru-RU")}</span>
          ) : (
            "без ограничений"
          )}
        </Row>
        <Row label="Последняя синхронизация">
          {state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("ru-RU") : "—"}
        </Row>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">Правка для проверки</div>
          <p className="mt-1 text-[11px] text-faint max-w-prose">
            Деньги нельзя записать напрямую: игровой баланс живёт в браузере игрока, сервер хранит
            обязательства. Начисление кладётся в очередь получения — клиент заберёт его при
            следующей синхронизации, и это будут настоящие игровые деньги. Эквити в правке нет
            вовсе: это снимок, который клиент перезапишет через минуту.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          {(
            [
              ["prestige", "Престиж", 0, 100000],
              ["level", "Уровень", 0, 10],
              ["contractsPassed", "Испытаний пройдено", 0, 50],
              ["reliability", "Кредитная репутация", 0, 100],
            ] as const
          ).map(([key, label, min, max]) => (
            <label key={key} className="block">
              <span className="text-xs text-muted">{label}</span>
              <input
                type="number"
                min={min}
                max={max}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
                className="input-base mt-1 w-full px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
          ))}

          <label className="block">
            <span className="text-xs text-muted">Начислить в очередь, $</span>
            <input
              type="number"
              value={draft.grant}
              onChange={(e) => setDraft((d) => ({ ...d, grant: Number(e.target.value) }))}
              className="input-base mt-1 w-full px-2 py-1.5 text-sm tabular-nums"
            />
          </label>

          <label className="block">
            <span className="text-xs text-muted">Мут, минут (0 — снять)</span>
            <input
              type="number"
              min={0}
              value={draft.muteMinutes}
              onChange={(e) => setDraft((d) => ({ ...d, muteMinutes: Number(e.target.value) }))}
              className="input-base mt-1 w-full px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void save({
                prestige: draft.prestige,
                level: draft.level,
                contractsPassed: draft.contractsPassed,
                reliability: draft.reliability,
                ...(draft.grant !== 0 ? { grant: draft.grant } : {}),
                muteMinutes: draft.muteMinutes,
              })
            }
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-50"
          >
            Применить
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ isPublic: !state.isPublic })}
            className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
          >
            {state.isPublic ? "Скрыть из рейтинга" : "Показать в рейтинге"}
          </button>
          {message && <span className="text-xs text-muted">{message}</span>}
        </div>
      </div>
    </div>
  );
}
