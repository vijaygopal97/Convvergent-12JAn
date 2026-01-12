# 🚫 Abandoned Responses Decision Report - Last 24 Hours

**Generated:** January 5, 2026, 18:55 UTC  
**Time Range:** Last 24 hours (since 2026-01-04T18:55:45)

---

## 📊 EXECUTIVE SUMMARY

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total Pending_Approval (last 24h)** | 3,595 | 100% |
| **Should be Abandoned** | **203** | **5.65%** |
| **Correctly marked** | 3,392 | 94.35% |

---

## 📱 BREAKDOWN BY INTERVIEW MODE

| Mode | Count | Percentage |
|------|-------|------------|
| **CAPI** | 61 | 30.05% |
| **CATI** | 142 | 69.95% |

---

## 🚫 BREAKDOWN BY ABANDON REASON

| Reason | Count | Percentage |
|--------|-------|------------|
| **Call_Not_Connected** | 134 | 66.01% |
| **technical_issue** | 27 | 13.30% |
| **respondent_not_available** | 14 | 6.90% |
| **location_issue** | 10 | 4.93% |
| **Interview_Abandoned_Early** | 6 | 2.96% |
| **respondent_refused** | 4 | 1.97% |
| **language_barrier** | 3 | 1.48% |
| **respondent_busy** | 2 | 0.99% |
| **other** | 1 | 0.49% |
| **consent_refused** | 1 | 0.49% |
| **Not_Registered_Voter_In_AC** | 1 | 0.49% |

---

## 📞 CATI CALL STATUS BREAKDOWN

| Call Status | Count | % of CATI |
|-------------|-------|-----------|
| **busy** | 37 | 26.06% |
| **did_not_pick_up** | 27 | 19.01% |
| **not_reachable** | 22 | 15.49% |
| **unknown** | 17 | 11.97% |
| **didnt_get_call** | 14 | 9.86% |
| **number_does_not_exist** | 10 | 7.04% |
| **switched_off** | 8 | 5.63% |

---

## 📋 SURVEY BREAKDOWN

**All 203 responses are from the same survey:**
- **Survey ID:** `68fd1915d41841da463f0d46`
- **CAPI:** 61 responses
- **CATI:** 142 responses

---

## 👤 TOP 20 INTERVIEWERS WITH ABANDONED RESPONSES

| Interviewer | Member ID | Total | CAPI | CATI |
|-------------|-----------|-------|------|------|
| **MALA MONDAL** | 3558 | 30 | 0 | 30 |
| **SUMAN CHAKRABORTY** | 3556 | 30 | 0 | 30 |
| **SUMAIYA KHATUN** | 3575 | 22 | 0 | 22 |
| **Karina khatoon** | 1052 | 13 | 0 | 13 |
| **Sifa khatun** | 1050 | 12 | 0 | 12 |
| **Nurjahan Khatun** | 3510 | 10 | 0 | 10 |
| **MADHURIMA SUR** | CAPI274 | 9 | 9 | 0 |
| **Vishals Interviewer** | 130848 | 8 | 0 | 8 |
| **Lili Kadar** | 3260 | 6 | 0 | 6 |
| **RUPALI MONDAL** | 3571 | 5 | 0 | 5 |
| **NIBADITA GIRI** | CAPI323 | 4 | 4 | 0 |
| **Md Sahid Jamal** | CAPI190 | 3 | 3 | 0 |
| **Sukanta Mandal** | CAPI225 | 3 | 3 | 0 |
| **MD SAHIL SK** | CAPI132 | 3 | 3 | 0 |
| **Mosaraf Mondal** | CAPI1006 | 2 | 2 | 0 |
| **Sujit Halder** | CAPI483 | 2 | 2 | 0 |
| **Sourav Dutta** | CAPI417 | 2 | 2 | 0 |
| **Surajit Mondal** | CAPI250 | 2 | 2 | 0 |
| **KOUSHIK DAS** | CAPI227 | 2 | 2 | 0 |
| **Wahida Nasrin** | 3503 | 2 | 0 | 2 |

---

## 📋 INDICATOR STATISTICS

- **Responses with `abandonedReason` field:** 203 (100%)
- **Responses with `metadata.abandoned`:** 0 (0%)
- **Responses with call status (CATI):** 135 (95.07% of CATI)

