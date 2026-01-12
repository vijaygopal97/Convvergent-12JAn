# CATI Audio Recording Migration - Problem Analysis & Solution Plan

## Current Situation

### Architecture
1. **CAPI Interviews:**
   - Audio recorded directly in React Native app
   - Uploaded to S3 during interview completion
   - Stored in `SurveyResponse.audioRecording.audioUrl` (S3 key format: `audio/interviews/YYYY/MM/...`)
   - Accessed via proxy endpoint: `/api/survey-responses/audio/:audioPath`

2. **CATI Interviews:**
   - Audio recorded by DeepCall service (third-party)
   - Recording URL received via webhook: `https://s-ct3.sarv.com/v2/recording/direct/...`
   - Stored in `CatiCall.recordingUrl` (DeepCall URL)
   - CATI responses have `call_id` linking to `CatiCall`
   - Audio accessed via: `/api/cati/recording/:callId` (downloads from DeepCall and streams)
   - **CATI responses do NOT have `audioRecording.audioUrl` in SurveyResponse**

### The Problem
- DeepCall deletes recordings after 2 months
- ~13K CATI calls already exist with DeepCall URLs
- Need to migrate all existing recordings to S3
- Need to automatically migrate future recordings
- Concern about S3 cross-region charges

## Solution Strategy

### Phase 1: Database Schema Updates
1. **Add S3 fields to CatiCall model:**
   - `s3AudioUrl` (String) - S3 key for migrated audio
   - `s3AudioUploadedAt` (Date) - When it was uploaded to S3
   - `s3AudioUploadStatus` (String) - 'pending', 'uploaded', 'failed'
   - Keep `recordingUrl` (DeepCall URL) for backward compatibility during migration

2. **Update SurveyResponse for CATI:**
   - Optionally populate `audioRecording.audioUrl` with S3 key for CATI responses
   - This allows CATI audio to use same proxy endpoint as CAPI

### Phase 2: Migration Script for Existing Recordings
1. **Batch Processing:**
   - Process in batches of 50-100 calls
   - Check if `s3AudioUrl` already exists (skip if migrated)
   - Check if DeepCall URL is still accessible (404 = already deleted)
   - Download from DeepCall (backend only - same region)
   - Upload to S3 with key: `audio/cati/YYYY/MM/callId_timestamp.mp3`
   - Update `CatiCall` with S3 key
   - Log progress and failures

