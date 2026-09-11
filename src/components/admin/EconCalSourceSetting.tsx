"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import clsx from "clsx";

// Общий выключатель календаря + выбор источника событий. Живёт в карточке
// «Экономический календарь» на /admin/content, а не среди переключателей на
// /admin/features: тут рядом счётчик событий и кнопка ручного обновления —
// то есть всё, что нужно, чтобы переключить источник и сразу увидеть результат.
//
// Обе настройки — одна строка FeatureConfig с ключом `econcal`: `enabled` и
// `config.source` (см. src/lib/features.ts).

type Source = "forexfactory" | "investing";

const SOURCES: { value: Source; title: string; note: string }[] = [
  {
    value: "forexfactory",
    title: "ForexFactory",
    note: "Бесплатный фид faireconomy. Названия событий по-английски (в интерфейсе переводятся словарём), важность фида подгоняется под шкалу investing вручную — таблицей в коде.",
  },
  {
    value: "investing",
    title: "ru.investing.com",
    note: "Разбор страницы календаря investing. Названия сразу по-русски, важность — родные звёзды investing, без ручной таблицы. Шире по событиям еврозоны (Германия, Франция, Италия, Испания отдельно).",
  },
];

export default function EconCalSourceSetting({
  enabled,
  source,
  sourceError,
}: {
  enabled: boolean;
  source: Source;
  /** Почему выбранный источник сейчас не отдаёт событий (если не отдаёт). */
  sourceError?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { enabled?: boolean; config?: { source: Source } }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/features", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: "econcal", ...body }),
      });
      if (!res.ok) {
        setError(((await res.json()) as { error?: string }).error ?? "Не удалось сохранить");
        return;
      }
      // Счётчик событий и «ближайшее событие» на этой странице считаются на
      // сервере — после смены источника они показывают уже другие числа.
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium">Календарь включён</div>
          <p className="mt-0.5 text-[11px] text-faint leading-relaxed">
            {enabled
              ? "Виден всем: страница «Календарь», блок на главной, напоминания перед выходом новостей."
              : "Выключен — календарь скрыт у всех, напоминания не приходят, за событиями наружу не ходим."}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label="Экономический календарь"
          disabled={busy}
          onClick={() => patch({ enabled: !enabled })}
          className={clsx(
            "relative inline-flex h-6 w-11 items-center rounded-full transition shrink-0 disabled:opacity-50",
            enabled ? "bg-accent" : "bg-surface-2 border border-border",
          )}
        >
          <span
            className={clsx(
              "inline-block h-4 w-4 rounded-full bg-white transition",
              enabled ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </div>

      <div
        className={clsx(
          "mt-3 transition-opacity duration-200",
          enabled ? "opacity-100" : "opacity-40 pointer-events-none select-none",
        )}
        aria-hidden={!enabled}
      >
        {sourceError && (
          // Показываем ровно выбранный источник и ничего не подменяем, поэтому
          // единственное, чем можно помочь админу, — объяснить, почему он пуст.
          <div className="mb-2.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-muted">
            <b>{SOURCES.find((s) => s.value === source)?.title}</b> сейчас не отдаёт событий:{" "}
            {sourceError} Календарь останется пустым, пока источник не ответит — подменять его
            вторым намеренно не стали, иначе вы смотрели бы не на тот календарь, который выбрали.
          </div>
        )}
        <div className="text-xs font-medium">Источник событий</div>
        <div className="mt-1.5 space-y-1.5">
          {SOURCES.map((s) => {
            const active = s.value === source;
            return (
              <button
                key={s.value}
                onClick={() => !active && patch({ config: { source: s.value } })}
                disabled={busy || active}
                className={clsx(
                  "w-full text-left rounded-lg border px-3 py-2 transition disabled:cursor-default",
                  active
                    ? "border-accent bg-accent/10"
                    : "border-border hover:border-border-strong disabled:opacity-50",
                )}
              >
                <div className="flex items-center gap-2 text-xs font-medium">
                  {s.title}
                  {active && <Check size={13} className="text-accent" />}
                </div>
                <p className="mt-0.5 text-[11px] text-faint leading-relaxed">{s.note}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-faint leading-relaxed">
          События обоих источников лежат в базе рядом и не затирают друг друга, поэтому
          переключение обратимо и ничего не стирает. Новый источник подтянется сам в течение
          получаса — или сразу, кнопкой «Обновить» выше.
        </p>
      </div>

      {error && <p className="mt-2 text-xs text-loss">{error}</p>}
    </div>
  );
}
