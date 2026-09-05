"use client";

// Боты: кто населяет мир, чем торгует прямо сейчас и на что настроен.
//
// Раньше боты жили в справочнике характеров: чтобы завести седьмого или
// сделать одного умнее, требовался передеплой. Мир из неизменяемых шести
// человек стареет быстро, поэтому ботов заводят и настраивают отсюда.
//
// Три ручки, которые решают всё:
//   ИНТЕЛЛЕКТ — как часто бот оказывается прав. 50% — монетка, у него счёт
//     тает на комиссии времени; 80% — заметно сильнее рынка.
//   СТРЕМЛЕНИЕ — какую долю счёта он ставит в одну идею. Высокое даёт
//     громкие взлёты и такие же падения.
//   ГЛУБИНА ИИ — доля решений, которые принимает модель, а не встроенная
//     логика. Это ПРЯМО расход на токены: 100% у десяти ботов — это десять
//     запросов каждые пять минут круглые сутки.
import { useCallback, useEffect, useState } from "react";
import { Bot, Plus, RefreshCw, Trash2 } from "lucide-react";
import { fmtUsd } from "@/lib/format";

interface BotPosition {
  id: string;
  symbol: string;
  side: string;
  qty: number;
  entryPrice: number;
  price: number;
  pnlPct: number;
  reason: string | null;
  openedAt: number;
}

interface BotRow {
  id: string;
  nickname: string;
  persona: string | null;
  style: string;
  equity: number;
  peakEquity: number;
  cash: number;
  skillPct: number;
  riskPct: number;
  aiPct: number;
  voice: string | null;
  active: boolean;
  plan: string | null;
  lastActAt: number | null;
  positions: BotPosition[];
}

const STYLES = [
  { id: "scalping", label: "Скальпинг" },
  { id: "day", label: "Дейтрейдинг" },
  { id: "swing", label: "Свинг" },
  { id: "investing", label: "Инвестиции" },
];

const STYLE_LABEL: Record<string, string> = Object.fromEntries(STYLES.map((s) => [s.id, s.label]));

