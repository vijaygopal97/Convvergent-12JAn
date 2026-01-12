# Audio Proxy Route Fix

## Issue
Express wildcard routes don't work as expected. The `*` pattern doesn't capture in `req.params[0]`.

## Solution
Changed route from `/audio/*` to `/audio/:audioPath(*)` which properly captures the entire path after `/audio/` in `req.params.audioPath`.

## Route Pattern
- **Before**: `router.get('/audio/*', streamAudioProxy)` - Doesn't capture properly
- **After**: `router.get('/audio/:audioPath(*)', streamAudioProxy)` - Captures in `req.params.audioPath`

## How It Works
1. URL: `/api/survey-responses/audio/audio%2Finterviews%2F2026%2F01%2F...`
2. Express matches `/audio/:audioPath(*)`
3. Express automatically decodes: `req.params.audioPath = "audio/interviews/2026/01/..."`
4. We use this directly as the S3 key

## Testing
1. Open Response Details Modal
2. Check browser network tab - should see request to `/api/survey-responses/audio/...`
3. Check backend logs for `🔍 streamAudioProxy - Request received`
4. Audio should load successfully

