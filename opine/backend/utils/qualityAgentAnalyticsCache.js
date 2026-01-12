/**
 * In-Memory Cache for Quality Agent Analytics
 * 
 * This cache stores getQualityAgentPerformance results to prevent repeated database queries
 * when users refresh their dashboard frequently.
 * 
 * Cache Strategy:
 * - TTL: 2 minutes (analytics change more frequently than stats)
 * - Storage: In-memory Map (fast lookups)
 * - Cache Key: qualityAgentId + timeRange + startDate + endDate + surveyId + lightweight
 * - Cleanup: Automatic via TTL expiration
 */

class QualityAgentAnalyticsCache {
  constructor() {
    this.cache = new Map(); // key -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 2 minutes)
    this.startCleanup();
  }

  /**
   * Generate cache key from parameters
   * @param {string} qualityAgentId - Quality Agent ID
   * @param {Object} params - Query parameters (timeRange, startDate, endDate, surveyId, lightweight)
   * @returns {string} - Cache key
   */
  _generateKey(qualityAgentId, params) {
    const { timeRange = 'all', startDate, endDate, surveyId, lightweight } = params || {};
    return `${qualityAgentId}-${timeRange}-${startDate || ''}-${endDate || ''}-${surveyId || ''}-${lightweight || ''}`;
  }

  /**
   * Get cached analytics for a quality agent
   * @param {string} qualityAgentId - Quality Agent ID
   * @param {Object} params - Query parameters
   * @returns {Object|null} - Cached analytics or null if not found/expired
   */
  get(qualityAgentId, params) {
    const key = this._generateKey(qualityAgentId, params);
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
   * Store analytics in cache
   * @param {string} qualityAgentId - Quality Agent ID
   * @param {Object} params - Query parameters
   * @param {Object} data - The analytics data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 2 minutes)
   */
  set(qualityAgentId, params, data, ttlMs = 2 * 60 * 1000) {
    const key = this._generateKey(qualityAgentId, params);
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(key, { data, expiresAt });
  }

  /**
   * Delete entry from cache
   * @param {string} qualityAgentId - Quality Agent ID
   * @param {Object} params - Query parameters
   */
  delete(qualityAgentId, params) {
    const key = this._generateKey(qualityAgentId, params);
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
    // Run cleanup every 2 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 2 * 60 * 1000); // 2 minutes
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
      console.log(`🧹 QualityAgentAnalyticsCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const qualityAgentAnalyticsCache = new QualityAgentAnalyticsCache();

module.exports = qualityAgentAnalyticsCache;

