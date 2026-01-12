#!/bin/bash
# Monitor CSV generation progress

LOG_FILE="/tmp/csv_generation.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Log file not found: $LOG_FILE"
    echo "   The CSV generation script may not be running."
    exit 1
fi

echo "📊 Monitoring CSV Generation Progress"
echo "   Log file: $LOG_FILE"
echo "   Press Ctrl+C to stop monitoring"
echo ""
echo "--- Latest Progress ---"
tail -f "$LOG_FILE" 2>/dev/null || tail "$LOG_FILE"





