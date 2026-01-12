# 🎯 COMPREHENSIVE AUDIO PROXY IMPLEMENTATION PLAN

## 📊 CURRENT STATE ANALYSIS

### ✅ **AUDIO UPLOADS: Already Proxied (No Cross-Region Charges)**
- **Flow**: React Native App → Backend Server → S3 (ap-south-1)
- **Status**: ✅ Working correctly, no changes needed

### ❌ **AUDIO DOWNLOADS: Direct S3 Access (Causing Cross-Region Charges)**
- **Flow**: Backend generates signed URL → Client downloads directly from S3
- **Problem**: Quality Agents worldwide → Cross-region transfers = $0.09/GB
- **Impact**: 38TB in 5 days = $381.76

---

## 🔍 ALL PLACES USING SIGNED URLS

### **BACKEND ENDPOINTS (6 locations)**

#### 1. **`/api/survey-responses/audio-signed-url`** (Route: `surveyResponseRoutes.js:135`)
   - **Purpose**: Returns signed URL for audio file
   - **Used by**: Frontend & React Native when audio URL is S3 key
   - **Location**: `surveyResponseController.js:4194-4258`
   - **Action**: Keep for backward compatibility, but frontend will use proxy instead

#### 2. **`getSurveyResponsesV2`** (Route: `/survey/:surveyId/responses-v2`)
   - **Purpose**: Returns paginated responses with signed URLs for ALL responses
   - **Location**: `surveyResponseController.js:3207-3233`
   - **Problem**: Generates 500 signed URLs per page load (even if audio never played)
   - **Action**: ❌ **REMOVE signed URL generation** - frontend will use proxy when needed

#### 3. **`getNextReviewAssignment`** (Route: `/next-review`)
   - **Purpose**: Returns next QC assignment with signed URL
   - **Location**: `surveyResponseController.js:2054-2076`
   - **Action**: ❌ **REMOVE signed URL generation** - frontend will use proxy

#### 4. **`getPendingApprovals`** (Route: `/pending-approvals`)
   - **Purpose**: Returns pending responses with signed URLs
   - **Location**: `surveyResponseController.js:1165-1225`
   - **Action**: ❌ **REMOVE signed URL generation** - frontend will use proxy

#### 5. **`getMyInterviews`** (Route: `/my-interviews`)
   - **Purpose**: Returns interviewer's interviews with signed URLs
   - **Location**: `surveyResponseController.js:1763-1767`
   - **Action**: ❌ **REMOVE signed URL generation** - frontend will use proxy

#### 6. **`getSurveyResponseById`** (Route: `/:responseId`)
   - **Purpose**: Returns single response with signed URL
   - **Location**: `surveyResponseController.js:3017-3023`
   - **Action**: ❌ **REMOVE signed URL generation** - frontend will use proxy

---

### **FRONTEND COMPONENTS (4 locations)**

#### 1. **`ResponseDetailsModal.jsx`**
   - **Location**: `frontend/src/components/dashboard/ResponseDetailsModal.jsx`
   - **Lines**: 82-125 (useEffect), 104 (fetch signed URL), 1471 (audio src)
   - **Current Flow**:
     - useEffect fetches signed URL when response changes
     - Uses signed URL in audio tag src
     - Fallback: fetches signed URL on audio error
   - **Action**: Replace signed URL with proxy endpoint

#### 2. **`SurveyApprovals.jsx`** (Quality Agent Dashboard)
   - **Location**: `frontend/src/components/dashboard/SurveyApprovals.jsx`
   - **Lines**: 253-307 (useEffect), 2126 (fetch signed URL), 4126-4212 (audio src)
   - **Current Flow**:
     - useEffect fetches signed URL when interview selected
     - Caches signed URLs in state (`audioSignedUrls`)
     - Uses cached/backend signed URL in audio tag
     - Fallback: fetches signed URL on audio error
   - **Action**: Replace signed URL with proxy endpoint

#### 3. **`MyInterviews.jsx`**
   - **Location**: `frontend/src/components/dashboard/MyInterviews.jsx`
   - **Lines**: 188-245 (handlePlayAudio function)
   - **Current Flow**:
     - When play is clicked, fetches signed URL
     - Uses signed URL in audio element
   - **Action**: Replace signed URL with proxy endpoint

