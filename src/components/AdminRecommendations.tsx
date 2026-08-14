"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Clock } from "lucide-react";
import clsx from "clsx";
import { rejectReasonLabel } from "@/lib/recommendations/labels";
import { fmtDateTime, fmtTime } from "@/lib/format";

type RecomputePhase = "idle" | "fetching" | "listing" | "scanning" | "writing" | "done" | "error";

type Progress = {
  phase: RecomputePhase;
  running: boolean;
  processed: number;
  total: number;
  currentSymbol: string | null;
  levelsFound: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  result: {
    symbolsScanned: number;
    levelsWritten: number;
    neutralSkipped: number;
    candidates: number;
    rejected: Record<string, number>;
  } | null;
  candleScan: { done: number; total: number; skippedReason: string | null } | null;
};

type Schedule = {
  dailyCloseUtcHour: number;
  delayMinutes: number;
  nextRunAt: string;
  schedulerInProcess: boolean;
  lastAutoRunAt: string | null;
  lastAutoRunSource: "scheduler" | "cron" | null;
  autoStale: boolean;
};

// Состояние скана дневных свечей на самом коллекторе. Показывается, даже если
// закачку начали не отсюда (суточный таймер коллектора) — иначе в админке
// висело бы «Готово» от прошлого прогона, пока свечи качаются прямо сейчас.
type CollectorScan = {
  running: boolean;
  done: number;
  total: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

type Status = {
  total: number;
  symbolsCovered: number;
  byBias: Record<string, number>;
  byDirection: Record<string, number>;
  lastComputedAt: string | null;
  lastCandlesTo: string | null;
  progress: Progress;
  collectorScan?: CollectorScan | null;
  schedule?: Schedule;
};

function untilLabel(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "вот-вот";
  const min = Math.round(ms / 60000);
  if (min < 60) return `через ${min} мин`;
  const h = Math.floor(min / 60);
  return `через ${h} ч ${min % 60} мин`;
}

/**
 * Расписание планового пересчёта. Момент — фиксированный в UTC (дневная свеча
 * Binance закрывается в 00:00 UTC круглый год), а показываем его по часовому
 * поясу из настроек: fmtTime/fmtDateTime уважают выбранную зону, и для
 * "auto" перевод часов учитывается автоматически.
 *
 * Про статус автоматики: судим по ФАКТУ прогонов (CronHeartbeat), а не по
 * ENABLE_SCHEDULER. На самохостинге внутренний планировщик выключен намеренно,
 * а пересчёт дёргает системный крон хоста — раньше админка в этом штатном
 * раскладе пугала красным «Автопересчёт выключен», хотя всё работало.
 */
function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const closeUtc = `${String(schedule.dailyCloseUtcHour).padStart(2, "0")}:00 UTC`;
  const sourceLabel =
    schedule.lastAutoRunSource === "cron" ? "системный крон хоста" : "встроенный планировщик";
  return (
    <div className="border-t border-border pt-3 space-y-1">
      <div className="flex items-center gap-2 text-sm">
        <Clock size={14} className={clsx("shrink-0", schedule.autoStale ? "text-loss" : "text-muted")} />
        {schedule.lastAutoRunAt && !schedule.autoStale ? (
          <span>
            Автопересчёт работает: последний прогон{" "}
            <span className="font-medium">{agoLabel(schedule.lastAutoRunAt)}</span> ({sourceLabel}),
            следующий в <span className="font-medium">{fmtTime(schedule.nextRunAt)}</span> по вашему
            времени
          </span>
        ) : schedule.lastAutoRunAt ? (
          <span className="text-loss">
            Автопересчёт не приходил больше суток (последний раз {agoLabel(schedule.lastAutoRunAt)},{" "}
            {sourceLabel}) — похоже, отвалился
          </span>
        ) : (
          <span className="text-loss">
            Автопересчёт ни разу не запускался — пока только вручную кнопкой выше
          </span>
        )}
      </div>
      {schedule.autoStale ? (
        <p className="text-[11px] text-faint leading-relaxed">
          {schedule.schedulerInProcess
            ? "Встроенный планировщик включён — если прогонов нет, смотрите логи контейнера app на ошибки пересчёта."
            : "Встроенный планировщик выключен (ENABLE_SCHEDULER=false) — это штатно для самохостинга: пересчёт должен дёргать системный крон хоста, задача /api/cron/recommendations (см. docs/SELF_HOSTING.md, §9.2). Проверьте на сервере: crontab -l | grep recommendations."}
        </p>
      ) : (
        <p className="text-[11px] text-faint leading-relaxed">
          Через {schedule.delayMinutes} мин после закрытия дневной свечи Binance ({closeUtc}) — чтобы
          коллектор успел забрать уже закрытый бар. Биржа работает по UTC и на летнее/зимнее время не
          переходит, поэтому момент пересчёта всегда один и тот же; сдвигается только его отображение
          в вашем часовом поясе. Следующий: {fmtDateTime(schedule.nextRunAt)} ({untilLabel(schedule.nextRunAt)}).
        </p>
      )}
    </div>
  );
}

