#!/bin/bash
# Quick status check for CSV export

SURVEY_ID=${1:-"68fd1915d41841da463f0d46"}
CSV_FILE="/var/www/opine/backend/generated-csvs/${SURVEY_ID}/responses_codes.csv"
EXPECTED=55300

echo "📊 CSV Export Status for Survey: ${SURVEY_ID}"
echo "=============================================="

# Check process
if pgrep -f "generateAllTimeCSVExport.js.*${SURVEY_ID}" > /dev/null; then
    echo "✅ Export process: RUNNING"
else
    echo "❌ Export process: NOT RUNNING"
fi

# Check file
if [ -f "$CSV_FILE" ]; then
    LINE_COUNT=$(wc -l < "$CSV_FILE" 2>/dev/null || echo "0")
    DATA_ROWS=$((LINE_COUNT - 2))
    if [ "$DATA_ROWS" -lt 0 ]; then DATA_ROWS=0; fi
    
    FILE_SIZE=$(stat -f%z "$CSV_FILE" 2>/dev/null || stat -c%s "$CSV_FILE" 2>/dev/null)
    FILE_SIZE_MB=$(awk "BEGIN {printf \"%.2f\", $FILE_SIZE/1024/1024}")
    PERCENTAGE=$(awk "BEGIN {printf \"%.1f\", ($DATA_ROWS/$EXPECTED)*100}")
    MODIFIED=$(stat -f "%Sm" "$CSV_FILE" 2>/dev/null || stat -c "%y" "$CSV_FILE" 2>/dev/null | cut -d'.' -f1)
    
    echo "📄 File: $CSV_FILE"
    echo "📈 Progress: ${DATA_ROWS} / ${EXPECTED} rows (${PERCENTAGE}%)"
    echo "💾 Size: ${FILE_SIZE_MB} MB"
    echo "🕒 Last Updated: ${MODIFIED}"
    
    if [ "$DATA_ROWS" -ge "$EXPECTED" ]; then
        echo ""
        echo "🎉 EXPORT COMPLETED!"
    fi
else
    echo "❌ File not found yet"
fi

