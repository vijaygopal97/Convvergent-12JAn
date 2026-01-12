#!/bin/bash

echo "=== CONTINUOUS MEMORY MONITORING ==="
echo "Press Ctrl+C to stop"
echo ""

BASELINE_TIME=$(date '+%H:%M:%S')
echo "[$BASELINE_TIME] Baseline snapshot:"
pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | contains("opine-backend")) | "  \(.name): Memory=\(.monit.memory/1024/1024 | floor)MB, CPU=\(.monit.cpu)%"' || pm2 list | grep opine-backend
echo ""

MONGO_BASELINE=$(mongosh --quiet --eval "db.serverStatus().connections.current" 2>/dev/null || echo "0")
echo "[$BASELINE_TIME] MongoDB Connections: $MONGO_BASELINE"
echo ""
echo "--- Monitoring every 2 seconds ---"
echo ""

SNAPSHOT=1
while true; do
  TIMESTAMP=$(date '+%H:%M:%S')
  echo "[$TIMESTAMP] Snapshot #$SNAPSHOT:"
  
  # PM2 Memory
  pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | contains("opine-backend")) | "  \(.name): Memory=\(.monit.memory/1024/1024 | floor)MB, CPU=\(.monit.cpu)%"' || pm2 list | grep opine-backend
  
  # MongoDB Connections
  MONGO_CURRENT=$(mongosh --quiet --eval "db.serverStatus().connections.current" 2>/dev/null || echo "0")
  echo "  MongoDB Connections: $MONGO_CURRENT"
  
  # System Memory
  SYS_MEM=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100}')
  echo "  System Memory: ${SYS_MEM}%"
  echo ""
  
  SNAPSHOT=$((SNAPSHOT + 1))
  sleep 2
done
