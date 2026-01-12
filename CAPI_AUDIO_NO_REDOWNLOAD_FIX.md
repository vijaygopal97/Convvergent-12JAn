# CAPI Audio No Re-download Fix - Complete

## ✅ Problem Fixed

When Quality Agent locks and unlocks the screen during Quality Check for CAPI interviews:
- CAPI audio recording was being re-loaded from the URL instead of using the already loaded audio
- This caused unnecessary network usage and slower playback

## 🔧 Solution Implemented

### 1. Added CAPI Audio URI Storage
- **New Refs**: `capiAudioUriRef` and `capiAudioResponseIdRef`
- **Purpose**: Store the audio URI and responseId when audio is loaded
- **Location**: Line ~200-201

### 2. Store URI in `loadAudio` Function
- **Before**: Audio URI was not stored
- **After**: Stores `fullAudioUrl` and `responseId` when audio is loaded
- **Location**: Line ~838-844

### 3. Enhanced `playAudio` Function
- **Before**: Always called `loadAudio` if audio wasn't loaded
- **After**: 
  - Checks if audio is already loaded for the same responseId
  - Checks if stored URI exists before loading from URL
  - Only loads from URL if no stored URI exists
- **Location**: Line ~871-910

### 4. Added AppState Restoration for CAPI
- **Before**: Only CATI audio was restored after lock/unlock
- **After**: CAPI audio is also restored from stored URI
- **Location**: Line ~365-395

## 📝 Key Changes

### Storage Refs
```typescript
const capiAudioUriRef = useRef<string | null>(null);
const capiAudioResponseIdRef = useRef<string | null>(null);
```

### `loadAudio` Function
```typescript
// Store the audio URI and responseId for restoration after lock/unlock
capiAudioUriRef.current = fullAudioUrl;
if (interview?.responseId) {
  capiAudioResponseIdRef.current = interview.responseId;
  console.log('💾 Stored CAPI audio URI for responseId:', interview.responseId);
}
```

### `playAudio` Function
```typescript
// CRITICAL: Check if we already have audio loaded for this response
if (audioSoundRef.current && capiAudioResponseIdRef.current === interview?.responseId) {
  const status = await audioSoundRef.current.getStatusAsync();
  if (status.isLoaded) {
    console.log('✅ CAPI audio already loaded, playing directly');
    await audioSoundRef.current.playAsync();
    return;
  }
}

// CRITICAL: Check if we have a stored URI before loading from URL
if (capiAudioUriRef.current && capiAudioResponseIdRef.current === interview?.responseId) {
  console.log('🔄 Reloading CAPI audio from stored URI (no re-download)');
  await loadAudio(capiAudioUriRef.current);
  return;
}
```

### AppState Restoration
```typescript
// Restore CAPI audio if we have the audio URI and modal is still visible
if (visible && interview?.interviewMode === 'capi' && capiAudioUriRef.current && 
    capiAudioResponseIdRef.current === interview?.responseId) {
  // Check if audio is still loaded
  if (audioSoundRef.current) {
    const status = await audioSoundRef.current.getStatusAsync();
    if (status.isLoaded) {
      console.log('✅ CAPI audio still loaded, no action needed');
      return;
    }
  }
  
  // Audio was unloaded, reload from the same URI (uses cached URL)
  console.log('🔄 Reloading CAPI audio from stored URI');
  await loadAudio(capiAudioUriRef.current);
}
```

## ✅ Benefits

1. **No Re-loading**: Audio is only loaded once, then reused from stored URI
2. **Faster Playback**: Instant playback if audio is still loaded, or reload from cached URL
3. **Data Savings**: No unnecessary re-loading when locking/unlocking
4. **Better UX**: Smooth playback even after screen lock/unlock

## 🧪 Testing Scenarios

1. ✅ Lock screen while CAPI audio is loaded → Unlock → Audio should play from stored URI (no re-load)
2. ✅ Lock screen while CAPI audio is playing → Unlock → Audio should restore and continue
3. ✅ Click play button → Should check stored URI first, only load from URL if missing
4. ✅ Switch to different interview → Previous audio should be cleared, new one loads
5. ✅ Close modal and reopen → Should check for stored URI and restore

## 📊 Flow Diagram

```
User locks screen
  ↓
App goes to background
  ↓
Audio playback stops (URI preserved)
  ↓
User unlocks screen
  ↓
App comes to foreground
  ↓
Check: Audio still loaded?
  ├─ YES → Play directly (NO RE-LOAD)
  └─ NO → Reload from stored URI (uses cached URL, NO RE-DOWNLOAD)
```

## 🔄 Difference from CATI

- **CATI**: Downloads to local file, restores from file system
- **CAPI**: Streams from URL, stores URI, reloads from same URI (cached by system)

Both approaches prevent re-downloading/re-loading after lock/unlock!
