# Quality Agent Dashboard: Split CAPI/CATI QC Analysis

## Current Implementation

### Backend (`getNextReviewAssignment`)
- **Endpoint**: `/api/survey-responses/next-review`
- **Current Query Parameters**: `search`, `gender`, `ageMin`, `ageMax`, `excludeResponseId`
- **Current Behavior**: Returns next available response from queue (mixed CAPI/CATI)
- **Interview Mode Field**: `interviewMode` exists in SurveyResponse model (enum: ['capi', 'cati', 'online'])
- **Index**: `interviewMode` is indexed (composite indexes exist for performance)

### React Native App
- **Current UI**: Single button "Start Quality Check"
- **Current Flow**: 
  - Calls `apiService.getNextReviewAssignment()` with no parameters
  - Gets next response from mixed queue
  - Opens ResponseDetailsModal with assignment

### Web App
- **Current UI**: Single button "Start Quality Check" with optional filters
- **Current Flow**: 
  - Calls `getNextReviewAssignment(params)` where `params` can include `mode: filterMode`
  - **Note**: Web app already passes `mode` parameter, but backend doesn't use it yet

## Feasibility: ✅ YES, This is Very Feasible

### Why This Works Well:
1. **Database Support**: `interviewMode` field exists and is indexed
2. **Backend Architecture**: Query system is already filter-based (supports search, gender, age)
3. **Queue System**: Same efficient queue logic can be used with mode filter
4. **No Breaking Changes**: Can add mode filter without affecting existing functionality
5. **Performance**: Indexes already exist for `interviewMode` filtering

## Implementation Requirements

### 1. Backend Changes (`/var/www/opine/backend/controllers/surveyResponseController.js`)

#### A. Add `interviewMode` Parameter Support
```javascript
// Line ~2108: Add interviewMode to query params extraction
const { search, gender, ageMin, ageMax, excludeResponseId, interviewMode } = req.query;
```

#### B. Add Interview Mode Filter to Query
```javascript
// Line ~2130: Add interviewMode filter to base query
let query = { 
  status: 'Pending_Approval',
  // ... existing filters ...
};

// Add interviewMode filter if provided
if (interviewMode && (interviewMode === 'capi' || interviewMode === 'cati')) {
  query.interviewMode = interviewMode.toLowerCase();
}
```

#### C. Add Interview Mode Filter to Active Assignment Query
```javascript
// Line ~2221: Add interviewMode to activeAssignmentQuery
const activeAssignmentQuery = {
  status: 'Pending_Approval',
  'reviewAssignment.assignedTo': userIdObjectId,
  'reviewAssignment.expiresAt': { $gt: now }
};

if (interviewMode && (interviewMode === 'capi' || interviewMode === 'cati')) {
  activeAssignmentQuery.interviewMode = interviewMode.toLowerCase();
}
```

#### D. Add Interview Mode Filter to Aggregation Pipeline
```javascript
// Line ~2439: Add interviewMode to aggregation match stage
const aggregationPipeline = [
  { $match: query }, // query already includes interviewMode if provided
  // ... rest of pipeline
];
```

#### E. Add Interview Mode Filter to findOne Query
```javascript
// Line ~2578: findOneQuery already inherits from query, so interviewMode is included
const findOneQuery = { ...query }; // Already includes interviewMode
```

**Impact**: Minimal - just adding a filter condition. No performance impact (indexed field).

### 2. React Native App Changes (`/var/www/Opine-Android/src/screens/QualityAgentDashboard.tsx`)

#### A. Replace Single Button with Two Buttons
```typescript
// Current (Line ~627-635):
<Button
  mode="contained"
  onPress={currentAssignment ? () => setShowResponseDetails(true) : handleStartQualityCheck}
  style={styles.startButton}
>
  {currentAssignment ? 'Continue Review' : 'Start Quality Check'}
</Button>

// New: Two separate buttons
<View style={styles.buttonRow}>
  <Button
    mode="contained"
    onPress={() => handleStartQualityCheck('capi')}
    style={[styles.startButton, styles.capiButton]}
    disabled={isGettingNextAssignment}
  >
    Start CAPI QC
  </Button>
  
  <Button
    mode="contained"
    onPress={() => handleStartQualityCheck('cati')}
    style={[styles.startButton, styles.catiButton]}
    disabled={isGettingNextAssignment}
  >
    Start CATI QC
  </Button>
</View>
```

