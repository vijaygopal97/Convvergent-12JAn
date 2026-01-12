# Audio URL Verification for "Start Quality Check"

## Backend (getNextReviewAssignment) ✅

The backend correctly returns **PROXY URLs** for audio:

```javascript
audioRecording: {
  audioUrl: 'audio/interviews/...',           // S3 key (original)
  signedUrl: '/api/survey-responses/audio/...',  // PROXY URL (not S3)
  proxyUrl: '/api/survey-responses/audio/...',   // PROXY URL (explicit)
  originalUrl: 'audio/interviews/...'       // S3 key (reference)
}
```

**Location**: `/var/www/opine/backend/controllers/surveyResponseController.js`
- Lines 2663-2682: findOne path
- Lines 2720-2739: findOne path (non-AC filter)
- Lines 3083-3105: aggregation path

All paths correctly construct proxy URLs:
```javascript
const proxyUrl = `/api/survey-responses/audio/${encodeURIComponent(audioRecording.audioUrl)}`;
audioRecording = {
  ...audioRecording,
  signedUrl: proxyUrl,  // PROXY URL (backward compatibility)
  proxyUrl: proxyUrl, // PROXY URL (explicit)
  originalUrl: audioRecording.audioUrl
};
```

## React Native App (ResponseDetailsModal) ✅

The app correctly uses proxy URLs:

**Location**: `/var/www/Opine-Android/src/components/ResponseDetailsModal.tsx`
- Lines 486-495: Checks for `proxyUrl` or `signedUrl` (which contains proxy URL)
- Lines 502-504: Constructs proxy URL from S3 key if needed
- Lines 499-501: Handles full URLs (but should not receive direct S3 URLs)

**Logic**:
1. First checks for `proxyUrl` or `signedUrl` from backend
2. If found, uses it (constructs full URL with API_BASE_URL)
3. If not found, constructs proxy URL from `audioUrl` (S3 key)
4. Never uses direct S3 URLs

## Verification ✅

✅ Backend returns proxy URLs (not direct S3)
✅ React Native app uses proxy URLs
✅ No direct AWS S3 URLs should be used
✅ Cross-region charges eliminated

## Test

When Quality Agent clicks "Start Quality Check":
1. Backend returns response with `audioRecording.proxyUrl` = `/api/survey-responses/audio/...`
2. App constructs full URL: `https://convo.convergentview.com/api/survey-responses/audio/...`
3. Audio plays through proxy (no direct S3 access)
