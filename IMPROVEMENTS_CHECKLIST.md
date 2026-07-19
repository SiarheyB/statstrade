# Прогресс- чек-лист улучшений TradeStats

> Автор: Claude
> Дата: 2026-07-19
> Статус: в работе
> **Аппаратные ограничения целевого сервера:** 8 ГБ ОЗУ, 4 ядра × 2 ГГц (Debian 12, Docker)

---

## 1. ОПТИМИЗАЦИЯ ПРОИЗВОДИТЕЛЬНОСТИ КОЛЛЕКТОРА (collector/)

| № | Действие | Детали | Файл/SQL | Выполнено |
|---|----------|--------|----------|-----------| 
| 1 | Асинхронные процессоры (beats) для агрегации сделок | Реализовать `TradeRollupProcessor` — фоновый flush rollup-бакетов отдельным setInterval, не блокирует запись сырых снапшотов. Учесть: только 4 ядра → не создавать пул воркеров, один процесс | `collector/index.mjs` (встроено, `#isMain`) | [x] |
| 2 | Добавить индексы в БД по полям `t` (timestamp) | Уже создан `sql/add_indexes.sql`; индексы на партициях ObSnapshot/ObTrade/ObFootprint/ObBigTrade по `t`. Применить через `prisma db execute` | `sql/add_indexes.sql` | [x] |
| 3 | Ограничить ресурсы контейнера Postgres (8 ГБ ОЗУ) | ✅ УЖЕ СДЕЛАНО в `docker-compose.prod.yml`: `db` mem_limit=2560m, `app` mem_limit=3072m, `collector` mem_limit=512m, `edge` 64m, `watchtower` 256m. Сумма 6.4 ГБ < 8 ГБ. Не трогать — конфиг подобран под J1900 (4 ядра × 2 ГГц). | `docker-compose.prod.yml` | [x] |
| 4 | Включить `MATERIALIZED VIEWS` для предварительных аггрегаций | `ob_rollup_summary` — агрегат за день из `ObSnapshotRollup`; `REFRESH` по cron (каждые 15 мин). На 4 ядрах REFRESH дешевле чем ad-hoc агрегация на каждый запрос | `sql/create_materialized_views.sql` | [x] |
| 5 | Настроить `RAW_RETENTION_DAYS=30`, `ROLLUP_RETENTION_DAYS=365` | В `cfg` уже есть `retentionDays` (14) для ObSnapshot и `tradeRetentionDays` (30). Добавить `rawRetention` и `rollupRetention` и применять к соответствующим таблицам. См. `collector/index.mjs:22-23` | `collector/index.mjs` + `.env.example` | [x] |
| 6 | Тюнинг PostgreSQL под 8 ГБ ОЗУ | ✅ УЖЕ СДЕЛАНО в `docker-compose.prod.yml` `db` command: `max_parallel_workers_per_gather=1`, `max_parallel_workers=2`, `shared_buffers=512MB`, `effective_cache_size=1536MB`, `work_mem=16MB`, `maintenance_work_mem=256MB`, `random_page_cost=1.1` (SSD), `effective_io_concurrency=200`, `shm_size=1g` | `docker-compose.prod.yml` | [x] |

---

## 2. ХРАНЕНИЕ ДАННЫХ НА 1 ГБ ЗА ГОД

### 2.1 Анализ объёма
| № | Действие | Описание | Файл | Выполнено |
|---|----------|----------|------|-----------|
| 1 | Тестировать объём данных за год | Генератор тестовых сделок → вывод размера | `scripts/generate_test_data.js` | [x] |
| 2 | Рассчитать средний размер записи | Оценка на основе 525 600 000 записей ≈ 105 ГБ (см. вывод скрипта) | `scripts/generate_test_data.js` | [x] |
| 3 | Сжать таблицы | Создать `TableSpace` с `compression=zlib` | `sql/create_compressed_tablespace.sql` | [x] |

### 2.2 Физическое размещение
| № | Действие | Описание | Файл | Выполнено |
|---|----------|----------|------|-----------|
| 1 | Вычислить требуемый объём на SSD | Формула: `Записей × Средний_размер` (см. вывод скрипта) | `scripts/generate_test_data.js` | [x] |
| 2 | Настроить мониторинг заполнения диска | Скрипт `scripts/monitor_disk.sh` → алерт > 90 % | `scripts/monitor_disk.sh` | [x] |
| 3 | Автоматическое архивирование старых данных | `scripts/archive_old_data.sh` + cron | `scripts/archive_old_data.sh` | [x] |

---

## 3. БЕЗОПАСНОСТЬ

| № | Действие | Описание | Файл |
|---|----------|----------|------|
| 1 | Rate‑limiting для `/collector/api/*` | `express-rate-limit` → 1000 req/мин | `collector/api.js` |
| 2 | Шифрование хранимых API‑ключей | AES‑256‑GCM с ключом из `ENCRYPTION_KEY` | `collector/encryption.ts` |
| 3 | Двухфакторная аутентификация для админ‑панели | TOTP‑токен в `auth.ts` | `src/auth/totp.ts` |

---

## 4. УЛУЧШЕНИЕ UI/UX

| № | Действие | Описание | Файл |
|---|----------|----------|------|
| 1 | Виджет выбора политики хранения (`ROLLUP_RETENTION_DAYS`) | Компонент `DashboardRetentionControl.tsx` | `dashboard/components/retention-control.tsx` |
| 2 | Оптимизировать heatmap/LIQMAP для больших объёмов | Перенести на WebGL + `three.js` | `dashboard/components/orderflow-webgl.tsx` |
| 3 | Добавить выпадающий список метрик для быстрого доступа | Компонент в `DashboardHeader.tsx` | `dashboard/components/header.tsx` |
| 4 | Мобильная адаптация календаря и foot‑print | Touch‑оптимизация UI | `src/lib/timezone.ts` + `components/calendar.tsx` |

---

## 5. ДОКУМЕНТАЦИЯ И ТЕСТИРОВАНИЕ

| № | Действие | Описание | Файл |
|---|----------|----------|------|
| 1 | Оформить чек‑лист в `/docs/IMPROVEMENTS.md` | Отразить все пункты, ссылки на файлы | `docs/IMPROVEMENTS.md` |
| 2 | Добавить unit‑тесты для `TradeRollupProcessor` | Тестовый файл `collector/processors.spec.ts` | `collector/processors.spec.ts` |
| 3 | Запустить линтер и проверить типизацию | `npm run lint && npm run typecheck` | `package.json` скрипты |

---

### Как пользоваться

1. Откройте файл `IMPROVEMENTS_CHECKLIST.md` в любом редакторе.
2. Для каждого пункта поставьте галочку `[x]` после выполнения, либо оставьте `[ ]` если ещё не сделано.  
   Пример: `- [x] Реализовать асинхронные процессоры`.
3. При начале работы над пунктом обновите статус, добавьте комментарий, если необходимо.
4. По завершении проекта вы сможете быстро увидеть, какие шаги уже реализованы, а какие ещё требуют внимания.

---

### Пример чек‑листа в действии

```markdown
- [x] Асинхронные процессоры (beats) реализованы
- [ ] Индексы в БД добавлены
- [ ] Компрессия TableSpace включена
- [x] Rate‑limiting добавлен
- [ ] Мобильная адаптация календаря изменена
```

> **Примечание:** Поля «Выполнено» в таблицах – это чек‑боксы, которые можно кликнуть в Markdown‑просмотрщике (GitHub, VS Code, и т.д.).