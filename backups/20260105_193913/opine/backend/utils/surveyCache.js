/**
 * In-Memory Cache for Survey Data
 * 
 * This cache stores getSurvey results to prevent repeated heavy database queries
 * with 8 populate() calls when users sync survey details frequently.
 * 
 * Cache Strategy:
 * - TTL: 5 minutes (surveys don't change frequently)
 * - Storage: In-memory Map (fast lookups)
 * - Cache Key: surveyId + mode (for CATI-specific logic)
 * - Cleanup: Automatic via TTL expiration
 */

class SurveyCache {
  constructor() {
    this.cache = new Map(); // cacheKey -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 5 minutes)
    this.startCleanup();
  }

  /**
   * Generate cache key from request parameters
   * @param {string} surveyId - Survey ID
   * @param {Object} options - Options object with mode
   * @returns {string} - Cache key
   */
  generateKey(surveyId, options = {}) {
    const { mode = '' } = options;
    return `${surveyId}|${mode}`;
  }

  /**
   * Get cached survey for a request
   * @param {string} surveyId - Survey ID
   * @param {Object} options - Options object with mode
   * @returns {Object|null} - Cached survey or null if not found/expired
   */
  get(surveyId, options = {}) {
    const key = this.generateKey(surveyId, options);
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
   * Store survey in cache
   * @param {string} surveyId - Survey ID
   * @param {Object} options - Options object with mode
   * @param {Object} data - The survey data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 5 minutes)
   */
  set(surveyId, options = {}, data, ttlMs = 5 * 60 * 1000) {
    const key = this.generateKey(surveyId, options);
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Delete entry from cache
   * @param {string} surveyId - Survey ID
   * @param {Object} options - Options object with mode
   */
  delete(surveyId, options = {}) {
    const key = this.generateKey(surveyId, options);
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
      console.log(`🧹 SurveyCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const surveyCache = new SurveyCache();

module.exports = surveyCache;

