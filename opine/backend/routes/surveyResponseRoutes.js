const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const {
  startInterview,
  getInterviewSession,
  updateResponse,
  navigateToQuestion,
  markQuestionReached,
  pauseInterview,
  resumeInterview,
  completeInterview,
  abandonInterview,
  getGenderResponseCounts,
  uploadAudioFile,
  getMyInterviews,
  getInterviewerStats,
  getQualityAgentStats,
  getPendingApprovals,
  getApprovalStats,
  getNextReviewAssignment,
  releaseReviewAssignment,
  skipReviewAssignment,
  submitVerification,
  debugSurveyResponses,
  getSurveyResponseById,
  getSurveyResponses,
  getSurveyResponsesV2,
  getSurveyResponsesV2ForCSV,
  getSurveyResponseCounts,
  approveSurveyResponse,
  rejectSurveyResponse,
  setPendingApproval,
  getACPerformanceStats,
  getInterviewerPerformanceStats,
  getLastCatiSetNumber,
  getAudioSignedUrl,
  streamAudioProxy,
  getCSVFileInfo,
  downloadPreGeneratedCSV,
  triggerCSVGeneration,
  downloadCSVWithFilters_OLD,
  createCSVJob,
  getCSVJobProgress,
  downloadCSVFromJob,
  verifyInterviewSync
} = require('../controllers/surveyResponseController');
const { protect, authorize } = require('../middleware/auth');

