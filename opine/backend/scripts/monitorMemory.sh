#!/bin/bash

# Memory Leak Monitoring Script
# Run this continuously to monitor backend memory usage
# Usage: ./monitorMemory.sh [duration_in_minutes]

DURATION=${1:-60}  # Default 60 minutes
INTERVAL=5  # Check every 5 seconds
END_TIME=$(date -d "+${DURATION} minutes" +%s)

echo "=== Memory Leak Monitoring Started ==="
echo "Duration: ${DURATION} minutes"
echo "Interval: ${INTERVAL} seconds"
echo "Started at: $(date)"
echo ""

# Get baseline memory
BASELINE_MEM=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name | contains(\"opine-backend\")) | .monit.memory" | sort -n | tail -1)
BASELINE_MEM_MB=$((BASELINE_MEM / 1024 / 1024))
echo "Baseline Memory: ${BASELINE_MEM_MB}MB"
echo ""

MAX_INCREASE=0
LEAK_COUNT=0
SNAPSHOT=1

while [ $(date +%s) -lt $END_TIME ]; do
  TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
  
  # Get current memory for all backend processes
  CURRENT_MEM=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name | contains(\"opine-backend\")) | .monit.memory" | sort -n | tail -1)
  CURRENT_MEM_MB=$((CURRENT_MEM / 1024 / 1024))
  MEM_DIFF=$((CURRENT_MEM_MB - BASELINE_MEM_MB))
  
  # Track max increase
  if [ $MEM_DIFF -gt $MAX_INCREASE ]; then
    MAX_INCREASE=$MEM_DIFF
  fi
  
  # Count leaks (>200MB increase)
  if [ $MEM_DIFF -gt 200 ]; then
    LEAK_COUNT=$((LEAK_COUNT + 1))
  fi
  
  # Display status
  STATUS="✅ Stable"
  if [ $MEM_DIFF -gt 500 ]; then
    STATUS="🚨 MASSIVE LEAK"
  elif [ $MEM_DIFF -gt 200 ]; then
    STATUS="⚠️  LEAK DETECTED"
  elif [ $MEM_DIFF -gt 50 ]; then
    STATUS="⚠️  Growing"
  fi
  
  printf "[%s] Snapshot #%d: Memory=%dMB (+%dMB) %s\n" "$TIMESTAMP" "$SNAPSHOT" "$CURRENT_MEM_MB" "$MEM_DIFF" "$STATUS"
  
  # Show process breakdown
  pm2 jlist 2>/dev/null | jq -r ".[] | select(.name | contains(\"opine-backend\")) | \"  Process \(.pm2_env.pm_id): \(.monit.memory/1024/1024 | floor)MB\"" || true
  
  SNAPSHOT=$((SNAPSHOT + 1))
  sleep $INTERVAL
done

echo ""
echo "=== Monitoring Summary ==="
echo "Baseline: ${BASELINE_MEM_MB}MB"
echo "Peak Increase: ${MAX_INCREASE}MB"
echo "Leak Detections (>200MB): ${LEAK_COUNT}"
echo "Total Snapshots: $((SNAPSHOT - 1))"
echo ""

if [ $MAX_INCREASE -gt 500 ]; then
  echo "🚨 CRITICAL: Memory leak detected (Peak: +${MAX_INCREASE}MB)"
  echo "   Action required: Investigate endpoints causing memory growth"
elif [ $MAX_INCREASE -gt 200 ]; then
  echo "⚠️  WARNING: Moderate memory growth (Peak: +${MAX_INCREASE}MB)"
  echo "   Monitor closely for potential leaks"
elif [ $MAX_INCREASE -gt 50 ]; then
  echo "✅ ACCEPTABLE: Minor memory growth (Peak: +${MAX_INCREASE}MB)"
  echo "   Normal operation - memory is stable"
else
  echo "✅ EXCELLENT: Memory stable (Peak: +${MAX_INCREASE}MB)"
  echo "   No memory leaks detected"
fi




