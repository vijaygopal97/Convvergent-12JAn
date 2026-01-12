#!/bin/bash

# Monitor CSV Export Progress
# Usage: ./scripts/monitorCSVProgress.sh [surveyId]

SURVEY_ID=${1:-"68fd1915d41841da463f0d46"}
CSV_FILE="/var/www/opine/backend/generated-csvs/${SURVEY_ID}/responses_codes.csv"
EXPECTED_RESPONSES=55300
PID_FILE="/tmp/csv_export.pid"

echo "📊 CSV Export Progress Monitor"
echo "================================"
echo "Survey ID: ${SURVEY_ID}"
echo "Output File: ${CSV_FILE}"
echo "Expected Responses: ${EXPECTED_RESPONSES}"
echo ""

# Check if process is running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p $PID > /dev/null 2>&1; then
        echo "✅ Export process is running (PID: $PID)"
    else
        echo "⚠️  Export process is not running (PID file exists but process not found)"
    fi
else
    echo "⚠️  No PID file found. Checking for any running export process..."
    if pgrep -f "generateAllTimeCSVExport.js.*${SURVEY_ID}" > /dev/null; then
        echo "✅ Found running export process"
    else
        echo "❌ No export process found running"
    fi
fi

echo ""

# Monitor loop
while true; do
    if [ -f "$CSV_FILE" ]; then
        FILE_SIZE=$(stat -f%z "$CSV_FILE" 2>/dev/null || stat -c%s "$CSV_FILE" 2>/dev/null)
        FILE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $FILE_SIZE/1024/1024}")
        LINE_COUNT=$(wc -l < "$CSV_FILE" 2>/dev/null || echo "0")
        DATA_ROWS=$((LINE_COUNT - 2))  # Subtract header rows
        
        if [ "$DATA_ROWS" -lt 0 ]; then
            DATA_ROWS=0
        fi
        
        if [ "$EXPECTED_RESPONSES" -gt 0 ]; then
            PERCENTAGE=$(awk "BEGIN {printf \"%.1f\", ($DATA_ROWS/$EXPECTED_RESPONSES)*100}")
            REMAINING=$((EXPECTED_RESPONSES - DATA_ROWS))
        else
            PERCENTAGE="0.0"
            REMAINING=0
        fi
        
        MODIFIED_TIME=$(stat -f "%Sm" "$CSV_FILE" 2>/dev/null || stat -c "%y" "$CSV_FILE" 2>/dev/null | cut -d'.' -f1)
        
        # Clear line and print progress
        echo -ne "\r📈 Progress: ${DATA_ROWS}/${EXPECTED_RESPONSES} rows (${PERCENTAGE}%) | Size: ${FILE_SIZE_MB} MB | Last Updated: ${MODIFIED_TIME}"
        
        # Check if process is still running
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if ! ps -p $PID > /dev/null 2>&1; then
                echo ""
                echo ""
                echo "✅ Export process completed!"
                echo "📊 Final Stats:"
                echo "   - Total rows: ${DATA_ROWS}"
                echo "   - File size: ${FILE_SIZE_MB} MB"
                echo "   - Completion: ${PERCENTAGE}%"
                echo "   - File location: ${CSV_FILE}"
                break
            fi
        else
            if ! pgrep -f "generateAllTimeCSVExport.js.*${SURVEY_ID}" > /dev/null; then
                echo ""
                echo ""
                echo "✅ Export process appears to be complete!"
                echo "📊 Final Stats:"
                echo "   - Total rows: ${DATA_ROWS}"
                echo "   - File size: ${FILE_SIZE_MB} MB"
                echo "   - Completion: ${PERCENTAGE}%"
                echo "   - File location: ${CSV_FILE}"
                break
            fi
        fi
        
        # Check if complete
        if [ "$DATA_ROWS" -ge "$EXPECTED_RESPONSES" ]; then
            echo ""
            echo ""
            echo "🎉 Export completed successfully!"
            echo "📊 Final Stats:"
            echo "   - Total rows: ${DATA_ROWS}"
            echo "   - File size: ${FILE_SIZE_MB} MB"
            echo "   - File location: ${CSV_FILE}"
            break
        fi
    else
        echo -ne "\r⏳ Waiting for file to be created..."
    fi
    
    sleep 2
done

