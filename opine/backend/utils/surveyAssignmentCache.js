/**
 * Redis Cache for Survey Assignments (Quality Agents)
 * 
 * Top-Tier Tech Company Solution (Meta, Google, Amazon pattern)
 * 
 * This cache stores survey assignments for Quality Agents to prevent
 * repeated expensive database queries when loading assignments.
 * 
 * Cache Strategy:
 * - TTL: 5 minutes (assignments change infrequently, but need reasonable freshness)
 * - Primary Storage: Redis (distributed, shared across workers/servers)
 * - Fallback: In-memory Map (if Redis unavailable - graceful degradation)
 * - Cache Key: qa:survey_assignments:${userId}:${companyId}
 * - Cleanup: Automatic via TTL expiration
 * - Invalidation: Event-based (when assignments change)
 */

const redisOps = require('./redisClient');

class SurveyAssignmentCache {
  constructor() {
    this.cache = new Map(); // In-memory fallback cacheKey -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 5 minutes) - only for in-memory fallback
    this.startCleanup();
  }

  /**
   * Generate cache key from userId and companyId
   * @param {string} userId - User ID
   * @param {string} companyId - Company ID
   * @returns {string} - Cache key
   */
  generateKey(userId, companyId) {
    return `qa:survey_assignments:${userId}:${companyId}`;
  }

  /**
   * Get cached survey assignments for a Quality Agent
   * @param {string} userId - User ID
   * @param {string} companyId - Company ID
   * @returns {Promise<Object|null>} - Cached survey assignments or null if not found/expired
   */
  async get(userId, companyId) {
    const key = this.generateKey(userId, companyId);
    
    // Try Redis first (primary cache)
    // Note: redisOps.get() already parses JSON automatically
    try {
      const cached = await redisOps.get(key);
      if (cached) {
        return cached;
      }
    } catch (error) {
      // Redis failed, fall back to in-memory
      console.warn(`⚠️ SurveyAssignmentCache: Redis get failed, using in-memory fallback: ${error.message}`);
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
   * Store survey assignments in cache
   * @param {string} userId - User ID
   * @param {string} companyId - Company ID
   * @param {Object} data - The survey assignments data to cache ({ assignedSurveyIds, surveyAssignmentsMap })
   * @param {number} ttlSeconds - Time to live in seconds (default: 5 minutes)
   */
  async set(userId, companyId, data, ttlSeconds = 5 * 60) {
    const key = this.generateKey(userId, companyId);
    
    // Try Redis first (primary cache)
    // Note: redisOps.set() automatically serializes JSON
    try {
      await redisOps.set(key, data, ttlSeconds);
    } catch (error) {
      // Redis failed, fall back to in-memory
      console.warn(`⚠️ SurveyAssignmentCache: Redis set failed, using in-memory fallback: ${error.message}`);
      const expiresAt = Date.now() + (ttlSeconds * 1000);
      this.cache.set(key, { data, expiresAt });
    }
  }

  /**
   * Invalidate cache for a specific Quality Agent
   * Called when survey assignments are updated/created/deleted
   * @param {string} userId - User ID
   * @param {string} companyId - Company ID
   */
  async invalidate(userId, companyId) {
    const key = this.generateKey(userId, companyId);
    
    // Delete from Redis
    try {
      await redisOps.del(key);
    } catch (error) {
      console.warn(`⚠️ SurveyAssignmentCache: Redis delete failed (non-critical): ${error.message}`);
    }
    
    // Delete from in-memory fallback
    this.cache.delete(key);
  }

  /**
   * Invalidate cache for all Quality Agents in a company
   * Called when company-wide changes occur (rare, but useful for cleanup)
   * @param {string} companyId - Company ID
   */
  async invalidateCompany(companyId) {
    // For Redis: Pattern deletion would require SCAN (expensive)
    // Instead, rely on TTL expiration (5 minutes is acceptable)
    // Individual user caches will expire naturally
    
    // For in-memory: Clear all entries with this companyId
    const keysToDelete = [];
    const prefix = `qa:survey_assignments:`;
    const suffix = `:${companyId}`;
    
    for (const [key] of this.cache.entries()) {
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        keysToDelete.push(key);
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key));
    
    if (keysToDelete.length > 0) {
      console.log(`🧹 SurveyAssignmentCache: Cleared ${keysToDelete.length} in-memory entries for company ${companyId}`);
    }
    
    // Note: Redis entries will expire via TTL (5 minutes)
    // Pattern deletion with SCAN is expensive and not necessary for 5-minute TTL
  }

  /**
   * Clear all cache entries (useful for testing or manual cache invalidation)
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache size (for monitoring)
   * @returns {number} - Number of entries in in-memory fallback cache
   */
  size() {
    return this.cache.size;
  }

  /**
   * Start cleanup interval to remove expired entries from in-memory fallback
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
   * Remove expired entries from in-memory fallback cache
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
      console.log(`🧹 SurveyAssignmentCache: Cleaned up ${cleanedCount} expired in-memory entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const surveyAssignmentCache = new SurveyAssignmentCache();

module.exports = surveyAssignmentCache;

