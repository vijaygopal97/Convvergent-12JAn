# Audio Proxy Debugging

## Issue
Audio not playing - URL is `/api/survey-responses/audio/audio%2Finterviews%2F...`

## Expected Flow
1. Frontend constructs: `/api/survey-responses/audio/${encodeURIComponent('audio/interviews/...')}`
2. URL becomes: `/api/survey-responses/audio/audio%2Finterviews%2F...`
3. Backend extracts: `audio/interviews/...` (S3 key)
4. Backend streams from S3 using this key

## Current Problem
Backend logs show: `path: '/audio/audio/interviews/...'`

This means Express is decoding the URL, so:
- Original: `/api/survey-responses/audio/audio%2Finterviews%2F...`
- Express decodes to: `/api/survey-responses/audio/audio/interviews/...`
- req.path (relative to route): `/audio/audio/interviews/...`

## Fix Applied
1. Extract from `req.originalUrl` first (before Express processing)
2. Match pattern: `/audio/(.+)$` to get everything after `/audio/`
3. Decode the result to get S3 key: `audio/interviews/...`

## Testing
Check backend logs for:
- `🔍 streamAudioProxy - Request received`
- `🔍 streamAudioFromS3 - Received audioUrl`
- Should see S3 key: `audio/interviews/2026/01/...`

