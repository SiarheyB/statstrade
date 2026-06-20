# TradeStats — статистика трейдера

Веб-приложение для анализа торговых результатов. Подключаете биржу
(**Binance**, **Bybit**, **OKX**) по read-only API-ключу — сделки импортируются
автоматически, и на их основе считается полная статистика: доходность, риск,
win rate, просадки и десятки других метрик.

## Возможности

- **Мультиаккаунт / мультибиржа** — несколько аккаунтов в одном дашборде,
  фильтры по аккаунту, рынку (спот / фьючерсы) и символу.
- **Реконструкция позиций** — биржи отдают *исполнения* (fills); приложение
  собирает их в закрытые round-trip сделки методом средней цены (поддержка
  усреднения, частичных закрытий и разворотов позиции).
- **60+ метрик** — Net P&L, ROI, Win Rate, Profit Factor, Expectancy, Payoff,
  Sharpe, Sortino, Calmar, максимальная просадка (абс. и %), длительность
  просадки, серии побед/поражений, лучшая/худшая сделка, среднее время в позиции.
- **Графики** — кривая капитала, P&L по дням, календарь-теплокарта P&L,
  разбивки по бирже / месяцу / дню недели / часу / символу / стороне (long/short).
- **Таблица сделок** — сортировка и фильтрация по символу, стороне, результату.
- **Безопасность** — пароли через bcrypt, сессии на JWT (HttpOnly cookie),
  секреты бирж шифруются **AES-256-GCM** перед записью в БД. Двухфакторная
  аутентификация (**TOTP**, Google Authenticator/Authy), вход и регистрация
  через **Google**, смена пароля в настройках.
- **Демо-режим** — генератор синтетических сделок, чтобы исследовать дашборд
  без реальных ключей.

## Стек

| Слой | Технология |
|------|-----------|
| Фреймворк | Next.js 16 (App Router) + React 19 + TypeScript |
| Стили | Tailwind CSS v4 (тёмная тема) |
| БД / ORM | Prisma 6 + PostgreSQL (dev и prod) |
| Биржи | CCXT (единый API для Binance/Bybit/OKX) |
| Графики | Recharts |
| Аутентификация | bcryptjs + jose (JWT) |

## Запуск

```bash
cp .env.example .env          # затем впишите свои секреты (см. ниже)
docker compose up -d db       # локальный PostgreSQL в Docker (порт 5432)
npm install
npx prisma migrate dev        # применить миграции к БД
npm run dev                   # http://localhost:3000
```

> БД одна и та же в dev и prod — PostgreSQL. Миграции Prisma привязаны к
> провайдеру, поэтому единый набор в `prisma/migrations/` гарантирует
> dev/prod-паритет. Локальный Postgres поднимается через `docker compose`
> (креды совпадают с `DATABASE_URL` из `.env.example`); если Postgres у вас
> уже есть — просто укажите свою строку подключения и пропустите `docker compose`.

Переменные окружения (`.env`, пример — в `.env.example`):

```
DATABASE_URL              — строка подключения к БД
JWT_SECRET                — секрет для подписи сессий
ENCRYPTION_KEY            — 32-байтный ключ (64 hex) для шифрования API-секретов
GOOGLE_CLIENT_ID          — (опц.) Google OAuth Client ID для проверки входа на сервере
NEXT_PUBLIC_GOOGLE_CLIENT_ID — (опц.) тот же Client ID, для кнопки «Войти через Google»
```

Сгенерировать секреты:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"  # ENCRYPTION_KEY
```

### Вход и регистрация через Google (опционально)

Кнопка «Войти через Google» появляется на `/login` и `/register`, только если
заданы обе переменные `GOOGLE_CLIENT_ID` и `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
(одно и то же значение). Без них всё остальное работает как обычно.

Настройка:

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) →
   **Create Credentials → OAuth client ID → Web application**.
2. **Authorized JavaScript origins** — укажите адреса приложения, например
   `http://localhost:3000` (dev) и `https://ваш-домен` (прод).
3. Скопируйте **Client ID** и пропишите его в обе переменные `.env`:

```env
GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
```

> Client **secret** не нужен: используется Google Identity Services, а `id_token`
> проверяется на сервере по публичным ключам Google (JWKS) через `jose`.
> Если у пользователя включена 2FA, после Google-входа всё равно запрашивается
> код из приложения.

### Двухфакторная аутентификация (2FA)

Включается в **Настройки → Общие**: сканируете QR (или вводите ключ вручную) в
Google Authenticator / Authy / 1Password, подтверждаете кодом. После включения
вход становится двухшаговым: пароль (или Google) → 6-значный код. TOTP по
RFC 6238, секрет хранится зашифрованным (`ENCRYPTION_KEY`). Дополнительных
переменных окружения не требует.

## Быстрый старт без ключей

1. Зарегистрируйтесь на `/register`.
2. На странице **«Биржи»** добавьте аккаунт (для демо подойдут любые значения
   ключей).
