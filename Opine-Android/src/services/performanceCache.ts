/**
 * Performance Cache Service - In-Memory Caching for Ultra-Fast Access
 * 
 * This service provides in-memory caching for frequently accessed data:
 * - Survey data (by surveyId)
 * - User data (single instance)
 * - Assignment lookups (by surveyId + userId)
 * - Online status (cached for 30 seconds)
 * 
 * Cache strategy: TTL-based with automatic expiration
 * Memory-efficient: Uses Map for O(1) lookups
 * 
 * Design inspired by Meta/Amazon performance patterns
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

interface AssignmentCache {
  foundAssignment: boolean;
  requiresACSelection: boolean;
  assignedACs: string[];
  surveyId: string;
  userId: string;
}

class PerformanceCacheService {
  // Survey cache: Map<surveyId, CacheEntry<survey>>
  private surveyCache = new Map<string, CacheEntry<any>>();
  
  // All surveys cache (for batch operations)
  private allSurveysCache: CacheEntry<any[]> | null = null;
  
  // User data cache (single instance)
  private userDataCache: CacheEntry<any> | null = null;
  
  // Assignment cache: Map<`${surveyId}:${userId}`, AssignmentCache>
  private assignmentCache = new Map<string, CacheEntry<AssignmentCache>>();
  
  // Online status cache
  private onlineStatusCache: { isOnline: boolean; timestamp: number } | null = null;
  private readonly ONLINE_STATUS_TTL = 30000; // 30 seconds
  
  // TTL constants
  private readonly SURVEY_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly USER_DATA_TTL = 30 * 60 * 1000; // 30 minutes (session duration)
  private readonly ASSIGNMENT_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly ALL_SURVEYS_TTL = 5 * 60 * 1000; // 5 minutes

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T> | null): boolean {
    if (!entry) return false;
    const now = Date.now();
    return (now - entry.timestamp) < entry.ttl;
  }

  /**
   * Get survey from cache
   */
  getSurvey(surveyId: string): any | null {
    const entry = this.surveyCache.get(surveyId);
    if (this.isCacheValid(entry)) {
      return entry!.data;
    }
    // Cache expired or not found
    if (entry) {
      this.surveyCache.delete(surveyId);
    }
    return null;
  }

  /**
   * Cache a survey
   */
  setSurvey(surveyId: string, survey: any, ttl?: number): void {
    this.surveyCache.set(surveyId, {
      data: survey,
      timestamp: Date.now(),
      ttl: ttl || this.SURVEY_TTL,
    });
  }

  /**
   * Get all surveys from cache
   */
  getAllSurveys(): any[] | null {
    if (this.isCacheValid(this.allSurveysCache)) {
      return this.allSurveysCache!.data;
    }
    this.allSurveysCache = null;
    return null;
  }

  /**
   * Cache all surveys
   */
  setAllSurveys(surveys: any[], ttl?: number): void {
    this.allSurveysCache = {
      data: surveys,
      timestamp: Date.now(),
      ttl: ttl || this.ALL_SURVEYS_TTL,
    };
    
    // Also cache individual surveys for faster lookup
    surveys.forEach((survey) => {
      const id = survey._id || survey.id;
      if (id) {
        this.setSurvey(id, survey, ttl);
      }
    });
  }

  /**
   * Invalidate survey cache (when surveys are synced)
   */
  invalidateSurvey(surveyId?: string): void {
    if (surveyId) {
      this.surveyCache.delete(surveyId);
    } else {
      // Invalidate all
      this.surveyCache.clear();
      this.allSurveysCache = null;
    }
  }

  /**
   * Get user data from cache
   */
  getUserData(): any | null {
    if (this.isCacheValid(this.userDataCache)) {
      return this.userDataCache!.data;
    }
    this.userDataCache = null;
    return null;
  }

  /**
   * Cache user data
   */
  setUserData(userData: any, ttl?: number): void {
    this.userDataCache = {
      data: userData,
      timestamp: Date.now(),
      ttl: ttl || this.USER_DATA_TTL,
    };
  }

  /**
   * Invalidate user data cache
   */
  invalidateUserData(): void {
    this.userDataCache = null;
  }

  /**
   * Get assignment from cache
   */
  getAssignment(surveyId: string, userId: string): AssignmentCache | null {
    const key = `${surveyId}:${userId}`;
    const entry = this.assignmentCache.get(key);
    if (this.isCacheValid(entry)) {
      return entry!.data;
    }
    if (entry) {
      this.assignmentCache.delete(key);
    }
    return null;
  }

  /**
   * Cache assignment result
   */
  setAssignment(
    surveyId: string,
    userId: string,
    assignment: AssignmentCache,
    ttl?: number
  ): void {
    const key = `${surveyId}:${userId}`;
    this.assignmentCache.set(key, {
      data: assignment,
      timestamp: Date.now(),
      ttl: ttl || this.ASSIGNMENT_TTL,
    });
  }

  /**
   * Invalidate assignment cache for a survey
   */
  invalidateAssignment(surveyId?: string, userId?: string): void {
    if (surveyId && userId) {
      const key = `${surveyId}:${userId}`;
      this.assignmentCache.delete(key);
    } else if (surveyId) {
      // Invalidate all assignments for this survey
      for (const key of this.assignmentCache.keys()) {
        if (key.startsWith(`${surveyId}:`)) {
          this.assignmentCache.delete(key);
        }
      }
    } else {
      // Invalidate all
      this.assignmentCache.clear();
    }
  }

  /**
   * Get cached online status
   */
  getOnlineStatus(): boolean | null {
    if (this.onlineStatusCache) {
      const now = Date.now();
      if ((now - this.onlineStatusCache.timestamp) < this.ONLINE_STATUS_TTL) {
        return this.onlineStatusCache.isOnline;
      }
    }
    return null;
  }

  /**
   * Cache online status
   */
  setOnlineStatus(isOnline: boolean): void {
    this.onlineStatusCache = {
      isOnline,
      timestamp: Date.now(),
    };
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.surveyCache.clear();
    this.allSurveysCache = null;
    this.userDataCache = null;
    this.assignmentCache.clear();
    this.onlineStatusCache = null;
  }

  /**
   * Get cache statistics (for debugging)
   */
  getStats(): {
    surveyCount: number;
    assignmentCount: number;
    hasUserData: boolean;
    hasAllSurveys: boolean;
  } {
    return {
      surveyCount: this.surveyCache.size,
      assignmentCount: this.assignmentCache.size,
      hasUserData: this.userDataCache !== null && this.isCacheValid(this.userDataCache),
      hasAllSurveys: this.allSurveysCache !== null && this.isCacheValid(this.allSurveysCache),
    };
  }
}

// Singleton instance
export const performanceCache = new PerformanceCacheService();