---

## 🔍 KEY FINDINGS

### **1. Primary Issue: Call_Not_Connected (66%)**
- **134 out of 203 responses** have "Call_Not_Connected" as abandon reason
- Mostly CATI interviews (142 total CATI, most have this reason)
- Call statuses: busy, did_not_pick_up, not_reachable, unknown, etc.

### **2. CAPI Issues:**
- **technical_issue:** 27 responses (44% of CAPI abandons)
- **location_issue:** 10 responses (16% of CAPI abandons)
- **respondent_not_available:** 14 responses (23% of CAPI abandons)

### **3. Top Interviewers:**
- **MALA MONDAL (3558):** 30 abandoned responses (all CATI)
- **SUMAN CHAKRABORTY (3556):** 30 abandoned responses (all CATI)
- These two interviewers account for **29.6%** of all abandoned responses

---

## 📁 DETAILED REPORTS

### **1. Text Report (Human-Readable)**
**Location:** `/var/www/opine/backend/scripts/abandoned_responses_detailed_report_2026-01-05T18-55-46.txt`
- Contains first 50 response details
- Full breakdowns and statistics
- Easy to read format

### **2. JSON Report (Complete Data)**
**Location:** `/var/www/opine/backend/scripts/abandoned_responses_detailed_report_2026-01-05T18-55-46.json`
- Contains ALL 203 responses with full details
- Includes all metadata, interviewer info, survey info
- Machine-readable format for further analysis

---

## ✅ RECOMMENDATION

**These 203 responses should be updated to `abandoned` status** because:

1. ✅ **All have clear abandon indicators:**
   - 203 have `abandonedReason` field set
   - 135 CATI responses have non-connected call status
   - All indicators point to abandoned interviews

2. ✅ **They're incorrectly in Pending_Approval:**
   - Should not be in QC batches
   - Should not be auto-rejected
   - Should be marked as abandoned

3. ✅ **Fix script is ready:**
   - Script: `/var/www/opine/backend/scripts/fixAbandonedInPendingApproval.js`
   - Will update all 203 responses
   - Asks for confirmation before updating

---

## 🚀 NEXT STEPS

### **Option 1: Fix All 203 Responses (Recommended)**
```bash
cd /var/www/opine/backend/scripts
node fixAbandonedInPendingApproval.js
```
This will:
- Update all 203 responses to `abandoned` status
- Set `abandonedReason` if missing
- Set `knownCallStatus` for CATI if missing
- Ask for confirmation before updating

### **Option 2: Review Specific Responses First**
1. Open the JSON report file
2. Review specific responses you're concerned about
3. Run the fix script after review

### **Option 3: Fix by Interviewer**
- You can modify the fix script to only fix specific interviewers
- Or fix in batches

---

## 📊 IMPACT ANALYSIS

### **If Fixed:**
- ✅ 203 responses correctly marked as `abandoned`
- ✅ Removed from QC batch processing (if already added)
- ✅ Accurate statistics and reporting
- ✅ Better data integrity

### **If Not Fixed:**
- ❌ 203 responses remain incorrectly in `Pending_Approval`
- ❌ May be processed in QC batches (waste of resources)
- ❌ Inaccurate statistics
- ❌ Data integrity issues

---

## 🔍 SAMPLE RESPONSES

### **Example 1: CAPI Technical Issue**
- **Response ID:** `8cdc0ec7-8e6a-48a5-9d1d-47f204d0c9a1`
- **Interviewer:** Pritikona Dey (CAPI1058)
- **Reason:** `technical_issue`
- **Created:** 2026-01-04T19:19:17

### **Example 2: CATI Call Not Connected**
- **Response ID:** `618acb71-b5ac-4f4f-8cf7-48ed07d1374b`
- **Interviewer:** Vishals Interviewer (130848)
- **Reason:** `Call_Not_Connected`
- **Call Status:** `unknown`
- **Created:** 2026-01-04T20:01:22

---

## 📝 NOTES

- All responses are from the same survey: `68fd1915d41841da463f0d46`
- Most abandoned responses are CATI (70%)
- Top 2 interviewers account for 60 abandoned responses (29.6%)
- All responses have clear abandon indicators

---

**Report Generated:** January 5, 2026, 18:55 UTC  
**Status:** ✅ Ready for Decision

