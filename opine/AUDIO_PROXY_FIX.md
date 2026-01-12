# Audio Proxy Fix - Debugging

## Issue
Audio not loading in Response Details Modal. URL shows:
`/api/survey-responses/audio/audio%2Finterviews%2F2026%2F01%2F...`

## Changes Made

### 1. Added Logging to `streamAudioProxy`
- Logs request URL, params, and query
- Logs decoded audioUrl
- Better error handling

### 2. Added Logging to `streamAudioFromS3`
- Logs received audioUrl
- Logs extracted S3 key
- Logs S3 headObject results
- Better error messages

## Testing
1. Open Response Details Modal
2. Check browser console for audio errors
3. Check backend logs: `pm2 logs opine-backend`
4. Look for:
   - `🔍 streamAudioProxy - Request received`
   - `🔍 streamAudioFromS3 - Received audioUrl`
   - `✅ streamAudioFromS3 - S3 object found`

## Expected Behavior
- Express should automatically decode URL parameters
- `audioUrl` should be `audio/interviews/2026/01/...` (decoded)
- `extractS3Key` should return the same value (it's already an S3 key)
- S3 headObject should find the file