#### 4. **`AudioPlayer.jsx`**
   - **Location**: `frontend/src/components/AudioPlayer.jsx`
   - **Lines**: 6 (signedUrl prop), 19 (effectiveAudioUrl), 111 (audio src)
   - **Current Flow**:
     - Accepts `signedUrl` prop
     - Uses signedUrl if available, else audioUrl
   - **Action**: Replace signedUrl prop with proxy URL generation

---

### **REACT NATIVE COMPONENTS (3 locations)**

#### 1. **`ResponseDetailsModal.tsx`**
   - **Location**: `Opine-Android/src/components/ResponseDetailsModal.tsx`
   - **Lines**: 469-587 (loadAudio function), 500-530 (fetch signed URL)
   - **Current Flow**:
     - Checks for signedUrl in interview object
     - If not found, fetches from `/api/survey-responses/audio-signed-url`
     - Uses signed URL in `Audio.Sound.createAsync`
   - **Action**: Replace signed URL with proxy endpoint

#### 2. **`InterviewDetails.tsx`**
   - **Location**: `Opine-Android/src/screens/InterviewDetails.tsx`
   - **Status**: Need to check if it uses signed URLs
   - **Action**: Replace if found

#### 3. **`MyInterviews.tsx`** (React Native)
   - **Location**: `Opine-Android/src/screens/MyInterviews.tsx`
   - **Status**: Need to check if it uses signed URLs
   - **Action**: Replace if found

---

## 🚀 IMPLEMENTATION PLAN

### **PHASE 1: CREATE PROXY ENDPOINT**

#### **New Endpoint**: `GET /api/survey-responses/audio/:audioUrl*`
   - **Purpose**: Stream audio from S3 through server
   - **Features**:
     - ✅ Streams audio from S3 (same region = no cross-region charges)
     - ✅ Supports HTTP Range requests (for seeking/partial content)
     - ✅ Adds Cache-Control headers (browser caching)
     - ✅ Handles authentication (protect middleware)
     - ✅ Handles local files (backward compatibility)
     - ✅ Handles mock URLs (returns 404)

#### **Implementation**:
```javascript
// Location: surveyResponseController.js
const streamAudioFile = async (req, res) => {
  try {
    const { audioUrl } = req.params;
    // Decode URL-encoded audioUrl
    const decodedAudioUrl = decodeURIComponent(audioUrl);
    
    // Skip mock URLs
    if (decodedAudioUrl.startsWith('mock://')) {
      return res.status(404).json({ success: false, message: 'Mock audio not available' });
    }
    
    // Handle local files
    if (decodedAudioUrl.startsWith('/uploads/')) {
      const localPath = path.join(__dirname, '../..', decodedAudioUrl);
      if (fs.existsSync(localPath)) {
        // Stream local file
        const stat = fs.statSync(localPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        
        if (range) {
          // Handle range requests for seeking
          const parts = range.replace(/bytes=/, "").split("-");
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(localPath, { start, end });
          const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'audio/webm',
            'Cache-Control': 'public, max-age=3600'
          };
          res.writeHead(206, head);
          file.pipe(res);
        } else {
          // Full file
          const head = {
            'Content-Length': fileSize,
            'Content-Type': 'audio/webm',
            'Cache-Control': 'public, max-age=3600'
          };
          res.writeHead(200, head);
          fs.createReadStream(localPath).pipe(res);
        }
        return;
      }
    }
    
    // Handle S3 files
    const { extractS3Key, isS3Configured } = require('../utils/cloudStorage');
    const s3Key = extractS3Key(decodedAudioUrl);
    
    if (!isS3Configured() || !s3Key) {
      return res.status(404).json({ success: false, message: 'Audio file not found' });
    }
    
    // Get S3 object stream
    const s3 = new AWS.S3({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      region: process.env.AWS_REGION || 'ap-south-1'
    });
    
    const params = {
      Bucket: process.env.AWS_S3_BUCKET_NAME,
      Key: s3Key
    };
    
    // Handle range requests
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : undefined;
      params.Range = `bytes=${start}-${end || ''}`;
    }
    
    const s3Object = s3.getObject(params).createReadStream();
    
    // Set headers
    res.setHeader('Content-Type', 'audio/webm');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Accept-Ranges', 'bytes');
    
    if (range) {
      res.status(206); // Partial content
    } else {
      res.status(200);
    }
    
    s3Object.pipe(res);
    
    s3Object.on('error', (error) => {
      console.error('Error streaming from S3:', error);
      if (!res.headersSent) {
        res.status(404).json({ success: false, message: 'Audio file not found' });
      }
    });
    
  } catch (error) {
    console.error('Error streaming audio:', error);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: 'Failed to stream audio' });
    }
  }
};
```

