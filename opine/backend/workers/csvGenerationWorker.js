require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const Queue = require('bull');
const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const SurveyResponse = require('../models/SurveyResponse');
const { generateCSVContent } = require('../utils/csvGeneratorHelper');
const fs = require('fs').promises;
const path = require('path');

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI is not defined in environment variables');
  process.exit(1);
}

// MongoDB connection state
let isMongoConnected = false;
let mongoConnectionRetries = 0;
const MAX_MONGO_RETRIES = 5;

// Connect to MongoDB with robust timeout settings
const connectToMongoDB = async () => {
  try {
    // Disconnect if already connected (to reset connection state)
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }

    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 50,
      minPoolSize: 5,
      serverSelectionTimeoutMS: 60000, // Increased to 60 seconds
      socketTimeoutMS: 600000, // 10 minutes - must be > maxTimeMS for queries
      connectTimeoutMS: 30000, // Increased to 30 seconds
      heartbeatFrequencyMS: 10000, // Check connection health every 10 seconds
      retryWrites: true,
      retryReads: true
    });
    
    isMongoConnected = true;
    mongoConnectionRetries = 0;
    console.log('✅ CSV Worker: Connected to MongoDB successfully!');
    
    // Monitor connection state
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️ CSV Worker: MongoDB connection lost, will reconnect on next job');
      isMongoConnected = false;
    });
    
    mongoose.connection.on('error', (error) => {
      console.error('❌ CSV Worker: MongoDB connection error:', error.message);
      isMongoConnected = false;
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('✅ CSV Worker: MongoDB reconnected');
      isMongoConnected = true;
      mongoConnectionRetries = 0;
    });
    
  } catch (error) {
    mongoConnectionRetries++;
    console.error(`❌ CSV Worker: MongoDB connection failed (attempt ${mongoConnectionRetries}/${MAX_MONGO_RETRIES}):`, error.message);
    isMongoConnected = false;
    
    if (mongoConnectionRetries >= MAX_MONGO_RETRIES) {
      console.error('❌ CSV Worker: Max MongoDB connection retries reached, exiting...');
      process.exit(1);
    }
    
    // Retry after delay
    setTimeout(() => {
      console.log(`🔄 CSV Worker: Retrying MongoDB connection...`);
      connectToMongoDB();
    }, 5000);
  }
};

// Initial connection
connectToMongoDB();

// Health check function to ensure MongoDB connection is active
const ensureMongoConnection = async () => {
  try {
    // Check if connection is ready
    if (mongoose.connection.readyState === 1) {
      // Ping to verify connection is actually working
      await mongoose.connection.db.admin().ping();
      isMongoConnected = true;
      return true;
    } else {
      // Connection is not ready, try to reconnect
      console.log('🔄 CSV Worker: MongoDB connection not ready, reconnecting...');
      await connectToMongoDB();
      // Wait a bit for connection to establish
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
        isMongoConnected = true;
        return true;
      }
      return false;
    }
  } catch (error) {
    console.error('❌ CSV Worker: MongoDB health check failed:', error.message);
    isMongoConnected = false;
    // Try to reconnect
    try {
      await connectToMongoDB();
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (mongoose.connection.readyState === 1) {
        await mongoose.connection.db.admin().ping();
        isMongoConnected = true;
        return true;
      }
    } catch (reconnectError) {
      console.error('❌ CSV Worker: Reconnection failed:', reconnectError.message);
    }
    return false;
  }
};

// CSV storage directory
const CSV_STORAGE_DIR = path.join(__dirname, '../generated-csvs');

// Ensure directory exists
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
};

// Create queue (same as in csvJobQueue.js)
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

    console.log(`📡 CSV Worker: Connecting to Redis at ${redisConfig.host}:${redisConfig.port}...`);

    const queue = new Queue('csv-generation', {
      redis: redisConfig
    });

    queue.on('ready', () => {
      console.log('✅ CSV Worker: Connected to Redis successfully');
    });

    queue.on('error', (error) => {
      console.error('❌ CSV Worker: Queue error:', error.message);
      if (error.code === 'ECONNREFUSED') {
        console.error('❌ Redis connection refused. Please ensure Redis is running.');
        process.exit(1);
      }
    });

    return queue;
  } catch (error) {
    console.error('❌ Failed to create CSV queue in worker:', error);
    throw error; // Fail fast - Redis is required
  }
};

let csvQueue;
try {
  csvQueue = createQueue();
  if (!csvQueue) {
    throw new Error('Failed to create queue');
  }
} catch (error) {
  console.error('❌ CSV Worker: Failed to initialize queue:', error);
  process.exit(1);
}

