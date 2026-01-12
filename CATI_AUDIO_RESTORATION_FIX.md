# CATI Audio Restoration Fix - Implementation Summary

## Problem
When the Quality Agent locks the screen and comes back, the CATI recording shows "No Recording Available" even though it was already downloaded. The recording was not being restored from the local file.

## Root Causes
1. **AppState listener** was calling `cleanupCatiAudio()` which reset all state including `catiRecordingUri`
2. **UI condition** only checked `catiCallDetails?.recordingUrl`, not the downloaded local file (`catiRecordingUri`)
3. **No restoration logic** when app comes back to foreground

## Solution Implemented

### 1. Created `stopCatiAudio()` function
- **Purpose**: Stop audio playback only, preserve state for restoration
- **Behavior**: Only stops and unloads audio, keeps `catiRecordingUri` and `catiCallDetails`
- **Used by**: AppState listener when app goes to background

### 2. Modified AppState listener
- **Background**: Calls `stopCatiAudio()` instead of `cleanupCatiAudio()` to preserve state
- **Foreground**: Automatically restores audio from local file if:
  - Modal is still visible
  - Interview is still CATI mode
  - `catiRecordingUri` exists
  - Local file still exists on disk

### 3. Updated UI condition
- **Before**: Only checked `catiCallDetails?.recordingUrl`
- **After**: Checks `catiCallDetails?.recordingUrl` OR `catiCallDetails?.s3AudioUrl` OR `catiRecordingUri`
- **Result**: Recording section shows even if only local file exists

### 4. Added restoration button
- **When**: Recording section visible but audio not loaded
- **Behavior**: 
  - If local file exists: Reloads from local file (no re-download)
  - If local file missing: Re-downloads from server
- **Text**: Shows "Recording ready - tap to load" or "Recording available - tap to download"

### 5. Enhanced modal opening logic
- **Check**: When modal opens, checks if local file already exists
- **Action**: If file exists and audio not loaded, automatically restores it
- **Fallback**: If file doesn't exist, fetches fresh from server

### 6. Wrapped `loadCatiAudio` in `useCallback`
- **Purpose**: Make function stable for AppState listener dependencies
- **Dependencies**: `catiPlaybackRate`, `catiIsSeeking`

## Benefits
1. ✅ **No data waste**: Audio is restored from local file, not re-downloaded
2. ✅ **Better UX**: Recording persists across app state changes
3. ✅ **Standard behavior**: Matches how modern apps handle downloaded content
4. ✅ **Automatic restoration**: Works seamlessly when app comes back to foreground
5. ✅ **Manual fallback**: User can manually reload if needed

## Testing Checklist
- [ ] Lock screen while recording is loaded → Unlock → Recording should be restored
- [ ] Lock screen while recording is downloading → Unlock → Download should continue
- [ ] Switch to different interview → Previous recording should be cleared
- [ ] Close modal and reopen → Should check for existing local file
- [ ] Delete local file manually → Should re-download when needed
- [ ] Background app for long time → File should still be restored if it exists

## Files Modified
- `/var/www/Opine-Android/src/components/ResponseDetailsModal.tsx`

## Key Changes
1. Added `stopCatiAudio()` function (lines ~138-158)
2. Modified AppState listener (lines ~237-270)
3. Updated UI condition (line ~2236)
4. Added restoration button UI (lines ~2347-2382)
5. Enhanced modal opening logic (lines ~222-245)
6. Wrapped `loadCatiAudio` in `useCallback` (line ~420)

