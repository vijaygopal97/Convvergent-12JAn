const redisOps = require('./redisClient');

// Cache TTL: 5 minutes (stats change frequently but not every second)
const STATS_CACHE_TTL = 300; // 5 minutes in seconds

// Cache key prefix
const CACHE_KEY_PREFIX = 'overall-stats:';

/**
 * Get cache key for overall stats
 */
const getCacheKey = (companyId) => {
  return `${CACHE_KEY_PREFIX}${companyId}`;
};

/**
 * Get overall stats from cache or calculate
 * Top tech companies use this pattern: Cache-Aside with short TTL
 */
const getOverallStats = async (companyId, calculateFn) => {
  const cacheKey = getCacheKey(companyId);

  // Try cache first
  try {
    const cached = await redisOps.get(cacheKey);
    if (cached) {
      console.log(`✅ Overall stats cache HIT: ${companyId}`);
      return cached;
    }
    console.log(`❌ Overall stats cache MISS: ${companyId}`);
  } catch (error) {
    console.warn('⚠️ Cache read error, falling back to calculation:', error.message);
  }

  // Cache miss - calculate stats
  try {
    const stats = await calculateFn();
    
    // Store in cache for future requests (async, don't block)
    redisOps.set(cacheKey, stats, STATS_CACHE_TTL).catch((error) => {
      console.warn('⚠️ Cache write error (non-blocking):', error.message);
    });
    
    return stats;
  } catch (error) {
    console.error('❌ Error calculating overall stats:', error);
    throw error;
  }
};

/**
 * Invalidate overall stats cache (call when surveys or responses change)
 */
const invalidateStatsCache = async (companyId) => {
  const cacheKey = getCacheKey(companyId);
  try {
    await redisOps.del(cacheKey);
    console.log(`🗑️ Overall stats cache invalidated: ${companyId}`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

module.exports = {
  getOverallStats,
  invalidateStatsCache,
  STATS_CACHE_TTL
};




