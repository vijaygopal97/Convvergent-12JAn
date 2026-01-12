#!/bin/bash

# Memory Leak Detection Script
# Tracks CPU, Memory, and MongoDB connections over time

LOG_FILE="/var/www/opine/monitoring-$(date '+%Y%m%d').log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Function to get PM2 stats
get_pm2_stats() {
  pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | contains("opine")) | "\(.name)|\(.monit.cpu)|\(.monit.memory)"' 2>/dev/null
}

# Function to get MongoDB connections
get_mongo_connections() {
  mongosh --quiet --eval "db.serverStatus().connections.current" 2>/dev/null || echo "0"
}

# Function to get system memory
get_system_memory() {
  free | grep Mem | awk '{printf "%.1f", $3/$2 * 100}'
}

# Collect metrics
echo "[$TIMESTAMP] === METRICS SNAPSHOT ===" >> "$LOG_FILE"
echo "PM2 Processes:" >> "$LOG_FILE"
get_pm2_stats | while IFS='|' read -r name cpu memory; do
  memory_mb=$((memory / 1024 / 1024))
  echo "  $name: CPU=${cpu}%, Memory=${memory_mb}MB" >> "$LOG_FILE"
done

MONGO_CONN=$(get_mongo_connections)
SYS_MEM=$(get_system_memory)

echo "MongoDB Connections: $MONGO_CONN" >> "$LOG_FILE"
echo "System Memory Usage: ${SYS_MEM}%" >> "$LOG_FILE"
echo "---" >> "$LOG_FILE"

# Display current snapshot
echo "=== CURRENT METRICS ($TIMESTAMP) ==="
echo "PM2 Processes:"
get_pm2_stats | while IFS='|' read -r name cpu memory; do
  memory_mb=$((memory / 1024 / 1024))
  echo "  $name: CPU=${cpu}%, Memory=${memory_mb}MB"
done
echo "MongoDB Connections: $MONGO_CONN"
echo "System Memory Usage: ${SYS_MEM}%"
echo ""
echo "📊 Logging to: $LOG_FILE"
echo "   Run this script multiple times to track changes over time"
