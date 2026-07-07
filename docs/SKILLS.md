# Навыки (Skills) для работы с TradeStats

Этот файл описывает два прикладных «навыка», которые помогают не наступать на типичные грабли проекта. Они не являются автоматическими инструментами — это контрольные чек‑листы и правила, которые я (Claude) держу в голове при любой правке.

---

## 1. Deploy & CI Skill — «как работает прод»

### Правило 1: Push в `main` = авто‑деплой
- GitHub Actions (`.github/workflows/deploy.yml`) собирает два образа: `app` и `collector`.
- Образы пушатся в GHCR: `ghcr.io/siarheyb/statstrade-app`, `ghcr.io/siarheyb/statstrade-collector`.
- На домашнем сервере `watchtower` каждые ~120 сек проверяет GHCR и делает `docker pull` + рестарт контейнеров.
- **Никаких ручных действий на сервере не нужно** — только `git push origin main`.

### Правило 2: `docker-compose.prod.yml` и `.env` — watchtower их НЕ видит
- Если меняете порты, volumes, env‑переменные, добавляете сервисы — после пуша **обязательно** заходите на сервер и делаете:
  ```bash
  git pull && docker compose -f docker-compose.prod.yml up -d
  ```
- Без этого новый compose не подхватится, сервер продолжит работать со старым конфигом.

### Правило 3: В `Dockerfile` не используйте `npm run build`
- В `Dockerfile` (app) CMD — `prisma migrate deploy && npm run start`. Сборка (`next build`) происходит на этапе `RUN npx prisma generate && npx next build` **до** CMD.
- Если добавите `npm run build` в CMD — миграции упадут, потому что БД ещё не готова.

### Правило 4: `npm ci` vs `npm install`
- В CI (GitHub Actions) и в Dockerfile используйте **`npm install`**, а не `npm ci`.
- `npm ci` требует идеально синхронный `package-lock.json`. Любая правка `package.json` без обновления lockfile → ошибка `EUSAGE` / `Missing: … from lock file`.
- `npm install` перегенерирует lockfile сам и не падает на рассинхроне.

### Правило 5: Версия Node.js
- В обоих `Dockerfile` (app и collector) — `FROM node:24-slim` / `node:24-alpine`.
- Не используйте `node:20` — он deprecated и в GH Actions выдаёт предупреждение, а в будущем может исчезнуть.

### Правило 6: Prisma generate на Windows (локально)
- `postinstall: prisma generate` может упасть с `EPERM` на переименовании `query_engine-windows.dll.node.tmp*`.
- Ворк‑аунд: `rm -f node_modules/.prisma/client/query_engine-windows.dll.node.tmp*` перед `npm install` или используйте `npm install --ignore-scripts` + ручной `npx prisma generate`.

---

## 2. Risk Manager Domain Skill — «как считаются риски»

### Где живут настройки
- Таблица `RiskProfile` (не `User`!). Поля: `userId`, `accountId` (пустая строка = дефолтный профиль), `enabled`, `maxStopsPerDay`, `riskPerTrade` (JSON), `lossLimits` (JSON).
- В `User` **нет** полей `riskLimits`, `maxStopsPerDay` и т.п. — это осознанное решение.

### Формула «чистых стопов»
```
netR = Σ (netPnl / rAmount)   по всем закрытым сделкам за период
used = netR < 0 ? ceil(-netR - 1e-9) : 0
```
- `rAmount` — денежный эквивалент 1R (берётся из `riskPerTrade` + баланс аккаунта).
- **Выигрыш компенсирует стопы**: два стопа по −1R + тейк +3R → `netR = +1` → `used = 0`. В UI риск‑баннер покажет 0 использованных стопов.

### Лимиты по периодам
- В `lossLimits` JSON хранятся включённые лимиты для `day`, `week`, `month`, `year`. Формат:
  ```json
  {
    "day": { "on": true, "value": "3" },
    "week": { "on": false, "value": "10" }
  }
  ```
- `checkRiskLimits` бросает ошибку, если `used >= limit` для любого включённого периода.