const PHASE_LABELS: Record<RecomputePhase, string> = {
  idle: "Ожидание",
  fetching: "Загружаем свежие свечи с Binance",
  listing: "Ищем пары с дневными свечами…",
  scanning: "Считаем уровни и сигналы",
  writing: "Записываем результат в базу",
  done: "Готово",
  error: "Ошибка",
};

// Почему уровни не дошли до выдачи. Полезно, когда список внезапно пустой:
// сразу видно, какой именно критерий качества отсеял рынок.
function RejectionBreakdown({ rejected }: { rejected: Record<string, number> }) {
  const rows = Object.entries(rejected ?? {}).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;
  return (
    <details className="text-[11px] text-faint">
      <summary className="cursor-pointer hover:text-muted">Причины отсева уровней ({rows.length})</summary>
      <ul className="mt-1 space-y-0.5 pl-3">
        {rows.map(([reason, count]) => (
          <li key={reason}>
            {rejectReasonLabel(reason)}: {count}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Закачка свечей, идущая на коллекторе прямо сейчас, но начатая НЕ отсюда —
 * например, суточным таймером самого коллектора. Свой прогресс-бар для неё
 * рисовать не нужно: когда пересчёт запущен из админки, этап «Загружаем
 * свежие свечи» уже показан ниже.
 */
function CollectorScanLine({ scan }: { scan: CollectorScan }) {
  const pct = scan.total > 0 ? Math.min(100, Math.round((scan.done / scan.total) * 100)) : 0;
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 font-medium">
          <RefreshCw size={13} className="animate-spin text-muted shrink-0" />
          Коллектор качает дневные свечи с Binance
        </span>
        <span className="text-muted tabular-nums shrink-0">
          {scan.total > 0 ? `${scan.done} / ${scan.total} пар · ${pct}%` : "…"}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full rounded-full bg-accent/60 transition-[width] duration-300" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-faint">
        Запущено не из админки — это плановая закачка самого коллектора. Пересчёт уровней по этим свечам
        пойдёт по расписанию или по кнопке выше.
      </p>
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  const { phase, processed, total, currentSymbol, levelsFound, candleScan } = progress;
  // Загрузка свечей — свой счётчик (пары, скачанные с биржи); анализ — свой.
  const fetching = phase === "fetching";
  const [cur, max] = fetching ? [candleScan?.done ?? 0, candleScan?.total ?? 0] : [processed, total];
  // Пока общее число пар неизвестно — показываем неполную «неопределённую»
  // полосу вместо деления на ноль.
  const pct = max > 0 ? Math.min(100, Math.round((cur / max) * 100)) : fetching || phase === "listing" ? 5 : 100;

  return (
    <div className="border-t border-border pt-3 space-y-2">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className={clsx("font-medium", phase === "error" ? "text-loss" : "text-fg")}>{PHASE_LABELS[phase]}</span>
        <span className="text-muted tabular-nums">{max > 0 ? `${cur} / ${max} пар · ${pct}%` : "…"}</span>
      </div>

      <div className="h-2 w-full rounded-full bg-surface-2 overflow-hidden">
        <div
          className={clsx(
            "h-full rounded-full transition-[width] duration-300",
            phase === "error" ? "bg-loss" : phase === "done" ? "bg-profit" : "bg-accent",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px] text-faint">
        <span className="truncate">{currentSymbol ? `Сейчас: ${currentSymbol}` : " "}</span>
        <span className="tabular-nums shrink-0">Найдено уровней: {levelsFound}</span>
      </div>

      {candleScan?.skippedReason && (
        <div className="text-[11px] text-loss">
          Свечи с биржи обновить не удалось ({candleScan.skippedReason}) — посчитано по тому, что уже было в базе.
        </div>
      )}

      {phase === "error" && progress.error && <div className="text-xs text-loss">Ошибка: {progress.error}</div>}
      {phase === "done" && progress.result && (
        <div className="space-y-1.5">
          <div className="text-[11px] text-faint">
            {candleScan && !candleScan.skippedReason && <>Свечей обновлено по {candleScan.done} парам · </>}
            Пар просканировано: {progress.result.symbolsScanned} · прошло фильтр качества:{" "}
            {progress.result.candidates} · попало в выдачу: {progress.result.levelsWritten} · отброшено
            нейтральных: {progress.result.neutralSkipped}
          </div>
          <RejectionBreakdown rejected={progress.result.rejected} />
        </div>
      )}
    </div>
  );
}

type FeatureValue = { enabled: boolean; maxDistanceAtr: number };

// Числовые настройки фичи, которые правятся прямо на этой странице.
const NUMERIC_FIELDS = [{ key: "maxDistanceAtr" as const, step: "0.1", min: "0.1" }];
type FeatureRow = { key: string; fieldHelp: Record<string, string>; value: FeatureValue };
type AccessFeatureRow = { key: string; value: { enabled: boolean } };

function Switch({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "relative inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 shrink-0",
        on ? "bg-accent" : "bg-surface-2 border border-border",
      )}
    >
      <span className={clsx("inline-block h-4 w-4 rounded-full bg-white transition", on ? "translate-x-6" : "translate-x-1")} />
    </button>
  );
}

function agoLabel(iso: string | null): string {
  if (!iso) return "ещё не считалось";
  const ms = Date.now() - Date.parse(iso);
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}с назад`;
  if (sec < 3600) return `${Math.round(sec / 60)}мин назад`;
  if (sec < 86400) return `${Math.round(sec / 3600)}ч назад`;
  return `${Math.round(sec / 86400)}д назад`;
}

export default function AdminRecommendations() {
  const [status, setStatus] = useState<Status | null>(null);
  const [feature, setFeature] = useState<FeatureRow | null>(null);
  const [publicAccess, setPublicAccess] = useState<AccessFeatureRow | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const res = await fetch("/api/admin/recommendations", { cache: "no-store" });
    if (res.ok) setStatus(await res.json());
  }, []);

  const running = status?.progress?.running ?? false;
  // Закачка на коллекторе, начатая не отсюда: её тоже нужно показывать живьём.
  const collectorScanning = (status?.collectorScan?.running ?? false) && !running;

  // Пока что-то идёт — опрашиваем статус, чтобы двигать прогресс. Свою работу
  // опрашиваем часто, чужую закачку — реже: она длится минуты, а каждый такой
  // запрос дополнительно дёргает коллектор.
  useEffect(() => {
    if (!running && !collectorScanning) return;
    const id = setInterval(loadStatus, running ? 1000 : 5000);
    return () => clearInterval(id);
  }, [running, collectorScanning, loadStatus]);

  const loadFeature = useCallback(async () => {
    const res = await fetch("/api/admin/features", { cache: "no-store" });
    if (res.ok) {
      const rows = (await res.json()).features ?? [];
      const row = rows.find((r: FeatureRow) => r.key === "tradeRecommendations");
      if (row) {
        setFeature(row);
        setDrafts(Object.fromEntries(NUMERIC_FIELDS.map((f) => [f.key, String(row.value[f.key])])));
      }
      const publicAccessRow = rows.find((r: AccessFeatureRow) => r.key === "tradeRecommendationsPublicAccess");
      if (publicAccessRow) setPublicAccess(publicAccessRow);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    loadFeature();
  }, [loadStatus, loadFeature]);

  // POST только СТАРТУЕТ пересчёт (202) и сразу возвращает управление —
  // дальше картинку двигает поллинг GET-статуса выше.
  async function rescan() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/recommendations", { method: "POST" });
      const body = await res.json().catch(() => null);
      if (res.ok || res.status === 202 || res.status === 409) {
        if (body) setStatus(body as Status);
        if (res.status === 409) setError("Пересчёт уже идёт — показан прогресс текущего.");
      } else {
        setError((body as { error?: string } | null)?.error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!feature) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tradeRecommendations", enabled: !feature.value.enabled }),
      });
      if (res.ok) {
        const row = ((await res.json()).features ?? []).find((r: FeatureRow) => r.key === "tradeRecommendations");
        if (row) setFeature(row);
      }
    } finally {
      setBusy(false);
    }
  }

  async function togglePublicAccess() {
    if (!publicAccess) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tradeRecommendationsPublicAccess", enabled: !publicAccess.value.enabled }),
      });
      if (res.ok) {
        const row = ((await res.json()).features ?? []).find(
          (r: AccessFeatureRow) => r.key === "tradeRecommendationsPublicAccess",
        );
        if (row) setPublicAccess(row);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveField(key: string) {
    const n = Number(drafts[key]);
    if (!Number.isFinite(n) || n <= 0) return;
    setSavingConfig(true);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "tradeRecommendations", config: { [key]: n } }),
      });
      if (res.ok) {
        const row = ((await res.json()).features ?? []).find((r: FeatureRow) => r.key === "tradeRecommendations");
        if (row) setFeature(row);
        setSaved(true);
        setTimeout(() => setSaved(false), 1500);
      }
    } finally {
      setSavingConfig(false);
    }
  }

  const breakout = status?.byBias.breakout ?? 0;
  const falseBreakout = status?.byBias.false_breakout ?? 0;
  const longs = status?.byDirection?.long ?? 0;
  const shorts = status?.byDirection?.short ?? 0;

  return (
    <div className="mt-6 space-y-6 max-w-2xl">
      {/* Статус + ручной пересчёт */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Текущая картина дня</div>
            <p className="text-xs text-muted mt-1">
              Последний пересчёт: {agoLabel(status?.lastComputedAt ?? null)}
              {status?.lastComputedAt && <> ({fmtDateTime(status.lastComputedAt)})</>}
              {status?.lastCandlesTo && (
                <> · свечи по {new Date(status.lastCandlesTo).toLocaleDateString("ru-RU")}</>
              )}
            </p>
          </div>
          <button
            onClick={rescan}
            disabled={busy || running}
            className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50 flex items-center gap-2 shrink-0"
          >
            <RefreshCw size={14} className={busy || running ? "animate-spin" : ""} />
            {running ? "Идёт пересчёт…" : "Пересчитать сейчас"}
          </button>
        </div>

        {error && <div className="text-xs text-loss">Ошибка: {error}</div>}

        {status?.schedule && <ScheduleCard schedule={status.schedule} />}

        {collectorScanning && status?.collectorScan && <CollectorScanLine scan={status.collectorScan} />}

        {status?.progress && status.progress.phase !== "idle" && <ProgressBar progress={status.progress} />}

        <div className="flex flex-wrap gap-4 text-sm border-t border-border pt-3">
          <span className="text-muted">
            Уровней: <span className="text-fg font-medium">{status?.total ?? "—"}</span>
          </span>
          <span className="text-muted">
            Пар: <span className="text-fg font-medium">{status?.symbolsCovered ?? "—"}</span>
          </span>
          <span className="text-muted">Пробой: {breakout}</span>
          <span className="text-muted">Ложный пробой: {falseBreakout}</span>
          <span className="flex items-center gap-1 text-profit">
            <TrendingUp size={14} /> Лонг: {longs}
          </span>
          <span className="flex items-center gap-1 text-loss">
            <TrendingDown size={14} /> Шорт: {shorts}
          </span>
        </div>

        <p className="text-[11px] text-faint">
          Пересчёт сначала просит collector скачать с Binance свежие дневные свечи по всем бессрочным
          USDT-контрактам — крипта плюс tradfi (золото, серебро, акции). Список пар каждый раз берётся с
          биржи заново, поэтому новые листинги попадают в скан сразу (~12 мин: биржа опрашивается
          последовательно, с паузой между парами). И только потом
          анализирует уровни. Анализ идёт по последнему ЗАКРЫТОМУ дню — сегодняшний, ещё формирующийся бар
          отбрасывается. В выдачу попадают все «готовые»
          уровни без ограничения по количеству: вчерашний день закрылся вплотную к уровню, слева нет распила
          и глубоких ложных пробоев, за уровнем пусто, есть запас хода. На инструмент — ровно один, самый
          сильный сетап. Нейтральные сетапы (факторов «за» и «против» поровну) не пишутся.
        </p>
      </div>

      {/* Настройки фичи */}
      {feature && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Раздел «Рекомендации» — общий выключатель</div>
              <p className="text-xs text-muted mt-1">
                {feature.value.enabled
                  ? "Включено — пункт меню и API доступны (если ниже разрешён публичный доступ)."
                  : "Выключено — пункт меню и API скрыты у ВСЕХ, включая админа."}
              </p>
            </div>
            <Switch on={feature.value.enabled} disabled={busy} onClick={toggleEnabled} />
          </div>

          {publicAccess && (
            <div className="border-t border-border pt-3 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">Доступ для обычных пользователей</div>
                <p className="text-xs text-muted mt-1">
                  {publicAccess.value.enabled
                    ? "Включено — раздел виден всем пользователям."
                    : "Выключено — пункт меню и данные скрыты у обычных пользователей; админ видит раздел как обычно."}
                </p>
              </div>
              <Switch on={publicAccess.value.enabled} disabled={busy} onClick={togglePublicAccess} />
            </div>
          )}

          {NUMERIC_FIELDS.map((field) => (
            <div key={field.key} className="border-t border-border pt-3 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-medium">{field.key}</div>
                <p className="text-[11px] text-faint mt-0.5 leading-relaxed max-w-md">
                  {feature.fieldHelp[field.key]}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <input
                  type="number"
                  aria-label={field.key}
                  step={field.step}
                  min={field.min}
                  className="w-24 input-base px-2 py-1 text-sm"
                  value={drafts[field.key] ?? ""}
                  onChange={(e) => setDrafts((d) => ({ ...d, [field.key]: e.target.value }))}
                />
                <button
                  onClick={() => saveField(field.key)}
                  disabled={savingConfig}
                  className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-50"
                >
                  Сохранить
                </button>
              </div>
            </div>
          ))}
          {saved && <span className="text-xs text-profit">Сохранено — вступит в силу со следующего пересчёта.</span>}
        </div>
      )}
    </div>
  );
}