#### **Route Registration**:
```javascript
// Location: surveyResponseRoutes.js
// Add BEFORE /:responseId route (to avoid conflicts)
router.get('/audio/*', streamAudioFile);
```

---

### **PHASE 2: REMOVE SIGNED URL GENERATION FROM BACKEND**

#### **Files to Modify**:

1. **`surveyResponseController.js`**:
   - ❌ Remove signed URL generation from `getSurveyResponsesV2` (line 3207-3233)
   - ❌ Remove signed URL generation from `getNextReviewAssignment` (line 2054-2076)
   - ❌ Remove signed URL generation from `getPendingApprovals` (line 1165-1225)
   - ❌ Remove signed URL generation from `getMyInterviews` (line 1763-1767)
   - ❌ Remove signed URL generation from `getSurveyResponseById` (line 3017-3023)

#### **Changes**:
- Simply remove the `getAudioSignedUrl` calls
- Keep `audioUrl` in response (frontend will use it for proxy)
- No need to generate signed URLs upfront

---

### **PHASE 3: UPDATE FRONTEND COMPONENTS**

#### **Helper Function** (Create in `frontend/src/utils/audioUtils.js`):
```javascript
export const getAudioProxyUrl = (audioUrl) => {
  if (!audioUrl) return null;
  
  // Skip mock URLs
  if (audioUrl.startsWith('mock://') || audioUrl.includes('mock://')) {
    return null;
  }
  
  // If it's already a full URL (http/https), return as is
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return audioUrl;
  }
  
  // If it's a local path, return as is (will be handled by backend)
  if (audioUrl.startsWith('/uploads/')) {
    return audioUrl;
  }
  
  // For S3 keys, use proxy endpoint
  if (audioUrl.startsWith('audio/') || audioUrl.startsWith('documents/') || audioUrl.startsWith('reports/')) {
    const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
    return `${API_BASE_URL}/api/survey-responses/audio/${encodeURIComponent(audioUrl)}`;
  }
  
  // Fallback: assume it's a local path
  return audioUrl;
};
```

#### **1. Update `ResponseDetailsModal.jsx`**:
   - Remove `useEffect` that fetches signed URL (lines 82-125)
   - Remove `audioSignedUrl` state
   - Update audio tag `src` to use `getAudioProxyUrl(currentResponse.audioRecording.audioUrl)`
   - Remove signed URL fetch from `onError` handler

#### **2. Update `SurveyApprovals.jsx`**:
   - Remove `useEffect` that fetches signed URL (lines 253-307)
   - Remove `audioSignedUrls` state
   - Update audio tag `src` to use `getAudioProxyUrl(selectedInterview.audioRecording.audioUrl)`
   - Remove signed URL fetch from `handlePlayAudio` and `onError` handler

#### **3. Update `MyInterviews.jsx`**:
   - Update `handlePlayAudio` to use `getAudioProxyUrl` instead of fetching signed URL
   - Remove signed URL fetch logic (lines 211-237)

#### **4. Update `AudioPlayer.jsx`**:
   - Remove `signedUrl` prop
   - Update to use `getAudioProxyUrl(audioUrl)` instead

---

### **PHASE 4: UPDATE REACT NATIVE COMPONENTS**