### Ключевые функции (экспортированы из `src/lib/riskManager.ts`)
- `checkRiskLimits(userId, exchangeId, orderType)` — вызывается перед выставлением стоп‑ордера.
- `getNetStopsCount(userId, exchangeId, period)` — считает `used` для периода, кэширует на TTL до конца периода.
- `calculateNetStopsFromTrades(trades, rAmount)` — чистая функция для юнит‑тестов (не дергает БД).

### Типичные ошибки при правках
1. Импортировать несуществующий `fetchCompletedStops` из `exchanges.ts` — его там нет.
2. Пытаться читать `riskLimits` из `User` — поля нет, нужен `RiskProfile`.
3. Передавать в `parseRiskProfile` строку вместо объекта — функция ждёт `{enabled, maxStopsPerDay, riskPerTrade, lossLimits}`.
4. Забыть добавить `maxStopsPerDay` в `select` при запросе `RiskProfile`.
5. Фильтровать сделки по `userId` — у `Trade` нет `userId`, только `accountId` (через `ExchangeAccount`).

### Тесты
- Находятся в `src/lib/riskManager.test.ts` (vitest).
- Покрывают: чистые стопы = 0 после выигрыша, накопление стопов без выигрыша, пограничные floating‑point кейсы.
- Чтобы запустить тесты локально: `npm test` (или `npm run test` в `package.json`).

---

## 3. Примеры применения навыков

### Пример 1: Добавление нового лимита «monthlyStops»
1. Открываем `prisma/schema.prisma` → добавляем в `lossLimits` новый ключ `month` в JSON‑полосе.
2. Вручную правляем `docker-compose.prod.yml` (если меняем тип лимита) – **не забудьте** выполнить на сервере `git pull && docker compose up -d`.
3. При расчёте лимитов в `riskManager.ts` добавляем в `Limits` новый параметр `monthlyStops` и связываем его с `lossLimits.month.value`.
4. Добавляем unit‑тест в `riskManager.test.ts`:
   ```ts
   it('should respect monthly limit', async () => {
     const used = await getNetStopsCount('user123', 'exchangeA', 'month');
     expect(used).toBeLessThan(10); // предположим, лимит = 10
   });
   ```
5. Собираем проект: `npm install && npm run build` → убеждаемся, что TypeScript не ругается.

### Пример 2: Удаление ненужного импорта и фикса EJSONPARSE
1. Пробуем импортировать `fetchCompletedStops` из `exchanges.ts` → получаем ошибку «module has no exported member».
2. Удаляем импорт из `riskManager.ts`.
3. Проверяем `package.json` — убеждаемся, что нет лишних пробелов перед `"` (иначе `EJSONPARSE`).
4. Выполняем `npm install` (не `npm ci`) → lockfile обновляется.
5. Деплоим изменения в ветку `main` → CI проходит без `EUSAGE`.

---

## 4. Чек‑лист перед коммитом

- [ ] **Deploy checklist** – если в Dockerfile/Compose добавлены новые переменные – выполнить `git pull && docker compose up -d` на сервере.
- [ ] **JSON валидация** – `cat package.json | python -m json.tool` (или `jq`) – проверка отсутствия пробелов/непарных кавычек.
- [ ] **Lockfile sync** – удалённый `package-lock.json` и `node_modules` – `npm install` (не `npm ci`).
- [ ] **Prisma generate** – локально `rm -f node_modules/.prisma/client/query_engine-windows.dll.node.tmp*` перед `npm install`.
- [ ] **Risk‑manager** – если в `RiskProfile` изменился набор полей – проверить, что в `checkRiskLimits` все новые свойства добавлены в `select`.
- [ ] **Тесты** – `npm test` прошёл без ошибок (особенно `riskManager.test.ts`).

---

## 5. Ссылки

- `docs/SELF_HOSTING.md` — полное руководство по развёртыванию.
- `.github/workflows/deploy.yml` — CI‑скрипты сборки образов.
- `src/lib/riskManager.ts` — реализация расчётов риска.
- `src/lib/risk.ts` — функции `parseRiskProfile`, `riskPerTradeAmount`.

Эти навыки помогут вам ориентироваться в проекте, избегать типовых ошибок и быстро проверять изменения перед тем, как они попадут в прод.