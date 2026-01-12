# ✅ Abandon Detection Fix - January 5, 2026

## 🔴 Problem Identified

Abandoned interviews from offline sync were being marked as `Pending_Approval` instead of `abandoned` status. This happened because the `createCompleteResponse` function in `SurveyResponse.js` was always setting status to `Pending_Approval` without checking metadata for abandoned indicators.

**Example:** Session ID `8b3d2423-9c7c-43d5-9373-54b04f9ae25a` was an abandoned response but was received as `Pending_Approval`.

---

## ✅ Solution Implemented

### **1. Added Abandon Detection Logic in `createCompleteResponse`**

**File:** `backend/models/SurveyResponse.js` (lines 725-798)

**What it does:**
- Checks metadata for abandoned indicators BEFORE setting status
- For **CATI interviews:**
  - Checks `metadata.abandoned === true`
  - Checks `metadata.abandonedReason` field
  - Checks `metadata.callStatus` (if not 'call_connected' or 'success', it's abandoned)
  - Checks `metadata.knownCallStatus`
- For **CAPI interviews:**
  - Checks `metadata.abandoned === true`
  - Checks `metadata.abandonedReason` field

**If abandoned detected:**
- Sets `status: 'abandoned'` instead of `'Pending_Approval'`
- Stores `abandonedReason` from metadata
- Stores `knownCallStatus` for CATI (if available)
- Logs detection for debugging

### **2. Updated `completeInterview` to Skip Processing for Abandoned Responses**

**File:** `backend/controllers/surveyResponseController.js` (lines 602-643)

**What it does:**
- Skips auto-rejection check for abandoned responses
- Skips QC batch addition for abandoned responses
- Abandoned responses are final status and don't need processing

---

## 📋 Detection Logic Details

### **CATI Abandon Detection:**
```javascript
const isCatiAbandoned = isMetadataAbandoned ||
                        (callStatus && 
                         callStatus !== 'call_connected' && 
                         callStatus !== 'success' &&
                         callStatus !== null &&
                         callStatus !== undefined);
```

**Checks:**
- `metadata.abandoned === true`
- `metadata.abandonedReason` exists
- `metadata.callStatus` is not 'call_connected' or 'success'
- `metadata.knownCallStatus` is not 'call_connected' or 'success'

### **CAPI Abandon Detection:**
```javascript
if (isMetadataAbandoned) {
  initialStatus = 'abandoned';
  abandonedReason = metadata?.abandonedReason || null;
}
```

**Checks:**
- `metadata.abandoned === true`
- `metadata.abandonedReason` exists

---

## 🔍 Metadata Fields Checked

The system now checks these metadata fields for abandon detection:

1. **`metadata.abandoned`** - Boolean flag indicating interview was abandoned
2. **`metadata.abandonedReason`** - String reason for abandonment
3. **`metadata.callStatus`** - CATI call status (for CATI only)
4. **`metadata.knownCallStatus`** - Known call status (for CATI only)

---

## ✅ Expected Behavior After Fix

### **Before Fix:**
- ❌ All offline sync submissions → `Pending_Approval`
- ❌ Abandoned interviews → `Pending_Approval` (WRONG)

### **After Fix:**
- ✅ Normal offline sync submissions → `Pending_Approval` (CORRECT)
- ✅ Abandoned interviews from offline sync → `abandoned` (CORRECT)
- ✅ Abandoned CATI interviews → `abandoned` with `abandonedReason` and `knownCallStatus`
- ✅ Abandoned CAPI interviews → `abandoned` with `abandonedReason`
- ✅ Abandoned responses are NOT added to QC batches
- ✅ Abandoned responses are NOT auto-rejected

---

## 🧪 Testing Checklist

- [ ] Test CAPI abandoned interview from offline sync
- [ ] Test CATI abandoned interview from offline sync
- [ ] Verify sessionId `8b3d2423-9c7c-43d5-9373-54b04f9ae25a` is handled correctly
- [ ] Verify abandoned responses are NOT in QC batches
- [ ] Verify abandoned responses are NOT auto-rejected
- [ ] Verify normal (non-abandoned) interviews still work correctly

---

## 📝 Files Modified

1. **`backend/models/SurveyResponse.js`**
   - Added abandon detection logic in `createCompleteResponse` function
   - Lines 725-798: Abandon detection and status setting

2. **`backend/controllers/surveyResponseController.js`**
   - Updated `completeInterview` to skip processing for abandoned responses
   - Lines 602-643: Skip auto-rejection and batch addition for abandoned responses

---

## 🚀 Next Steps

1. **Test the fix** with the specific sessionId mentioned
2. **Monitor logs** for abandon detection messages
3. **Verify** that abandoned responses are correctly marked
4. **Check** that abandoned responses are NOT in QC batches

---

## 📊 Log Messages to Watch For

When an abandoned interview is detected, you'll see:
```
🚫 CATI Abandon Detected: Setting status to 'abandoned' for sessionId: <sessionId>
   Abandoned reason: <reason>, Call status: <status>
```

or

```
🚫 CAPI Abandon Detected: Setting status to 'abandoned' for sessionId: <sessionId>
   Abandoned reason: <reason>
```

When processing is skipped:
```
⏭️  Skipping auto-rejection and batch addition for abandoned response <responseId> (status: abandoned)
```

---

**Fix Completed:** January 5, 2026
**Status:** ✅ Ready for Testing





