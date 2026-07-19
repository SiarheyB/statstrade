#!/usr/bin/env bash
# Monitor disk usage for PostgreSQL data directory.
# Alerts if usage exceeds threshold (default 80%).
# Usage: ./scripts/monitor_disk.sh [threshold_percent] [data_dir]

THRESHOLD=${1:-80}
DATA_DIR=${2:-/var/lib/postgresql/data}

if [[ ! -d "$DATA_DIR" ]]; then
    echo "Error: Data directory $DATA_DIR does not exist."
    exit 1
fi

# Get usage percentage
USE_PERCENT=$(df "$DATA_DIR" | awk 'NR==2 {print $5}' | tr -d '%')
HOSTNAME=$(hostname)

echo "[$(date)] Disk usage of $DATA_DIR: ${USE_PERCENT}% (threshold: ${THRESHOLD}%)"

if [[ "$USE_PERCENT" -ge "$THRESHOLD" ]]; then
    echo "ALERT: Disk usage ${USE_PERCENT}% exceeds threshold ${THRESHOLD}% on $HOSTNAME"
    # You could integrate with alerting systems here (email, Slack, etc.)
    exit 1
else
    echo "OK: Disk usage within limits."
    exit 0
fi