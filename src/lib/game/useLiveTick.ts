"use client";

// Живая цена внутри минуты.
//
// Раньше последний бар ждал ответа сервера и прыгал раз в несколько секунд:
// «минута прошла — появилась палка, непонятно откуда». Настоящий терминал
// показывает цену непрерывно, и последняя свеча растёт на глазах.
//
// Считаем тики В БРАУЗЕРЕ тем же детерминированным путём, что и сервер: для
// этого нужны только сид мира и последняя минутка. Ни одного лишнего запроса,
// и к закрытию минуты клиентская цена сходится с серверной до цента —
// потому что это буквально одна и та же функция.
import { useEffect, useRef, useState } from "react";
import { tickPrice, MS_MINUTE, type GeneratedCandle } from "@/lib/game/marketGen";
import type { Asset } from "@/engine/entities/types";

/** Как часто пересчитываем цену. Две секунды — шаг тика в генераторе. */
export const TICK_INTERVAL_MS = 2000;

let cachedKey: { value: string; expiresAt: number } | null = null;
let keyPromise: Promise<string | null> | null = null;

/**
 * Ключ тиков. Живёт ОДИН ЧАС и запрашивается один раз на вкладку — пока не
 * истечёт.
 *
 * Раньше здесь лежал сид мира, и это была дыра: генератор рынка едет в этот
 * же бандл, поэтому с сидом на руках можно было посчитать любой будущий бар,
 * а не только текущую минуту. Часовой ключ даёт ту же случайность внутри
 * минуты и не даёт ничего за её пределами.
 */
export function useTickKey(): string | null {
  const [key, setKey] = useState<string | null>(cachedKey?.value ?? null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      if (cachedKey && cachedKey.expiresAt > Date.now()) {
        setKey(cachedKey.value);
        return;
      }
      keyPromise ??= fetch("/api/game/market")
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data?.tickKey) return null;
          cachedKey = { value: data.tickKey, expiresAt: data.tickKeyExpiresAt ?? Date.now() + 3_600_000 };
          return cachedKey.value;
        })
        .catch(() => null)
        .finally(() => {
          // Промис снимаем всегда: следующий час должен сходить за новым
          // ключом, а не получить закешированный отказ.
          keyPromise = null;
        });
      void keyPromise.then((value) => {
        if (alive) setKey(value);
      });
    };
    load();
    // Час прошёл — ключ протух. Проверяем раз в минуту: точность здесь не
    // нужна, а таймер на час пережил бы усыпление вкладки не всегда.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return key;
}

/**
 * Цена в текущий момент внутри последней минутки.
 *
 * `null`, если считать не по чему: нет сида, нет минутки или минутка уже
 * закрылась — тогда показывать надо её закрытие, а не выдуманное значение.
 */
export function useLiveTick(asset: Asset | undefined, lastMinute: GeneratedCandle | null): number | null {
  const seed = useTickKey();
  const [price, setPrice] = useState<number | null>(null);
  // Через ref, чтобы таймер не пересоздавался на каждой смене минутки.
  // Пишем ref в эффекте, а не в теле: React справедливо запрещает трогать
  // refs во время рендера.
  const dataRef = useRef<{ asset: Asset | undefined; lastMinute: GeneratedCandle | null; seed: string | null }>({
    asset: undefined,
    lastMinute: null,
    seed: null,
  });
  useEffect(() => {
    dataRef.current = { asset, lastMinute, seed };
  }, [asset, lastMinute, seed]);

  useEffect(() => {
    const compute = () => {
      const { asset: a, lastMinute: minute, seed: s } = dataRef.current;
      if (!a || !minute || !s) {
        setPrice(null);
        return;
      }
      const offset = Date.now() - minute.ts;
      // Минутка закрылась — её закрытие и есть цена, дорисовывать нечего.
      if (offset < 0 || offset >= MS_MINUTE) {
        setPrice(null);
        return;
      }
      setPrice(tickPrice(minute, a, s, Math.round(minute.ts / MS_MINUTE), offset));
    };
    compute();
    const timer = setInterval(() => {
      // Фоновую вкладку не дёргаем — там всё равно никто не смотрит.
      if (typeof document !== "undefined" && document.hidden) return;
      compute();
    }, TICK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return price;
}
