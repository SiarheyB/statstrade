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

# Параметры сбора стаканов (можно не менять)
OB_SYMBOLS=BTCUSDT,ETHUSDT
OB_EXCHANGES=binance-futures,binance-spot
OB_RETENTION_DAYS=14
EOF
chmod 600 .env
```
> `DATABASE_URL` в `.env` указывает на `db` (имя сервиса внутри Docker-сети) — это правильно
> для контейнеров. Для app оно ещё и переопределяется в `docker-compose.prod.yml`.

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

---

## 11. Обслуживание и контроль места
Collector пишет много (стаканы каждые 2 с). Следите за диском:
```bash
df -h                                   # свободное место
docker system df                        # место под Docker
docker exec tradestats-db psql -U tradestats -d tradestats -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 6;"
```
Если места мало — уменьшите `OB_RETENTION_DAYS` в `.env` и перезапустите collector, либо
поднимите `OB_NOISE_MIN_NOTIONAL` (меньше «мелочи» в базе). Очистка старых образов:
```bash
docker image prune -f
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
- [ ] Авто-бэкап БД в cron.
- [ ] Проверен авто-деплой: тестовый коммит в `main` → через пару минут изменения на сайте.
```
