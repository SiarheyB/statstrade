# Самохостинг TradeStats на мини-ПК (Intel Celeron J1900)

Полная инструкция: от чистого мини-ПК до открытия проекта в браузере из интернета,
с авто-деплоем при каждом коммите в `main`.

**Стратегия под слабое железо (J1900, 2–8 ГБ ОЗУ):** мини-ПК НЕ собирает проект — это
делает GitHub Actions в облаке и кладёт готовые Docker-образы в GHCR. Сервер только
скачивает образы и запускает их. Так J1900 не упирается в RAM при сборке Next.js.

```
[git push main] → GitHub Actions (сборка образов) → GHCR (реестр образов)
                                                        ↓ (Watchtower тянет каждые 2 мин)
[мини-ПК] db + app + collector  ──→  Tailscale Funnel  ──→  https://<имя>.ts.net (интернет)
```

Компоненты на сервере (всё в Docker):
- **db** — PostgreSQL 16 (данные приложения + стаканы).
- **app** — Next.js (сайт).
- **collector** — постоянный сбор orderbook/сделок (BTC/ETH, Binance futures+spot).
- **watchtower** — авто-обновление образов из GHCR.
- **tailscaled** — туннель в интернет (ставится на хост, не в Docker).

---

## 0. Что понадобится
- Мини-ПК J1900, диск ≥ 64 ГБ (лучше SSD — Postgres любит IOPS), ОЗУ ≥ 4 ГБ (8 ГБ комфортнее).
- USB-флешка ≥ 2 ГБ для установки.
- Монитор + клавиатура на время установки (потом — только по SSH).
- Аккаунт GitHub (репозиторий уже есть: `SiarheyB/statstrade`).
- Бесплатный аккаунт Tailscale (вход через тот же GitHub/Google).

---

## 1. BIOS мини-ПК
Зайдите в BIOS (обычно `Del` или `F2` при включении) и выставьте:
- **Boot → USB** первым на время установки.
- **Restore on AC Power Loss → Power On** (чтобы сервер сам включался после отключения света).
- Отключите быстрый старт/Secure Boot, если установщик не грузится.
- Сохраните (`F10`).

---

## 2. Установка Debian 12 (минимальная)
Debian 12 — самый лёгкий и стабильный выбор для такого железа.

1. Скачайте **netinst** образ (amd64): https://www.debian.org/distrib/netinst
   (файл вида `debian-12.x.x-amd64-netinst.iso`).
2. Запишите на флешку:
   - Windows: **Rufus** (режим DD), Linux/macOS: `sudo dd if=debian-...iso of=/dev/sdX bs=4M status=progress && sync`.
3. Загрузитесь с флешки → **Install** (текстовый установщик, легче для J1900).
4. Параметры установки:
   - Язык/время — на ваш выбор.
   - **Hostname:** `tradestats`.
   - **Root password:** задайте (или оставьте пустым, тогда первый юзер получит sudo).
   - **Создайте пользователя**, например `deploy` (под ним будете работать).
   - **Разметка диска:** «Auto — use entire disk», без LVM (проще). Один раздел `/` + swap.
   - **Software selection (ВАЖНО для лёгкости):** снимите галочку с «GNOME/Desktop»,
     оставьте только **SSH server** и **standard system utilities**. Никакого графического окружения.
5. Поставьте GRUB на диск, перезагрузитесь, выньте флешку.

После загрузки войдите в консоль под `deploy`.

---

## 3. Базовая настройка ОС

### 3.1 Сеть и доступ по SSH
Узнайте IP сервера:
```bash
ip a            # ищите inet 192.168.x.x
```
Дальше можно работать с ноутбука по SSH (удобнее, чем у монитора):
```bash
ssh deploy@192.168.x.x
```

Рекомендуется вход по ключу (с вашего ноутбука):
```bash
# на НОУТБУКЕ:
ssh-copy-id deploy@192.168.x.x
```

### 3.2 Обновления и базовые пакеты
```bash
sudo apt update && sudo apt -y full-upgrade
sudo apt -y install curl git ca-certificates ufw fail2ban unattended-upgrades htop
```

### 3.3 Автоматические обновления безопасности
```bash
sudo dpkg-reconfigure -plow unattended-upgrades   # ответьте "Yes"
```

