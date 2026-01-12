# Real-Time Reviewer Replacement Monitoring

## How to View the Monitoring

### Option 1: Run the Simple Count Monitor (Recommended)
This shows the "Total Reviewed" count and alerts when it changes:

```bash
cd /var/www/opine/backend
node scripts/simpleReviewerMonitor.js 693ca75a518527155598e961
```

**What it shows:**
- Initial count when started
- Real-time count updates every 2 seconds
- Alert when count changes with difference (+ or -)
- Timestamp of each change

**To stop:** Press `Ctrl+C`

---

### Option 2: Monitor Backend Logs Directly
This shows detailed replacement information from the backend:

```bash
cd /var/www/opine/backend
pm2 logs opine-backend --lines 0 | grep --line-buffered -E "⚠️⚠️⚠️ REVIEWER REPLACEMENT|📝 REVIEW HISTORY|🔴🔴🔴"
```

**What it shows:**
- `⚠️⚠️⚠️ REVIEWER REPLACEMENT DETECTED` - Full details of replacement
- `📝 REVIEW HISTORY UPDATED` - When review history is preserved
- Response IDs, reviewer IDs, timestamps

**To stop:** Press `Ctrl+C`

---

### Option 3: View Log File Directly
Check the PM2 log files:

```bash
tail -f ~/.pm2/logs/opine-backend-out.log | grep --line-buffered -E "⚠️⚠️⚠️|📝 REVIEW HISTORY|REVIEWER REPLACEMENT"
```

---

### Option 4: Check Current Count Anytime
Quick check of current count:

```bash
cd /var/www/opine/backend
node -e "require('dotenv').config(); const mongoose = require('mongoose'); const SurveyResponse = require('./models/SurveyResponse'); mongoose.connect(process.env.MONGODB_URI).then(async () => { const qaId = new mongoose.Types.ObjectId('693ca75a518527155598e961'); const count = await SurveyResponse.countDocuments({ 'verificationData.reviewer': qaId }); console.log('Current Total Reviewed:', count); process.exit(0); });"
```

---

## What to Look For

When a reviewer replacement happens, you'll see:

1. **From Count Monitor:**
   ```
   ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
   🔴 COUNT CHANGED! -1
      Previous: 1032
      Current: 1031
      Time: 2026-01-09T07:45:00.000Z
   ⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️⚠️
   ```

2. **From Backend Logs:**
   ```
   ⚠️⚠️⚠️ REVIEWER REPLACEMENT DETECTED: {
     responseId: 'abc-123-def',
     previousReviewerId: '693ca75a518527155598e961',
     newReviewerId: '693ca75c518527155598e96a',
     timestamp: '2026-01-09T07:45:00.000Z'
   }
   ```

---

## Quick Start

**To start monitoring right now:**
```bash
cd /var/www/opine/backend
node scripts/simpleReviewerMonitor.js 693ca75a518527155598e961
```

This will show you the count and alert when it changes!


