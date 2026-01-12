/**
 * CATI Call Worker (BullMQ)
 * 
 * Background worker process that handles DeepCall API calls asynchronously.
 * This prevents blocking the main Node.js event loop when making external API calls.
 * 
 * Pattern used by top-tier companies: Meta (WhatsApp), Amazon (SQS workers), Google (Cloud Tasks)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const axios = require('axios');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const Survey = require('../models/Survey'); // CRITICAL: Import Survey model to prevent "Schema hasn't been registered" error
const redisOps = require('../utils/redisClient');

// DeepCall API Configuration
const DEEPCALL_API_BASE_URL = 'https://s-ct3.sarv.com/v2/clickToCall/para';
const DEEPCALL_USER_ID = process.env.DEEPCALL_USER_ID || '89130240';
const DEEPCALL_TOKEN = process.env.DEEPCALL_TOKEN || '6GQJuwW6lB8ZBHntzaRU';

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ CATI Call Worker: MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

// Connect to MongoDB
(async () => {
  try {
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 20,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000
    });
    console.log('✅ CATI Call Worker: Connected to MongoDB successfully!');
  } catch (error) {
    console.error('❌ CATI Call Worker: MongoDB connection failed:', error);
    process.exit(1);
  }
})();

// Redis connection configuration (same as queue)
const getRedisConnection = () => {
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_HOST || 'redis://localhost:6379';
  
  let connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || '0', 10),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: false
  };
  
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

// Helper function to make call via DeepCall API (same as controller)
const initiateDeepCall = async (fromNumber, toNumber, fromType = 'Number', toType = 'Number', fromRingTime = 30, toRingTime = 30) => {
  try {
    const cleanFrom = fromNumber.replace(/[^0-9]/g, '');
    const cleanTo = toNumber.replace(/[^0-9]/g, '');

    const params = {
      user_id: DEEPCALL_USER_ID,
      token: DEEPCALL_TOKEN,
      from: cleanFrom,
      to: cleanTo,
      fromType: fromType,
      toType: toType,
      fromRingTime: parseInt(fromRingTime),
      toRingTime: parseInt(toRingTime)
    };

    const queryString = new URLSearchParams(params).toString();
    const fullUrl = `${DEEPCALL_API_BASE_URL}?${queryString}`;

    console.log(`📞 [Worker] Making CATI call: ${fromNumber} -> ${toNumber}`);

    const response = await axios.get(fullUrl, {
      timeout: 10000, // 10 seconds timeout (reduced from 30s)
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const apiResponse = response.data;
    console.log('📞 [Worker] DeepCall API raw response:', apiResponse);
    
    // Normalize common fields
    const status = typeof apiResponse?.status === 'string'
      ? apiResponse.status.toLowerCase()
      : apiResponse?.status;
    const code = apiResponse?.code ?? apiResponse?.statusCode ?? apiResponse?.status_code;

    // Treat as error only when status explicitly indicates error or when we have a clear non‑success code
    const isExplicitErrorStatus = status === 'error' || status === 'failed' || status === 'failure';
    const isErrorCode = code !== undefined && !['0', 0, '200', 200].includes(code);

    if (isExplicitErrorStatus || isErrorCode) {
      const errorMessage =
        apiResponse.message ||
        (typeof apiResponse.error === 'string' ? apiResponse.error : apiResponse.error?.message) ||
        `DeepCall API Error: ${code || 'Unknown error'}`;
      return {
        success: false,
        message: errorMessage,
        error: {
          message: errorMessage,
          code,
          status: apiResponse.status,
          details: apiResponse
        },
        statusCode: code
      };
    }
    
    const callId = apiResponse?.callId || apiResponse?.id || apiResponse?.call_id || apiResponse?.data?.callId;

    if (!callId) {
      return {
        success: false,
        message: 'API response does not contain call ID',
        error: {
          message: 'API response does not contain call ID',
          details: apiResponse
        },
        apiResponse: apiResponse
      };
    }

    return {
      success: true,
      callId: callId,
      data: {
        callId: callId,
        fromNumber: fromNumber,
        toNumber: toNumber,
        apiResponse: apiResponse
      }
    };
  } catch (error) {
    console.error('❌ [Worker] DeepCall API Error:', error.message);
    return {
      success: false,
      message: error.response?.data?.message || error.message || 'Failed to initiate call',
      error: {
        message: error.response?.data?.message || error.message,
        code: error.response?.status,
        details: error.response?.data || error.message
      },
      statusCode: error.response?.status
    };
  }
};

// Create worker
const createWorker = () => {
  try {
    const connection = getRedisConnection();
    
    const worker = new Worker(
      'cati-call',
      async (job) => {
        console.log(`\n🔄 [Worker] Processing job ${job.id}...`);
        console.log(`   Queue ID: ${job.data.queueId}`);
        console.log(`   From: ${job.data.fromNumber} -> To: ${job.data.toNumber}`);
        
        try {
          const { queueId, fromNumber, toNumber, fromType, toType, interviewerId, surveyId } = job.data;
          
          // Update job progress
          await job.updateProgress({ stage: 'calling_api', progress: 25 });
          
          // Make DeepCall API call
          const callResult = await initiateDeepCall(
            fromNumber,
            toNumber,
            fromType || 'Number',
            toType || 'Number',
            30,
            30
          );
          
          await job.updateProgress({ stage: 'processing_response', progress: 50 });
          
          // Get queue entry
          const queueEntry = await CatiRespondentQueue.findById(queueId)
            .populate('survey', 'surveyName');
          
          if (!queueEntry) {
            throw new Error(`Queue entry not found: ${queueId}`);
          }
          
          if (!callResult.success) {
            // Update queue entry on failure
            queueEntry.status = 'pending';
            queueEntry.priority = -1;
            queueEntry.assignedTo = null;
            queueEntry.assignedAt = null;
            queueEntry.currentAttemptNumber = (queueEntry.currentAttemptNumber || 0) + 1;
            
            const errorMessage = callResult.message || 'Call initiation failed';
            
            queueEntry.callAttempts = queueEntry.callAttempts || [];
            queueEntry.callAttempts.push({
              attemptNumber: queueEntry.currentAttemptNumber,
              attemptedAt: new Date(),
              attemptedBy: interviewerId,
              status: 'failed',
              reason: errorMessage
            });
            
            queueEntry.createdAt = new Date();
            await queueEntry.save();
            
            await job.updateProgress({ stage: 'failed', progress: 100 });
            
            return {
              success: false,
              message: errorMessage,
              error: callResult.error
            };
          }
          
          // Create call record
          await job.updateProgress({ stage: 'creating_call_record', progress: 75 });
          
          let tempCallRecord = null;
          if (callResult.success && callResult.callId) {
            try {
              tempCallRecord = new CatiCall({
                callId: callResult.callId,
                survey: surveyId || queueEntry.survey._id,
                queueEntry: queueEntry._id,
                company: null,
                createdBy: interviewerId,
                fromNumber: fromNumber,
                toNumber: toNumber,
                fromType: fromType || 'Number',
                toType: toType || 'Number',
                callStatus: 'ringing',
                webhookReceived: false
              });
              await tempCallRecord.save();
              
              queueEntry.callRecord = tempCallRecord._id;
            } catch (error) {
              console.error('❌ [Worker] Error creating call record:', error.message);
              // Continue without call record - webhook will create it
            }
          }
          
          // Update queue entry
          queueEntry.status = 'calling';
          queueEntry.currentAttemptNumber = (queueEntry.currentAttemptNumber || 0) + 1;
          queueEntry.lastAttemptedAt = new Date();
          
          queueEntry.callAttempts = queueEntry.callAttempts || [];
          queueEntry.callAttempts.push({
            attemptNumber: queueEntry.currentAttemptNumber,
            attemptedAt: new Date(),
            attemptedBy: interviewerId,
            callId: callResult.data?.callId,
            status: 'initiated'
          });
          
          await queueEntry.save();
          
          await job.updateProgress({ stage: 'completed', progress: 100 });
          
          console.log(`✅ [Worker] Job ${job.id} completed successfully`);
          console.log(`   Call ID: ${callResult.callId}`);
          
          return {
            success: true,
            callId: callResult.data?.callId,
            fromNumber,
            toNumber,
            queueId: queueEntry._id,
            callRecordId: tempCallRecord?._id
          };
        } catch (error) {
          console.error(`❌ [Worker] Job ${job.id} failed:`, error.message);
          await job.updateProgress({ stage: 'error', progress: 100 });
          throw error;
        }
      },
      {
        connection,
        concurrency: 20, // Process 20 jobs concurrently
        limiter: {
          max: 100, // Max 100 jobs
          duration: 60000 // Per minute (rate limit DeepCall API)
        }
      }
    );
    
    // Worker event handlers
    worker.on('completed', (job) => {
      console.log(`✅ [Worker] Job ${job.id} completed successfully`);
    });
    
    worker.on('failed', (job, err) => {
      console.error(`❌ [Worker] Job ${job?.id || 'unknown'} failed:`, err.message);
    });
    
    worker.on('error', (error) => {
      console.error('❌ [Worker] Worker error:', error.message);
    });
    
    console.log('✅ CATI Call Worker started successfully');
    console.log('   Concurrency: 20 jobs');
    console.log('   Rate limit: 100 jobs/minute');
    
    return worker;
  } catch (error) {
    console.error('❌ Failed to create CATI Call Worker:', error.message);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (worker) => {
  console.log('\n🛑 Shutting down CATI Call Worker...');
  await worker.close();
  await mongoose.disconnect();
  console.log('✅ CATI Call Worker shut down gracefully');
  process.exit(0);
};

// Start worker
const worker = createWorker();

// Handle shutdown signals
process.on('SIGTERM', () => shutdown(worker));
process.on('SIGINT', () => shutdown(worker));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
  shutdown(worker);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  shutdown(worker);
});


