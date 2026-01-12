# 🚫 Abandoned Responses Analysis - Last 24 Hours

## 📊 Summary

**Analysis Date:** January 5, 2026, 18:52 UTC

### Key Findings:

- **Total Pending_Approval (last 24h):** 3,595 responses
- **Should be Abandoned:** 203 responses (5.6%)
- **Correctly marked:** 3,392 responses (94.4%)

### Breakdown by Interview Mode:

- **📱 CAPI:** 61 responses should be abandoned
- **📞 CATI:** 142 responses should be abandoned

---

## 🔍 Abandon Indicators Found

The analysis checked for these abandon indicators:

1. **`abandonedReason` field** - Direct field on response
2. **`metadata.abandoned === true`** - Boolean flag in metadata
3. **`metadata.abandonedReason`** - Reason string in metadata
4. **`callStatus` / `knownCallStatus`** - For CATI (if not 'call_connected' or 'success')

---

## 📋 Common Abandon Reasons Found

### CATI Responses:
- **Call_Not_Connected** - Most common (majority of CATI abandons)
- Call statuses: `unknown`, `busy`, `not_reachable`, `did_not_pick_up`, `didnt_get_call`

### CAPI Responses:
- **technical_issue** - Technical problems during interview
- **location_issue** - Location/GPS problems

---

## 🎯 Example Responses Found

1. **Response ID:** `8cdc0ec7-8e6a-48a5-9d1d-47f204d0c9a1`
   - Mode: CAPI
   - Reason: `technical_issue`
   - Created: 2026-01-04T19:19:17.995Z

2. **Response ID:** `618acb71-b5ac-4f4f-8cf7-48ed07d1374b`
   - Mode: CATI
   - Reason: `Call_Not_Connected`
   - Call Status: `unknown`
   - Created: 2026-01-04T20:01:22.066Z

---

## ✅ Fix Applied

The abandon detection logic has been added to `createCompleteResponse` function in `SurveyResponse.js`. This will prevent future abandoned responses from being marked as `Pending_Approval`.

### For Existing Responses:

A fix script is available at:
- `/var/www/opine/backend/scripts/fixAbandonedInPendingApproval.js`

**To fix existing responses:**
```bash
cd /var/www/opine/backend/scripts
node fixAbandonedInPendingApproval.js
```

This will:
- Find all responses that should be abandoned
- Update their status to `abandoned`
- Set `abandonedReason` if missing
- Set `knownCallStatus` for CATI if missing
- Ask for confirmation before updating

---

## 📁 Output Files

- **Analysis Results:** `/var/www/opine/backend/scripts/should_be_abandoned_pending_approval_2026-01-05T18-52-22.json`
  - Contains full list of 203 responses with all details

---

## 🔄 Next Steps

1. **Review the analysis** - Check the JSON file for details
2. **Run the fix script** - Update the 203 responses to `abandoned` status
3. **Monitor going forward** - The new logic will prevent this issue for new responses

---

**Status:** ✅ Analysis Complete - Ready for Fix





