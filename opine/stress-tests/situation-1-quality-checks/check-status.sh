#!/bin/bash
echo "=== Test Process Status ==="
ps aux | grep comprehensive-5min-stress-test | grep -v grep || echo "Test not running"

echo ""
echo "=== Latest Log Entry (Last 10 lines) ==="
LATEST_LOG=$(find /var/www/opine/stress-tests/situation-1-quality-checks/logs -name "comprehensive-5min-*.log" -type f -exec ls -lt {} + 2>/dev/null | head -1 | awk '{print $NF}')
if [ -n "$LATEST_LOG" ]; then
    tail -10 "$LATEST_LOG"
else
    echo "No log file found"
fi

echo ""
echo "=== System Load ==="
uptime

echo ""
echo "=== Memory Usage ==="
free -h | grep Mem

echo ""
echo "=== Latest Metrics (Last 3 samples) ==="
LATEST_CSV=$(find /var/www/opine/stress-tests/situation-1-quality-checks/reports -name "metrics-comprehensive-5min-*.csv" -type f -exec ls -lt {} + 2>/dev/null | head -1 | awk '{print $NF}')
if [ -n "$LATEST_CSV" ]; then
    tail -3 "$LATEST_CSV"
else
    echo "No metrics file found"
fi