2. **Cost Optimization:**
   - Download from DeepCall to server (same region as S3 = no cross-region)
   - Upload to S3 from server (same region = no cross-region)
   - Use streaming (don't load entire file in memory)
   - Process during off-peak hours
   - Add delays between batches to avoid rate limiting

3. **Error Handling:**
   - If DeepCall URL returns 404, mark as 'deleted' (can't migrate)
   - If download fails, retry 3 times with exponential backoff
   - If upload fails, log error and continue (can retry later)
   - Track migration status in database

### Phase 3: Automatic Migration for Future Calls
1. **Webhook Handler Update:**
   - When webhook receives `recordingUrl`, immediately:
     - Download from DeepCall (backend)
     - Upload to S3
     - Store S3 key in `CatiCall.s3AudioUrl`
     - Keep DeepCall URL in `recordingUrl` for reference

2. **Background Job (Alternative):**
   - If immediate upload fails, queue for background processing
   - Retry failed uploads periodically

### Phase 4: Audio Access Update
1. **Update `/api/cati/recording/:callId` endpoint:**
   - Check if `s3AudioUrl` exists
   - If yes: Use S3 proxy (same as CAPI)
   - If no: Fallback to DeepCall URL (backward compatibility)

2. **Update frontend/React Native:**
   - Use same audio proxy endpoint for CATI as CAPI
   - Construct URL: `/api/survey-responses/audio/:s3AudioUrl`

### Phase 5: Cleanup (After Migration Complete)
1. Remove DeepCall URL fallback logic
2. Remove `recordingUrl` field (optional - keep for audit)

## Cost Analysis

### Current (No Migration):
- DeepCall URLs expire after 2 months
- Lost recordings = lost data

### With Migration:
- **One-time migration:** ~13K recordings
  - Download from DeepCall: Free (same region)
  - Upload to S3: ~$0.023 per GB (PUT requests)
  - Storage: ~$0.023 per GB/month
  - Estimated: 13K calls × 5MB avg = 65GB = ~$1.50 upload + $1.50/month storage

- **Ongoing (Future calls):**
  - Same cost per call as above
  - Minimal impact (already paying for CAPI storage)

### Cross-Region Charges:
- **AVOIDED** by downloading to server first, then uploading to S3
- Server and S3 are in same region (ap-south-1)

## Implementation Considerations

### 1. Backward Compatibility
- Keep DeepCall URL fallback during migration
- Gradually migrate to S3-only access
- No breaking changes to existing functionality

### 2. Performance
- Use streaming for large files
- Batch processing to avoid overwhelming server
- Add rate limiting to avoid DeepCall API limits

### 3. Data Integrity
- Verify file size after download
- Verify upload success before updating database
- Keep audit trail of migration status

### 4. Error Recovery
- Track failed migrations
- Retry mechanism for failed uploads
- Manual intervention for problematic calls

## Recommended Approach

### Option A: Immediate Migration (Recommended)
1. Create migration script
2. Run in batches during off-peak hours
3. Update webhook to auto-migrate future calls
4. Update audio access to prefer S3

### Option B: Gradual Migration
1. Update webhook to auto-migrate new calls only
2. Migrate existing calls gradually (prioritize recent ones)
3. Eventually migrate all

### Option C: Hybrid
1. Auto-migrate new calls immediately
2. Migrate existing calls on-demand (when accessed)
3. Background job for bulk migration

## Risk Mitigation

1. **Data Loss:**
   - Keep DeepCall URL in database (backup)
   - Verify S3 upload before marking as migrated
   - Test with small batch first

2. **Cost:**
   - Monitor S3 usage during migration
   - Set up billing alerts
   - Use same region for all operations

3. **Functionality:**
   - Maintain backward compatibility
   - Test thoroughly before removing DeepCall fallback
   - Gradual rollout

## Next Steps

1. Review and approve solution approach
2. Implement database schema updates
3. Create migration script
4. Test with small batch (10-20 calls)
5. Run full migration
6. Update webhook handler
7. Update audio access endpoints
8. Monitor and verify

## Current Implementation Details (From ResponseDetailsModal)

### CATI Audio Access Flow:
1. **Frontend (ResponseDetailsModal.jsx):**
   - Detects CATI response: `currentResponse.interviewMode === 'cati'`
   - Extracts `call_id` from: `currentResponse.call_id` or `metadata.call_id`
   - Calls `catiAPI.getCallById(callId)` to fetch CatiCall details
   - Checks for `recordingUrl` in: `callResponse.data.recordingUrl` or `webhookData.recordingUrl`
   - If recording exists, calls: `/api/cati/recording/${recordingId}` (where recordingId = CatiCall._id)
   - Receives blob response, creates blob URL: `URL.createObjectURL(blob)`
   - Displays in `<audio>` tag with `src={catiRecordingBlobUrl}`

2. **Backend (`/api/cati/recording/:callId`):**
   - Finds CatiCall by `_id` or `callId`
   - Gets `recordingUrl` (DeepCall URL) from CatiCall
   - Downloads from DeepCall using axios (streaming)
   - Streams directly to client as blob

### CAPI Audio Access Flow (For Comparison):
1. **Frontend:**
   - Audio stored in: `currentResponse.audioRecording.audioUrl` (S3 key like `audio/interviews/...`)
   - Uses `getProxyUrl()` helper to construct: `/api/survey-responses/audio/${s3Key}`
   - Displays in `<audio>` tag with proxy URL

2. **Backend (`/api/survey-responses/audio/:audioPath`):**
   - Extracts S3 key from URL path
   - Streams from S3 using `streamAudioFromS3()`
   - No direct S3 URLs exposed to frontend

## Migration Strategy (Updated)

### Key Insight:
- CATI audio is **NOT** stored in `SurveyResponse.audioRecording.audioUrl`
- CATI audio is accessed via **separate endpoint** (`/api/cati/recording/:callId`)
- After migration, we can:
  1. **Option A:** Keep separate endpoint but use S3 proxy (like current CAPI flow)
  2. **Option B:** Store S3 key in `SurveyResponse.audioRecording.audioUrl` for CATI too, use same proxy endpoint

### Recommended: Option A (Minimal Changes)
- Add `s3AudioUrl` to CatiCall model
- Update `/api/cati/recording/:callId` to check S3 first, fallback to DeepCall
- Frontend code remains unchanged (still uses `/api/cati/recording/:callId`)
- No changes to SurveyResponse model needed

### Alternative: Option B (Unified Approach)
- Store S3 key in `SurveyResponse.audioRecording.audioUrl` for CATI responses
- Frontend can use same proxy endpoint as CAPI
- Requires updating CATI response creation to populate `audioRecording.audioUrl`
- More consistent but requires more changes

## Implementation Priority

1. **Phase 1:** Add S3 fields to CatiCall model (no breaking changes)
2. **Phase 2:** Update webhook to auto-upload new recordings to S3
3. **Phase 3:** Migration script for existing recordings
4. **Phase 4:** Update `/api/cati/recording/:callId` to prefer S3
5. **Phase 5:** (Optional) Store S3 key in SurveyResponse for unified access

