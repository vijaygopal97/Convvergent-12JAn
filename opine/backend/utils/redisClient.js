const Redis = require('ioredis');

// Redis connection configuration
// Falls back to in-memory if Redis is not available
let redisClient = null;
let useInMemory = false;

// In-memory store as fallback
const inMemoryStore = new Map();

const createRedisClient = () => {
  try {
    // Try to connect to Redis
    // Use REDIS_URL from env or default to localhost
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST || 'redis://localhost:6379';
    
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.warn('⚠️ Redis connection failed after 3 retries, using in-memory fallback');
          useInMemory = true;
          return null; // Stop retrying
        }
        return Math.min(times * 50, 2000);
      },
      lazyConnect: true,
      enableOfflineQueue: false
    });

    client.on('error', (err) => {
      console.error('❌ Redis error:', err.message);
      if (!useInMemory) {
        console.warn('⚠️ Falling back to in-memory storage');
        useInMemory = true;
      }
    });

    client.on('connect', () => {
      console.log('✅ Redis connected successfully');
      useInMemory = false;
    });

    return client;
  } catch (error) {
    console.warn('⚠️ Redis initialization failed, using in-memory fallback:', error.message);
    useInMemory = true;
    return null;
  }
};

// Initialize Redis client
redisClient = createRedisClient();

// Connect to Redis (non-blocking)
if (redisClient) {
  redisClient.connect().catch((err) => {
    console.warn('⚠️ Redis connection failed, using in-memory fallback:', err.message);
    useInMemory = true;
  });
}

// Redis operations with in-memory fallback
const redisOps = {
  async get(key) {
    if (useInMemory || !redisClient) {
      return inMemoryStore.get(key) || null;
    }
    try {
      const value = await redisClient.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.warn('Redis get error, using in-memory:', error.message);
      return inMemoryStore.get(key) || null;
    }
  },

  async set(key, value, expirySeconds = null) {
    const serialized = JSON.stringify(value);
    if (useInMemory || !redisClient) {
      inMemoryStore.set(key, value);
      if (expirySeconds) {
        setTimeout(() => inMemoryStore.delete(key), expirySeconds * 1000);
      }
      return;
    }
    try {
      if (expirySeconds) {
        await redisClient.setex(key, expirySeconds, serialized);
      } else {
        await redisClient.set(key, serialized);
      }
    } catch (error) {
      console.warn('Redis set error, using in-memory:', error.message);
      inMemoryStore.set(key, value);
      if (expirySeconds) {
        setTimeout(() => inMemoryStore.delete(key), expirySeconds * 1000);
      }
    }
  },

  async del(key) {
    if (useInMemory || !redisClient) {
      inMemoryStore.delete(key);
      return;
    }
    try {
      await redisClient.del(key);
    } catch (error) {
      console.warn('Redis del error, using in-memory:', error.message);
      inMemoryStore.delete(key);
    }
  },

  async exists(key) {
    if (useInMemory || !redisClient) {
      return inMemoryStore.has(key) ? 1 : 0;
    }
    try {
      return await redisClient.exists(key);
    } catch (error) {
      console.warn('Redis exists error, using in-memory:', error.message);
      return inMemoryStore.has(key) ? 1 : 0;
    }
  },

  // Pipeline for batch operations (Phase 6 optimization)
  async pipeline(commands) {
    if (useInMemory || !redisClient) {
      // In-memory fallback: execute commands sequentially
      const results = [];
      for (const cmd of commands) {
        const [operation, key, ...args] = cmd;
        if (operation === 'get') {
          results.push([null, inMemoryStore.get(key) || null]);
        } else if (operation === 'set') {
          const [value, expiry] = args;
          inMemoryStore.set(key, value);
          if (expiry) {
            setTimeout(() => inMemoryStore.delete(key), expiry * 1000);
          }
          results.push([null, 'OK']);
        } else if (operation === 'del') {
          inMemoryStore.delete(key);
          results.push([null, 1]);
        }
      }
      return results;
    }
    try {
      const pipeline = redisClient.pipeline();
      commands.forEach(([operation, key, ...args]) => {
        if (operation === 'get') {
          pipeline.get(key);
        } else if (operation === 'set') {
          const [value, expiry] = args;
          const serialized = JSON.stringify(value);
          if (expiry) {
            pipeline.setex(key, expiry, serialized);
          } else {
            pipeline.set(key, serialized);
          }
        } else if (operation === 'del') {
          pipeline.del(key);
        }
      });
      return await pipeline.exec();
    } catch (error) {
      console.warn('Redis pipeline error, using sequential:', error.message);
      // Fallback to sequential execution
      const results = [];
      for (const cmd of commands) {
        const [operation, key, ...args] = cmd;
        try {
          if (operation === 'get') {
            const value = await this.get(key);
            results.push([null, value]);
          } else if (operation === 'set') {
            const [value, expiry] = args;
            await this.set(key, value, expiry);
            results.push([null, 'OK']);
          } else if (operation === 'del') {
            await this.del(key);
            results.push([null, 1]);
          }
        } catch (err) {
          results.push([err, null]);
        }
      }
      return results;
    }
  },

  // Get Redis client for Bull queue (returns null if using in-memory)
  getClient() {
    if (useInMemory || !redisClient) {
      return null;
    }
    return redisClient;
  },

  // Check if using in-memory
  isUsingInMemory() {
    return useInMemory || !redisClient;
  }
};

module.exports = redisOps;