3. Нажмите **«Демо»** у аккаунта — сгенерируются тестовые сделки.
4. Откройте **«Обзор»** — статистика и графики готовы.

## Архитектура

```
src/
  app/
    api/                 # route handlers (auth, accounts, sync, demo, stats)
    dashboard/           # дашборд: обзор / сделки / биржи
    login, register/     # страницы аутентификации
  lib/
    analytics/
      positions.ts       # реконструкция round-trip сделок из исполнений
      metrics.ts         # расчёт всех метрик и разбивок
    exchanges.ts         # фабрика CCXT + нормализация сделок
    sync.ts              # импорт сделок с биржи (пагинация, дедупликация)
    demo.ts              # генератор демо-данных
    crypto.ts            # AES-256-GCM для API-секретов
    auth.ts              # хэш паролей + JWT-сессии
  middleware.ts          # защита /dashboard
  components/            # UI: графики, карточки, навигация, формы
```

## Прод-замечания

- **PostgreSQL**: провайдер БД — `postgresql` и в dev, и в prod (менять ничего
  не нужно). В проде задайте `DATABASE_URL` на managed/self-hosted инстанс и
  примените миграции через `npx prisma migrate deploy`.
- **Синхронизация бирж** реализована best-effort: сначала пробуется выгрузка
  всех сделок без указания символа (работает на Bybit/OKX), при ошибке —
  перебор по символам (текущие балансы + список мейджоров). Для Binance,
  где исторические закрытые позиции не видны без символа, перебор может не
  покрыть все пары — это место для доработки под конкретную биржу.
- Метрики считаются в quote-валюте (предполагается USDT/USDC). Для мульти-quote
  портфелей потребуется конвертация по курсам.

---

# Деплой на VPS (Linux, продакшн)

Полное пошаговое руководство по выводу проекта в прод на чистом сервере
(пример — **Ubuntu 22.04 / 24.04 LTS**). Стек на сервере: Node.js LTS,
PostgreSQL, Nginx (reverse proxy + TLS), PM2 (менеджер процессов).

## 0. Что понадобится

- VPS с Ubuntu (минимум 1 vCPU / 1–2 ГБ RAM; ccxt + сборка Next любят память —
  при 1 ГБ добавьте swap, см. ниже).
- Доменное имя, указывающее A-записью на IP сервера (для HTTPS).
- SSH-доступ под пользователем с `sudo`.

## 1. Базовая подготовка сервера

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

## 2. Node.js LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # должно быть v22.x (≥ 20 обязательно)
```

## 3. PostgreSQL

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

## 4. Код и зависимости

```bash
sudo adduser --system --group --home /opt/tradestats deploy   # сервисный юзер
sudo mkdir -p /opt/tradestats && sudo chown deploy:deploy /opt/tradestats
sudo -u deploy -H bash
cd /opt/tradestats
git clone <URL_РЕПОЗИТОРИЯ> .
npm ci                       # точная установка по package-lock.json
```

## 5. Переменные окружения

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
# (опц.) вход через Google — см. раздел «Вход и регистрация через Google»
GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
NEXT_PUBLIC_GOOGLE_CLIENT_ID="<client-id>.apps.googleusercontent.com"
```

> ВАЖНО: `ENCRYPTION_KEY` нельзя терять и менять — иначе ранее сохранённые
> API-секреты бирж не расшифруются. Бэкапьте `.env` отдельно и безопасно.

## 6. Миграции и сборка

```bash
npx prisma generate
npx prisma migrate deploy     # применяет миграции из prisma/migrations (без prompt)
npm run build                 # продакшн-сборка Next.js
```

## 7. Запуск через PM2

```bash
sudo npm install -g pm2
# Next слушает порт 3000; биндим только на localhost (наружу — через Nginx)
PORT=3000 pm2 start "npm run start" --name tradestats
pm2 save
pm2 startup systemd           # выполните выведенную команду, чтобы стартовать при ребуте
```

Полезное: `pm2 logs tradestats`, `pm2 restart tradestats`, `pm2 status`.

### Альтернатива — systemd (вместо PM2)

`/etc/systemd/system/tradestats.service`:

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

## 8. Nginx + HTTPS

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

## 9. Авто-синхронизация в проде

Два варианта (используйте один):

- **Внутрипроцессный планировщик** (по умолчанию): `ENABLE_SCHEDULER="true"`.
  Подходит, когда приложение работает одним постоянным процессом (PM2/systemd).
- **Внешний cron** (для нескольких инстансов/serverless): поставьте
  `ENABLE_SCHEDULER="false"` и дёргайте защищённый эндпоинт. Пример crontab
  (`crontab -e`), каждые 15 минут:

  ```cron
  */15 * * * * curl -fsS -H "Authorization: Bearer ВАШ_CRON_SECRET" https://your-domain.com/api/cron/sync >/dev/null 2>&1
  ```

## 10. Обновление (redeploy)

```bash
cd /opt/tradestats
git pull
npm ci
npx prisma migrate deploy
npm run build
pm2 restart tradestats      # или: sudo systemctl restart tradestats
```

