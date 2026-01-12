# 📋 Test Script Information

## 🎯 Main Test Script

**Location:** `/var/www/opine/stress-tests/situation-1-quality-checks/scripts/comprehensive-5min-stress-test.js`

## 🚀 How to Run

```bash
cd /var/www/opine/stress-tests/situation-1-quality-checks/scripts
node comprehensive-5min-stress-test.js
```

## ⚙️ Configuration

The test script can be customized by editing these variables at the top of the file:

```javascript
const TEST_DURATION_SECONDS = 300; // 5 minutes (change to desired duration)
const SURVEY_ID = '68fd1915d41841da463f0d46'; // Survey ID to test
```

To change the number of concurrent users, modify these sections:

```javascript
// In initializeEmulators() method:
for (let i = 0; i < 50; i++) {  // Change 50 to desired number
  this.emulators.qualityAgents.push(...);
}
for (let i = 0; i < 50; i++) {  // Change 50 to desired number
  this.emulators.catiInterviewers.push(...);
}
// etc.
```

To change the request rate, modify:

```javascript
// In runUserGroup() method:
promises.push(this.runUserGroup(this.emulators.qualityAgents, 'Quality Agents', 50)); // Change 50 to requests/second
```

## 📊 Test Results Location

All test results are saved in:
- `/var/www/opine/stress-tests/situation-1-quality-checks/reports/`
- Metrics JSON: `metrics-comprehensive-5min-{timestamp}.json`
- Results JSON: `results-comprehensive-5min-{timestamp}.json`
- Metrics CSV: `metrics-comprehensive-5min-{timestamp}.csv`
- Logs: `logs/comprehensive-5min-{timestamp}.log`

## 🔧 Supporting Scripts

- `monitor-system.js` - System performance monitoring
- `generate-report.js` - Report generation
- `cleanup-all-test-data.js` - Cleanup test data