#### B. Update `handleStartQualityCheck` Function
```typescript
// Current (Line ~200): No parameters
const handleStartQualityCheck = async () => {
  // ...
  const resultPromise = apiService.getNextReviewAssignment();
  // ...
}

// New: Accept interviewMode parameter
const handleStartQualityCheck = async (interviewMode?: 'capi' | 'cati') => {
  // ...
  const params = interviewMode ? { interviewMode } : {};
  const resultPromise = apiService.getNextReviewAssignment(params);
  // ...
}
```

#### C. Update `handleStartQualityCheckWithExclusion` Function
```typescript
// Line ~361: Add interviewMode parameter
const handleStartQualityCheckWithExclusion = async (
  excludeResponseId?: string,
  interviewMode?: 'capi' | 'cati'
) => {
  // ...
  const params: any = {};
  if (excludeResponseId) params.excludeResponseId = excludeResponseId;
  if (interviewMode) params.interviewMode = interviewMode;
  // ...
}
```

#### D. Update Skip Function to Preserve Mode
```typescript
// Line ~326: Store current interview mode and pass it when skipping
const handleSkipResponse = async () => {
  // ...
  const currentMode = currentAssignment?.interviewMode; // 'capi' or 'cati'
  await handleStartQualityCheckWithExclusion(skippedResponseId, currentMode);
  // ...
}
```

**Impact**: UI changes only. No breaking changes to existing functionality.

### 3. API Service Changes (`/var/www/Opine-Android/src/services/api.ts`)

#### No Changes Needed
- `getNextReviewAssignment(params)` already accepts params object
- Just need to pass `{ interviewMode: 'capi' }` or `{ interviewMode: 'cati' }`

### 4. Styling Changes (Optional but Recommended)

```typescript
// Add to styles in QualityAgentDashboard.tsx
const styles = StyleSheet.create({
  // ... existing styles ...
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  capiButton: {
    flex: 1,
    backgroundColor: '#2563eb', // Blue for CAPI
  },
  catiButton: {
    flex: 1,
    backgroundColor: '#059669', // Green for CATI
  },
});
```

## Benefits

1. **Better UX**: Quality agents can choose which type of interview to review
2. **Efficient Queue Management**: Separate queues prevent mixing CAPI/CATI
3. **Clearer Workflow**: Agents know what type of interview they're getting
4. **No Performance Impact**: Uses existing indexes
5. **Backward Compatible**: Can still support mixed queue if needed (just don't pass interviewMode)

## Potential Issues & Solutions

### Issue 1: What if no responses available for selected mode?
**Solution**: Backend already handles this - returns `{ interview: null, message: 'No responses available for review' }`. Frontend can show appropriate message.

### Issue 2: What if agent wants to switch between CAPI and CATI?
**Solution**: They can release current assignment and start a new one with different mode.

### Issue 3: Active assignment from different mode?
**Solution**: When agent has active assignment, show "Continue Review" button. If they want different mode, they can release and start new.

### Issue 4: Skip functionality
**Solution**: When skipping, preserve the current interview mode so next assignment is same type.

## Testing Checklist

1. ✅ Test "Start CAPI QC" - should only get CAPI responses
2. ✅ Test "Start CATI QC" - should only get CATI responses
3. ✅ Test skip functionality - should preserve mode
4. ✅ Test active assignment - should show "Continue Review"
5. ✅ Test release and switch modes - should work correctly
6. ✅ Test when no responses available for selected mode - should show appropriate message
7. ✅ Test backward compatibility - existing code should still work (if needed)

## Backward Compatibility

**Current "Start Quality Check" (Mixed Queue)**: 
- Can be kept for older app versions if needed
- Just don't pass `interviewMode` parameter
- Backend will return mixed queue (current behavior)

**Recommendation**: Since user said "Don't need to have it now", we can remove the mixed queue option and only show the two separate buttons.

## Performance Considerations

1. **Index Usage**: `interviewMode` is already indexed, so filtering is fast
2. **Query Optimization**: Adding `interviewMode` filter actually makes queries faster (smaller result set)
3. **Cache**: Current cache system (`nextAssignmentCache`) will work with mode filter
4. **No Additional Load**: Same number of queries, just with additional filter

## Summary

**Feasibility**: ✅ **100% Feasible**

**Complexity**: 🟢 **Low** - Mostly adding filter conditions

**Risk**: 🟢 **Low** - No breaking changes, well-indexed field

**Effort**: 🟡 **Medium** - Backend changes + React Native UI changes

**Recommendation**: ✅ **Proceed with Implementation**

The feature is well-aligned with existing architecture and can be implemented efficiently without affecting other functionality.

