# Audio Proxy Status

## ✅ What's Working
1. **Frontend**: Correctly constructs proxy URLs
   - URL: `/api/survey-responses/audio/audio%2Finterviews%2F2026%2F01%2F...`
   - This is the CORRECT proxy URL (not direct S3 URL)

2. **Backend**: Path extraction logic is implemented
   - Extracts from `req.originalUrl`
   - Decodes URL-encoded paths
   - Should extract S3 key: `audio/interviews/2026/01/...`

## 🔍 Debugging Steps

### 1. Check Browser Console
- Open Developer Tools (F12)
- Go to Console tab
- Look for errors when playing audio
- Look for network errors

### 2. Check Network Tab
- Open Developer Tools (F12)
- Go to Network tab
- Try to play audio
- Find the request to `/api/survey-responses/audio/...`
- Check:
  - Status code (should be 200)
  - Response headers
  - Response body (should be audio data)

### 3. Check Backend Logs
```bash
pm2 logs opine-backend | grep streamAudioProxy
```

Look for:
- `🔍 streamAudioProxy - Request received`
- `🔍 streamAudioFromS3 - Received audioUrl`
- `🔍 streamAudioFromS3 - Extracted S3 key`
- Any error messages

### 4. Common Issues

**Issue: 404 Not Found**
- Backend can't find the S3 key
- Check if S3 key is correctly extracted

**Issue: 500 Internal Server Error**
- S3 streaming error
- Check AWS credentials
- Check S3 bucket permissions

**Issue: Audio doesn't play**
- Check Content-Type header (should be audio/mpeg or audio/mp4)
- Check if Range requests are supported
- Check browser console for CORS errors

## Expected Flow

1. Browser requests: `/api/survey-responses/audio/audio%2Finterviews%2F2026%2F01%2F...`
2. Backend extracts: `audio/interviews/2026/01/...` (S3 key)
3. Backend streams from S3 using this key
4. Browser receives audio data and plays it

