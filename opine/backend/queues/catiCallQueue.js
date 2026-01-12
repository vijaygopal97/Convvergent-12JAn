/**
 * CATI Call Queue Definition (BullMQ)
 * 
 * This queue handles asynchronous DeepCall API calls to prevent blocking the main event loop.
 * Used by top-tier companies (Meta, Amazon, Google) for external API integrations.
 */

const { Queue } = require('bullmq');
const redisOps = require('../utils/redisClient');

// Redis connection configuration
const getRedisConnection = () => {
  const redisClient = redisOps.getClient();
  
  if (!redisClient) {
    throw new Error('Redis client not available. Please ensure Redis is running.');
  }
  
  // BullMQ needs a Redis connection object
  // Extract connection details from existing Redis client
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST || 'redis://localhost:6379';
  
  // Parse Redis URL or use environment variables
  let connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null, // BullMQ handles this
    enableReadyCheck: false,
    enableOfflineQueue: false
  };
  
  // If REDIS_URL is provided, parse it
  if (process.env.REDIS_URL && process.env.REDIS_URL.startsWith('redis://')) {
    try {
      const url = new URL(process.env.REDIS_URL);
      connection.host = url.hostname;
      connection.port = parseInt(url.port || '6379', 10);
      connection.password = url.password || undefined;
      connection.db = parseInt(url.pathname?.slice(1) || '0', 10);
    } catch (error) {
      console.warn('⚠️ Failed to parse REDIS_URL, using default connection settings');
    }
  }
  
  return connection;
};

// Create queue instance
let catiCallQueue = null;

const createQueue = () => {
  if (catiCallQueue) {
    return catiCallQueue;
  }
  
  try {
    const connection = getRedisConnection();
    
    catiCallQueue = new Queue('cati-call', {
      connection,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 1000 // Keep max 1000 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
          count: 5000 // Keep max 5000 failed jobs
        },
        attempts: 3, // Retry 3 times
        backoff: {
          type: 'exponential',
          delay: 2000 // Start with 2 seconds, double each retry
        },
        timeout: 10000 // 10 second timeout per job (reduced from 30s)
      }
    });
    
    console.log('✅ CATI Call Queue created successfully');
    
    // Handle queue events for monitoring
    catiCallQueue.on('error', (error) => {
      console.error('❌ CATI Call Queue error:', error.message);
    });
    
    return catiCallQueue;
  } catch (error) {
    console.error('❌ Failed to create CATI Call Queue:', error.message);
    throw error;
  }
};

// Get or create queue instance
const getQueue = () => {
  if (!catiCallQueue) {
    return createQueue();
  }
  return catiCallQueue;
};

// Add job to queue (non-blocking)
// TOP-TIER TECH COMPANY SOLUTION: Use deterministic jobId to prevent duplicate jobs
// BullMQ automatically prevents duplicate jobs if the same jobId is used
// Pattern used by: Meta (WhatsApp), Twitter, Google (Cloud Tasks)
const addCallJob = async (jobData) => {
  try {
    const queue = getQueue();
    
    // TOP-TIER TECH COMPANY SOLUTION: Use queueId as jobId (deterministic, prevents duplicates)
    // If a job with this ID already exists (waiting/active), BullMQ will return the existing job
    // This prevents duplicate calls even if makeCallToRespondent is called multiple times
    const deterministicJobId = `cati-call-${jobData.queueId}`;
    
    // Check if a job already exists for this queueId
    const existingJob = await queue.getJob(deterministicJobId);
    
    if (existingJob) {
      const existingState = await existingJob.getState();
      
      // If job is waiting or active, return existing job (prevent duplicate)
      if (existingState === 'waiting' || existingState === 'active') {
        console.log(`⚠️ Job already exists for queueId ${jobData.queueId} (state: ${existingState}), returning existing job`);
        return {
          success: true,
          jobId: existingJob.id,
          queueId: jobData.queueId,
          isDuplicate: true,
          existingState: existingState
        };
      }
      
      // If job is completed or failed, we can create a new one (retry scenario)
      // But only if the call actually failed - check queue entry status
      if (existingState === 'completed' || existingState === 'failed') {
        console.log(`ℹ️ Previous job ${existingState} for queueId ${jobData.queueId}, creating new job for retry`);
        // Continue to create new job below
      }
    }
    
    // Add job with deterministic ID (BullMQ will prevent duplicates automatically)
    const job = await queue.add('initiate-call', jobData, {
      jobId: deterministicJobId, // Deterministic: same queueId = same jobId
      priority: 1, // Normal priority
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000
      }
    });
    
    console.log(`✅ CATI call job added to queue: ${job.id} (queueId: ${jobData.queueId})`);
    
    return {
      success: true,
      jobId: job.id,
      queueId: jobData.queueId
    };
  } catch (error) {
    // If error is "Job already exists" (BullMQ duplicate prevention), that's actually good!
    if (error.message && error.message.includes('already exists')) {
      console.log(`⚠️ Job already exists for queueId ${jobData.queueId} (BullMQ duplicate prevention working)`);
      // Try to get the existing job
      try {
        const queue = getQueue();
        const existingJob = await queue.getJob(`cati-call-${jobData.queueId}`);
        if (existingJob) {
          return {
            success: true,
            jobId: existingJob.id,
            queueId: jobData.queueId,
            isDuplicate: true
          };
        }
      } catch (getJobError) {
        // Fall through to throw original error
      }
    }
    
    console.error('❌ Failed to add CATI call job to queue:', error.message);
    throw error;
  }
};

// Get job status
const getJobStatus = async (jobId) => {
  try {
    const queue = getQueue();
    const job = await queue.getJob(jobId);
    
    if (!job) {
      return {
        success: false,
        message: 'Job not found'
      };
    }
    
    const state = await job.getState();
    const progress = job.progress || {};
    
    return {
      success: true,
      jobId: job.id,
      state, // 'waiting', 'active', 'completed', 'failed', 'delayed'
      progress,
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn
    };
  } catch (error) {
    console.error('❌ Failed to get job status:', error.message);
    throw error;
  }
};

// Get job by queueId (find job for a queue entry)
// TOP-TIER TECH COMPANY SOLUTION: Use deterministic jobId for efficient lookup
// Since jobId is now deterministic (cati-call-{queueId}), we can get it directly
// This is MUCH more efficient than searching through all jobs
// Pattern used by: Meta (WhatsApp), Twitter, Google (Cloud Tasks)
const getJobByQueueId = async (queueId) => {
  try {
    const queue = getQueue();
    
    // TOP-TIER TECH COMPANY SOLUTION: Direct lookup using deterministic jobId
    // O(1) lookup instead of O(n) search - zero processing overhead
    const deterministicJobId = `cati-call-${queueId}`;
    const job = await queue.getJob(deterministicJobId);
    
    if (!job) {
      return null;
    }
    
    const state = await job.getState();
    
    return {
      jobId: job.id,
      state,
      progress: job.progress || {},
      data: job.data,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason
    };
  } catch (error) {
    console.error('❌ Failed to get job by queueId:', error.message);
    return null;
  }
};

module.exports = {
  getQueue,
  addCallJob,
  getJobStatus,
  getJobByQueueId
};


