/**
 * In-Memory Cache for Idempotency Checks
 * 
 * This cache stores sessionId -> response data mappings to avoid MongoDB queries
 * for duplicate/idempotent requests. This significantly reduces database load.
 * 
 * Cache Strategy:
 * - TTL: 48 hours (completed interviews don't change after completion)
 * - Storage: In-memory Map (fast lookups)
 * - Cleanup: Automatic via TTL expiration
 */

class IdempotencyCache {
  constructor() {
    this.cache = new Map(); // sessionId -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every hour)
    this.startCleanup();
  }

  /**
   * Get cached response data for a sessionId
   * @param {string} sessionId - The session ID to lookup
   * @returns {Object|null} - Cached response data or null if not found/expired
   */
  get(sessionId) {
    const entry = this.cache.get(sessionId);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(sessionId);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Store response data in cache
   * @param {string} sessionId - The session ID (cache key)
   * @param {Object} data - The response data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 48 hours)
   */
  set(sessionId, data, ttlMs = 48 * 60 * 60 * 1000) {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(sessionId, { data, expiresAt });
  }

  /**
   * Delete entry from cache
   * @param {string} sessionId - The session ID to delete
   */
  delete(sessionId) {
    this.cache.delete(sessionId);
  }

  /**
   * Clear all cache entries
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
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000); // 1 hour
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
    
    for (const [sessionId, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(sessionId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 IdempotencyCache: Cleaned up ${cleanedCount} expired entries`);
    }
  }
}

// Export singleton instance
const idempotencyCache = new IdempotencyCache();

module.exports = idempotencyCache;

