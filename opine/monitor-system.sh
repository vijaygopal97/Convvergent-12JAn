#!/bin/bash

echo "=========================================="
echo "  SYSTEM MONITORING - $(date '+%Y-%m-%d %H:%M:%S')"
echo "=========================================="
echo ""

echo "--- CPU & MEMORY ---"
echo "CPU Load Average:"
uptime | awk -F'load average:' '{print $2}'
echo ""
echo "Memory Usage:"
free -h | grep -E "Mem|Swap"
echo ""

echo "--- PM2 PROCESSES ---"
pm2 jlist 2>/dev/null | jq -r '.[] | "\(.name): CPU=\(.monit.cpu)%, Memory=\(.monit.memory/1024/1024 | floor)MB, Restarts=\(.pm2_env.restart_time), Status=\(.pm2_env.status)"' 2>/dev/null || pm2 list
echo ""

echo "--- MONGODB CONNECTIONS (via mongo shell) ---"
mongosh --quiet --eval "
  const status = db.serverStatus();
  print('Current Connections:', status.connections.current);
  print('Available Connections:', status.connections.available);
  print('Total Created:', status.connections.totalCreated);
  print('Active Clients:', status.globalLock.activeClients.total);
  print('Queued Operations:', status.globalLock.currentQueue.total);
" 2>/dev/null || echo "MongoDB connection check failed (may need authentication)"
echo ""

echo "--- TOP PROCESSES BY CPU ---"
ps aux --sort=-%cpu | head -6
echo ""

echo "--- TOP PROCESSES BY MEMORY ---"
ps aux --sort=-%mem | head -6
echo ""

echo "=========================================="