// Configure multer for audio file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(__dirname, '../../uploads/temp/');
    // Ensure temp directory exists
    const fs = require('fs');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1000 * 1024 * 1024 // 1000MB (1GB) limit - allow large audio recordings
  },
  fileFilter: function (req, file, cb) {
    // Accept only audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// Test route to verify routing (before protect middleware)
router.get('/test-skip-route', (req, res) => {
  res.json({ success: true, message: 'Skip route test endpoint is accessible' });
});

// Audio proxy endpoint - streams audio from S3 through server (eliminates cross-region charges)
// IMPORTANT: This route must be PUBLIC (no authentication) because browser <audio> elements don't send auth headers
// IMPORTANT: This route must come BEFORE /:responseId and BEFORE protect middleware to avoid conflicts
// CRITICAL: Define audio routes BEFORE protect middleware to make them public
// Use regex pattern that matches any path after /audio/ (including encoded slashes)
// CRITICAL: Do NOT call next() - streamAudioProxy handles the response directly
// If we call next(), it will pass to protect middleware and cause 401
router.get(/^\/audio\/.+/, streamAudioProxy);
router.get('/audio', streamAudioProxy);

// All routes require authentication (except audio proxy above)
router.use(protect);

// Debug middleware to log all POST requests to survey-responses
router.use((req, res, next) => {
  if (req.method === 'POST') {
    console.log('🔍🔍🔍 POST REQUEST:', req.method, req.path, req.originalUrl, req.baseUrl);
    if (req.path.includes('skip')) {
      console.log('🔍🔍🔍 SKIP ROUTE DETECTED! Request params:', req.params);
      console.log('🔍🔍🔍 SKIP ROUTE - Request body:', req.body);
      console.log('🔍🔍🔍 SKIP ROUTE - User:', req.user?.email, 'UserType:', req.user?.userType);
    }
  }
  next();
});

// Start a new interview session
router.post('/start/:surveyId', startInterview);

// Get interview session data
router.get('/session/:sessionId', getInterviewSession);

// Update response (temporary storage)
router.post('/session/:sessionId/response', updateResponse);

// Navigate to a specific question
router.post('/session/:sessionId/navigate', navigateToQuestion);

// Mark question as reached
router.post('/session/:sessionId/reach', markQuestionReached);

// Pause interview
router.post('/session/:sessionId/pause', pauseInterview);

// Resume interview
router.post('/session/:sessionId/resume', resumeInterview);

// Complete interview
router.post('/session/:sessionId/complete', completeInterview);

// Abandon interview
router.post('/session/:sessionId/abandon', abandonInterview);

// Get gender response counts for quota management
router.get('/survey/:surveyId/gender-counts', getGenderResponseCounts);

// Get last CATI set number for a survey (to alternate sets)
// CRITICAL: This route MUST be defined BEFORE /survey/:surveyId/responses to avoid route conflicts
// Express matches routes in order, so more specific routes must come first
router.get('/survey/:surveyId/last-cati-set', getLastCatiSetNumber);

// Upload audio file for interview
router.post('/upload-audio', upload.single('audio'), uploadAudioFile);

// Get signed URL for audio file (DEPRECATED - returns proxy URL instead of direct S3 URL)
// Kept for backward compatibility
router.get('/audio-signed-url', getAudioSignedUrl);
router.get('/audio-signed-url/:responseId', getAudioSignedUrl);

// Get all interviews conducted by the logged-in interviewer (with pagination)
router.get('/my-interviews', getMyInterviews);

// Get interviewer statistics (lightweight endpoint using aggregation)
router.get('/interviewer-stats', getInterviewerStats);

// Get quality agent statistics (lightweight endpoint using aggregation - optimized for dashboard loading)
// IMPORTANT: This route MUST come before /:responseId to avoid route conflicts
router.get('/quality-agent-stats', protect, authorize('quality_agent'), getQualityAgentStats);

// Get approval statistics (optimized endpoint using aggregation)
router.get('/approval-stats', getApprovalStats);

// Get pending approval responses for company admin
router.get('/pending-approvals', getPendingApprovals);

// Get next available response from queue for review (Queue-based assignment)
// IMPORTANT: This must come BEFORE /:responseId route to avoid route conflicts
router.get('/next-review', getNextReviewAssignment);

// Release review assignment (when user abandons review)
router.post('/release-review/:responseId', releaseReviewAssignment);

// Skip review assignment (releases assignment and returns response to queue)
// IMPORTANT: This must come BEFORE /:responseId routes to avoid route conflicts
router.post('/skip-review/:responseId', protect, authorize('quality_agent'), skipReviewAssignment);

// Submit survey response verification
router.post('/verify', submitVerification);

// Debug endpoint to check all survey responses
router.get('/debug-responses', debugSurveyResponses);

// Get survey responses for View Responses modal
router.get('/survey/:surveyId/responses', getSurveyResponses);

// Get survey responses V2 (Optimized for big data - No limits)
router.get('/survey/:surveyId/responses-v2', protect, authorize('company_admin', 'project_manager'), getSurveyResponsesV2);

// Get response counts (lightweight endpoint for counts only)
router.get('/survey/:surveyId/responses-v2/counts', protect, authorize('company_admin', 'project_manager'), getSurveyResponseCounts);

// Get all survey responses V2 for CSV download (no pagination, company admin only)
router.get('/survey/:surveyId/responses-v2-csv', getSurveyResponsesV2ForCSV);

// Pre-generated CSV endpoints
router.get('/survey/:surveyId/csv-info', getCSVFileInfo);
router.get('/survey/:surveyId/csv-download', downloadPreGeneratedCSV);
router.post('/survey/:surveyId/generate-csv', protect, authorize('company_admin'), triggerCSVGeneration);

// Efficient CSV download with filters (server-side generation) - OLD synchronous version
router.get('/survey/:surveyId/download-csv', protect, authorize('company_admin', 'project_manager'), downloadCSVWithFilters_OLD);

// NEW: Async CSV generation with job queue
// Create CSV generation job (returns immediately with job ID)
router.post('/survey/:surveyId/create-csv-job', protect, authorize('company_admin', 'project_manager'), createCSVJob);

// Get CSV job progress
router.get('/csv-job/:jobId/progress', protect, authorize('company_admin', 'project_manager'), getCSVJobProgress);

// Download completed CSV file
router.get('/csv-job/:jobId/download', protect, authorize('company_admin', 'project_manager'), downloadCSVFromJob);

// Get AC Performance Stats
router.get('/survey/:surveyId/ac-performance', getACPerformanceStats);

// Get Interviewer Performance Stats
router.get('/survey/:surveyId/interviewer-performance', getInterviewerPerformanceStats);

// Approve survey response (must come after skip-review to avoid conflicts)
router.patch('/:responseId/approve', approveSurveyResponse);

// Reject survey response (must come after skip-review to avoid conflicts)
router.patch('/:responseId/reject', rejectSurveyResponse);

// Set response to Pending Approval (must come after skip-review to avoid conflicts)
router.patch('/:responseId/set-pending', setPendingApproval);

// Offline interview reporting routes
const {
  reportOfflineInterviews,
  getOfflineInterviewReports,
  getOfflineInterviewSummary
} = require('../controllers/offlineInterviewReportController');

router.post('/offline-interviews/report', reportOfflineInterviews);
router.get('/offline-interviews/reports', authorize('company_admin', 'super_admin'), getOfflineInterviewReports);
router.get('/offline-interviews/summary', authorize('company_admin', 'super_admin'), getOfflineInterviewSummary);

// Verify interview sync (two-phase commit verification)
router.post('/verify-sync', protect, verifyInterviewSync);

// Get survey response details by ID (must be last to avoid conflicts with other routes)
router.get('/:responseId', getSurveyResponseById);

module.exports = router;