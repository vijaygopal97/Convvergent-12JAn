# ROOT CAUSE ANALYSIS: Duplicate Responses with Different Interviewers

## Executive Summary

**CRITICAL BUG IDENTIFIED**: The offline sync mechanism uses the currently logged-in user's ID instead of preserving the original interviewer ID who conducted the interview. This causes the same interview content to be synced with different interviewer IDs when multiple users log in on the same device.

## Evidence

### 1. Mismatch Reason Analysis
- **100% of bypassed duplicates (200 responses)** have the mismatch reason: **"Different interviewer ObjectId"**
- This is the ONLY mismatch reason found in all 160 groups

### 2. Submission Dates
- **Today**: 0 responses
- **Yesterday**: 107 responses (29.7%)
- **Earlier**: 253 responses (70.3%)
- **Total**: 360 responses with different interviewers

### 3. Session ID Patterns
- **Offline sessionIds**: 9 responses
- **Regular sessionIds**: 351 responses
- **Same sessionId with different interviewers**: 0 (all have different sessionIds)

## Root Cause: Code Analysis

### Frontend (React Native) - syncService.ts

**File**: `Opine-Android/src/services/syncService.ts`
**Line**: 565

```typescript
metadata: {
  survey: interview.surveyId,
  interviewer: 'current-user',  // ❌ CRITICAL BUG: Uses current logged-in user
  status: 'Pending_Approval',
  sessionId: sessionId,
  // ... other fields
}
```

**Problem**: The offline interview data structure (`OfflineInterview`) does NOT store the original interviewer ID. When syncing, it always sends `interviewer: 'current-user'`.

### Backend - surveyResponseController.js

**File**: `/var/www/opine/backend/controllers/surveyResponseController.js`
**Line**: 578

```javascript
const interviewerId = req.user.id;  // Uses authenticated user from JWT token
```

**Problem**: The backend resolves `'current-user'` to `req.user.id`, which is the currently authenticated user from the JWT token, NOT the original interviewer who conducted the interview.

## How This Happens: Step-by-Step

### Scenario 1: Shared Device / Multiple Users

1. **Interviewer A** conducts an interview on Device X
   - Interview is saved offline with sessionId: `abc-123`
   - Original interviewer ID: `InterviewerA_ObjectId`
   - Offline interview data does NOT store interviewer ID

2. **Interviewer B** logs in on the same Device X
   - Interviewer A's offline interview is still in storage
   - Sync service runs for Interviewer B

3. **Sync Process**:
   - Reads offline interview (created by Interviewer A)
   - Sends `interviewer: 'current-user'` in metadata
   - Backend receives JWT token for **Interviewer B**
   - Backend resolves `req.user.id` = **Interviewer B's ObjectId**
   - Same interview content gets saved with **Interviewer B's ID**

4. **Result**: 
   - Original response: Interviewer A (sessionId: `abc-123`)
   - Duplicate response: Interviewer B (sessionId: `xyz-789`)
   - Same content, same startTime, same responses, same audio
   - **Different interviewer ObjectIds** → Different contentHash → Not detected as duplicate

### Scenario 2: Session ID Regeneration

The offline interview may also generate a new sessionId during sync if the original sessionId is not preserved or is invalid. This creates a different sessionId for the same interview content.

## Proof from Data

### Example: Group 300

**Original Response**:
- Response ID: `3e05789f-937...`
- Interviewer: CAPI933 (Imran sk) - ObjectId: `6946cd91962d7e42c40411e6`
- SessionId: `90d8e397-f0e7-4356-a8c6-2ea6a5298a5c` (regular)
- Created: 2025-12-26T13:23:59.198Z
- StartTime: 2025-12-26T13:12:21.198Z

**Duplicate 1**:
- Response ID: `358ddc23-394...`
- Interviewer: CAPI931 (Sobrati sk) - ObjectId: `6946cd8e962d7e42c404065e` (DIFFERENT)
- SessionId: `70b699f3-c4ea-40ac-b1af-a717d90b99cd` (DIFFERENT)
- Created: 2025-12-29T02:46:01.775Z (3 days later)
- StartTime: 2025-12-26T13:12:21.198Z (SAME)

**Duplicate 2**:
- Response ID: `f2e27d2c-ca4...`
- Interviewer: CAPI132 (MD SAHIL SK) - ObjectId: `6942c364fe90bbe7745bc923` (DIFFERENT)
- SessionId: `offline_1767352549764_atgzcv4rc` (offline-generated, DIFFERENT)
- Created: 2026-01-02T11:15:51.100Z (7 days later)
- StartTime: 2025-12-26T13:12:21.198Z (SAME)

**Analysis**:
- All have the EXACT same startTime (to the millisecond)
- All have the EXACT same content (responses, audio, etc.)
- All have DIFFERENT sessionIds (not the same session being reused)
- All have DIFFERENT interviewer ObjectIds
- Created at different times (synced by different users on different days)

## Why ContentHash Doesn't Match

The contentHash includes the interviewer ObjectId:

```javascript
let hashInput = `${interviewer.toString()}|${survey.toString()}|${normalizedStartTime.toISOString()}|...`;
```

Since the interviewer ObjectId is different, the hash is different, so the duplicate detection fails.

## Why Same ContentHash Responses Work

For responses with the same contentHash:
- They were synced by the SAME user (same interviewer ObjectId)
- The idempotency check by sessionId may have failed (different sessionIds)
- Or the sessionId check failed, allowing multiple submissions with different sessionIds

## Impact

- **160 groups** with different interviewers
- **200 responses** bypassed duplicate detection
- **107 responses** submitted yesterday (still happening)
- **253 responses** submitted earlier (historical issue)

## Recommendations

1. **Store Original Interviewer ID**: Modify `OfflineInterview` interface to store the original interviewer ID when the interview is saved offline
2. **Use Original Interviewer on Sync**: Instead of `'current-user'`, use the stored original interviewer ID
3. **Backend Validation**: Add validation to prevent syncing interviews with a different interviewer ID than the original
4. **Session ID Preservation**: Ensure sessionId is preserved and validated during sync







