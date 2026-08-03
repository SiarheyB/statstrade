# Аудит производительности statstrade (2026-08-03)

Статусы: `[ ]` не сделано, `[x]` выполнено.

## Фронтенд

### 1. [x] rAF-throttle redraw() на mousemove/wheel — ВЫСОКИЙ
`src/lib/useChartInteractions.ts` (`onMove` ~136-289, wheel-листенер ~422-453).
`redraw()` вызывается синхронно на каждое mousemove/wheel событие (до 60-120 раз/сек).
**Фикс:** обернуть `redraw()` в rAF-коалесер (флаг `rafPending`), общий для mousemove/wheel/pan.

### 2. [ ] Мемоизация merged-candles и y-range/candleStep — ВЫСОКИЙ
`src/app/dashboard/orderflow/page.tsx` (`draw()` ~640-648, `getMergedCandles()` ~297-302).
Каждый кадр пересчитывается `fYMin/fYMax/candleStep` проходом по всему массиву свечей (до 4000),
`getMergedCandles()` создаёт новый спред-массив дважды на каждый hover.
**Фикс:** мемоизировать по ключу `(data, historyVersion)`, кэшировать merged-массив в ref.

### 3. [ ] Кэш агрегации footprint — СРЕДНИЙ
`src/app/dashboard/orderflow/page.tsx` (~761-792). Пересоздаёт Map и проходит все levels на каждый draw().
**Фикс:** предвычислять через useMemo/ref, привязанный к реальному изменению fp.

### 4. [ ] Выборочная перерисовка панелей ForexView — СРЕДНИЙ
`src/app/dashboard/forex/ForexView.tsx` (`redrawAll` ~653-658). Все 3 канваса перерисовываются на каждый mousemove.
**Фикс:** delta/B-A перерисовывать только при смене snapped-колонки.

### 5. [ ] Пауза polling в фоновой вкладке — НИЗКИЙ
`page.tsx` (~582, 607), `ForexView.tsx` (~271). Нет проверки `document.hidden`.
**Фикс:** ставить интервалы на паузу через `visibilitychange`.

### 6. [ ] React.memo на тяжёлые leaf-компоненты — НИЗКИЙ
`ImbalanceHeatmap`, `VolumeProfile`, `DivergenceHistory`, `AbsorptionPanel` ре-рендерятся на любое
состояние родителя (30+ useState в OrderflowPage).
**Фикс:** обернуть в React.memo.

## Бэкенд / БД

### 7. [ ] Индекс на bucket в rollup-таблицах — ВЫСОКИЙ
`collector/index.mjs` (~693-708), `prisma/schema.prisma` (ObSnapshotRollup ~446-447, ObRollupBucket ~460-461).
Ежечасный DELETE по `bucket <` не может использовать индексы `[symbol,...,bucket]` → full scan растущей таблицы.
**Фикс:** добавить `@@index([bucket])` на обе таблицы (миграция), либо партиционирование + DROP PARTITION.

### 8. [ ] select вместо full findMany в stats — СРЕДНЕ-ВЫСОКИЙ
`src/app/api/stats/route.ts` (~78, 122). Тянутся все колонки Trade/ImportedTrade.
**Фикс:** явный select под используемые поля.

### 9. [ ] Rollup flush beat не завязан на границу минуты — СРЕДНИЙ
`collector/index.mjs` (~472). Запрос каждую секунду 24/7 независимо от закрытия бакета.
**Фикс:** привязать к границе минуты.

### 10. [ ] Явный connection_limit для Prisma — СРЕДНИЙ
`src/lib/db.ts` (~9). Нет явного лимита пула на слабом сервере при app+collector.
**Фикс:** задать connection_limit/pool_timeout в DATABASE_URL.

### 11. [ ] O(n*m) -> O(n+m) в computeDivergence — НИЗКО-СРЕДНИЙ
`src/lib/orderflow.ts` (~883-894). Вложенный цикл синхронизации свечей и delta-бакетов.
**Фикс:** two-pointer вместо вложенного цикла.
