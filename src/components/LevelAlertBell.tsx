"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellRing, Check, Loader2 } from "lucide-react";
import clsx from "clsx";
import {
  DEFAULT_THRESHOLD_ATR,
  THRESHOLD_STEPS,
  formatPrice,
} from "@/lib/recommendations/alerts";
import { pushState, subscribePush, type PushState } from "@/lib/push/client";

/**
 * Колокольчик «сообщить, когда цена подойдёт к уровню» — в шапке карточки
 * сетапа на странице «Рекомендации».
 *
 * Почему тут, а не общей настройкой раздела: уведомление нужно не «по
 * рекомендациям вообще», а по КОНКРЕТНОМУ уровню, который человек выбрал сам.
 * Из десятка инструментов в выдаче его обычно интересуют один-два.
 *
 * Свёрнутый вид — только иконка: карточка и без того плотная, и десяток
 * развёрнутых настроек порога в списке превратил бы её в форму. Настройка
 * раскрывается по клику, ровно когда человек решил подписаться.
 */

export type LevelAlert = {
  id: string;
  symbol: string;
  levelPrice: number;
  thresholdAtr: number;
  triggeredAt: string | null;
};

export default function LevelAlertBell({
  symbol,
  levelPrice,
  direction,
  atr,
  alert,
  onChange,
}: {
  symbol: string;
  levelPrice: number;
  direction: string;
  atr: number;
  /** Текущая подписка на этот уровень, если она есть. */
  alert: LevelAlert | null;
  /** Родитель держит список подписок — сообщаем ему об изменении. */
  onChange: (next: LevelAlert | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState<PushState | null>(null);
  const [threshold, setThreshold] = useState(alert?.thresholdAtr ?? DEFAULT_THRESHOLD_ATR);
  const boxRef = useRef<HTMLDivElement>(null);

  // Состояние push спрашиваем только когда панель открыли: на странице десяток
  // карточек, и опрашивать service worker из каждой при загрузке списка —
  // десяток лишних проверок ради подсказки, которую никто не увидит.
  useEffect(() => {
    if (!open || push !== null) return;
    pushState()
      .then(setPush)
      .catch(() => setPush("unsupported"));
  }, [open, push]);

  // Клик мимо — закрыть. Панель висит поверх карточки, и без этого она
  // оставалась бы открытой, пока человек не попадёт ровно по колокольчику.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const save = useCallback(
    async (thresholdAtr: number) => {
      setBusy(true);
      try {
        // Подписка без разрешения браузера — это тумблер, который ничего не
        // включает. Спрашиваем разрешение здесь же, в момент осознанного
        // действия, а не заранее при заходе на страницу.
        let state = push ?? (await pushState());
        if (state === "off") state = await subscribePush();
        setPush(state);
        if (state !== "on") return;

        const res = await fetch("/api/recommendations/alerts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbol, levelPrice, direction, atr, thresholdAtr }),
        });
        if (res.ok) {
          onChange(((await res.json()) as { alert: LevelAlert }).alert);
          setOpen(false);
        }
      } finally {
        setBusy(false);
      }
    },
    [atr, direction, levelPrice, onChange, push, symbol],
  );

  const remove = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/recommendations/alerts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, levelPrice }),
      });
      if (res.ok) {
        onChange(null);
        setOpen(false);
      }
    } finally {
      setBusy(false);
    }
  }, [levelPrice, onChange, symbol]);

  const on = alert !== null;
  const zone = threshold * atr;

  return (
    <div ref={boxRef} className="relative shrink-0">
      <button
        type="button"
        aria-label={on ? "Уведомление включено" : "Сообщить, когда цена подойдёт к уровню"}
        aria-pressed={on}
        onClick={(e) => {
          // Карточка целиком — кнопка «раскрыть график»; без этого клик по
          // колокольчику заодно разворачивал бы карточку.
          e.stopPropagation();
          setThreshold(alert?.thresholdAtr ?? DEFAULT_THRESHOLD_ATR);
          setOpen((v) => !v);
        }}
        className={clsx(
          "inline-flex h-8 w-8 items-center justify-center rounded-lg border transition",
          on
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-transparent text-faint hover:border-border hover:text-muted",
        )}
      >
        {on ? <BellRing size={15} /> : <Bell size={15} />}
      </button>

      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          // bg-surface, а НЕ bg-surface-1: такого токена в теме нет
          // (см. globals.css — есть surface и surface-2), и класс молча не
          // давал фона вовсе — панель висела прозрачной поверх карточки, и
          // текст читался вперемешку с тем, что под ней.
          className="absolute right-0 top-9 z-30 w-72 rounded-xl border border-border-strong bg-surface p-3 shadow-2xl"
        >
          <div className="text-xs font-medium">Сообщить о подходе к уровню</div>
          <p className="mt-1 text-[11px] leading-relaxed text-faint">
            Уведомление придёт один раз, когда цена окажется ближе {threshold}×ATR к уровню{" "}
            {formatPrice(levelPrice, levelPrice)} — это примерно ±
            {formatPrice(zone, levelPrice)} по цене. Когда цена уйдёт от уровня далеко,
            уведомление зарядится снова.
          </p>

          <div className="mt-2.5 text-[11px] font-medium text-muted">Насколько близко</div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {THRESHOLD_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                onClick={() => setThreshold(step)}
                className={clsx(
                  "rounded-md border px-2 py-1 text-[11px] tabular-nums transition",
                  step === threshold
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted hover:border-border-strong",
                )}
              >
                {step}×ATR
              </button>
            ))}
          </div>

          {push === "denied" && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-loss">
              Уведомления запрещены для сайта в браузере — разрешите их в настройках сайта
              (значок слева от адреса).
            </p>
          )}
          {push === "unsupported" && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-loss">
              Этот браузер не умеет push-уведомлений. На iPhone они работают только для сайта,
              добавленного на главный экран.
            </p>
          )}
          {push === "unconfigured" && (
            <p className="mt-2.5 text-[11px] leading-relaxed text-loss">
              Push-уведомления не настроены на сервере — обратитесь к администратору.
            </p>
          )}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || push === "denied" || push === "unsupported" || push === "unconfigured"}
              onClick={() => save(threshold)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {on ? "Сохранить" : "Уведомить"}
            </button>
            {on && (
              <button
                type="button"
                disabled={busy}
                onClick={remove}
                className="rounded-lg px-2 py-1.5 text-xs text-muted transition hover:text-loss disabled:opacity-40"
              >
                Убрать
              </button>
            )}
          </div>

          {on && alert?.triggeredAt && (
            <p className="mt-2 text-[11px] text-faint">
              Уже сработало — ждём, пока цена отойдёт от уровня.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
