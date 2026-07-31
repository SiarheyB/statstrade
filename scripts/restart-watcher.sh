#!/bin/bash
# Скрипт наблюдения за collector и автоперезапуск при сбое.
# Запускаете на сервере: nohup ./scripts/restart-watcher.sh &
#
# Логи пишутся в /var/log/collector-restart.log

LOG="/var/log/collector-restart.log"
MAX_RESTARTS=10
RESTART_DELAY=15

restart_count=0

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG"
}

log "Watcher started"

while true; do
  # Проверяем healthcheck collector через docker
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' tradestats-collector 2>/dev/null || echo "unknown")

  if [ "$STATUS" != "healthy" ]; then
    if [ $restart_count -lt $MAX_RESTARTS ]; then
      log "Collector unhealthy ($STATUS), restarting..."
      docker restart tradestats-collector >> "$LOG" 2>&1
      restart_count=$((restart_count + 1))
      sleep $RESTART_DELAY
    else
      log "Max restarts reached, alerting"
      # Можно добавить уведомление в Telegram/Discord
      restart_count=0  # Сброс счётчика после тревоги
    fi
  else
    # Сбрасываем счётчик при здоровье
    restart_count=0
  fi

  sleep 30
done