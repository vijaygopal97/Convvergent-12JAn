const redisOps = require('./redisClient');
const Survey = require('../models/Survey');

// Cache TTL: 1 hour (surveys don't change frequently during interviews)
const SURVEY_CACHE_TTL = 3600; // 1 hour in seconds

// Cache key prefix
const CACHE_KEY_PREFIX = 'survey:';

/**
 * Get cache key for a survey
 */
const getCacheKey = (surveyId) => {
  return `${CACHE_KEY_PREFIX}${surveyId}`;
};

/**
 * Get survey from cache or database
 * Top tech companies use this pattern: Cache-Aside (Lazy Loading)
 * 1. Check cache first
 * 2. If miss, load from DB
 * 3. Store in cache for future requests
 * 4. Return data
 */
const getSurvey = async (surveyId, options = {}) => {
  const {
    // CRITICAL: Always include targetAudience in default select for age/gender validation
    select = 'surveyName description mode sections questions targetAudience settings company assignedInterviewers assignedQualityAgents acAssignmentState status version assignACs',
    useCache = true
  } = options;

  const cacheKey = getCacheKey(surveyId);

  // Try cache first (if enabled)
  if (useCache) {
    try {
      const cached = await redisOps.get(cacheKey);
      if (cached) {
        console.log(`✅ Survey cache HIT: ${surveyId}`);
        return cached;
      }
      console.log(`❌ Survey cache MISS: ${surveyId}`);
    } catch (error) {
      console.warn('⚠️ Cache read error, falling back to DB:', error.message);
    }
  }

  // Cache miss or disabled - load from database
  try {
    const survey = await Survey.findById(surveyId)
      .select(select)
      .lean(); // Use lean() for memory efficiency

    if (!survey) {
      return null;
    }

    // Store in cache for future requests (async, don't block)
    if (useCache && survey) {
      redisOps.set(cacheKey, survey, SURVEY_CACHE_TTL).catch((error) => {
        console.warn('⚠️ Cache write error (non-blocking):', error.message);
      });
    }

    return survey;
  } catch (error) {
    console.error('❌ Error loading survey from database:', error);
    throw error;
  }
};

/**
 * Invalidate survey cache (call when survey is updated)
 */
const invalidateSurveyCache = async (surveyId) => {
  const cacheKey = getCacheKey(surveyId);
  try {
    await redisOps.del(cacheKey);
    console.log(`🗑️ Survey cache invalidated: ${surveyId}`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

/**
 * Pre-warm cache for a survey (useful for frequently accessed surveys)
 */
const preWarmCache = async (surveyId, options = {}) => {
  const {
    select = 'surveyName description mode sections questions targetAudience settings company assignedInterviewers assignedQualityAgents acAssignmentState status version'
  } = options;

  try {
    const survey = await Survey.findById(surveyId)
      .select(select)
      .lean();

    if (survey) {
      const cacheKey = getCacheKey(surveyId);
      await redisOps.set(cacheKey, survey, SURVEY_CACHE_TTL);
      console.log(`🔥 Survey cache pre-warmed: ${surveyId}`);
      return survey;
    }
    return null;
  } catch (error) {
    console.error('❌ Error pre-warming cache:', error);
    throw error;
  }
};

/**
 * Clear all survey caches (use with caution - only for maintenance)
 */
const clearAllSurveyCaches = async () => {
  // Note: This requires Redis SCAN command which isn't in our redisOps
  // For now, we'll just log a warning
  console.warn('⚠️ clearAllSurveyCaches not implemented - use invalidateSurveyCache for specific surveys');
};

/**
 * Set survey in cache (useful for explicit caching)
 */
const setSurvey = async (surveyId, surveyData, ttl = SURVEY_CACHE_TTL) => {
  const cacheKey = getCacheKey(surveyId);
  try {
    await redisOps.set(cacheKey, surveyData, ttl);
    console.log(`✅ Survey cached: ${surveyId} (TTL: ${ttl}s)`);
  } catch (error) {
    console.warn('⚠️ Cache write error:', error.message);
  }
};

module.exports = {
  getSurvey,
  setSurvey,
  invalidateSurveyCache,
  preWarmCache,
  clearAllSurveyCaches,
  SURVEY_CACHE_TTL
};
