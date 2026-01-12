require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const redisOps = require('./redisClient');

// Redis cache key prefix for CATI queue
const CACHE_KEY_PREFIX = 'cati:next:';
const CACHE_TTL = 300; // 5 minutes (same as AC priority cache)

/**
 * Get cached next available queue entry for a survey/AC/priority combination
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @returns {Object|null} Cached queue entry ID or null
 */
const getCachedNextEntry = async (surveyId, acName, priority) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    const cached = await redisOps.get(cacheKey);
    return cached;
  } catch (error) {
    console.warn('⚠️ CATI queue cache get error:', error.message);
    return null;
  }
};

/**
 * Set cached next available queue entry
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 * @param {String} queueEntryId - Queue entry ID
 */
const setCachedNextEntry = async (surveyId, acName, priority, queueEntryId) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    await redisOps.set(cacheKey, queueEntryId, CACHE_TTL);
  } catch (error) {
    console.warn('⚠️ CATI queue cache set error:', error.message);
    // Non-blocking - continue even if cache fails
  }
};

/**
 * Clear cached next available queue entry (when entry is assigned/completed)
 * @param {String} surveyId - Survey ID
 * @param {String} acName - AC name
 * @param {Number} priority - Priority level
 */
const clearCachedNextEntry = async (surveyId, acName, priority) => {
  try {
    const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
    await redisOps.del(cacheKey);
  } catch (error) {
    console.warn('⚠️ CATI queue cache clear error:', error.message);
    // Non-blocking - continue even if cache fails
  }
};

/**
 * Batch get cached entries (Phase 6: Pipeline optimization)
 * @param {Array} keys - Array of {surveyId, acName, priority} objects
 * @returns {Object} Map of cacheKey -> entryId or null
 */
const batchGetCachedEntries = async (keys) => {
  try {
    const cacheKeys = keys.map(({ surveyId, acName, priority }) => 
      `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`
    );
    
    // Use Redis pipeline for batch operations
    const commands = cacheKeys.map(key => ['get', key]);
    const results = await redisOps.pipeline(commands);
    
    const resultMap = {};
    cacheKeys.forEach((key, index) => {
      const [error, value] = results[index] || [null, null];
      if (!error && value) {
        resultMap[key] = value;
      }
    });
    
    return resultMap;
  } catch (error) {
    console.warn('⚠️ CATI queue cache batch get error:', error.message);
    // Fallback to sequential
    const resultMap = {};
    for (const { surveyId, acName, priority } of keys) {
      const entryId = await getCachedNextEntry(surveyId, acName, priority);
      if (entryId) {
        const cacheKey = `${CACHE_KEY_PREFIX}${surveyId}:${acName}:${priority}`;
        resultMap[cacheKey] = entryId;
      }
    }
    return resultMap;
  }
};

/**
 * Clear all cached entries for a survey (when queue is reset)
 * @param {String} surveyId - Survey ID
 */
const clearAllCachedEntriesForSurvey = async (surveyId) => {
  try {
    // Note: This requires Redis KEYS command which can be slow on large datasets
    // For production, consider using Redis SCAN or maintaining a set of cache keys
    // For now, we'll just log - individual entries will expire with TTL
    console.log(`ℹ️  CATI queue cache: Clearing all entries for survey ${surveyId} (entries will expire with TTL)`);
  } catch (error) {
    console.warn('⚠️ CATI queue cache clear all error:', error.message);
  }
};

module.exports = {
  getCachedNextEntry,
  setCachedNextEntry,
  clearCachedNextEntry,
  batchGetCachedEntries,
  clearAllCachedEntriesForSurvey
};
