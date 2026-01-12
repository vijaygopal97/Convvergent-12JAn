# CRITICAL AUDIO LOSS ISSUE - ROOT CAUSE ANALYSIS

## Executive Summary
**5 interviews were synced but all audio files are missing (404 errors)**. This is a critical data loss issue that needs immediate attention.

---

## Root Causes Identified

### 🔴 CRITICAL BUG #1: `responseId` NOT Passed to Audio Upload
**Location**: `/var/www/Opine-Android/src/services/syncService.ts`

**Problem**: 
- Line 840: `uploadAudioWithRetry` is called with `responseId` parameter
- Line 929: Function signature does NOT accept `responseId` parameter
- Line 961: `apiService.uploadAudioFile` is called WITHOUT `responseId`

**Impact**: Audio upload fails to link to the response because `responseId` is never passed to the backend, so the audio is uploaded but not associated with the response.

**Code Flow**:
```typescript
// Line 834-841: Calling with responseId
const uploadResult = await this.uploadAudioWithRetry(
  audioPath, sessionId, interview.surveyId, interview.id, 5, responseId // ❌ responseId ignored!
);

// Line 929: Function signature - NO responseId parameter!
private async uploadAudioWithRetry(
  audioPath: string, sessionId: string, surveyId: string, interviewId: string, maxRetries: number
  // ❌ Missing: responseId?: string
)

// Line 961: Calling API without responseId
const uploadResult = await apiService.uploadAudioFile(
  audioPath, sessionId, surveyId
  // ❌ Missing: responseId
);
```

**Backend Expectation**: The backend `uploadAudioFile` endpoint (line 1649-1694) expects `responseId` in `req.body.responseId` to link audio to existing response. Without it, audio uploads but is orphaned.

---

### 🔴 CRITICAL BUG #2: Audio Deleted Before Verification
**Location**: `/var/www/Opine-Android/src/services/syncService.ts` lines 146-153

**Problem**: 
- Audio files are deleted from local storage immediately after sync completes
- BUT: There's no verification that audio was actually uploaded and linked to the response
- If audio upload fails silently (network timeout, backend error, etc.), the interview is still marked as synced and audio is deleted

**Impact**: Once audio is deleted locally, it's permanently lost if it wasn't uploaded or linked correctly.

**Code Flow**:
```typescript
// Line 91: syncCapiInterview completes (might throw error if audio fails)
await this.syncCapiInterview(interview);

// Line 148-153: IMMEDIATELY delete interview and audio after sync
await offlineStorage.deleteSyncedInterview(interview.id);
if (interview.audioOfflinePath) {
  await offlineStorage.deleteAudioFileFromOfflineStorage(interview.audioOfflinePath); // ❌ Too early!
}
```

**What Should Happen**:
1. Complete interview → Get responseId
2. Upload audio → Verify audio URL is returned and saved in response
3. Verify on server → Fetch response and confirm audioUrl exists
4. THEN delete local files

---

### 🔴 CRITICAL BUG #3: No Sequential Progress Tracking
**Location**: `/var/www/Opine-Android/src/services/syncService.ts` lines 68-155

**Problem**:
- All interviews sync in a simple `for` loop
- No individual progress tracking per interview
- All appear to sync "instantly" because there's no UI feedback for each interview
- If one fails, others continue (good), but there's no retry queue system

**Impact**: User cannot see which interview is uploading, how much progress, or which one failed.

**What's Needed** (Like WhatsApp/Meta):
- Individual progress bars per interview (0-100%)
- Stage tracking: "Uploading data (50%)", "Uploading audio (90%)", "Verifying (100%)"
- Failed interviews go to retry queue
- Successfully synced interviews marked clearly

---

### 🔴 CRITICAL BUG #4: Audio Path Mismatch
**Error Messages Show**:
```
GET https://convo.convergentview.com/api/survey-responses/audio/%2Fuploads%2Faudio%2Finterview_offline_1767814627708_7qr8dhrf7_1767815200386.m4a 404 (Not Found)
```

**Problem**:
- Audio URLs are stored as local paths: `/uploads/audio/interview_offline_...`
- Backend expects either:
  - S3 keys (if S3 configured): `audio/interviews/2025/01/filename.m4a`
  - Signed URLs for S3 access
- The proxy endpoint `/api/survey-responses/audio/` tries to access local file system, but file doesn't exist

