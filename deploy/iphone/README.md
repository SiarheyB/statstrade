# Запуск сервера из iPhone (iSH + Neon + pm2)

Готовые скрипты к разделу **«Сервер из iPhone»** корневого
[README](../../README.md). Здесь — кратко: файлы и порядок запуска.

Схема: база данных — облачный **Neon** (обычный Postgres, ничего не занимает на
телефоне); в iSH крутятся только **приложения**, под менеджером процессов
**pm2** (он держит их живыми и удобен, когда сервисов несколько).

- **`setup.sh`** — разовая настройка: ставит пакеты (+ pm2), скачивает
  `cloudflared`, создаёт `.env` и генерирует секреты, `npm install`, миграции,
  сборка. Идемпотентный — можно запускать повторно.
- **`start.sh`** — запуск/восстановление: поднимает приложение и
  Cloudflare-туннель под pm2, перезапускает упавшие, восстанавливает всё после
  перезагрузки.

## Порядок (внутри iSH)

```sh
apk add git
git clone https://github.com/SiarheyB/statstrade.git tradestats && cd tradestats

sh deploy/iphone/setup.sh      # 1-й запуск создаст .env
nano .env                      # впиши DATABASE_URL (строка из neon.tech)
sh deploy/iphone/setup.sh      # 2-й запуск: install + миграции + сборка

# туннель Cloudflare — см. корневой README, раздел «Сервер из iPhone», шаг 6
# (cloudflared login / tunnel create / route dns / config.yml)

sh deploy/iphone/start.sh      # поднять приложение + туннель (pm2)
pm2 logs                       # смотреть логи (Ctrl+C закрывает только просмотр, сервисы живут)
```

## Несколько приложений одновременно

iSH — один маленький Linux, в нём можно держать несколько сервисов. Каждый — на
своём порту, все под pm2, один туннель раздаёт их по разным поддоменам:

```sh
cd ~/другой-проект
PORT=3001 pm2 start npm --name app2 -- start
pm2 save
```
Затем добавь правило в `~/.cloudflared/config.yml`
(`hostname: app2.домен → service: http://localhost:3001`),
выполни `cloudflared tunnel route dns tradestats app2.домен` и `pm2 restart tunnel`.
Подробнее — корневой README, раздел «Несколько приложений».

## После перезагрузки телефона

Открой iSH и выполни `sh deploy/iphone/start.sh` — pm2 восстановит все сервисы.
Затем включи Гид-доступ и «Автоблокировку: Никогда» (см. корневой README).