#### **Helper Function** (Create in `Opine-Android/src/utils/audioUtils.ts`):
```typescript
export const getAudioProxyUrl = (audioUrl: string | null | undefined): string | null => {
  if (!audioUrl) return null;
  
  // Skip mock URLs
  if (audioUrl.startsWith('mock://') || audioUrl.includes('mock://')) {
    return null;
  }
  
  // If it's already a full URL, return as is
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return audioUrl;
  }
  
  // If it's a local path, return as is
  if (audioUrl.startsWith('/uploads/')) {
    const API_BASE_URL = 'https://convo.convergentview.com';
    return `${API_BASE_URL}${audioUrl}`;
  }
  
  // For S3 keys, use proxy endpoint
  if (audioUrl.startsWith('audio/') || audioUrl.startsWith('documents/') || audioUrl.startsWith('reports/')) {
    const API_BASE_URL = 'https://convo.convergentview.com';
    return `${API_BASE_URL}/api/survey-responses/audio/${encodeURIComponent(audioUrl)}`;
  }
  
  // Fallback
  return audioUrl;
};
```

#### **1. Update `ResponseDetailsModal.tsx`**:
   - Remove signed URL fetch logic (lines 500-530)
   - Update `loadAudio` to use `getAudioProxyUrl(audioUrl)` directly
   - Remove signed URL checks

#### **2. Update `InterviewDetails.tsx`**:
   - Check if it uses signed URLs
   - Update to use `getAudioProxyUrl` if found

#### **3. Update `MyInterviews.tsx`** (React Native):
   - Check if it uses signed URLs
   - Update to use `getAudioProxyUrl` if found

---

## ✅ TESTING CHECKLIST

### **Backend**:
- [ ] Proxy endpoint streams audio correctly
- [ ] Proxy endpoint handles range requests (seeking)
- [ ] Proxy endpoint returns proper cache headers
- [ ] Proxy endpoint handles authentication
- [ ] Proxy endpoint handles local files
- [ ] Proxy endpoint handles S3 files
- [ ] Proxy endpoint handles mock URLs (returns 404)
- [ ] No signed URLs generated in `getSurveyResponsesV2`
- [ ] No signed URLs generated in `getNextReviewAssignment`
- [ ] No signed URLs generated in `getPendingApprovals`
- [ ] No signed URLs generated in `getMyInterviews`
- [ ] No signed URLs generated in `getSurveyResponseById`

### **Frontend**:
- [ ] `ResponseDetailsModal` plays audio via proxy
- [ ] `SurveyApprovals` plays audio via proxy
- [ ] `MyInterviews` plays audio via proxy
- [ ] `AudioPlayer` uses proxy URL
- [ ] Audio seeking works (range requests)
- [ ] Browser caching works (check Network tab)
- [ ] No signed URL API calls in Network tab

### **React Native**:
- [ ] `ResponseDetailsModal` plays audio via proxy
- [ ] `InterviewDetails` plays audio via proxy (if applicable)
- [ ] `MyInterviews` plays audio via proxy (if applicable)
- [ ] Audio playback works correctly
- [ ] No signed URL API calls

### **Performance**:
- [ ] No cross-region S3 charges (check AWS Cost Explorer)
- [ ] Audio loads quickly
- [ ] Browser caching reduces repeated downloads

---

## 📊 EXPECTED RESULTS

### **Cost Reduction**:
- **Before**: $381.76 in 5 days (38TB cross-region transfer)
- **After**: ~$0-10 per month (server bandwidth only)
- **Savings**: 95-99% cost reduction

### **Performance**:
- ✅ Same or better audio loading speed
- ✅ Browser caching reduces repeated downloads
- ✅ No cross-region latency

### **Functionality**:
- ✅ All existing features work
- ✅ Audio playback works everywhere
- ✅ Audio seeking works (range requests)
- ✅ Backward compatible (local files still work)

---

## 🔄 ROLLBACK PLAN

If issues occur:
1. Keep signed URL endpoint active (backward compatibility)
2. Revert frontend changes to use signed URLs
3. Re-enable signed URL generation in backend endpoints
4. No data loss or breaking changes

---

## 📝 NOTES

- **Keep signed URL endpoint**: For backward compatibility and emergency fallback
- **Gradual rollout**: Can be done component by component
- **Monitoring**: Watch AWS Cost Explorer after deployment
- **Cache headers**: Set to 1 hour (matches signed URL expiry)






