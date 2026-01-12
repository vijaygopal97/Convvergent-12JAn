/**
 * Redis + In-Memory Cache for Next Assignment Available Responses
 * 
 * Phase 1: Quick Wins - Enhanced with Redis for distributed caching
 * 
 * This cache stores the list of available responses for quality agents
 * to prevent repeated expensive database queries when loading assignments.
 * 
 * Cache Strategy:
 * - TTL: 30 seconds (assignments change frequently, but list of available responses is relatively stable)
 * - Primary Storage: Redis (distributed, shared across workers/servers)
 * - Fallback: In-memory Map (if Redis unavailable)
 * - Cache Key: userId + filters (search, gender, ageMin, ageMax)
 * - Cleanup: Automatic via TTL expiration
 */

const redisOps = require('./redisClient');

class NextAssignmentCache {
  constructor() {
    this.cache = new Map(); // In-memory fallback cacheKey -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every minute) - only for in-memory fallback
    this.startCleanup();
  }

  /**
   * Generate cache key from userId and filters
   * @param {string} userId - User ID
   * @param {Object} filters - Filter object (search, gender, ageMin, ageMax)
   * @returns {string} - Cache key
   */
  generateKey(userId, filters = {}) {
    const filterStr = JSON.stringify({
      search: filters.search || '',
      gender: filters.gender || '',
      ageMin: filters.ageMin || '',
      ageMax: filters.ageMax || ''
    });
    return `${userId}:${filterStr}`;
  }

  /**
   * Get cached available responses for a user
   * @param {string} userId - User ID
   * @param {Object} filters - Filter object
   * @returns {Promise<Array|null>} - Cached available responses or null if not found/expired
   */
  async get(userId, filters = {}) {
    const key = this.generateKey(userId, filters);
    
    // Try Redis first (primary cache)
    try {
      const cached = await redisOps.get(key);
      if (cached) {
        return cached;
      }
    } catch (error) {
      // Redis failed, fall back to in-memory
      console.warn(`⚠️ NextAssignmentCache: Redis get failed, using in-memory fallback: ${error.message}`);
    }
    
    // Fallback to in-memory cache
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
   * Store available responses in cache
   * @param {string} userId - User ID
   * @param {Object} filters - Filter object
   * @param {Array} data - The available responses list to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 30 seconds)
   */
  async set(userId, filters = {}, data, ttlMs = 30 * 1000) {
    const key = this.generateKey(userId, filters);
    const ttlSeconds = Math.floor(ttlMs / 1000);
    
    // Try Redis first (primary cache)
    try {
      await redisOps.set(key, data, ttlSeconds);
    } catch (error) {
      // Redis failed, fall back to in-memory
      console.warn(`⚠️ NextAssignmentCache: Redis set failed, using in-memory fallback: ${error.message}`);
      const expiresAt = Date.now() + ttlMs;
      this.cache.set(key, { data, expiresAt });
    }
  }

  /**
   * Delete entry from cache
   * @param {string} userId - User ID
   * @param {Object} filters - Filter object
   */
  delete(userId, filters = {}) {
    const key = this.generateKey(userId, filters);
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries for a user (useful when assignment changes)
   * @param {string} userId - User ID
   */
  async clearUser(userId) {
    // Clear in-memory cache
    const keysToDelete = [];
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(`${userId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
    
    // Note: Redis doesn't support pattern deletion easily without SCAN
    // Cache entries will expire naturally (TTL is only 30 seconds)
    // This is acceptable for Phase 1 - in future we could implement SCAN-based deletion
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
    // Run cleanup every minute
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
      console.log(`🧹 NextAssignmentCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const nextAssignmentCache = new NextAssignmentCache();

module.exports = nextAssignmentCache;





