const redisOps = require('./redisClient');
const fs = require('fs').promises;
const path = require('path');

// Cache TTL: 30 minutes (contacts can change, but not frequently)
const CONTACTS_CACHE_TTL = 1800; // 30 minutes in seconds

// Cache key prefix
const CACHE_KEY_PREFIX = 'respondent-contacts:';

/**
 * Get cache key for respondent contacts
 */
const getCacheKey = (surveyId, page, limit) => {
  return `${CACHE_KEY_PREFIX}${surveyId}:page:${page}:limit:${limit}`;
};

/**
 * Get cache key for total count
 */
const getTotalCountKey = (surveyId) => {
  return `${CACHE_KEY_PREFIX}${surveyId}:total`;
};

/**
 * Get cache key for file metadata (size, mtime)
 */
const getFileMetadataKey = (surveyId) => {
  return `${CACHE_KEY_PREFIX}${surveyId}:metadata`;
};

/**
 * Get respondent contacts from cache or file
 * Top tech companies use this pattern: Cache-Aside with pagination
 */
const getRespondentContacts = async (surveyId, page = 1, limit = 50) => {
  const cacheKey = getCacheKey(surveyId, page, limit);
  const totalCountKey = getTotalCountKey(surveyId);
  const metadataKey = getFileMetadataKey(surveyId);

  // Try cache first
  try {
    const [cachedContacts, cachedTotal, cachedMetadata] = await Promise.all([
      redisOps.get(cacheKey),
      redisOps.get(totalCountKey),
      redisOps.get(metadataKey)
    ]);

    if (cachedContacts && cachedTotal !== null) {
      // Check if file has been modified (invalidate cache if changed)
      const filePath = path.join('/var/www/opine', 'data', 'respondent-contacts', `${surveyId}.json`);
      try {
        const stats = await fs.stat(filePath);
        const currentMetadata = {
          size: stats.size,
          mtime: stats.mtime.getTime()
        };

        if (cachedMetadata && 
            cachedMetadata.size === currentMetadata.size &&
            cachedMetadata.mtime === currentMetadata.mtime) {
          // File hasn't changed, return cached data
          console.log(`✅ Respondent contacts cache HIT: ${surveyId} (page ${page}, limit ${limit})`);
          return {
            contacts: cachedContacts,
            total: cachedTotal,
            fromCache: true
          };
        } else {
          // File changed, invalidate cache
          console.log(`🔄 File modified, invalidating cache: ${surveyId}`);
          await invalidateContactsCache(surveyId);
        }
      } catch (fileError) {
        // File doesn't exist, but cache does - use cache
        if (cachedContacts && cachedTotal !== null) {
          return {
            contacts: cachedContacts,
            total: cachedTotal,
            fromCache: true
          };
        }
      }
    }
  } catch (error) {
    console.warn('⚠️ Cache read error, falling back to file:', error.message);
  }

  // Cache miss or invalidated - will be loaded by caller
  return null;
};

/**
 * Set respondent contacts in cache
 */
const setRespondentContacts = async (surveyId, page, limit, contacts, total, fileMetadata = null) => {
  const cacheKey = getCacheKey(surveyId, page, limit);
  const totalCountKey = getTotalCountKey(surveyId);
  const metadataKey = getFileMetadataKey(surveyId);

  try {
    await Promise.all([
      redisOps.set(cacheKey, contacts, CONTACTS_CACHE_TTL),
      redisOps.set(totalCountKey, total, CONTACTS_CACHE_TTL),
      fileMetadata ? redisOps.set(metadataKey, fileMetadata, CONTACTS_CACHE_TTL) : Promise.resolve()
    ]);
    console.log(`✅ Respondent contacts cached: ${surveyId} (page ${page}, limit ${limit})`);
  } catch (error) {
    console.warn('⚠️ Cache write error (non-blocking):', error.message);
  }
};

/**
 * Invalidate respondent contacts cache (call when contacts are updated)
 */
const invalidateContactsCache = async (surveyId) => {
  // Note: We can't easily delete all keys with pattern, so we'll just let them expire
  // For now, we'll delete the metadata key which will force cache refresh
  const metadataKey = getFileMetadataKey(surveyId);
  try {
    await redisOps.del(metadataKey);
    console.log(`🗑️ Respondent contacts cache invalidated: ${surveyId}`);
  } catch (error) {
    console.warn('⚠️ Cache invalidation error:', error.message);
  }
};

module.exports = {
  getRespondentContacts,
  setRespondentContacts,
  invalidateContactsCache,
  CONTACTS_CACHE_TTL
};




