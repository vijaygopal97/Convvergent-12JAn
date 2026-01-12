const crypto = require('crypto');

/**
 * Generate a unique fingerprint for a CSV job request
 * This is used for smart job linking - identical requests get the same fingerprint
 */
const generateJobFingerprint = (surveyId, mode, filters) => {
  // Normalize filters to ensure consistent fingerprint
  const normalizedFilters = {
    status: filters.status || '',
    gender: filters.gender || '',
    ageMin: filters.ageMin || '',
    ageMax: filters.ageMax || '',
    ac: filters.ac || '',
    city: filters.city || '',
    district: filters.district || '',
    lokSabha: filters.lokSabha || '',
    dateRange: filters.dateRange || '',
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
    interviewMode: filters.interviewMode || '',
    interviewerIds: filters.interviewerIds 
      ? (Array.isArray(filters.interviewerIds) 
          ? filters.interviewerIds.sort().join(',') 
          : String(filters.interviewerIds).split(',').sort().join(','))
      : '',
    interviewerMode: filters.interviewerMode || 'include',
    search: filters.search || ''
  };

  // Create a deterministic string from all parameters
  const fingerprintString = JSON.stringify({
    surveyId: String(surveyId),
    mode: String(mode),
    filters: normalizedFilters
  });

  // Generate SHA256 hash for consistent fingerprint
  const hash = crypto.createHash('sha256').update(fingerprintString).digest('hex');
  
  // Return short fingerprint (first 16 chars for readability)
  return `csv-${surveyId}-${mode}-${hash.substring(0, 16)}`;
};

/**
 * Generate a unique job ID that includes fingerprint for deduplication
 */
const generateJobId = (surveyId, mode, filters) => {
  const fingerprint = generateJobFingerprint(surveyId, mode, filters);
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  
  // Format: fingerprint-timestamp-random
  // This allows Bull to deduplicate jobs with same fingerprint
  return `${fingerprint}-${timestamp}-${random}`;
};

module.exports = {
  generateJobFingerprint,
  generateJobId
};