## 11. Бэкапы и безопасность

- **БД**: регулярный дамп — `pg_dump -U tradestats tradestats > backup_$(date +%F).sql`
  (можно cron'ом + выгрузка в S3/удалённое хранилище).
- **`.env`** (особенно `ENCRYPTION_KEY`) — хранить в секрет-менеджере/офлайн-бэкапе.
- Биржевые ключи добавляйте **только read-only** (без вывода и торговли).
- Включите авто-обновления безопасности: `sudo apt install unattended-upgrades`.
- Postgres слушает только localhost (дефолт) — не открывайте 5432 наружу.

## Альтернатива: Docker

В репозитории уже есть `docker-compose.yml` с сервисом `db` (PostgreSQL 16 +
volume) — для локальной разработки достаточно `docker compose up -d db`.

Чтобы контейнеризовать и само приложение для прода — добавьте `Dockerfile`
(multi-stage: `npm ci` → `npm run build` → `npm run start`) и сервис `app`
(порт 3000) в тот же compose, прокинув `.env` и зависимость от `db`.
Reverse-proxy и TLS — через Nginx/Caddy перед контейнером. Не забудьте
`npx prisma migrate deploy` на старте контейнера (entrypoint).

---

# Сервер из iPhone (iSH + Cloudflare Tunnel)

Запуск приложения как **постоянного сервера прямо на iPhone** (без джейлбрейка),
с доступом из глобального интернета и собственным доменом. Подходит для
небольшой нагрузки / личного использования.

> 🛠 В репозитории есть готовые скрипты [`deploy/iphone/`](deploy/iphone/):
> `setup.sh` (разовая настройка) и `start.sh` (запуск + авто-перезапуск).
> Шаги ниже объясняют, что они делают, и нужны для туннеля/домена/Гид-доступа,
> которые скриптами не автоматизируются.

## Как это устроено

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

## Важные ограничения

- iOS усыпляет приложения в фоне → сервер живёт, только пока iSH на переднем
  плане и экран включён (см. «Гид-доступ» ниже).
- Node и Postgres на iOS работают только **через эмуляцию Linux** (iSH) — медленно
  и греет телефон.
- **Единственную копию данных пользователей не держите в локальном Postgres на
  телефоне** — эмулированный PG нестабилен и повреждается при жёстком выключении.
  База — на облачном Postgres (Neon/Supabase) с бэкапами; на телефоне — только
  веб-сервер.

## 1. Подготовка телефона

- **Настройки → Экран и яркость → Автоблокировка → Никогда.**
- Телефон постоянно на зарядке, Wi-Fi. Снять чехол (нагрев), прохладное место.

## 2. Linux-окружение (iSH)

App Store → **iSH Shell** → установить → открыть, затем:

```sh
apk update && apk upgrade
apk add nodejs npm git openssl nano
node -v && npm -v && git --version
```

## 3. База данных (Neon — рекомендуется)

Зарегистрируйтесь на **neon.tech**, создайте проект и скопируйте строку
подключения `postgresql://...?sslmode=require` — она пойдёт в `DATABASE_URL`.

## 4. Код и окружение

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

## 5. Установка, миграции, сборка

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

## 6. Туннель Cloudflare

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

## 7. Запуск с авто-перезапуском (pm2)

Готовый скрипт [`deploy/iphone/start.sh`](deploy/iphone/start.sh) поднимает
приложение и туннель под менеджером процессов **pm2** — он держит их живыми,
перезапускает упавшие и восстанавливает после перезагрузки (если продакшн-сборки
нет — стартует в dev-режиме):

```sh
sh deploy/iphone/start.sh   # поднять приложение + туннель
pm2 status                  # что запущено
pm2 logs                    # логи (Ctrl+C закрывает только просмотр, сервисы живут)
```

### Несколько приложений одновременно

iSH — один Linux, можно держать несколько сервисов сразу. Каждый — на своём
порту, все под pm2, один туннель раздаёт их по поддоменам:

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
`pm2 restart tunnel`. Все приложения ходят в одну облачную базу Neon — просто
заведите в ней отдельную базу под каждое и укажите свою `DATABASE_URL` в `.env`
каждого проекта.

## 8. Чтобы iOS не усыплял (ключевое)

1. Автоблокировка → **Никогда** (см. шаг 1).
2. **Гид-доступ**: Настройки → Универсальный доступ → **Гид-доступ** → включить.
   Открыть iSH → **тройное нажатие боковой кнопки** → «Запустить». Телефон
   «приклеен» к iSH с включённым экраном — режим киоска/сервера.

## 9. После перезагрузки телефона

iOS не запускает приложения сам. Один раз вручную:

```sh
# открыть iSH, затем:
sh ~/tradestats/deploy/iphone/start.sh   # pm2 восстановит все сервисы
```

и снова включить Гид-доступ (шаг 8.2).

## 10. Проверка

- С другого устройства открыть `https://app.твой-домен.com`.
- Логи: `pm2 logs` (Ctrl+C закрывает только просмотр — сервисы продолжают работать).
