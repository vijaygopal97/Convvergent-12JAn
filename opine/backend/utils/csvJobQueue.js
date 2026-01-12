const Queue = require('bull');
const path = require('path');

// Create job queue for CSV generation
// Bull requires Redis - no fallback to in-memory
let csvQueue = null;

const createQueue = () => {
  try {
    // Redis configuration - Bull requires Redis
    // Note: Bull doesn't allow enableReadyCheck or maxRetriesPerRequest
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      db: parseInt(process.env.REDIS_DB || '0', 10)
    };

    console.log(`📡 Connecting to Redis at ${redisConfig.host}:${redisConfig.port}...`);

    csvQueue = new Queue('csv-generation', {
      redis: redisConfig,
      defaultJobOptions: {
        removeOnComplete: {
          age: 3600, // Keep completed jobs for 1 hour
          count: 100 // Keep max 100 completed jobs
        },
        removeOnFail: {
          age: 86400, // Keep failed jobs for 24 hours
          count: 50 // Keep max 50 failed jobs
        },
        attempts: 1, // Don't retry failed jobs (CSV generation should be idempotent)
        timeout: 1800000 // 30 minutes timeout per job
      }
    });

    // Queue event handlers
    csvQueue.on('error', (error) => {
      console.error('❌ CSV Queue error:', error.message);
      // Don't exit - let it retry
    });

    csvQueue.on('ready', () => {
      console.log('✅ CSV Queue connected to Redis successfully');
    });

    csvQueue.on('waiting', (jobId) => {
      console.log(`📋 CSV Job ${jobId} is waiting`);
    });

    csvQueue.on('active', (job) => {
      console.log(`🔄 CSV Job ${job.id} is now active`);
    });

    csvQueue.on('completed', (job, result) => {
      console.log(`✅ CSV Job ${job.id} completed`);
    });

    csvQueue.on('failed', (job, err) => {
      console.error(`❌ CSV Job ${job.id} failed:`, err.message);
    });

    // Wait for Redis connection
    csvQueue.on('error', (error) => {
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ Redis connection refused. Please ensure Redis is running.');
      }
    });

    return csvQueue;
  } catch (error) {
    console.error('❌ Failed to create CSV queue:', error);
    throw error; // Fail fast - Redis is required
  }
};

// Initialize queue
csvQueue = createQueue();

// Helper functions
const addCSVJob = async (jobData) => {
  if (!csvQueue) {
    throw new Error('CSV queue is not initialized. Redis connection may have failed.');
  }
  
  try {
    const job = await csvQueue.add('generate-csv', jobData, {
      jobId: jobData.jobId, // Use custom job ID for tracking
      priority: jobData.priority || 0
    });
    
    console.log(`✅ Job ${jobData.jobId} added to queue (Bull job ID: ${job.id})`);
    return job;
  } catch (error) {
    console.error('❌ Error adding job to queue:', error);
    throw new Error(`Failed to add job to queue: ${error.message}`);
  }
};

const getJob = async (jobId) => {
  if (!csvQueue) {
    return null;
  }
  
  try {
    return await csvQueue.getJob(jobId);
  } catch (error) {
    console.error('❌ Error getting job from queue:', error);
    return null;
  }
};

const getJobProgress = async (jobId) => {
  try {
    if (!csvQueue) {
      console.error('❌ CSV queue not initialized');
      return null;
    }

    const job = await getJob(jobId);
    if (!job) {
      console.warn(`⚠️ Job not found: ${jobId}`);
      return null;
    }
    
    // Get job state with timeout protection
    let state;
    try {
      state = await Promise.race([
        job.getState(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout getting job state')), 5000))
      ]);
    } catch (error) {
      console.error(`❌ Error getting job state for ${jobId}:`, error.message);
      state = 'unknown';
    }
    
    // Get progress safely
    let progress;
    try {
      const rawProgress = job.progress();
      if (typeof rawProgress === 'object' && rawProgress !== null) {
        progress = rawProgress;
      } else {
        progress = { percentage: typeof rawProgress === 'number' ? rawProgress : 0 };
      }
    } catch (error) {
      console.error(`❌ Error getting job progress for ${jobId}:`, error.message);
      progress = { percentage: 0 };
    }
    
  // Get result - check multiple places
  let result = job.returnvalue || null;
  
  // If no returnvalue but job is completed, try to get from job.opts or job.data
  if (!result && state === 'completed') {
    // Sometimes result is stored differently
    result = job.opts?.result || job.data?.result || null;
  }
  
  return {
    jobId: job.id || jobId,
    state: state,
    progress: progress,
    data: job.data || {},
    result: result,
    failedReason: job.failedReason || null,
    createdAt: job.timestamp ? new Date(job.timestamp) : new Date(),
    processedAt: job.processedOn ? new Date(job.processedOn) : null,
    finishedAt: job.finishedOn ? new Date(job.finishedOn) : null
  };
  } catch (error) {
    console.error(`❌ Error in getJobProgress for ${jobId}:`, error);
    return null;
  }
};

/**
 * Find existing active job by fingerprint (for smart job linking)
 * Returns jobId if found, null otherwise
 */
const findActiveJobByFingerprint = async (fingerprint) => {
  if (!csvQueue) {
    return null;
  }

  try {
    // Get all jobs (waiting, active, completed, failed)
    const [waiting, active, completed, failed] = await Promise.all([
      csvQueue.getWaiting(),
      csvQueue.getActive(),
      csvQueue.getCompleted(),
      csvQueue.getFailed()
    ]);

    // Check active and waiting jobs first (most likely to be the one we want)
    const allActiveJobs = [...waiting, ...active];
    
    for (const job of allActiveJobs) {
      if (job.id && job.id.startsWith(fingerprint)) {
        const state = await job.getState();
        // Only return if job is waiting or active (not failed)
        if (state === 'waiting' || state === 'active') {
          console.log(`🔗 Found existing active job for fingerprint ${fingerprint}: ${job.id}`);
          return job.id;
        }
      }
    }

    // Check recently completed jobs (within last 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const job of completed) {
      if (job.id && job.id.startsWith(fingerprint)) {
        const finishedTime = job.finishedOn || 0;
        if (finishedTime > fiveMinutesAgo) {
          console.log(`🔗 Found recently completed job for fingerprint ${fingerprint}: ${job.id}`);
          return job.id;
        }
      }
    }

    return null;
  } catch (error) {
    console.error('❌ Error finding job by fingerprint:', error);
    return null;
  }
};

module.exports = {
  csvQueue,
  addCSVJob,
  getJob,
  getJobProgress,
  findActiveJobByFingerprint
};