// Process CSV generation jobs
csvQueue.process('generate-csv', async (job) => {
  const { surveyId, filters, mode, jobId } = job.data;
  
  console.log(`🔄 Starting CSV generation job ${jobId} for survey ${surveyId}, mode: ${mode}`);
  
  try {
    // Update progress: Starting
    await job.progress({ stage: 'starting', percentage: 0, message: 'Initializing CSV generation...' });
    
    // CRITICAL: Ensure MongoDB connection is healthy before processing
    const mongoHealthy = await ensureMongoConnection();
    if (!mongoHealthy) {
      throw new Error('MongoDB connection is not available. Please check database connectivity.');
    }
    console.log(`✅ MongoDB connection verified for job ${jobId}`);
    
    // Ensure CSV storage directory exists
    await ensureDirectoryExists(CSV_STORAGE_DIR);
    const surveyDir = path.join(CSV_STORAGE_DIR, surveyId);
    await ensureDirectoryExists(surveyDir);
    
    // Fetch survey
    await job.progress({ stage: 'fetching_survey', percentage: 5, message: 'Fetching survey data...' });
    const survey = await Survey.findById(surveyId).lean();
    if (!survey) {
      throw new Error(`Survey ${surveyId} not found`);
    }
    
    // Build match filter
    await job.progress({ stage: 'building_filters', percentage: 10, message: 'Building filters...' });
    const matchFilter = { 
      survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId 
    };
    
    // Status filter
    if (filters.status && filters.status !== 'all' && filters.status !== '') {
      if (filters.status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (filters.status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (filters.status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = filters.status;
      }
    } else {
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }
    
    // Interview mode filter
    if (filters.interviewMode) {
      matchFilter.interviewMode = filters.interviewMode.toLowerCase();
    }
    
    // Date range filter (using IST timezone)
    if (filters.dateRange && filters.dateRange !== 'all' && filters.dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000;
      let dateStart, dateEnd;
      
      const getISTDateString = () => {
        const now = new Date();
        const istTime = new Date(now.getTime() + istOffset);
        const year = istTime.getUTCFullYear();
        const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
        const day = String(istTime.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      
      const getISTDateStartUTC = (istDateStr) => {
        const [year, month, day] = istDateStr.split('-').map(Number);
        const startDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 30, 0, 0));
        startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
        return startDateUTC;
      };
      
      const getISTDateEndUTC = (istDateStr) => {
        const [year, month, day] = istDateStr.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
      };
      
      switch (filters.dateRange) {
        case 'today':
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateString();
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateString();
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }
      
      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range
    if (filters.dateRange === 'custom' && filters.startDate && filters.endDate) {
      const getISTDateStartUTC = (istDateStr) => {
        const [year, month, day] = istDateStr.split('-').map(Number);
        const startDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 30, 0, 0));
        startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
        return startDateUTC;
      };
      
      const getISTDateEndUTC = (istDateStr) => {
        const [year, month, day] = istDateStr.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
      };
      
      const dateStart = getISTDateStartUTC(filters.startDate);
      const dateEnd = getISTDateEndUTC(filters.endDate);
      matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
    }
    
    // Interviewer filter
    if (filters.interviewerIds) {
      const interviewerIdsArray = typeof filters.interviewerIds === 'string' 
        ? filters.interviewerIds.split(',').map(id => id.trim()).filter(id => id)
        : Array.isArray(filters.interviewerIds) ? filters.interviewerIds : [];
      
      if (interviewerIdsArray.length > 0) {
        const User = require('../models/User');
        const validObjectIds = [];
        const potentialMemberIds = [];
        
        interviewerIdsArray
          .filter(id => id && id !== 'undefined' && id !== 'null')
          .forEach(id => {
            if (mongoose.Types.ObjectId.isValid(id)) {
              validObjectIds.push(new mongoose.Types.ObjectId(id));
            } else {
              potentialMemberIds.push(id);
            }
          });
        
        if (potentialMemberIds.length > 0) {
          const usersByMemberId = await User.find({
            memberId: { $in: potentialMemberIds },
            userType: 'interviewer'
          }).select('_id').lean();
          
          const memberIdObjectIds = usersByMemberId.map(user => user._id);
          validObjectIds.push(...memberIdObjectIds);
        }
        
        if (validObjectIds.length > 0) {
          if (filters.interviewerMode === 'exclude') {
            matchFilter.interviewer = { $nin: validObjectIds };
          } else {
            matchFilter.interviewer = { $in: validObjectIds };
          }
        }
      }
    }
    
    // Build aggregation pipeline
    await job.progress({ stage: 'building_pipeline', percentage: 15, message: 'Building database query...' });
    const pipeline = [];
    pipeline.push({ $match: matchFilter });
    pipeline.push({ $sort: { createdAt: 1 } });
    
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'interviewer',
        foreignField: '_id',
        as: 'interviewerDetails'
      }
    });
    pipeline.push({
      $unwind: {
        path: '$interviewerDetails',
        preserveNullAndEmptyArrays: true
      }
    });
    
    pipeline.push({
      $project: {
        _id: 1,
        survey: 1,
        interviewer: 1,
        status: 1,
        interviewMode: 1,
        createdAt: 1,
        startTime: 1,
        updatedAt: 1,
        responses: 1,
        selectedAC: 1,
        selectedPollingStation: 1,
        location: 1,
        verificationData: 1,
        audioRecording: 1,
        qcBatch: 1,
        responseId: 1,
        call_id: 1,
        interviewer: {
          firstName: { $ifNull: ['$interviewerDetails.firstName', ''] },
          lastName: { $ifNull: ['$interviewerDetails.lastName', ''] },
          email: { $ifNull: ['$interviewerDetails.email', ''] },
          memberId: { $ifNull: ['$interviewerDetails.memberId', ''] },
          memberID: { $ifNull: ['$interviewerDetails.memberId', ''] }
        }
      }
    });
    
    // Get total count
    await job.progress({ stage: 'counting_responses', percentage: 20, message: 'Counting responses...' });
    const countPipeline = [...pipeline, { $count: 'total' }];
    // Ensure MongoDB connection is healthy before count query
    const countMongoHealthy = await ensureMongoConnection();
    if (!countMongoHealthy) {
      throw new Error('MongoDB connection lost during count query');
    }
    
    const countResult = await SurveyResponse.aggregate(countPipeline, {
      allowDiskUse: true,
      maxTimeMS: 300000 // 5 minutes
    });
    const totalResponses = countResult.length > 0 ? countResult[0].total : 0;
    
    if (totalResponses === 0) {
      throw new Error('No responses found matching the filters');
    }
    
    console.log(`📊 Found ${totalResponses} responses to process for CSV job ${jobId}`);
    
    // Process in batches to avoid memory issues
    const BATCH_SIZE = 1500;
    let allResponses = [];
    let skip = 0;
    let processedCount = 0;
    
    await job.progress({ 
      stage: 'fetching_responses', 
      percentage: 25, 
      message: `Fetching responses (0/${totalResponses})...`,
      current: 0,
      total: totalResponses
    });
    
    while (skip < totalResponses) {
      const batchPipeline = [
        ...pipeline,
        { $skip: skip },
        { $limit: BATCH_SIZE }
      ];
      
      const batchEnd = Math.min(skip + BATCH_SIZE, totalResponses);
      console.log(`   [Job ${jobId}] Fetching batch: ${skip + 1} to ${batchEnd} of ${totalResponses}...`);
      
      // Ensure MongoDB connection is still healthy before each batch
      const batchMongoHealthy = await ensureMongoConnection();
      if (!batchMongoHealthy) {
        throw new Error('MongoDB connection lost during batch processing');
      }
      
      const batch = await SurveyResponse.aggregate(batchPipeline, {
        allowDiskUse: true,
        maxTimeMS: 300000 // Reduced to 5 minutes to stay within socketTimeoutMS
      });
      
      if (batch.length === 0) break;
      
      allResponses.push(...batch);
      processedCount += batch.length;
      const fetchProgress = 25 + Math.floor((processedCount / totalResponses) * 50); // 25% to 75%
      
      await job.progress({ 
        stage: 'fetching_responses', 
        percentage: fetchProgress, 
        message: `Fetching responses (${processedCount}/${totalResponses})...`,
        current: processedCount,
        total: totalResponses
      });
      
      skip += BATCH_SIZE;
    }
    
    console.log(`📊 [Job ${jobId}] Processing ${allResponses.length} responses for CSV generation...`);
    
    // Generate CSV content
    await job.progress({ 
      stage: 'generating_csv', 
      percentage: 75, 
      message: 'Generating CSV content...',
      current: processedCount,
      total: totalResponses
    });
    
    const csvContent = await generateCSVContent(survey, allResponses, mode, surveyId);
    
    // Save CSV file
    await job.progress({ 
      stage: 'saving_file', 
      percentage: 90, 
      message: 'Saving CSV file...',
      current: processedCount,
      total: totalResponses
    });
    
    const filename = `survey_${surveyId}_${mode}_${new Date().toISOString().split('T')[0]}.csv`;
    const filePath = path.join(surveyDir, filename);
    await fs.writeFile(filePath, csvContent, 'utf8');
    
    // Update progress: Complete
    await job.progress({ 
      stage: 'completed', 
      percentage: 100, 
      message: 'CSV generation completed!',
      current: processedCount,
      total: totalResponses
    });
    
    console.log(`✅ [Job ${jobId}] CSV generation completed: ${filePath}`);
    
    // Return result
    return {
      success: true,
      filePath: filePath,
      filename: filename,
      totalResponses: processedCount,
      surveyId: surveyId,
      mode: mode
    };
    
  } catch (error) {
    console.error(`❌ [Job ${jobId}] CSV generation failed:`, error);
    
    // Check if error is MongoDB connection related
    const isMongoError = error.message && (
      error.message.includes('connect') ||
      error.message.includes('timeout') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('MongoNetworkError') ||
      error.message.includes('MongoServerSelectionError')
    );
    
    if (isMongoError) {
      console.error(`❌ [Job ${jobId}] MongoDB connection error detected, marking connection as unhealthy`);
      isMongoConnected = false;
    }
    
    await job.progress({ 
      stage: 'failed', 
      percentage: 0, 
      message: `Error: ${error.message}`,
      error: error.message
    });
    throw error;
  }
});

console.log('✅ CSV Generation Worker started and listening for jobs...');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, closing CSV queue...');
  await csvQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, closing CSV queue...');
  await csvQueue.close();
  process.exit(0);
});

