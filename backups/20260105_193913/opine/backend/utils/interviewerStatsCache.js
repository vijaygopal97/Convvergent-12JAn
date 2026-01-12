/**
 * In-Memory Cache for Interviewer Stats
 * 
 * This cache stores getInterviewerStats results to prevent repeated database queries
 * when users refresh their dashboard frequently.
 * 
 * Cache Strategy:
 * - TTL: 2 minutes (stats change more frequently than CATI stats)
 * - Storage: In-memory Map (fast lookups)
 * - Cache Key: interviewerId
 * - Cleanup: Automatic via TTL expiration
 */

class InterviewerStatsCache {
  constructor() {
    this.cache = new Map(); // interviewerId -> { data, expiresAt }
    this.cleanupInterval = null;
    
    // Start cleanup interval (runs every 2 minutes)
    this.startCleanup();
  }

  /**
   * Get cached stats for an interviewer
   * @param {string} interviewerId - Interviewer ID
   * @returns {Object|null} - Cached stats or null if not found/expired
   */
  get(interviewerId) {
    const entry = this.cache.get(interviewerId);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(interviewerId);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Store stats in cache
   * @param {string} interviewerId - Interviewer ID
   * @param {Object} data - The stats data to cache
   * @param {number} ttlMs - Time to live in milliseconds (default: 2 minutes)
   */
  set(interviewerId, data, ttlMs = 2 * 60 * 1000) {
    const expiresAt = Date.now() + ttlMs;
    this.cache.set(interviewerId, { data, expiresAt });
  }

  /**
   * Delete entry from cache
   * @param {string} interviewerId - Interviewer ID
   */
  delete(interviewerId) {
    this.cache.delete(interviewerId);
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
    
    for (const [interviewerId, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(interviewerId);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      console.log(`🧹 InterviewerStatsCache: Cleaned up ${cleanedCount} expired entries (${this.cache.size} remaining)`);
    }
  }
}

// Export singleton instance
const interviewerStatsCache = new InterviewerStatsCache();

module.exports = interviewerStatsCache;