### 3.4 Фаервол
Наружу проект выставляет туннель (исходящие соединения), поэтому входящими открываем только SSH:
```bash
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

### 3.5 SWAP (обязательно при 4 ГБ ОЗУ)
Даже при облачной сборке swap страхует Postgres/Node от OOM:
```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
# уменьшим агрессивность свопа
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-swappiness.conf
sudo sysctl --system
free -h
```

---

## 4. Установка Docker
```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# перелогиньтесь, чтобы группа применилась:
exit
ssh deploy@192.168.x.x
docker version && docker compose version
```

---

## 5. Получение проекта и настройка секретов
```bash
cd ~
git clone https://github.com/SiarheyB/statstrade.git
cd statstrade
```

Создайте `.env` (НЕ коммитится). Сгенерируйте секреты:
```bash
JWT=$(docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
ENC=$(docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
CRON=$(docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
DBPASS=$(docker run --rm node:22-slim node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")

cat > .env <<EOF
# Пароль БД (используется и app, и db, и collector через docker-compose)
POSTGRES_PASSWORD=$DBPASS
DATABASE_URL=postgresql://tradestats:$DBPASS@db:5432/tradestats?schema=public

JWT_SECRET=$JWT
ENCRYPTION_KEY=$ENC
CRON_SECRET=$CRON
# Авто-синхронизацию бирж «по времени» на сервере гоняет системный крон хоста
# (см. шаг 9.1), поэтому встроенный планировщик выключен — иначе будет дублировать.
ENABLE_SCHEDULER=false

# Google Sign-In — опционально (оставьте пустым, чтобы скрыть кнопку).
GOOGLE_CLIENT_ID=
NEXT_PUBLIC_GOOGLE_CLIENT_ID=

# Google Drive — опционально, загрузка скриншотов сделок (см. 5.1 ниже).
GOOGLE_DRIVE_CLIENT_ID=
GOOGLE_DRIVE_CLIENT_SECRET=
GOOGLE_DRIVE_REDIRECT_URI=

# Параметры сбора стаканов (можно не менять)
OB_SYMBOLS=BTCUSDT,ETHUSDT
OB_EXCHANGES=binance-futures,binance-spot
# Сырые снапшоты стакана. Их не читает ни один живой запрос (карта, B/A и
# профиль стакана идут в rollup и ObLatestBook) — это путь отката и материал
# для диагностики. Самая тяжёлая таблица базы: ~3 ГБ в сутки.
OB_RETENTION_DAYS=3
# Минутный слой rollup. Нужен окнам шириной в несколько дней; всё, что шире,
# читается из часового и дневного уровней каскада, а они хранятся ВЕЧНО —
# история лимиток не теряется, на глубине лет она просто менее подробная.
# 0 = не чистить и минутный слой (тогда планируйте ~80 ГБ в год).
OB_ROLLUP_MINUTE_RETENTION_DAYS=30
# Фича "Рекомендации" (дневные уровни/сетапы пробой-ложный пробой) — без этого
# collector не сканирует дневные свечи по всем USDT-M фьючерсам Binance, и
# разделу /dashboard/recommendations банально не по чему считать. По умолчанию
# выключено (нагрузка на сервер и на биржевой API), включайте осознанно.
OB_SCAN_ALL_USDT_PAIRS=true
EOF
chmod 600 .env
```
> `DATABASE_URL` в `.env` указывает на `db` (имя сервиса внутри Docker-сети) — это правильно
> для контейнеров. Для app оно ещё и переопределяется в `docker-compose.prod.yml`.

### 5.1 Google Drive — загрузка скриншотов сделок (опционально)

Пользователи могут прикреплять к сделке скриншот, который загружается на ИХ
собственный Google Drive (не на наш сервер) — мы храним только ссылку.
Требует отдельного OAuth-клиента (НЕ тот же `GOOGLE_CLIENT_ID`, что для входа
через Google — там Identity Services без client secret, здесь нужен полный
Authorization Code flow):

1. https://console.cloud.google.com/apis/credentials → создать/выбрать
   проект.
2. **⚠️ Отдельным шагом, легко пропустить**: включить сам API —
   https://console.cloud.google.com/apis/library/drive.googleapis.com
   → **Enable** (для того же проекта из шага 1). Создание OAuth-клиента
   (шаг 4) само по себе API не включает — если пропустить этот шаг,
   загрузка скриншота будет падать с «Не удалось загрузить файл в Google
   Drive» (в Admin → Errors будет видно `403` от Google).
3. **OAuth consent screen**: тип External, заполнить название приложения.
   Пока приложение не прошло верификацию Google — добавьте себя и
   пользователей в **Test users** (без верификации доступно до 100
   пользователей; используемый scope `drive.file` даёт доступ только к
   файлам, созданным самим приложением — обычно не требует полной
   верификации Google даже сверх лимита в 100).
4. **Credentials → Create Credentials → OAuth client ID → Web application**.
   Authorized redirect URIs: `https://<ваш-домен>/api/integrations/google-drive/callback`.
5. Скопировать **Client ID** и **Client Secret** в `.env`:
   ```
   GOOGLE_DRIVE_CLIENT_ID=...
   GOOGLE_DRIVE_CLIENT_SECRET=...
   GOOGLE_DRIVE_REDIRECT_URI=https://<ваш-домен>/api/integrations/google-drive/callback
   ```

Если переменные не заданы — кнопка «Подключить Google Drive» в настройках
скрыта, остальное приложение работает как обычно. Как и с
`docker-compose.prod.yml`, изменения `.env` не подхватываются watchtower —
нужен ручной `git pull && docker compose -f docker-compose.prod.yml up -d`
(либо просто `docker compose --env-file .env up -d app` после правки `.env`).

Токены доступа хранятся в БД зашифрованными (`ENCRYPTION_KEY`, тот же ключ,
что и для секретов бирж) — сам сервер никогда не видит и не хранит файлы
пользователя, только временный `access_token`/`refresh_token` для API-вызовов.

### 5.2 Яндекс.Диск — второй провайдер для скриншотов сделок (опционально)

То же самое, что 5.1, но через Яндекс.Диск. Если у пользователя подключены
оба провайдера — новые загрузки идут в Google Drive (Яндекс — фолбэк).

1. https://oauth.yandex.ru/client/new → создать приложение. На вопрос
   **«Какое приложение хотите создать?»** выбрать **«Для авторизации
   пользователей»** (получение данных и разрешений от пользователей вашего
   сайта) — это и есть нужный нам Authorization Code flow с redirect_uri.
   **НЕ** «Для доступа к API или отладки» — тот вариант для сервисных
   сценариев без участия конечного пользователя, здесь не подходит, т.к.
   каждый пользователь подключает свой личный Диск.
2. **Шаг 1 из 4 — «Создание приложения»**: указать название (то, что увидят
   пользователи на экране согласия — например `TradeStats`, не оставлять
   дефолтное) и **иконку сервиса** — у Яндекса это **обязательное поле**
   (до 1 МБ, подойдёт любая квадратная картинка/логотип, на работу API не
   влияет). Почта для связи — любая, только для уведомлений от Яндекса.
3. **Платформы**: отметить «Веб-сервисы», указать Redirect URI:
   `https://<ваш-домен>/api/integrations/yandex-disk/callback`.
4. **Доступ (Scopes)**: выбрать **«Яндекс.Диск REST API: доступ к папке
   приложения»** (`cloud_api:disk.app_folder`) — **не** выдавайте доступ ко
   всему диску («Яндекс.Диск REST API» без уточнения даёт полный доступ,
   это не нужно: файлы приложения хранятся в изолированной папке
   «Приложения/TradeStats», как и `drive.file` у Google).
5. Скопировать **ID** и **Пароль** приложения (Client ID / Client Secret) в
   `.env`:
   ```
   YANDEX_DISK_CLIENT_ID=...
   YANDEX_DISK_CLIENT_SECRET=...
   YANDEX_DISK_REDIRECT_URI=https://<ваш-домен>/api/integrations/yandex-disk/callback
   ```

Если переменные не заданы — кнопка «Подключить Яндекс.Диск» скрыта. Как и с
Google Drive, изменения `.env` не подхватываются watchtower — нужен ручной
`git pull && docker compose -f docker-compose.prod.yml up -d`.

В отличие от Google Drive, у Яндекс.Диска нет постоянной прямой ссылки на
файл — приложение перевыпускает короткоживущую ссылку на каждый просмотр
через свой собственный роут (`/api/trade-images/view`), поэтому просмотр
скриншотов с Яндекс.Диска работает только пока сервис приложения доступен
(это не влияет на Google Drive — там ссылка постоянная и открывается
напрямую).

---

## 6. Публикация образов в GHCR (один раз настроить)

### 6.1 Запустить сборку
Образы собирает workflow `.github/workflows/deploy.yml` при пуше в `main` (или вручную:
GitHub → вкладка **Actions** → **build-and-publish** → **Run workflow**).
Дождитесь зелёной галочки — появятся пакеты `statstrade-app` и `statstrade-collector`
в GitHub → ваш профиль → **Packages**.

### 6.2 Сделать пакеты доступными серверу
Проще всего — сделать пакеты **public** (тогда серверу не нужен логин):
GitHub → Packages → каждый пакет → **Package settings** → **Change visibility → Public**.

Если хотите оставить приватными — на сервере выполните вход в GHCR
(понадобится Personal Access Token с правами `read:packages`):
```bash
echo 'ВАШ_PAT' | docker login ghcr.io -u SiarheyB --password-stdin
```
(Watchtower в `docker-compose.prod.yml` уже монтирует `~/.docker/config.json` для этого.)

### 6.3 (опц.) Google Sign-In
Если нужен вход через Google: GitHub → репозиторий → **Settings → Secrets and variables →
Actions → New repository secret** → имя `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, значение — ваш Client ID.
В Google Cloud Console добавьте публичный URL (см. шаг 8) в «Authorized JavaScript origins».

---

## 7. Первый запуск на сервере
```bash
cd ~/statstrade
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```
Проверка:
```bash
docker compose -f docker-compose.prod.yml ps          # все контейнеры Up
docker compose -f docker-compose.prod.yml logs -f app  # дождитесь "Ready"
curl -I http://127.0.0.1:3000                          # 200/307 — приложение живо
docker logs --tail 5 tradestats-collector              # [write] ... feeds=4/4
```
Миграции БД применяются автоматически при старте контейнера `app`.

Создайте свой аккаунт на `http://127.0.0.1:3000/register` (через SSH-туннель или на шаге 8
после публикации). Тестовый аккаунт демо-данных — `trader@test.com` / `password123` —
существует только в dev-БД, на проде его нет.

---

## 8. Доступ из интернета — Tailscale Funnel (бесплатно, без белого IP)

Tailscale Funnel даёт постоянный публичный HTTPS-адрес `https://<имя>.<tailnet>.ts.net`,
работает за NAT/CGNAT, без проброса портов на роутере. Это и есть бесплатный домен.

```bash
# установка
curl -fsSL https://tailscale.com/install.sh | sudo sh
# вход (откроется ссылка — авторизуйтесь в браузере под своим аккаунтом)
sudo tailscale up
```

Включите HTTPS и Funnel в админке Tailscale один раз:
- https://login.tailscale.com/admin/dns → включите **MagicDNS** и **HTTPS Certificates**.
- https://login.tailscale.com/admin/acls → в секции `nodeAttrs` разрешите `funnel`
  (Tailscale показывает готовый сниппет при первом запуске Funnel).

Опубликуйте приложение (порт 3000) наружу:
```bash
sudo tailscale funnel --bg 3000
sudo tailscale funnel status        # покажет публичный https://<имя>.ts.net
```
Откройте этот адрес в браузере с любого устройства в интернете — это ваш сайт.

> Funnel держит соединение сам и переживает перезагрузки (служба `tailscaled`).
> Чтобы выключить публикацию: `sudo tailscale funnel --bg off`.

### Альтернатива A — Cloudflare Tunnel (если есть свой домен)
Если у вас есть домен в Cloudflare: `cloudflared tunnel` тоже бесплатен, обходит NAT и даёт
ваш красивый домен. Кратко: `cloudflared tunnel login` → `create` → в `~/.cloudflared/config.yml`
маршрут `service: http://localhost:3000` → `cloudflared tunnel route dns <tunnel> app.ваш-домен`
→ запустить как службу `sudo cloudflared service install`.

### Альтернатива B — DuckDNS + проброс портов (только при белом IP)
Если провайдер даёт белый IP: заведите поддомен на https://www.duckdns.org, пробросьте на
роутере 80/443 на сервер, поставьте Caddy (авто-HTTPS) с reverse-proxy на `localhost:3000`.
Не сработает за CGNAT (серый IP) — тогда используйте Tailscale Funnel.

---

## 9. Авто-деплой при коммите
Уже настроен и работает так:
1. `git push` в `main` → GitHub Actions собирает свежие образы `app` и `collector` → пушит в GHCR.
2. **Watchtower** на сервере каждые 2 минуты проверяет GHCR и при новой версии `:latest`
   автоматически перезапускает контейнеры с новым образом. Миграции применятся на старте `app`.

Ничего вручную делать не нужно. Проверить, что Watchtower работает:
```bash
docker logs --tail 20 tradestats-watchtower
```
Хотите деплоить вручную/сразу:
```bash
cd ~/statstrade && docker compose -f docker-compose.prod.yml pull && \
  docker compose -f docker-compose.prod.yml up -d
```

> Изменения в самом `docker-compose.prod.yml` или `.env` Watchtower НЕ подхватывает —
> после их правок сделайте `git pull` и `up -d` на сервере вручную.

### 9.1 Авто-синхронизация бирж «по времени» (системный крон)
Раздел «Биржи» синхронизирует каждый аккаунт по его настройке — раз в выбранный интервал
(`syncIntervalMinutes`). На сервере это гоняет **системный крон хоста**, который раз в минуту
дёргает защищённый endpoint `/api/cron/sync`; приложение само решает, каким аккаунтам уже
«пора» (по их интервалу), и продвигает только их. Встроенный планировщик при этом выключен
(`ENABLE_SCHEDULER=false` в `.env`), чтобы не было двойных синхронизаций.

> Почему именно так: на Vercel это работало лишь раз в сутки + пока открыта вкладка.
> На своём сервере крон тикает всегда — синхронизация идёт «по времени» даже без браузера.

Endpoint требует `CRON_SECRET` (тот, что в `.env`). Заведите задачу в crontab. Секрет читается
из `.env`, чтобы не светить его в `crontab -l`:
```bash
( crontab -l 2>/dev/null; \
  echo '* * * * * curl -fsS --max-time 55 -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/sync >/dev/null 2>&1' \
) | crontab -
```
Проверка вручную (должно вернуть `{"ok":true,...}`):
```bash
curl -s -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" \
  http://127.0.0.1:3000/api/cron/sync
```
> Интервал самого крона (раз в минуту) — это лишь частота опроса; реальная периодичность
> синхронизации каждого аккаунта берётся из его настройки в разделе «Биржи».

### 9.2 Авто-пересчёт «Рекомендаций» (системный крон)
Раздел «Рекомендации» раз в сутки пересчитывает дневные уровни/сетапы по всем USDT-M
фьючерсам Binance — момент фиксированный, 00:05 UTC (через 5 минут после закрытия дневной
свечи биржи; см. `src/lib/recommendations/schedule.ts`). Как и с синхронизацией бирж выше,
встроенный планировщик выключен (`ENABLE_SCHEDULER=false`), поэтому пересчёт дёргает **тот же
системный крон хоста** — защищённый endpoint `/api/cron/recommendations`, тот же `CRON_SECRET`:
```bash
( crontab -l 2>/dev/null; \
  echo '5 3 * * * curl -fsS --max-time 300 -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/recommendations >/dev/null 2>&1' \
) | crontab -
```
> **Время в crontab — локальное для хоста, а нужный момент задан в UTC.** `5 3` выше — это
> для хоста в MSK (UTC+3, переводов на летнее время нет): 03:05 MSK = 00:05 UTC. На хосте в
> другой зоне пересчитайте час сами: `date` покажет текущую зону.
>
> Наивное `5 0 * * *` — грабли: cron прочитает его как 00:05 ПО МЕСТНОМУ времени, на MSK-хосте
> это 21:05 UTC, то есть ДО закрытия дневной свечи. Пересчёт отработает, но по позавчерашнему
> дню — в панели это видно как отставание «свечи по …» на сутки. Директива `CRON_TZ=UTC`
> выглядит как решение, но Debian-овский cron её молча игнорирует (проверено на bookworm:
> строка в crontab есть, а `journalctl -u cron` показывает запуски по MSK) — не полагайтесь
> на неё, ставьте локальный час явно.
>
> Проверить, когда крон реально стрелял:
> ```bash
> sudo journalctl -u cron --since "3 days ago" | grep recommendations
> ```
Проверка вручную (должно вернуть `{"ok":true,...}`, может занять до пары минут — сначала
дозагружаются свежие свечи с Binance по всем парам, потом считаются уровни):
```bash
curl -s -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" \
  http://127.0.0.1:3000/api/cron/recommendations
```
> Без `OB_SCAN_ALL_USDT_PAIRS=true` в `.env` (см. §5) пересчёт отработает, но найдёт 0 уровней —
> collector просто не собирает нужные свечи.
>
> Прогресс и статистику последнего пересчёта (сколько пар просканировано, сколько отсеяно
> фильтром качества и почему) видно в `/admin/recommendations` — там же ручная кнопка
> «Пересчитать сейчас», если не хотите ждать полночи UTC.

### 9.3 Свёртка статистики посещаемости (системный крон)
Раздел `/admin/traffic` считает посещаемость по сырым событиям (`PageView`, `VisitSession`).
Это самая быстрорастущая таблица приложения — роботы на публичном сайте генерируют строк
больше, чем люди. Раз в сутки нужно свернуть их в агрегаты (`TrafficDaily`, хранятся
бессрочно) и удалить сырьё старше `ANALYTICS_RETENTION_DAYS` (по умолчанию 90 суток):
```bash
( crontab -l 2>/dev/null; \
  echo '20 4 * * * curl -fsS --max-time 120 -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" http://127.0.0.1:3000/api/cron/analytics >/dev/null 2>&1' \
) | crontab -
```
Час не важен (задача не привязана к рыночному времени) — важно только не совпасть с бэкапом
и пересчётом рекомендаций. Прогон захватывает последние трое суток, поэтому если мини-ПК был
выключен, пропущенные дни досчитаются следующим запуском.

Проверка вручную:
```bash
curl -s -H "Authorization: Bearer $(grep -E ^CRON_SECRET= ~/statstrade/.env | cut -d= -f2)" \
  http://127.0.0.1:3000/api/cron/analytics
```
> Сам сбор кроном не управляется — события пишет приложение на каждом запросе страницы
> (middleware → `/api/analytics/collect`). Если в `/admin/traffic` висит предупреждение
> «просмотров нет», проверьте `ANALYTICS_ENABLED` и что порт в `ANALYTICS_INGEST_URL`
> совпадает с портом контейнера.

**Что ещё полезно знать про этот раздел:**

- **Страны посетителей появятся, только если перед приложением стоит CDN**, который
  проставляет заголовок с кодом страны (`CF-IPCountry` у Cloudflare — есть и на бесплатном
  тарифе; поддерживаются также `X-Vercel-IP-Country`, `X-Geo-Country`, `X-Country-Code`).
  Само приложение страну не определяет: GeoIP-база — это десятки мегабайт, которые надо
  ещё и обновлять. Без CDN колонка «Страны» просто не показывается, остальное работает.
  Через Tailscale Funnel страна не приходит.
- **Оповещения** (`ANALYTICS_ALERTS`, по умолчанию включены) падают в журнал ошибок —
  тот же красный бейдж в меню админки: всплеск сканеров (≥20 запросов за час),
  молчание сбора дольше 6 часов, падение посещаемости ниже 40% от недельного среднего.
  Последнее считается суточным прогоном крона, первые два — на лету, не чаще раза
  в 15 минут.
- **Сканеров приложение не рендерит**: запросы вида `/wp-login.php`, `/.env`,
  `/phpmyadmin` middleware обрывает коротким 404 (~10 мс вместо рендера страницы 404),
  но в статистику они всё равно попадают — иначе всплеск было бы не увидеть.
- **Выгрузка CSV** — кнопки в шапке раздела (по дням / страницы / источники / роботы /
  визиты). Разделитель `;` и BOM: файл открывается в Excel с русской локалью без плясок.
- **Cookie.** По умолчанию ставятся две технические cookie (`ts_vid` — посетитель на год,
  `ts_sid` — визит на 30 минут). `ANALYTICS_COOKIES=false` полностью выключает их:
  идентификатор считается из хэша IP+UA на сутки, возвращаемость тогда не отслеживается,
  зато формально не нужен баннер согласия для аудитории из ЕС.

### 9.4 robots.txt и sitemap.xml
Отдаются приложением динамически (`src/app/robots.ts`, `src/app/sitemap.ts`), адрес сайта
берётся из заголовков запроса — за туннелем домен меняется без пересборки образа. Если
сайт доступен сразу по нескольким доменам и нужен один канонический, задайте `SITE_URL`.

В индекс закрыты `/dashboard`, `/admin`, `/api`, `/login`, `/register` и, что важнее,
`/share/<токен>` — токен публичной ссылки и есть ключ доступа к ней, в поиске ему не место.
AI-краулеры (GPTBot, ClaudeBot и т.п.) намеренно НЕ заблокированы: они приводят переходы,
а кто и как часто ходит — видно в `/admin/traffic` → «Роботы». Заблокировать конкретного
можно правилом в `src/app/robots.ts`.

Проверка: `curl -s https://<ваш-домен>/robots.txt` и `.../sitemap.xml`.

---

## 10. Бэкап базы данных
Разовый дамп:
```bash
docker exec tradestats-db pg_dump -U tradestats tradestats | gzip > ~/backup-$(date +%F).sql.gz
```
Авто-бэкап раз в сутки (cron):
```bash
mkdir -p ~/backups
( crontab -l 2>/dev/null; echo '30 4 * * * docker exec tradestats-db pg_dump -U tradestats tradestats | gzip > ~/backups/db-$(date +\%F).sql.gz && find ~/backups -name "db-*.sql.gz" -mtime +14 -delete' ) | crontab -
```
Восстановление:
```bash
gunzip -c ~/backups/db-YYYY-MM-DD.sql.gz | docker exec -i tradestats-db psql -U tradestats tradestats
```

### 10.1 Раздел «База данных» в админке (`/admin/backup`)

То же самое, но из браузера: экспорт (полный дамп, только данные, только
аналитика, базовый дамп), импорт (с дедупликацией или с полной заменой),
список файлов и журнал операций.

Как это устроено, чтобы не удивляться:

- **экспорт делается на сервере, а скачивается к вам.** `pg_dump` живёт в
  контейнере `app`, поэтому дамп сначала создаётся в `backup/tmp`, а по
  готовности браузер сразу забирает его файлом. Тот же файл можно скачать
  позже кнопкой в списке;
- **импорт — наоборот:** файл с вашей машины загружается в `backup/tmp`
  (кнопка «Загрузить»), а потом запускается импорт уже на сервере;
- **файлы лежат на хосте**, а не внутри контейнера: `./backup/tmp`
  примонтирован в `app` (см. `docker-compose.prod.yml`). Без этого тома всё
  созданное исчезало бы при каждом обновлении образа watchtower'ом, а забрать
  дамп по `scp` было бы нельзя;
- **лимит на загрузку — 200 МБ** в приложении и 256 МБ в nginx
  (`location /api/admin/backup`). Дамп больше — заливайте по `scp` прямо в
  `~/statstrade/backup/tmp`, он появится в списке;
- **«Импорт с полной заменой» пересоздаёт схему** (`DROP SCHEMA public
  CASCADE`) и заливает дамп поверх. Приложение в этот момент работает со
  старым пулом соединений — после импорта перезапустите его:
  `docker compose -f docker-compose.prod.yml restart app`.

> Правки `docker-compose.prod.yml` и `deploy/nginx/nginx.conf` watchtower не
> подхватывает: после обновления, добавившего том и правило nginx, на сервере
> нужен `git pull && docker compose -f docker-compose.prod.yml up -d`.

---

## 11. Обслуживание и контроль места
Collector пишет много (стаканы каждые 2 с). Следите за диском:
```bash
df -h                                   # свободное место
docker system df                        # место под Docker
docker exec tradestats-db psql -U tradestats -d tradestats -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 6;"
```
Если места мало — уменьшите `OB_RETENTION_DAYS` (сырьё, самое тяжёлое) или
`OB_ROLLUP_MINUTE_RETENTION_DAYS` в `.env` и перезапустите collector, либо
поднимите `OB_NOISE_MIN_NOTIONAL` (меньше «мелочи» в базе). Часовой и дневной
уровни каскада чистке не подлежат — в них живёт вся история лимиток. Очистка старых образов:
```bash
docker image prune -f
```

### 11.1 VACUUM: коллектор убирает мусор обновлений сам

Настраивать ничего не нужно — раздел на случай, если что-то пойдёт не так.

Postgres при UPDATE оставляет старую версию строки мёртвым грузом. Мы обновляем
много (текущая свеча — каждую минуту, rollup-бакеты — каждый флаш), и autovacuum
на слабом сервере за этим не поспевает. Страдает ЧТЕНИЕ: пока vacuum не обновил
карту видимости, запрос по индексу вынужден лезть в саму таблицу. Счётчик
инструментов на главной из-за этого занимал **19 секунд** вместо миллисекунд.

Коллектор раз в час берёт ОДНУ таблицу из списка (`ObCandle` и агрегаты
карты ордеров) — ту, которую дольше всего не убирали, — и делает ей
`VACUUM (ANALYZE)`, если с прошлого раза прошло больше суток. По одной, чтобы
не грузить диск. Данные при этом НЕ удаляются: историю чистит только ретеншн
(см. выше), это разные вещи.

- `VACUUM_INTERVAL_HOURS` в `.env` — порог давности, по умолчанию `24`.
  `0` выключает уборку совсем (autovacuum продолжает работать сам).
- В логах коллектора: `[vacuum] ObCandle — 12с`.
- Разово вручную, если ждать прогона не хочется:

```bash
docker exec -i tradestats-db psql -U tradestats -d tradestats -c 'VACUUM (ANALYZE) "ObCandle"'
```

---

## 12. Шпаргалка
```bash
# статус / логи
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f app
docker logs -f tradestats-collector

# перезапуск всего
docker compose -f docker-compose.prod.yml restart

# полный передеплой вручную
cd ~/statstrade && git pull && docker compose -f docker-compose.prod.yml pull && \
  docker compose -f docker-compose.prod.yml up -d

# публичный адрес
sudo tailscale funnel status
```

---

## 13. Чек-лист «до мелочей»
- [ ] BIOS: загрузка с USB, авто-включение после сбоя питания.
- [ ] Debian 12 minimal без графики, только SSH + утилиты.
- [ ] Обновления, ufw (только SSH), fail2ban, unattended-upgrades.
- [ ] SWAP 4 ГБ + swappiness 10.
- [ ] Docker + compose, пользователь в группе docker.
- [ ] `git clone`, заполнен `.env` (секреты сгенерированы, `chmod 600`).
- [ ] GitHub Actions собрал образы, пакеты GHCR доступны (public или `docker login`).
- [ ] `docker compose -f docker-compose.prod.yml up -d` — все контейнеры Up, миграции прошли.
- [ ] collector: `feeds=4/4`, данные в БД растут.
- [ ] Tailscale Funnel включён, сайт открывается по `https://<имя>.ts.net` из интернета.
- [ ] (опц.) Google origins добавлены, если нужен вход через Google.
- [ ] `ENABLE_SCHEDULER=false` в `.env`, в crontab задача синхронизации бирж (`/api/cron/sync`).
- [ ] (если нужна фича «Рекомендации») `OB_SCAN_ALL_USDT_PAIRS=true` в `.env`, в crontab задача
      пересчёта уровней (`/api/cron/recommendations`, см. §9.2).
- [ ] Задача свёртки посещаемости в cron (`/api/cron/analytics`, см. §9.3).
- [ ] Авто-бэкап БД в cron.
- [ ] Проверен авто-деплой: тестовый коммит в `main` → через пару минут изменения на сайте.
```


## Страница «технический перерыв» (edge-nginx)

Перед `app` стоит лёгкий nginx (`edge` в `docker-compose.prod.yml`,
порт 127.0.0.1:3000 теперь слушает он). Туннель менять НЕ нужно. Когда
app-контейнер перезапускается (деплой watchtower, OOM, миграции при старте),
edge отдаёт `deploy/nginx/offline.html` — брендированную страницу с
автообновлением, вместо голого 502.

Включение на сервере (watchtower compose-правки не подхватывает):

```bash
cd ~/statstrade && git pull
docker compose -f docker-compose.prod.yml up -d
```

Проверка: `docker stop tradestats-app && curl -s localhost:3000 | head` —
должна вернуться страница «Технический перерыв»; `docker start tradestats-app`.

### Полное отключение сервера (света)

Если хост обесточен, страницу с него отдавать некому. Для этого случая есть
Cloudflare Worker-фолбэк (`deploy/cloudflare/offline-worker.js`): он живёт на
edge-серверах Cloudflare и отдаёт ту же страницу, когда origin/туннель мертвы.
Подключение — см. docs/local/CLOUDFLARE_TUNNEL.md, раздел «Фолбэк при
недоступном сервере».
