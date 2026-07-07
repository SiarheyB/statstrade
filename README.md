# TradeStats — статистика трейдера

Веб-приложение для анализа торговых результатов. Подключаете биржу
(**Binance**, **Bybit**, **OKX**) по read-only API-ключу — сделки импортируются
автоматически, и на их основе считается полная статистика: доходность, риск,
win rate, просадки и десятки других метрик.

---

## Оглавление

1. [Возможности](#возможности)
2. [Технологический стек](#технологический-стек)
3. [Локальный запуск для новичков (Mac / Windows / Linux)](#локальный-запуск-для-новичков-mac--windows--linux)
   - [Шаг 1. Что установить](#шаг-1-что-установить)
   - [Шаг 2. Скачать код](#шаг-2-скачать-код-проекта)
   - [Шаг 3. Настроить `.env`](#шаг-3-настроить-окружение-env)
   - [Шаг 4. Запустить базу данных](#шаг-4-запустить-базу-данных)
   - [Шаг 5. Установить и запустить приложение](#шаг-5-установить-и-запустить-приложение)
   - [Если что-то пошло не так](#если-что-то-пошло-не-так)
4. [Быстрый старт без ключей (демо)](#быстрый-старт-без-ключей-демо)
5. [Аутентификация и безопасность](#аутентификация-и-безопасность)
6. [Переменные окружения](#переменные-окружения-справочник)
7. [Архитектура проекта](#архитектура-проекта)
8. [Деплой в продакшн](#деплой-в-продакшн)
   - [VPS / Linux-сервер](#деплой-на-vps-linux)
   - [Docker](#деплой-через-docker)
   - [Сервер из iPhone](#сервер-из-iphone-ish--cloudflare-tunnel)

---

## Возможности

- **Мультиаккаунт / мультибиржа** — несколько аккаунтов в одном дашборде,
  фильтры по аккаунту, рынку (спот / фьючерсы) и символу.
- **Реконструкция позиций** — биржи отдают *исполнения* (fills); приложение
  собирает их в закрытые round-trip сделки методом средней цены (поддержка
  усреднения, частичных закрытий и разворотов позиции).
- **60+ метрик** — Net P&L, ROI, Win Rate, Profit Factor, Expectancy, Payoff,
  Sharpe, Sortino, Calmar, максимальная просадка (абс. и %), длительность
  просадки, серии побед/поражений, лучшая/худшая сделка, среднее время в позиции,
  RR (Risk/Reward).
- **Графики** — кривая капитала, P&L по дням, календарь-теплокарта P&L,
  разбивки по бирже / месяцу / дню недели / часу / символу / стороне (long/short),
  просадка, гистограммы распределения P&L/R-кратности/времени удержания.
- **Таблица сделок** — сортировка, фильтрация, постраничная навигация; ручная
  разметка (точка/тип входа, ошибки, стоп-лосс) настраиваемыми списками;
  дневник сделок с заметками по дням.
- **Карта ордеров (orderflow)** — heatmap лимитных стен стакана в стиле
  ClusterBtc/Bookmap (Binance futures+spot), свечи, профиль объёма, дельта/CVD,
  footprint-кластеры, B/A-дисбаланс, лента крупных сделок, LIVE-обновление,
  таймфреймы от 5м до 1н. Данные собирает отдельный сервис `collector/`.
- **Карта ликвидаций (liqmap)** — оценка уровней ликвидации плечевых позиций
  по фьючерсным свечам (Binance/Bybit/OKX), без API-ключа.
- **Экономический календарь и новости** — лента крипто-новостей с фильтром по
  источнику, календарь макро-событий (занятость/инфляция/ставки и т.п.).
- **Риск-менеджер** — лимиты по периодам (день/неделя/месяц), авто-стопы.
- **Часовой пояс отображения** — фиксированный сдвиг UTC (или по устройству),
  применяется ко всем датам/времени: сделки, календарь, графики, новости
  (Настройки → Общие).
- **Локализация** — интерфейс на английском и русском, переключатель языка.
- **Админ-панель** — для email из `ADMIN_EMAILS`: пользователи, аккаунты бирж,
  наполнение карты ордеров, здоровье БД, логи ошибок, аудит действий.
- **Безопасность** — пароли через bcrypt, сессии на JWT (HttpOnly cookie),
  секреты бирж шифруются **AES-256-GCM** перед записью в БД. Двухфакторная
  аутентификация (**TOTP**, Google Authenticator/Authy), вход и регистрация
  через **Google**, привязка/смена Google и пароля в настройках.
- **Демо-режим** — генератор синтетических сделок, чтобы исследовать дашборд
  без реальных ключей.

## Технологический стек

| Слой | Технология |
|------|-----------|
| Фреймворк | Next.js 16 (App Router) + React 19 + TypeScript |
| Стили | Tailwind CSS v4 (тёмная тема) |
| БД / ORM | Prisma 6 + PostgreSQL (dev и prod) |
| Биржи | CCXT (единый API для Binance/Bybit/OKX) |
| Графики | Recharts |
| Аутентификация | bcryptjs + jose (JWT) + Google Identity Services |

---

## Локальный запуск для новичков (Mac / Windows / Linux)

Это пошаговая инструкция «с нуля» — даже если вы никогда не запускали проекты в
терминале. Нужно установить три программы (**Git**, **Node.js**, **Docker**),
скачать код, прописать пару настроек и выполнить пять команд.

> **Что такое терминал?** Это окно для ввода команд.
> - **macOS:** программа **Terminal** (Программы → Утилиты → Терминал).
> - **Windows:** используйте **Git Bash** (ставится вместе с Git, см. ниже) — в нём
>   команды из этой инструкции работают один в один.
> - **Linux:** ваш **Terminal**.

### Шаг 1. Что установить

#### 1.1. Git (система для скачивания кода)

| ОС | Как установить |
|----|----------------|
| **macOS** | Введите в терминале `xcode-select --install` и подтвердите. Либо скачайте установщик с [git-scm.com](https://git-scm.com/download/mac). |
| **Windows** | Скачайте **Git for Windows** с [git-scm.com](https://git-scm.com/download/win) и установите со всеми настройками по умолчанию. Вместе с ним появится **Git Bash** — открывайте его для всех команд ниже. |
| **Linux (Ubuntu/Debian)** | `sudo apt update && sudo apt install -y git` |

Проверка: `git --version` — должна показаться версия.

#### 1.2. Node.js (среда, в которой работает приложение)

Нужна версия **20 или новее** (рекомендуется **22 LTS**).

| ОС | Как установить |
|----|----------------|
| **macOS** | Скачайте установщик **LTS** с [nodejs.org](https://nodejs.org/) и установите. Либо, если есть Homebrew: `brew install node@22`. |
| **Windows** | Скачайте установщик **LTS** с [nodejs.org](https://nodejs.org/) и установите (галочки по умолчанию). |
| **Linux (Ubuntu/Debian)** | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` |

Проверка: `node -v` (например `v22.x`) и `npm -v`.

#### 1.3. Docker Desktop (для базы данных PostgreSQL)

Самый простой способ поднять базу данных — через Docker, чтобы ничего не
настраивать вручную.

| ОС | Как установить |
|----|----------------|
| **macOS** | Скачайте **Docker Desktop** с [docker.com](https://www.docker.com/products/docker-desktop/) (выберите чип — Apple Silicon M1/M2/… или Intel), перетащите в «Программы», запустите. |
| **Windows** | Скачайте **Docker Desktop** с [docker.com](https://www.docker.com/products/docker-desktop/), установите. При запросе разрешите установку **WSL2** (установщик сделает всё сам). Запустите Docker Desktop. |
| **Linux** | Установите **Docker Engine** + плагин compose по [официальной инструкции](https://docs.docker.com/engine/install/). |

После установки **запустите Docker Desktop** и дождитесь статуса «Running».
Проверка: `docker --version`.

> **Не хотите Docker?** Можно поставить PostgreSQL напрямую (например, с
> [postgresql.org/download](https://www.postgresql.org/download/)) и в шаге 4
> пропустить команду `docker compose`, прописав свою строку подключения в
> `DATABASE_URL`.

### Шаг 2. Скачать код проекта

В терминале перейдите в папку, куда хотите положить проект (например, домашнюю),
и склонируйте репозиторий:

```bash
git clone <URL-репозитория>
cd <папка-проекта>
```

`<URL-репозитория>` — адрес из GitHub (кнопка **Code → HTTPS**).
`cd <папка-проекта>` — зайти в созданную папку (её имя совпадает с именем репозитория).

### Шаг 3. Настроить окружение (`.env`)

Скопируйте файл-пример настроек:

```bash
# macOS / Linux / Git Bash
cp .env.example .env
```
```powershell
# Windows PowerShell (если не используете Git Bash)
copy .env.example .env
```

Теперь сгенерируйте два секретных ключа — выполните по очереди:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # это JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # это ENCRYPTION_KEY
```

Откройте файл `.env` любым текстовым редактором (например, VS Code или «Блокнот»)
и вставьте полученные строки в `JWT_SECRET` и `ENCRYPTION_KEY`. Строку
`DATABASE_URL` менять **не нужно** — она уже совпадает с базой из Docker.

> ⚠️ **`ENCRYPTION_KEY` нельзя терять и менять** — иначе ранее сохранённые
> API-ключи бирж не расшифруются. Для локальной игры это неважно, но на бою —
> бэкапьте.

### Шаг 4. Запустить базу данных

Убедитесь, что **Docker Desktop запущен**, и поднимите PostgreSQL:

```bash
docker compose up -d db
```

База поднимется в фоне на порту `5432`. Остановить позже: `docker compose stop db`.

### Шаг 5. Установить и запустить приложение

```bash
npm install              # скачать зависимости (один раз, может занять пару минут)
npx prisma migrate dev   # создать таблицы в базе
npm run dev              # запустить приложение
```

Откройте в браузере **http://localhost:3000**. Зарегистрируйтесь на `/register`
и переходите к [демо-режиму](#быстрый-старт-без-ключей-демо), чтобы сразу увидеть
дашборд.

Чтобы остановить приложение — нажмите **Ctrl + C** в терминале.
В следующий раз достаточно `docker compose up -d db` и `npm run dev`.

### Если что-то пошло не так

| Проблема | Решение |
|----------|---------|
| `docker: command not found` или ошибка подключения к Docker | Не запущен Docker Desktop — откройте его и дождитесь статуса «Running». |
| `port 5432 ... already in use` | На компьютере уже работает PostgreSQL. Остановите его, либо измените порт в `docker-compose.yml` и в `DATABASE_URL`. |
| `port 3000 ... already in use` | Порт занят другим приложением. Запустите на другом порту: `PORT=3001 npm run dev`. |
| `node: command not found` | Node.js не установлен / терминал не перезапущен — закройте и откройте терминал заново. |
| `Can't reach database server` при `prisma migrate` | База ещё не поднялась — подождите 5–10 секунд после `docker compose up -d db` и повторите. |
| Ошибки про версию Node | Обновите Node.js до 20+ (см. шаг 1.2). |

---

## Быстрый старт без ключей (демо)

Чтобы посмотреть приложение без реальной биржи:

1. Зарегистрируйтесь на `/register`.
2. На странице **«Биржи»** добавьте аккаунт (для демо подойдут любые значения ключей).
3. Нажмите **«Демо»** у аккаунта — сгенерируются тестовые сделки.
4. Откройте **«Обзор»** — статистика и графики готовы.

---

## Аутентификация и безопасность

Поддерживаются вход по email+паролю и через Google, двухфакторная аутентификация
и управление способами входа в **Настройки → Общие**.

### Вход и регистрация через Google (опционально)

Кнопка «Войти через Google» появляется на `/login` и `/register`, только если
заданы **обе** переменные `GOOGLE_CLIENT_ID` и `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
(одно и то же значение). Без них всё остальное работает как обычно.

Настройка:

1. Откройте [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   → **Create Credentials → OAuth client ID → Web application**.
2. В **Authorized JavaScript origins** добавьте адреса приложения, например
   `http://localhost:3000` (локально) и `https://ваш-домен` (прод).
3. Скопируйте **Client ID** и пропишите его в обе переменные `.env`:

```env
GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
```

> Client **secret** не нужен: используется Google Identity Services, а `id_token`
> проверяется на сервере по публичным ключам Google (JWKS) через `jose`.

### Привязка Google к существующему аккаунту

Если вы зарегистрировались по email и паролю, в **Настройки → Общие → «Аккаунт
Google»** можно привязать Google-аккаунт, чтобы потом входить и через него.
Привязка работает, даже если email в Google отличается от email аккаунта (вход
сопоставляется по Google-идентификатору). Отвязать Google можно, только если на
аккаунте задан пароль — чтобы не потерять доступ.

### Смена / установка пароля

В **Настройки → Общие → «Сменить пароль»**. Для аккаунтов, созданных только через
Google (без пароля), там будет «Задать пароль» — это добавит второй способ входа.

### Двухфакторная аутентификация (2FA)

Включается в **Настройки → Общие → «Двухфакторная аутентификация»**: сканируете QR
(или вводите ключ вручную) в Google Authenticator / Authy / 1Password,
подтверждаете кодом. После включения вход становится двухшаговым: пароль (или
Google) → 6-значный код. TOTP по RFC 6238, секрет хранится зашифрованным
(`ENCRYPTION_KEY`). Отдельных переменных окружения не требует.

---

## Переменные окружения (справочник)

Все переменные задаются в файле `.env` (пример — `.env.example`).

| Переменная | Обяз. | Назначение |
|-----------|:----:|-----------|
| `DATABASE_URL` | да | Строка подключения к PostgreSQL. |
| `JWT_SECRET` | да | Секрет для подписи сессий (JWT). |
| `ENCRYPTION_KEY` | да | 32-байтный ключ (64 hex) для AES-256-GCM шифрования API-секретов. |
| `CRON_SECRET` | для прода | Токен для защиты эндпоинта авто-синхронизации `/api/cron/sync`. |
| `ENABLE_SCHEDULER` | нет | `"true"` — встроенный планировщик авто-синка (для постоянного процесса). |
| `GOOGLE_CLIENT_ID` | нет | Google OAuth Client ID — проверка входа на сервере. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | нет | Тот же Client ID — для кнопки «Войти через Google». |
| `NODE_ENV` | прод | `"production"` в проде. |

Сгенерировать секреты:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"  # CRON_SECRET
```

---

## Архитектура проекта

```
src/
  app/
    api/                 # route handlers (auth, accounts, sync, demo, stats,
                         #   orderflow, liqmap, econcal, news, admin/*)
    dashboard/           # дашборд: обзор / сделки / календарь / аналитика /
                         #   биржи / настройки / orderflow / liqmap / risk
    admin/               # админ-панель (guard по ADMIN_EMAILS)
    login, register/     # страницы аутентификации
  lib/
    analytics/
      positions.ts       # реконструкция round-trip сделок из исполнений
      metrics.ts         # расчёт всех метрик и разбивок
    exchanges.ts         # фабрика CCXT + нормализация сделок
    sync.ts              # импорт сделок с биржи (пагинация, дедупликация)
    demo.ts              # генератор демо-данных
    crypto.ts            # AES-256-GCM для API-секретов
    auth.ts              # хэш паролей + JWT-сессии (+ pending-шаг для 2FA)
    totp.ts              # TOTP (RFC 6238) для двухфакторной аутентификации
    google.ts            # проверка Google id_token по JWKS
    risk.ts              # риск-менеджер (лимиты по периодам, стопы)
    orderflow.ts         # heatmap стакана + свечи/дельта/footprint/B-A (карта ордеров)
    liqmap.ts            # оценка уровней ликвидации по фьючерсным свечам
    timezone.ts          # пользовательская таймзона отображения (UTC-12..+14 + auto)
    format.ts            # локализованное форматирование чисел/дат
    i18n/                # core (locale-cookie), server/provider (EN/RU), dictionaries
  middleware.ts          # защита /dashboard и /admin
  components/            # UI: графики, карточки, навигация, формы, Pagination
collector/               # отдельный long-running сервис: сбор стакана/сделок
                         #   в Postgres (Binance/Bybit/OKX), свой Dockerfile
```

**Замечания по данным:**

- **PostgreSQL** и в dev, и в prod (провайдер в `prisma/schema.prisma` — `postgresql`).
  Единый набор миграций в `prisma/migrations/` гарантирует dev/prod-паритет.
- **Синхронизация бирж** работает best-effort: сначала пробуется выгрузка всех
  сделок без символа (Bybit/OKX), при ошибке — перебор по символам (текущие
  балансы + мейджоры). Для Binance перебор может не покрыть все пары — место для
  доработки под конкретную биржу.
- **Метрики** считаются в quote-валюте (предполагается USDT/USDC). Для
  мульти-quote портфелей нужна конвертация по курсам.

---

## Деплой в продакшн

> ⚠️ **Актуальный прод — самохостинг на домашнем мини-ПК** (Docker + GHCR +
> watchtower), см. [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md). Разделы
> ниже (VPS / Docker вручную / iPhone) — альтернативные варианты деплоя для
> тех, кому нужен именно такой сценарий; не текущий прод-путь проекта.

### Деплой на VPS (Linux)

Пошаговое руководство для чистого сервера (пример — **Ubuntu 22.04 / 24.04 LTS**).
Стек на сервере: Node.js LTS, PostgreSQL, Nginx (reverse proxy + TLS), PM2.

#### 0. Что понадобится

- VPS с Ubuntu (минимум 1 vCPU / 1–2 ГБ RAM; ccxt + сборка Next любят память —
  при 1 ГБ добавьте swap, см. ниже).
- Доменное имя, указывающее A-записью на IP сервера (для HTTPS).
- SSH-доступ под пользователем с `sudo`.

#### 1. Базовая подготовка сервера

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential ufw

# (опционально, если RAM ≤ 1 ГБ) — swap, чтобы next build не падал по OOM
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Фаервол: открываем SSH и HTTP/HTTPS, всё остальное закрыто.

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # 80 + 443
sudo ufw enable
```

#### 2. Node.js LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть v22.x (≥ 20 обязательно)
```

#### 3. PostgreSQL

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql <<'SQL'
CREATE DATABASE tradestats;
CREATE USER tradestats WITH ENCRYPTED PASSWORD 'СМЕНИТЕ_ПАРОЛЬ';
GRANT ALL PRIVILEGES ON DATABASE tradestats TO tradestats;
ALTER DATABASE tradestats OWNER TO tradestats;
SQL
```

Провайдер в `prisma/schema.prisma` уже `postgresql` — менять ничего не нужно,
достаточно указать `DATABASE_URL` (шаг 5) на этот инстанс.

#### 4. Код и зависимости

```bash
sudo adduser --system --group --home /opt/tradestats deploy   # сервисный юзер
sudo mkdir -p /opt/tradestats && sudo chown deploy:deploy /opt/tradestats
sudo -u deploy -H bash
cd /opt/tradestats
git clone <URL_РЕПОЗИТОРИЯ> .
npm ci                       # точная установка по package-lock.json
```

#### 5. Переменные окружения

Создайте `/opt/tradestats/.env` (см. `.env.example`). Сгенерируйте секреты:

```bash
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('hex'))"
node -e "console.log('ENCRYPTION_KEY='+require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(24).toString('hex'))"
```

`.env` для прода:

```env
DATABASE_URL="postgresql://tradestats:СМЕНИТЕ_ПАРОЛЬ@localhost:5432/tradestats?schema=public"
JWT_SECRET="<сгенерированный>"
ENCRYPTION_KEY="<сгенерированный 32-байтный hex>"
CRON_SECRET="<сгенерированный>"
NODE_ENV="production"
# Внутрипроцессный планировщик включён — авто-синхронизация работает внутри app.
ENABLE_SCHEDULER="true"
# (опц.) вход через Google — см. «Аутентификация и безопасность»
GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
```

> ВАЖНО: `ENCRYPTION_KEY` нельзя терять и менять — иначе ранее сохранённые
> API-секреты бирж не расшифруются. Бэкапьте `.env` отдельно и безопасно.

#### 6. Миграции и сборка

```bash
npx prisma generate
npx prisma migrate deploy     # применяет миграции из prisma/migrations (без prompt)
npm run build                 # продакшн-сборка Next.js
```

#### 7. Запуск через PM2

```bash
sudo npm install -g pm2
# Next слушает порт 3000; биндим только на localhost (наружу — через Nginx)
PORT=3000 pm2 start "npm run start" --name tradestats
pm2 save
pm2 startup systemd           # выполните выведенную команду, чтобы стартовать при ребуте
```

Полезное: `pm2 logs tradestats`, `pm2 restart tradestats`, `pm2 status`.

**Альтернатива — systemd** (вместо PM2), `/etc/systemd/system/tradestats.service`:

```ini
[Unit]
Description=TradeStats
After=network.target postgresql.service

[Service]
Type=simple
User=deploy
WorkingDirectory=/opt/tradestats
Environment=NODE_ENV=production
Environment=PORT=3000
EnvironmentFile=/opt/tradestats/.env
ExecStart=/usr/bin/npm run start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tradestats
```

#### 8. Nginx + HTTPS

```bash
sudo apt install -y nginx
```

`/etc/nginx/sites-available/tradestats`:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300;   # запас под долгую синхронизацию/cron
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/tradestats /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Бесплатный TLS-сертификат Let's Encrypt
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

Certbot сам пропишет 443/редирект и настроит авто-обновление сертификата.

#### 9. Авто-синхронизация в проде

Два варианта (используйте один):

- **Внутрипроцессный планировщик** (по умолчанию): `ENABLE_SCHEDULER="true"`.
  Подходит, когда приложение работает одним постоянным процессом (PM2/systemd).
- **Внешний cron** (для нескольких инстансов/serverless): `ENABLE_SCHEDULER="false"`
  и дёргайте защищённый эндпоинт. Пример crontab (`crontab -e`), каждые 15 минут:

  ```cron
  */15 * * * * curl -fsS -H "Authorization: Bearer ВАШ_CRON_SECRET" https://your-domain.com/api/cron/sync >/dev/null 2>&1
  ```

#### 10. Обновление (redeploy)

```bash
cd /opt/tradestats
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart tradestats      # или: sudo systemctl restart tradestats
```

#### 11. Бэкапы и безопасность

- **БД**: регулярный дамп — `pg_dump -U tradestats tradestats > backup_$(date +%F).sql`
  (можно cron'ом + выгрузка в S3/удалённое хранилище).
- **`.env`** (особенно `ENCRYPTION_KEY`) — хранить в секрет-менеджере/офлайн-бэкапе.
- Биржевые ключи добавляйте **только read-only** (без вывода и торговли).
- Включите авто-обновления безопасности: `sudo apt install unattended-upgrades`.
- Postgres слушает только localhost (дефолт) — не открывайте 5432 наружу.

### Деплой через Docker

В репозитории уже есть `docker-compose.yml` с сервисом `db` (PostgreSQL 16 +
volume) — для локальной разработки достаточно `docker compose up -d db`.

Чтобы контейнеризовать и само приложение для прода — добавьте `Dockerfile`
(multi-stage: `npm ci` → `npm run build` → `npm run start`) и сервис `app`
(порт 3000) в тот же compose, прокинув `.env` и зависимость от `db`.
Reverse-proxy и TLS — через Nginx/Caddy перед контейнером. Не забудьте
`npx prisma migrate deploy` на старте контейнера (entrypoint).

### Авто-перезапуск collector (Docker)

По умолчанию Docker-контейнер `collector` настроен на автоматический перезапуск при падении:

```yaml
# docker-compose.prod.yml
collector:
  restart: unless-stopped   # перезапускает контейнер при рестарте Docker или падении
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:8080/metrics || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 40s
```

**Что делает healthcheck:**
- Каждые 30 секунд проверяет доступность эндпоинта `/metrics` (требует `COLLECTOR_METRICS_TOKEN`).
- Если 3 раза подряд не отвечает — контейнер помечается как `unhealthy` и перезапускается.

**Дополнительный мониторинг (опционально):**
Скрипт `scripts/restart-watcher.sh` наблюдает за контейнером и перезапускает его вручную при необходимости:

```bash
# На сервере:
chmod +x scripts/restart-watcher.sh
nohup ./scripts/restart-watcher.sh > /dev/null 2>&1 &
```

**Почему это важно:**
- Если сеть пропала между сервером и биржей (Binance/Bybit/OKX), collector может «зависнуть».
- Docker healthcheck + `restart: unless-stopped` гарантируют, что процесс восстановится.

---

### Сервер из iPhone (iSH + Cloudflare Tunnel)

Запуск приложения как **постоянного сервера прямо на iPhone** (без джейлбрейка),
с доступом из глобального интернета и собственным доменом. Подходит для
небольшой нагрузки / личного использования.

> 🛠 В репозитории есть готовые скрипты [`deploy/iphone/`](deploy/iphone/):
> `setup.sh` (разовая настройка) и `start.sh` (запуск + авто-перезапуск).
> Шаги ниже объясняют, что они делают, и нужны для туннеля/домена/Гид-доступа,
> которые скриптами не автоматизируются.

#### Как это устроено

```
   Пользователи в интернете
            │   https://app.твой-домен.com
            ▼
   Cloudflare  (DNS + бесплатный HTTPS)
            │   зашифрованный исходящий туннель (без проброса портов и белого IP)
            ▼
   cloudflared  ── процесс на телефоне
            │   http://localhost:3000
            ▼
   Next.js (это приложение)  ── в iSH на телефоне
            │
            ▼
   PostgreSQL  ── рекомендуется облачный (Neon) ради сохранности данных
```

Туннель исходящий, поэтому **меняющийся домашний IP и NAT/CGNAT не мешают** —
проброс портов не нужен, домен продолжает работать после смены IP / перезагрузки
роутера.

#### Важные ограничения

- iOS усыпляет приложения в фоне → сервер живёт, только пока iSH на переднем
  плане и экран включён (см. «Гид-доступ» ниже).
- Node и Postgres на iOS работают только **через эмуляцию Linux** (iSH) — медленно
  и греет телефон.
- **Единственную копию данных пользователей не держите в локальном Postgres на
  телефоне** — эмулированный PG нестабилен и повреждается при жёстком выключении.
  База — на облачном Postgres (Neon/Supabase) с бэкапами; на телефоне — только
  веб-сервер.

#### 1. Подготовка телефона

- **Настройки → Экран и яркость → Автоблокировка → Никогда.**
- Телефон постоянно на зарядке, Wi-Fi. Снять чехол (нагрев), прохладное место.

#### 2. Linux-окружение (iSH)

App Store → **iSH Shell** → установить → открыть, затем:

```sh
apk update && apk upgrade
apk add nodejs npm git openssl nano
node -v && npm -v && git --version
```

#### 3. База данных (Neon — рекомендуется)

Зарегистрируйтесь на **neon.tech**, создайте проект и скопируйте строку
подключения `postgresql://...?sslmode=require` — она пойдёт в `DATABASE_URL`.

#### 4. Код и окружение

```sh
cd ~
git clone <URL-репозитория> tradestats     # приватный репо: https://<TOKEN>@github.com/...
cd tradestats
cp .env.example .env
nano .env
```

В `.env` пропишите `DATABASE_URL` (из Neon) и сгенерируйте секреты:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"  # CRON_SECRET
```

`ENABLE_SCHEDULER="true"` — встроенный планировщик авто-синхронизации заработает,
т.к. процесс на телефоне всегда живой.

> 🔒 `ENCRYPTION_KEY` нельзя терять/менять — иначе сохранённые ключи бирж не
> расшифровать.

#### 5. Установка, миграции, сборка

Шаги 2, 4 и 5 можно выполнить одной командой через готовый скрипт (создаст `.env`
с секретами при первом запуске; после того как впишете `DATABASE_URL` — запустите
его повторно для install + миграций + сборки):

```sh
sh deploy/iphone/setup.sh
```

Либо вручную:

```sh
npm install
npx prisma migrate deploy
npx prisma generate
npm run build       # один раз; на эмуляции долго (10–30+ мин)
```

> Если `npm run build` падает по памяти — соберите проект на компьютере и
> скопируйте папку `.next` на телефон, либо как временное решение запускайте
> в dev-режиме (`npm run dev`).

#### 6. Туннель Cloudflare

Быстрый тест без домена (версия `386` — под iSH):

```sh
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-386 -O /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared
cloudflared tunnel --url http://localhost:3000   # выдаст временный https://*.trycloudflare.com
```

Постоянный домен:

1. Купите домен; заведите бесплатный аккаунт Cloudflare, добавьте домен (**Add a
   site**) и смените NS-серверы у регистратора на выданные Cloudflare.
2. Привяжите туннель:

```sh
cloudflared login                                   # подтвердите домен в браузере
cloudflared tunnel create tradestats
cloudflared tunnel route dns tradestats app.твой-домен.com
nano ~/.cloudflared/config.yml
```

`config.yml` (ID туннеля — из `cloudflared tunnel list`):

```yaml
tunnel: <ID>
credentials-file: /root/.cloudflared/<ID>.json
ingress:
  - hostname: app.твой-домен.com
    service: http://localhost:3000
  - service: http_status:404
```

После этого `https://app.твой-домен.com` ведёт на телефон с автоматическим HTTPS.

#### 7. Запуск с авто-перезапуском (pm2)

Готовый скрипт [`deploy/iphone/start.sh`](deploy/iphone/start.sh) поднимает
приложение и туннель под менеджером процессов **pm2** — он держит их живыми,
перезапускает упавшие и восстанавливает после перезагрузки (если продакшн-сборки
нет — стартует в dev-режиме):

```sh
sh deploy/iphone/start.sh   # поднять приложение + туннель
pm2 status                  # что запущено
pm2 logs                    # логи (Ctrl+C закрывает только просмотр, сервисы живут)
```

**Несколько приложений одновременно.** iSH — один Linux, можно держать несколько
сервисов сразу. Каждый — на своём порту, все под pm2, один туннель раздаёт их по
поддоменам:

```sh
cd ~/другой-проект
PORT=3001 pm2 start npm --name app2 -- start
pm2 save
```

Добавьте правило в `~/.cloudflared/config.yml`:

```yaml
ingress:
  - hostname: app.твой-домен.com
    service: http://localhost:3000
  - hostname: app2.твой-домен.com
    service: http://localhost:3001
  - service: http_status:404
```

затем `cloudflared tunnel route dns tradestats app2.твой-домен.com` и
`pm2 restart tunnel`. Все приложения ходят в одну облачную базу Neon — заведите в
ней отдельную базу под каждое и укажите свою `DATABASE_URL` в `.env` каждого.

#### 8. Чтобы iOS не усыплял (ключевое)

1. Автоблокировка → **Никогда** (см. шаг 1).
2. **Гид-доступ**: Настройки → Универсальный доступ → **Гид-доступ** → включить.
   Открыть iSH → **тройное нажатие боковой кнопки** → «Запустить». Телефон
   «приклеен» к iSH с включённым экраном — режим киоска/сервера.

#### 9. После перезагрузки телефона

iOS не запускает приложения сам. Один раз вручную:

```sh
# открыть iSH, затем:
sh ~/tradestats/deploy/iphone/start.sh   # pm2 восстановит все сервисы
```

и снова включить Гид-доступ (шаг 8.2).

#### 10. Проверка

- С другого устройства открыть `https://app.твой-домен.com`.
- Логи: `pm2 logs` (Ctrl+C закрывает только просмотр — сервисы продолжают работать).
