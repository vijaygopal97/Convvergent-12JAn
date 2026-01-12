#!/bin/bash

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
OUTPUT_FILE="/var/www/opine/monitoring-results-$(date '+%Y%m%d-%H%M%S').txt"

{
  echo "=========================================="
  echo "  DETAILED SYSTEM MONITORING"
  echo "  Timestamp: $TIMESTAMP"
  echo "=========================================="
  echo ""
  
  echo "=== SYSTEM RESOURCES ==="
  echo "CPU Load Average:"
  uptime
  echo ""
  echo "Memory:"
  free -h
  echo ""
  echo "Disk Usage:"
  df -h / | tail -1
  echo ""
  
  echo "=== PM2 PROCESSES (Detailed) ==="
  pm2 jlist 2>/dev/null | jq -r '.[] | select(.name | contains("opine")) | {
    name: .name,
    cpu: .monit.cpu,
    memory_mb: (.monit.memory/1024/1024 | floor),
    restarts: .pm2_env.restart_time,
    status: .pm2_env.status,
    uptime: .pm2_env.pm_uptime
  }' 2>/dev/null || pm2 list
  echo ""
  
  echo "=== MONGODB CONNECTIONS ==="
  mongosh --quiet --eval "
    try {
      const status = db.serverStatus();
      print('Current Connections:', status.connections.current);
      print('Available Connections:', status.connections.available);
      print('Total Created:', status.connections.totalCreated);
      print('Active Clients:', status.globalLock.activeClients.total);
      print('Queued Operations:', status.globalLock.currentQueue.total);
    } catch(e) {
      print('Error:', e.message);
    }
  " 2>/dev/null || echo "MongoDB check failed"
  echo ""
  
  echo "=== NETWORK CONNECTIONS ==="
  echo "MongoDB (27017): $(netstat -an | grep :27017 | wc -l) connections"
  echo "Redis (6379): $(netstat -an | grep :6379 | wc -l) connections"
  echo ""
  
  echo "=== TOP CPU PROCESSES ==="
  ps aux --sort=-%cpu | head -8
  echo ""
  
  echo "=== TOP MEMORY PROCESSES ==="
  ps aux --sort=-%mem | head -8
  echo ""
  
  echo "=== BACKEND ERROR LOGS (Last 10) ==="
  pm2 logs opine-backend --lines 50 --nostream 2>&1 | grep -iE "error|warning|memory|leak" | tail -10 || echo "No errors found"
  echo ""
  
} | tee "$OUTPUT_FILE"

echo ""
echo "✅ Detailed monitoring saved to: $OUTPUT_FILE"
