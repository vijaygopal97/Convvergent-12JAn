const redisOps = require('./redisClient');

// Cache TTL: 5 minutes (performance stats change frequently but not every second)
const PERFORMANCE_CACHE_TTL = 300; // 5 minutes in seconds

// Cache key prefix
const CACHE_KEY_PREFIX = 'caller-performance:';

/**
 * Generate cache key for caller performance stats
 */
const getCacheKey = (surveyId, filters) => {
  // Create a unique key based on survey ID and filter parameters
  const filterString = JSON.stringify({
    startDate: filters.startDate || '',
    endDate: filters.endDate || '',
    interviewerIds: (filters.interviewerIds || []).sort().join(','),
    interviewerMode: filters.interviewerMode || 'include',
    ac: filters.ac || ''
  });
  
  // Create a simple hash from filter string (for shorter keys)
  const filterHash = require('crypto')
    .createHash('md5')
    .update(filterString)
    .digest('hex')
    .substring(0, 8);
  
  return `${CACHE_KEY_PREFIX}${surveyId}:${filterHash}`;
};

/**
 * Get caller performance stats from cache or calculate
 * Top tech companies use this pattern: Cache-Aside with short TTL
 */
const getCallerPerformanceStats = async (surveyId, filters, calculateFn) => {
  const cacheKey = getCacheKey(surveyId, filters);

  // Try cache first
  try {
    const cached = await redisOps.get(cacheKey);
    if (cached) {
      console.log(`✅ Caller performance cache HIT: ${surveyId}`);
      return cached;
    }
    console.log(`❌ Caller performance cache MISS: ${surveyId}`);
  } catch (error) {
    console.warn('⚠️ Cache read error, falling back to calculation:', error.message);
  }

  // Cache miss - calculate stats
  try {
    const stats = await calculateFn();
    
    // Store in cache for future requests (async, don't block)
    redisOps.set(cacheKey, stats, PERFORMANCE_CACHE_TTL).catch((error) => {
      console.warn('⚠️ Cache write error (non-blocking):', error.message);
    });
    
    return stats;
  } catch (error) {
    console.error('❌ Error calculating caller performance stats:', error);
    throw error;
  }
};

/**
 * Invalidate caller performance cache (call when responses or calls change)
 */
const invalidateCallerPerformanceCache = async (surveyId) => {
  // Note: We can't easily delete all keys with pattern, so we'll just let them expire
  // For now, we'll delete keys that match the survey ID pattern
  // In production, you might want to use Redis SCAN for pattern matching
  try {
    // Since we can't pattern match easily, we'll just log and let TTL handle it
    // For immediate invalidation, you'd need to track cache keys or use Redis SCAN
    console.log(`🗑️ Caller performance cache should be invalidated for survey: ${surveyId} (TTL will handle expiration)`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

module.exports = {
  getCallerPerformanceStats,
  invalidateCallerPerformanceCache,
  PERFORMANCE_CACHE_TTL
};




