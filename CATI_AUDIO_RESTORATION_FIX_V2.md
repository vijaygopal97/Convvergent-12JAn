# CATI Audio Restoration Fix - Version 2 (Complete Fix)

## Problem
When Quality Agent locks the screen and unlocks, the CATI recording disappears and shows "No Recording Available" even though it was already downloaded.

## Root Cause Analysis

The issue was in the `useEffect` hook that runs when the modal opens or interview changes:

1. **State Reset on Re-render**: When the app comes back from background, React Native re-renders the component, causing the `useEffect` to run again
2. **Unconditional Reset**: The useEffect was resetting `catiRecordingUri` and `catiCallDetails` every time, even for the same interview
3. **Missing Call ID Tracking**: No way to verify if the stored URI belongs to the current interview

## Solution Implemented

### 1. Added Call ID Tracking
- **New Ref**: `catiRecordingUriCallIdRef` stores the `call_id` associated with the current `catiRecordingUri`
- **Purpose**: Verify that the stored URI belongs to the current interview before using it

### 2. Smart State Preservation
- **Interview Change Detection**: Only reset state when `call_id` actually changes
- **Same Interview**: Preserve `catiRecordingUri` and `catiCallDetails` when viewing the same interview again
- **Logging**: Added detailed logs to track state preservation

### 3. Enhanced Restoration Logic
- **Modal Opening**: Checks for existing local file and restores it automatically
- **AppState Listener**: Verifies call_id match before restoring
- **Call Details Fetch**: Always fetches call details if missing (even if URI exists) to ensure UI displays properly

### 4. Updated UI Condition
- **Before**: Only checked `catiCallDetails?.recordingUrl`
- **After**: Checks `catiCallDetails?.recordingUrl` OR `catiCallDetails?.s3AudioUrl` OR `catiRecordingUri`
- **Result**: Recording section shows even if `catiCallDetails` is null but `catiRecordingUri` exists

## Key Changes

### 1. Call ID Tracking Ref
```typescript
const catiRecordingUriCallIdRef = useRef<string | null>(null);
```

### 2. Smart State Management in useEffect
```typescript
const currentCallId = interview.call_id;
const isNewInterview = catiRecordingUriCallIdRef.current !== currentCallId;

if (isNewInterview) {
  // Reset state for new interview
  cleanupCatiAudio();
  setCatiCallDetails(null);
  if (catiRecordingUriCallIdRef.current !== currentCallId) {
    setCatiRecordingUri(null);
  }
  catiRecordingUriCallIdRef.current = currentCallId;
} else {
  // Same interview - preserve state
  // Only stop playback, don't reset state
  if (catiAudioSoundRef.current) {
    stopCatiAudio();
  }
}
```

### 3. Store Call ID When Loading Audio
```typescript
setCatiRecordingUri(audioUri);
if (interview?.call_id) {
  catiRecordingUriCallIdRef.current = interview.call_id;
}
```

### 4. Verify Call ID in AppState Listener
```typescript
if (visible && interview?.interviewMode === 'cati' && catiRecordingUri && 
    catiRecordingUriCallIdRef.current === interview?.call_id) {
  // Restore audio
}
```

### 5. Always Fetch Call Details
Even if we have a local file, we still fetch call details to ensure the UI can display properly:
```typescript
// Always fetch call details for metadata (even if we have URI) to ensure UI shows properly
if (!catiCallDetails) {
  fetchCatiCallDetails(interview.call_id);
}
```

## Testing Scenarios

1. ✅ **Lock/Unlock Same Interview**: Recording should be preserved and restored
2. ✅ **Switch Interviews**: Previous recording should be cleared, new one should load
3. ✅ **Close/Reopen Modal**: Should check for existing local file
4. ✅ **File Deleted**: Should re-download when needed
5. ✅ **Component Re-render**: State should be preserved for same interview

## Files Modified
- `/var/www/Opine-Android/src/components/ResponseDetailsModal.tsx`

## Debugging Logs Added
- `🔄 Interview changed` - When interview changes
- `✅ Same interview - preserving audio state` - When same interview detected
- `💾 Stored catiRecordingUri for call_id` - When URI is stored
- `🔍 AppState restoration check` - When checking if restoration is possible
- `🔄 Found existing local CATI audio file` - When local file is found