function ago(ts: number | null): string {
  if (!ts) return "ни разу";
  const minutes = Math.round((Date.now() - ts) / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.round(hours / 24)} д назад`;
}

/**
 * Ползунок с числом.
 *
 * Тянется он ЛОКАЛЬНО, а на сервер значение уходит один раз — когда отпустили.
 * Иначе каждое движение пальца било запросом и перезагрузкой всего списка, а
 * список возвращал ещё старое значение: курсор дёргался назад и двигался
 * рывками. Для процентов важен порядок, а не точность, — тем более незачем
 * платить сотней запросов за один жест.
 */
function Slider({
  label,
  hint,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  /** Вызывается ОДИН раз, когда ползунок отпустили. */
  onCommit: (value: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const [seen, setSeen] = useState(value);
  // Значение снаружи изменилось (перезагрузили список, сбросили бота) —
  // подхватываем его прямо на рендере. Эффект здесь был бы лишним кадром с
  // чужим числом.
  if (value !== seen) {
    setSeen(value);
    setLocal(value);
  }

  // Отпустили, ничего не изменив, — запрос не нужен: до этого правила
  // каждый случайный клик по ползунку писал в базу.
  const commit = () => {
    if (local !== seen) onCommit(local);
  };

  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted">{label}</span>
        <span className="text-xs tabular-nums">{local}%</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        // Мышь, палец и клавиатура — три способа отпустить ползунок, и ни
        // один из них не покрывает остальные.
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="w-full accent-accent"
      />
      <span className="text-[11px] text-faint">{hint}</span>
    </label>
  );
}

export default function GameBots() {
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    nickname: "",
    style: "day",
    skillPct: 55,
    riskPct: 100,
    aiPct: 35,
    startEquity: 10_000,
    voice: "",
  });

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/game/bots");
    if (!res.ok) {
      setError("Не удалось загрузить ботов");
      return;
    }
    const data = (await res.json()) as { bots: BotRow[] };
    setBots(data.bots);
    setError(null);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/admin/game/bots");
      if (!alive) return;
      if (!res.ok) {
        setError("Не удалось загрузить ботов");
        return;
      }
      const data = (await res.json()) as { bots: BotRow[] };
      if (alive) setBots(data.bots);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/admin/game/bots", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      setError("Не удалось сохранить");
      return;
    }
    await load();
  }

  async function create() {
    setBusy(true);
    const res = await fetch("/api/admin/game/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Не удалось создать бота");
      return;
    }
    setCreating(false);
    setDraft({ ...draft, nickname: "", voice: "" });
    await load();
  }

  async function remove(bot: BotRow) {
    if (!window.confirm(`Удалить бота «${bot.nickname}»? Его сообщения в чате останутся.`)) return;
    setBusy(true);
    await fetch(`/api/admin/game/bots?id=${encodeURIComponent(bot.id)}`, { method: "DELETE" });
    setBusy(false);
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <Bot size={15} className="text-accent" />
            Боты мира
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
            >
              <RefreshCw size={12} />
              Обновить
            </button>
            <button
              type="button"
              onClick={() => setCreating((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white"
            >
              <Plus size={13} />
              Новый бот
            </button>
          </div>
        </div>
        <p className="text-xs text-faint max-w-prose">
          Бот торгует по-настоящему: у него есть деньги, открытые позиции и результат по ним. Ходит он
          лениво — раз в пять минут, но только когда в мир кто-то смотрит: фоновый процесс ради
          пустой комнаты держать незачем.
        </p>
        {error && <div className="text-xs text-loss">{error}</div>}
      </div>

      {creating && (
        <div className="card p-4 space-y-3">
          <div className="text-sm font-medium">Новый бот</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs text-muted">Имя в мире</span>
              <input
                value={draft.nickname}
                maxLength={24}
                onChange={(e) => setDraft({ ...draft, nickname: e.target.value })}
                placeholder="Как его увидят в рейтинге и чате"
                className="input-base mt-1 w-full px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-xs text-muted">Стиль торговли</span>
              <select
                value={draft.style}
                onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                className="input-base mt-1 w-full px-2 py-1.5 text-sm"
              >
                {STYLES.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.label}
                  </option>
                ))}
              </select>
            </label>
            <Slider
              label="Интеллект"
              hint="Как часто он оказывается прав. 50% — монетка."
              value={draft.skillPct}
              min={0}
              max={100}
              onCommit={(skillPct) => setDraft({ ...draft, skillPct })}
            />
            <Slider
              label="Стремление"
              hint="Какую долю счёта ставит в одну идею."
              value={draft.riskPct}
              min={5}
              max={400}
              onCommit={(riskPct) => setDraft({ ...draft, riskPct })}
            />
            <Slider
              label="Глубина ИИ"
              hint="Доля решений, которые принимает модель. Это расход на токены."
              value={draft.aiPct}
              min={0}
              max={100}
              onCommit={(aiPct) => setDraft({ ...draft, aiPct })}
            />
            <label className="block">
              <span className="text-xs text-muted">Стартовый счёт, $</span>
              <input
                type="number"
                value={draft.startEquity}
                onChange={(e) => setDraft({ ...draft, startEquity: Number(e.target.value) })}
                className="input-base mt-1 w-full px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-xs text-muted">Характер и манера речи</span>
            <textarea
              value={draft.voice}
              maxLength={400}
              rows={2}
              onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
              placeholder="Как он разговаривает в чате. Пусто — бот молчит и только торгует."
              className="input-base mt-1 w-full px-2 py-1.5 text-sm"
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || draft.nickname.trim().length < 2}
              onClick={() => void create()}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Создать
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-xs text-muted hover:text-fg">
              Отмена
            </button>
          </div>
        </div>
      )}

      {!bots && !error && <div className="text-xs text-faint">Загрузка…</div>}

      {bots?.map((bot) => (
        <div key={bot.id} className={`card p-4 space-y-3 ${bot.active ? "" : "opacity-60"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">{bot.nickname}</span>
                <span className="text-[11px] text-accent">{STYLE_LABEL[bot.style] ?? bot.style}</span>
                {bot.persona && <span className="text-[11px] text-faint">из справочника</span>}
              </div>
              <div className="mt-1 flex flex-wrap gap-4 text-xs">
                <span>
                  <span className="text-muted">Счёт: </span>
                  <span className="tabular-nums">{fmtUsd(bot.equity)}</span>
                </span>
                <span>
                  <span className="text-muted">Свободно: </span>
                  <span className="tabular-nums">{fmtUsd(bot.cash)}</span>
                </span>
                <span>
                  <span className="text-muted">Ходил: </span>
                  <span>{ago(bot.lastActAt)}</span>
                </span>
              </div>
              {bot.plan && <div className="mt-1 text-[11px] text-faint max-w-prose">Последняя мысль: {bot.plan}</div>}
            </div>
            <div className="flex items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={bot.active}
                  onChange={(e) => void patch(bot.id, { active: e.target.checked })}
                  className="accent-accent"
                />
                Активен
              </label>
              <button
                type="button"
                onClick={() => void remove(bot)}
                className="text-muted transition hover:text-loss"
                title="Удалить бота"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Slider
              label="Интеллект"
              hint="Доля верных решений."
              value={bot.skillPct}
              min={0}
              max={100}
              onCommit={(skillPct) => void patch(bot.id, { skillPct })}
            />
            <Slider
              label="Стремление"
              hint="Доля счёта в одной идее."
              value={bot.riskPct}
              min={5}
              max={400}
              onCommit={(riskPct) => void patch(bot.id, { riskPct })}
            />
            <Slider
              label="Глубина ИИ"
              hint="Сколько решений принимает модель."
              value={bot.aiPct}
              min={0}
              max={100}
              onCommit={(aiPct) => void patch(bot.id, { aiPct })}
            />
          </div>

          {bot.positions.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Открытые позиции</div>
              {bot.positions.map((position) => (
                <div key={position.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-1.5 text-xs">
                  <span className="font-medium">{position.symbol}</span>
                  <span className={position.side === "long" ? "text-profit" : "text-loss"}>
                    {position.side === "long" ? "лонг" : "шорт"}
                  </span>
                  <span className="tabular-nums text-faint">
                    от {position.entryPrice.toFixed(2)} → {position.price.toFixed(2)}
                  </span>
                  <span className={`tabular-nums ${position.pnlPct >= 0 ? "text-profit" : "text-loss"}`}>
                    {position.pnlPct >= 0 ? "+" : ""}
                    {position.pnlPct.toFixed(1)}%
                  </span>
                  {position.reason && <span className="flex-1 min-w-[140px] text-faint">{position.reason}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-faint">Позиций нет — сидит в деньгах.</div>
          )}
        </div>
      ))}

      {bots?.length === 0 && <div className="card p-4 text-sm text-faint">Ботов пока нет.</div>}
    </div>
  );
}
