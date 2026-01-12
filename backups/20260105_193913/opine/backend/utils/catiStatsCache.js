/**
 * In-Memory Cache for CATI Stats
 * 
 * This cache stores getCatiStats results to prevent repeated heavy database queries
 * when users refresh or change filters frequently.
 * 
 * Cache Strategy:
 * - TTL: 5 minutes (stats don't change that frequently)
 * - Storage: In-memory Map (fast lookups)
 * - Cache Key: surveyId + filters (startDate, endDate, interviewerIds, interviewerMode, ac)
 * - Cleanup: Automatic via TTL expiration
 */

class CatiStatsCache {
  constructor() {
    this.cache = new Map(); // cacheKey -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 5 minutes)
    this.startCleanup();
  }

  /**
   * Generate cache key from request parameters
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object with startDate, endDate, interviewerIds, interviewerMode, ac
   * @returns {string} - Cache key
   */
  generateKey(surveyId, filters = {}) {
    const {
      startDate = '',
      endDate = '',
      interviewerIds = '',
      interviewerMode = '',
      ac = ''
    } = filters;
    
    // Create a unique key from all filter parameters
    return `${surveyId}|${startDate}|${endDate}|${interviewerIds}|${interviewerMode}|${ac}`;
  }

  /**
   * Get cached stats for a request
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object
   * @returns {Object|null} - Cached stats or null if not found/expired
   */
  get(surveyId, filters = {}) {
    const key = this.generateKey(surveyId, filters);
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Store stats in cache
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object
   * @param {Object} data - The stats data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 5 minutes)
   */
  set(surveyId, filters = {}, data, ttlMs = 5 * 60 * 1000) {
    const key = this.generateKey(surveyId, filters);
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Delete entry from cache
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object
   */
  delete(surveyId, filters = {}) {
    const key = this.generateKey(surveyId, filters);
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries (useful for testing or manual cache invalidation)
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size (for monitoring)
   * @returns {number} - Number of entries in cache
   */
  size() {
    return this.cache.size;
  }

  /**
   * Start cleanup interval to remove expired entries
   */
  startCleanup() {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // 5 minutes
  }

  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Remove expired entries from cache
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 CatiStatsCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const catiStatsCache = new CatiStatsCache();

module.exports = catiStatsCache;

