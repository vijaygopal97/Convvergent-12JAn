/**
 * In-Memory Cache for Survey Responses
 * 
 * This cache stores getSurveyResponses results to prevent repeated heavy database queries
 * when users refresh or filter responses frequently.
 * 
 * Cache Strategy:
 * - TTL: 1 minute (responses change frequently, but filters are stable)
 * - Storage: In-memory Map (fast lookups)
 * - Cache Key: surveyId + all filter parameters
 * - Cleanup: Automatic via TTL expiration
 */

class SurveyResponsesCache {
  constructor() {
    this.cache = new Map(); // cacheKey -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 1 minute)
    this.startCleanup();
  }

  /**
   * Generate cache key from request parameters
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object with all query parameters
   * @returns {string} - Cache key
   */
  generateKey(surveyId, filters = {}) {
    const {
      page = 1,
      limit = 10,
      status = 'all',
      gender = '',
      ageMin = '',
      ageMax = '',
      ac = '',
      city = '',
      district = '',
      lokSabha = '',
      interviewerIds = ''
    } = filters;
    
    // Create a unique key from all filter parameters
    return `${surveyId}|${page}|${limit}|${status}|${gender}|${ageMin}|${ageMax}|${ac}|${city}|${district}|${lokSabha}|${interviewerIds}`;
  }

  /**
   * Get cached responses for a request
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object
   * @returns {Object|null} - Cached responses or null if not found/expired
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
   * Store responses in cache
   * @param {string} surveyId - Survey ID
   * @param {Object} filters - Filter object
   * @param {Object} data - The responses data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 1 minute)
   */
  set(surveyId, filters = {}, data, ttlMs = 60 * 1000) {
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
    // Run cleanup every 1 minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000); // 1 minute
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
      console.log(`🧹 SurveyResponsesCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const surveyResponsesCache = new SurveyResponsesCache();

module.exports = surveyResponsesCache;