**Root Cause**:
- Backend `uploadAudioFile` (line 1646) generates path `/uploads/audio/${filename}`
- BUT: If S3 is configured, it should return S3 key, not local path
- OR: If local storage, file might have been moved/deleted after upload

---

## What Happened to Your 5 Interviews

1. **Interview Completed**: All 5 interviews were successfully created in database with `responseId`
2. **Audio Upload Attempted**: Audio files were uploaded, BUT:
   - `responseId` was NOT passed (Bug #1)
   - Audio was uploaded but NOT linked to response (orphaned in S3/local storage)
   - OR: Audio upload failed but error was swallowed
3. **Marked as Synced**: Because `syncCapiInterview` completed without throwing (audio upload "succeeded" but didn't link)
4. **Audio Deleted**: Local audio files deleted immediately (Bug #2)
5. **Result**: Interviews exist on server without audio, and local audio is gone forever

---

## Solution Plan

### Phase 1: Immediate Fixes (Prevent Future Loss)

1. **Fix `responseId` Parameter Passing**
   - Add `responseId` parameter to `uploadAudioWithRetry` signature
   - Pass `responseId` to `apiService.uploadAudioFile`
   - Verify backend receives and uses `responseId`

2. **Add Audio Upload Verification**
   - After audio upload, fetch the response from server
   - Verify `audioUrl` exists in response
   - Only then mark as synced and delete local files

3. **Improve Error Handling**
   - If audio upload fails, DO NOT mark interview as synced
   - Keep interview in "syncing" status with error
   - Retry on next sync attempt

### Phase 2: Data Recovery (Recover Lost Audio)

1. **Check S3 Storage**
   - Search S3 for orphaned audio files (uploaded but not linked)
   - Match by filename pattern: `interview_offline_*.m4a`
   - Link to responses if `responseId` can be extracted from filename or timestamp

2. **Check Local Server Storage**
   - Check if audio files still exist in `/var/www/opine/uploads/audio/`
   - If found, link to responses manually

3. **User Recovery Option**
   - If audio is completely lost, allow user to re-record audio (if still possible)

### Phase 3: WhatsApp-Style Sync System

1. **Individual Progress Tracking**
   - Add `syncProgress` (0-100) and `syncStage` to `OfflineInterview`
   - Update progress in real-time during sync
   - Display in UI with individual progress bars

2. **Retry Queue System**
   - Failed interviews go to "failed" status
   - Separate retry queue that processes failures
   - Exponential backoff with max retries

3. **Verification System**
   - After sync, verify response exists on server
   - Verify audio URL is accessible
   - Only then delete local files

---

## Implementation Priority

**CRITICAL (Do Now)**:
1. ✅ Fix `responseId` parameter passing
2. ✅ Add audio upload verification before deletion
3. ✅ Prevent deletion if audio upload fails

**HIGH (Do Soon)**:
4. ✅ Add sequential progress tracking per interview
5. ✅ Improve error messages and retry logic
6. ✅ Fix audio path handling (S3 vs local)

**MEDIUM (Do Later)**:
7. Data recovery for lost audio (if possible)
8. Enhanced UI with individual progress bars
9. Retry queue management

---

## Expected Behavior (After Fixes)

**Correct Flow**:
1. User clicks "Sync Offline Interviews"
2. For each interview:
   - Progress: "Uploading data... (0%)"
   - Complete interview → Get responseId
   - Progress: "Uploading audio... (50%)"
   - Upload audio with responseId → Get audioUrl
   - Progress: "Verifying... (90%)"
   - Verify response has audioUrl on server
   - Progress: "Complete (100%)"
   - Delete local files
3. If any step fails:
   - Keep interview in local storage
   - Show error message
   - Allow manual retry

---

## Questions to Answer

1. **Is S3 configured?** Check `AWS_ACCESS_KEY_ID` in backend `.env`
2. **Where are the audio files?** Check S3 bucket and local `/uploads/audio/` directory
3. **Can we recover?** If files exist in S3/local, we can link them to responses

---

## Testing Checklist

After fixes:
- [ ] Create offline interview with audio
- [ ] Sync interview
- [ ] Verify audio URL is in response on server
- [ ] Verify audio file is accessible
- [ ] Verify local files are deleted ONLY after verification
- [ ] Test failure case: Disconnect network during audio upload
- [ ] Verify interview remains in local storage if audio fails
- [ ] Test retry: Reconnect and sync again

---

**Status**: 🔴 CRITICAL - Audio loss confirmed for 5 interviews
**Next Step**: Implement Phase 1 fixes immediately



