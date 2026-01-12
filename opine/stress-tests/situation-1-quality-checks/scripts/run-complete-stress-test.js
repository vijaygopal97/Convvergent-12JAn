/**
 * Complete Stress Test Runner
 * Creates test data, runs stress test with 200 concurrent requests, then cleans up
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const mongoose = require('mongoose');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'https://convo.convergentview.com';
const SURVEY_ID = '68fd1915d41841da463f0d46';
const QUALITY_AGENT_EMAIL = 'adarshquality123@gmail.com';
const QUALITY_AGENT_PASSWORD = 'Vijaygopal97';
const TEST_MARKER = 'STRESS_TEST_1_COMPLETE';

// Import models
const SurveyResponse = require('../../../backend/models/SurveyResponse');
const Survey = require('../../../backend/models/Survey');
const User = require('../../../backend/models/User');

class CompleteStressTest {
  constructor() {
    this.testId = `stress-test-${Date.now()}`;
    this.reportDir = path.join(__dirname, '../reports');
    this.createdResponseIds = [];
    this.token = null;
  }

  async connectMongoDB() {
    console.log('🔌 Connecting to MongoDB...');
    
    // Use EXACT same connection options as backend server.js
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 100,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 30000,
      readPreference: "secondaryPreferred",
      maxStalenessSeconds: 90,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 10000
    });
    
    // Wait for connection to be fully ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('MongoDB connection timeout'));
      }, 30000);
      
      if (mongoose.connection.readyState === 1) {
        clearTimeout(timeout);
        // Test connection with a simple operation
        mongoose.connection.db.admin().ping().then(() => {
          resolve();
        }).catch(reject);
      } else {
        mongoose.connection.once('connected', () => {
          clearTimeout(timeout);
          mongoose.connection.db.admin().ping().then(() => {
            resolve();
          }).catch(reject);
        });
        mongoose.connection.once('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      }
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Small delay to ensure connection is stable
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  async createTestResponses(count = 200) {
    console.log(`📝 Creating ${count} test responses (50% CAPI, 50% CATI)...`);
    
    // Use direct MongoDB query to avoid Mongoose buffering issues
    const db = mongoose.connection.db;
    const survey = await db.collection('surveys').findOne({ _id: new mongoose.Types.ObjectId(SURVEY_ID) });
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }

    // Use direct MongoDB queries
    const usersCollection = mongoose.connection.db.collection('users');
    const capiInterviewer = await usersCollection.findOne({ 
      email: 'ajithinterviewer@gmail.com',
      userType: 'interviewer'
    });
    
    const catiInterviewer = await usersCollection.findOne({ 
      email: 'vishalinterviewer@gmail.com',
      userType: 'interviewer'
    });

    if (!capiInterviewer || !catiInterviewer) {
      throw new Error('Test interviewers not found');
    }

    const responses = [];
    const capiCount = Math.floor(count / 2);
    const catiCount = count - capiCount;

    // Create CAPI responses
    for (let i = 0; i < capiCount; i++) {
      responses.push({
        survey: SURVEY_ID,
        interviewer: capiInterviewer._id,
        status: 'Pending_Approval',
        interviewMode: 'capi',
        sessionId: `${TEST_MARKER}-capi-${Date.now()}-${i}`,
        startTime: new Date(),
        endTime: new Date(),
        totalTimeSpent: 300 + Math.floor(Math.random() * 200),
        responses: [
          {
            sectionIndex: 0,
            questionIndex: 0,
            questionId: 'age',
            questionType: 'numeric',
            response: 25 + Math.floor(Math.random() * 50),
            responseTime: 1000
          },
          {
            sectionIndex: 1,
            questionIndex: 0,
            questionId: 'gender',
            questionType: 'multiple_choice',
            response: Math.random() < 0.5 ? 'male' : 'female',
            responseTime: 2000
          }
        ],
        selectedAC: 'Ranibandh',
        location: {
          latitude: 22.866141660215824,
          longitude: 86.78307081700281,
          accuracy: 50
        },
        metadata: {
          testMarker: TEST_MARKER,
          testIndex: i
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Create CATI responses
    for (let i = 0; i < catiCount; i++) {
      responses.push({
        survey: SURVEY_ID,
        interviewer: catiInterviewer._id,
        status: 'Pending_Approval',
        interviewMode: 'cati',
        sessionId: `${TEST_MARKER}-cati-${Date.now()}-${i}`,
        startTime: new Date(),
        endTime: new Date(),
        totalTimeSpent: 200 + Math.floor(Math.random() * 150),
        responses: [
          {
            sectionIndex: 0,
            questionIndex: 0,
            questionId: 'age',
            questionType: 'numeric',
            response: 25 + Math.floor(Math.random() * 50),
            responseTime: 800
          },
          {
            sectionIndex: 1,
            questionIndex: 0,
            questionId: 'gender',
            questionType: 'multiple_choice',
            response: Math.random() < 0.5 ? 'male' : 'female',
            responseTime: 1500
          }
        ],
        selectedAC: 'Ranibandh',
        location: {
          latitude: 22.866141660215824,
          longitude: 86.78307081700281,
          accuracy: 100
        },
        metadata: {
          testMarker: TEST_MARKER,
          testIndex: capiCount + i
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Insert in batches using direct MongoDB operations
    const responsesCollection = mongoose.connection.db.collection('surveyresponses');
    const batchSize = 50;
    let inserted = 0;
    
    for (let i = 0; i < responses.length; i += batchSize) {
      const batch = responses.slice(i, i + batchSize);
      // Convert ObjectIds to proper format
      const batchToInsert = batch.map(r => ({
        ...r,
        survey: new mongoose.Types.ObjectId(r.survey),
        interviewer: new mongoose.Types.ObjectId(r.interviewer)
      }));
      
      const result = await responsesCollection.insertMany(batchToInsert);
      this.createdResponseIds.push(...Object.values(result.insertedIds).map(id => id.toString()));
      inserted += batch.length;
      console.log(`   ✅ Created ${inserted}/${count} responses`);
    }

    console.log(`\n✅ Successfully created ${inserted} test responses`);
    console.log(`   CAPI: ${capiCount}, CATI: ${catiCount}\n`);
    
    // Small delay to ensure data is available
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return inserted;
  }

  async login() {
    const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
      email: QUALITY_AGENT_EMAIL,
      password: QUALITY_AGENT_PASSWORD
    }, { timeout: 30000 });
    
    if (response.data.success) {
      this.token = response.data.token || response.data.data?.token;
      return true;
    }
    throw new Error('Login failed');
  }

  async getNextReviewAssignment() {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/survey-responses/next-review`, {
        headers: { 'Authorization': `Bearer ${this.token}` },
        params: { surveyId: SURVEY_ID },
        timeout: 30000
      });
      
      if (response.data.success && response.data.data) {
        const assignment = response.data.data.interview || response.data.data;
        if (assignment && (assignment.responseId || assignment._id)) {
          return assignment;
        }
      }
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  generateVerificationCriteria(responseType = 'capi') {
    return {
      audioStatus: ['1', '2', '3', '4'][Math.floor(Math.random() * 4)],
      genderMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      upcomingElectionsMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      previousElectionsMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      previousLoksabhaElectionsMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      nameMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      ageMatching: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      phoneNumberAsked: ['1', '2'][Math.floor(Math.random() * 2)],
      audioQuality: ['1', '2', '3', '4'][Math.floor(Math.random() * 4)],
      questionAccuracy: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      dataAccuracy: ['1', '2', '3'][Math.floor(Math.random() * 3)],
      locationMatch: ['1', '2', '3'][Math.floor(Math.random() * 3)]
    };
  }

  async submitVerification(responseId, responseType) {
    const criteria = this.generateVerificationCriteria(responseType);
    const status = Math.random() < 0.7 ? 'approved' : 'rejected';
    const feedback = status === 'rejected' ? 'Test rejection for stress test' : '';
    
    const response = await axios.post(
      `${API_BASE_URL}/api/survey-responses/verify`,
      {
        responseId,
        status,
        verificationCriteria: criteria,
        feedback
      },
      {
        headers: { 'Authorization': `Bearer ${this.token}` },
        timeout: 60000
      }
    );
    
    return response.data.success;
  }

  async processSingleRequest(requestIndex, monitor) {
    const startTime = Date.now();
    try {
      const assignment = await this.getNextReviewAssignment();
      
      if (assignment && (assignment.responseId || assignment._id)) {
        const responseId = assignment.responseId || assignment._id;
        const responseType = assignment.interviewMode === 'cati' ? 'cati' : 'capi';
        
        const success = await this.submitVerification(responseId, responseType);
        const responseTime = Date.now() - startTime;
        
        if (monitor) {
          monitor.recordAPICall(responseTime);
        }
        
        return { success, responseTime, responseId };
      }
      
      return { success: false, responseTime: Date.now() - startTime, error: 'No assignment' };
    } catch (error) {
      return { success: false, responseTime: Date.now() - startTime, error: error.message };
    }
  }

  async runStressTest(monitor, concurrency = 200, totalRequests = 1000) {
    console.log(`🚀 Starting stress test`);
    console.log(`   Concurrency: ${concurrency}`);
    console.log(`   Total Requests: ${totalRequests}`);
    console.log(`   Survey ID: ${SURVEY_ID}\n`);
    
    await this.login();
    console.log('✅ Logged in successfully\n');
    
    const results = {
      successful: [],
      failed: [],
      errors: []
    };
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    const startTime = Date.now();
    
    // Process in concurrent batches
    for (let i = 0; i < totalRequests; i += concurrency) {
      if (monitor && monitor.shouldStop()) {
        console.error(`\n🛑 TEST STOPPED DUE TO CRASH DETECTION`);
        break;
      }
      
      const batchSize = Math.min(concurrency, totalRequests - i);
      const batchPromises = [];
      
      for (let j = 0; j < batchSize; j++) {
        batchPromises.push(this.processSingleRequest(i + j, monitor));
      }
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        processed++;
        if (result.status === 'fulfilled') {
          const value = result.value;
          if (value.success) {
            successful++;
            results.successful.push(value);
          } else {
            failed++;
            results.failed.push(value);
          }
        } else {
          failed++;
          results.errors.push({ error: result.reason?.message || 'Unknown' });
        }
        
        if (processed % 100 === 0 || processed === totalRequests) {
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
          const rate = (processed / elapsed).toFixed(2);
          const successRate = processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0;
          console.log(`📊 Progress: ${processed}/${totalRequests} (${((processed/totalRequests)*100).toFixed(1)}%) | ✅ Success: ${successful} | ❌ Failed: ${failed} | Rate: ${rate}/s | Success Rate: ${successRate}%`);
        }
      });
      
      // Small delay between batches
      if (i + concurrency < totalRequests) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    return {
      processed,
      successful,
      failed,
      totalTime,
      results
    };
  }

  async cleanupTestData() {
    console.log('\n🧹 Cleaning up test data...');
    
    try {
      // Use direct MongoDB operation
      const responsesCollection = mongoose.connection.db.collection('surveyresponses');
      const result = await responsesCollection.deleteMany({
        'metadata.testMarker': TEST_MARKER
      });
      
      console.log(`✅ Deleted ${result.deletedCount} test responses\n`);
      return result.deletedCount;
    } catch (error) {
      console.error('❌ Error cleaning up:', error.message);
      throw error;
    }
  }

  async run() {
    const SystemMonitor = require('./monitor-system');
    const monitor = new SystemMonitor(this.testId, this.reportDir);
    
    try {
      // Ensure directories exist
      if (!fs.existsSync(this.reportDir)) {
        fs.mkdirSync(this.reportDir, { recursive: true });
      }
      
      monitor.start(1000);
      
      // Step 1: Connect to MongoDB
      await this.connectMongoDB();
      
      // Step 2: Create test data
      const createdCount = await this.createTestResponses(200);
      
      // Step 3: Run stress test
      const testResults = await this.runStressTest(monitor, 200, 1000);
      
      // Step 4: Stop monitoring
      const metrics = monitor.stop();
      
      // Step 5: Cleanup test data
      const deletedCount = await this.cleanupTestData();
      
      // Step 6: Save results
      const resultsFile = path.join(this.reportDir, `results-${this.testId}.json`);
      fs.writeFileSync(resultsFile, JSON.stringify({
        testId: this.testId,
        timestamp: new Date().toISOString(),
        surveyId: SURVEY_ID,
        createdResponses: createdCount,
        deletedResponses: deletedCount,
        summary: testResults,
        metrics: metrics.summary
      }, null, 2));
      
      // Step 7: Generate report
      const ReportGenerator = require('./generate-report');
      const generator = new ReportGenerator(this.testId, this.reportDir);
      await generator.generate();
      
      console.log('\n✅ Stress test complete!');
      console.log(`📄 Results: ${resultsFile}`);
      console.log(`📊 Metrics: ${monitor.metricsFile}`);
      console.log(`\n📈 Summary:`);
      console.log(`   Created: ${createdCount} responses`);
      console.log(`   Processed: ${testResults.processed} requests`);
      console.log(`   Successful: ${testResults.successful}`);
      console.log(`   Failed: ${testResults.failed}`);
      console.log(`   Success Rate: ${testResults.processed > 0 ? ((testResults.successful / testResults.processed) * 100).toFixed(2) : 0}%`);
      console.log(`   Total Time: ${testResults.totalTime}s`);
      console.log(`   Deleted: ${deletedCount} responses`);
      
      await mongoose.disconnect();
      process.exit(0);
    } catch (error) {
      monitor.stop();
      console.error('\n❌ Error:', error);
      
      // Try to cleanup on error
      try {
        await this.cleanupTestData();
      } catch (cleanupError) {
        console.error('❌ Cleanup error:', cleanupError);
      }
      
      await mongoose.disconnect();
      process.exit(1);
    }
  }
}

if (require.main === module) {
  const test = new CompleteStressTest();
  test.run();
}

module.exports = CompleteStressTest;

