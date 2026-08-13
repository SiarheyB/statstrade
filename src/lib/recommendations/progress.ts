/**
 * progress.ts — состояние текущего пересчёта рекомендаций для прогресс-бара в
 * админке.
 *
 * Хранится в памяти процесса: пересчёт запускается и наблюдается в одном и том
 * же Next-процессе (самохостинг — один контейнер `app`, см. CLAUDE.md), поэтому
 * отдельная таблица/Redis тут были бы лишними. Перезапуск контейнера сбрасывает
 * прогресс — это нормально, сам пересчёт идемпотентный (truncate + refill).
 */

import { recomputeRecommendations, type RecomputeResult } from "./recompute";
import { refreshDailyCandles } from "./candleScan";

export type RecomputePhase = "idle" | "fetching" | "listing" | "scanning" | "writing" | "done" | "error";

export interface RecomputeProgress {
  phase: RecomputePhase;
  running: boolean;
  /** Сколько пар уже обработано (для phase = scanning). */
  processed: number;
  /** Сколько всего пар в этом прогоне; 0 пока идёт phase = listing. */
  total: number;
  /** Символ, который считается прямо сейчас. */
  currentSymbol: string | null;
  /** Сколько уровней прошло фильтр качества — растёт по ходу сканирования. */
  levelsFound: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: RecomputeResult | null;
  /** Итог загрузки свежих свечей с биржи перед пересчётом. */
  candleScan: {
    done: number;
    total: number;
    /** Заполняется, если свечи обновить не удалось — считали по старым. */
    skippedReason: string | null;
  } | null;
}

function idleState(): RecomputeProgress {
  return {
    phase: "idle",
    running: false,
    processed: 0,
    total: 0,
    currentSymbol: null,
    levelsFound: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    result: null,
    candleScan: null,
  };
}

/**
 * Состояние держим на globalThis, а не в переменной модуля: Next грузит
 * instrumentation (внутренний планировщик) и route-handlers как отдельные
 * копии модулей, поэтому обычная модульная переменная у них была бы разной —
 * плановый пересчёт не был бы виден в прогресс-баре админки, а защита от
 * двойного запуска не работала бы между ними. Тот же приём, что для
 * PrismaClient в lib/db.ts.
 */
const globalForProgress = globalThis as unknown as {
  recomputeState?: RecomputeProgress;
  recomputeInFlight?: Promise<RecomputeResult> | null;
};

globalForProgress.recomputeState ??= idleState();

function getState(): RecomputeProgress {
  return globalForProgress.recomputeState ?? idleState();
}

function setState(next: RecomputeProgress) {
  globalForProgress.recomputeState = next;
}

export function getRecomputeProgress(): RecomputeProgress {
  return { ...getState() };
}

/** Только для тестов — сбрасывает состояние между кейсами. */
export function resetRecomputeProgress() {
  setState(idleState());
  globalForProgress.recomputeInFlight = null;
}

export interface StartResult {
  /** false — пересчёт уже шёл, повторный запуск проигнорирован. */
  started: boolean;
  progress: RecomputeProgress;
  /** Промис завершения — есть и у нового запуска, и у уже идущего. */
  done: Promise<RecomputeResult>;
}

/**
 * Запускает пересчёт в фоне и сразу возвращает состояние. Повторный вызов во
 * время работы не стартует второй прогон (иначе два truncate + refill гонялись
 * бы за одну таблицу), а отдаёт прогресс текущего.
 */
export function startRecompute(): StartResult {
  const inFlight = globalForProgress.recomputeInFlight;
  if (inFlight) {
    return { started: false, progress: getRecomputeProgress(), done: inFlight };
  }

  setState({
    ...idleState(),
    phase: "fetching",
    running: true,
    startedAt: new Date().toISOString(),
  });

  const run = (async () => {
    // Шаг 1 — свежие дневные свечи с биржи (их тянет коллектор). Без этого
    // «пересчёт» считал бы по тому, что осталось от прошлого прохода суточного
    // таймера коллектора. Недоступный коллектор пересчёт не отменяет: считаем
    // по уже собранным свечам и пишем причину в статус.
    const scan = await refreshDailyCandles((done, total) => {
      setState({ ...getState(), phase: "fetching", candleScan: { done, total, skippedReason: null } });
    });
    setState({
      ...getState(),
      phase: "listing",
      candleScan: {
        done: scan.done,
        total: scan.total,
        skippedReason: scan.ok ? null : (scan.skippedReason ?? "неизвестно"),
      },
    });

    // Шаг 2 — анализ уровней по обновлённым свечам.
    return recomputeRecommendations({
      onSymbolsListed: (total) => {
        setState({ ...getState(), phase: "scanning", total });
      },
      onSymbolStart: (symbol, index) => {
        setState({ ...getState(), phase: "scanning", currentSymbol: symbol, processed: index });
      },
      onSymbolDone: (_symbol, index, levelsSoFar) => {
        setState({ ...getState(), processed: index + 1, levelsFound: levelsSoFar });
      },
      onWriteStart: () => {
        setState({ ...getState(), phase: "writing", currentSymbol: null });
      },
    });
  })()
    .then((result) => {
      const prev = getState();
      setState({
        ...prev,
        phase: "done",
        running: false,
        currentSymbol: null,
        processed: prev.total,
        levelsFound: result.candidates,
        finishedAt: new Date().toISOString(),
        result,
      });
      return result;
    })
    .catch((err: unknown) => {
      setState({
        ...getState(),
        phase: "error",
        running: false,
        currentSymbol: null,
        finishedAt: new Date().toISOString(),
        error: (err as Error).message,
      });
      throw err;
    })
    .finally(() => {
      globalForProgress.recomputeInFlight = null;
    });

  // Без обработчика неперехваченный reject фонового промиса роняет процесс —
  // ошибка уже сохранена в state и отдаётся админке через GET.
  run.catch(() => {});
  globalForProgress.recomputeInFlight = run;

  return { started: true, progress: getRecomputeProgress(), done: run };
}
