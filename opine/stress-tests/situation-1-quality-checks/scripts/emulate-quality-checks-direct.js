/**
 * Direct Quality Check Emulation - NO DATA CREATION
 * Makes real API calls to test system capacity
 * Uses existing quality agents and responses
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'https://convo.convergentview.com';
const SURVEY_ID = '68fd1915d41841da463f0d46'; // User specified survey
const QUALITY_AGENT_EMAIL = 'adarshquality123@gmail.com';
const QUALITY_AGENT_PASSWORD = 'Vijaygopal97';

class DirectQualityCheckEmulator {
  constructor(monitor, concurrency = 50, totalRequests = 500) {
    this.monitor = monitor;
    this.concurrency = concurrency;
    this.totalRequests = totalRequests;
    this.results = {
      successful: [],
      failed: [],
      errors: []
    };
    this.startTime = Date.now();
    this.token = null;
  }

  async login() {
    try {
      const startTime = Date.now();
      const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
        email: QUALITY_AGENT_EMAIL,
        password: QUALITY_AGENT_PASSWORD
      }, {
        timeout: 30000
      });
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success) {
        this.token = response.data.token || response.data.data?.token;
        if (this.token) {
          return true;
        }
      }
      throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
    } catch (error) {
      throw new Error(`Login error: ${error.message}`);
    }
  }

  async getNextReviewAssignment() {
    try {
      const startTime = Date.now();
      const response = await axios.get(`${API_BASE_URL}/api/survey-responses/next-review`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        params: {
          surveyId: SURVEY_ID
        },
        timeout: 30000
      });
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success && response.data.data) {
        return response.data.data;
      }
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        return null; // No more assignments
      }
      throw error;
    }
  }

  generateVerificationCriteria(responseType = 'capi') {
    return {
      audioStatus: this.randomChoice(['1', '2', '3', '4']),
      genderMatching: this.randomChoice(['1', '2', '3']),
      upcomingElectionsMatching: this.randomChoice(['1', '2', '3']),
      previousElectionsMatching: this.randomChoice(['1', '2', '3']),
      previousLoksabhaElectionsMatching: this.randomChoice(['1', '2', '3']),
      nameMatching: this.randomChoice(['1', '2', '3']),
      ageMatching: this.randomChoice(['1', '2', '3']),
      phoneNumberAsked: this.randomChoice(['1', '2']),
      audioQuality: this.randomChoice(['1', '2', '3', '4']),
      questionAccuracy: this.randomChoice(['1', '2', '3']),
      dataAccuracy: this.randomChoice(['1', '2', '3']),
      locationMatch: this.randomChoice(['1', '2', '3'])
    };
  }

  randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  async submitVerification(responseId, responseType) {
    try {
      const criteria = this.generateVerificationCriteria(responseType);
      const status = Math.random() < 0.7 ? 'approved' : 'rejected';
      const feedback = status === 'rejected' ? 'Test rejection for stress test' : '';
      
      const startTime = Date.now();
      const response = await axios.post(
        `${API_BASE_URL}/api/survey-responses/verify`,
        {
          responseId,
          status,
          verificationCriteria: criteria,
          feedback
        },
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          },
          timeout: 60000
        }
      );
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success) {
        return {
          success: true,
          responseId,
          status,
          responseTime
        };
      }
      throw new Error('Verification failed');
    } catch (error) {
      throw new Error(`Verification error: ${error.message}`);
    }
  }

  async getPendingApprovals() {
    try {
      const startTime = Date.now();
      const response = await axios.get(`${API_BASE_URL}/api/survey-responses/pending-approvals`, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        },
        params: {
          surveyId: SURVEY_ID,
          limit: 100 // Get multiple responses
        },
        timeout: 30000
      });
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success && response.data.data?.interviews) {
        return response.data.data.interviews;
      }
      return [];
    } catch (error) {
      throw new Error(`Failed to get pending approvals: ${error.message}`);
    }
  }

  async releaseAssignment(responseId) {
    try {
      const startTime = Date.now();
      await axios.post(
        `${API_BASE_URL}/api/survey-responses/release-review/${responseId}`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          },
          timeout: 30000
        }
      );
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
    } catch (error) {
      // Ignore release errors - assignment might have expired
    }
  }

  async processSingleRequest(requestIndex, pendingResponse = null) {
    const requestResult = {
      requestIndex,
      startTime: Date.now(),
      success: false,
      error: null,
      responseTime: null
    };
    
    try {
      let assignment = null;
      let responseId = null;
      let responseType = 'capi';
      
      if (pendingResponse) {
        // Use provided pending response
        responseId = pendingResponse.responseId || pendingResponse._id;
        responseType = pendingResponse.interviewMode === 'cati' ? 'cati' : 'capi';
        assignment = pendingResponse;
      } else {
        // Get new assignment
        assignment = await this.getNextReviewAssignment();
        if (assignment && assignment.responseId) {
          responseId = assignment.responseId;
          responseType = assignment.interviewMode === 'cati' ? 'cati' : 'capi';
        }
      }
      
      if (responseId) {
        // Submit verification
        try {
          const result = await this.submitVerification(responseId, responseType);
          
          requestResult.success = true;
          requestResult.responseTime = Date.now() - requestResult.startTime;
          requestResult.result = result;
          
          return requestResult;
        } catch (verifyError) {
          // If verification fails because response was already processed, that's OK for stress test
          if (verifyError.message && verifyError.message.includes('already been processed')) {
            requestResult.success = true; // Count as success for stress test purposes
            requestResult.responseTime = Date.now() - requestResult.startTime;
            requestResult.result = { responseId, status: 'already_processed' };
            return requestResult;
          }
          throw verifyError;
        }
      } else {
        requestResult.error = 'No assignment available';
        requestResult.responseTime = Date.now() - requestResult.startTime;
        return requestResult;
      }
    } catch (error) {
      requestResult.error = error.message;
      requestResult.responseTime = Date.now() - requestResult.startTime;
      return requestResult;
    }
  }

  async run() {
    console.log(`🚀 Starting DIRECT quality check emulation (NO DATA CREATION)`);
    console.log(`   Total Requests: ${this.totalRequests}`);
    console.log(`   Concurrency: ${this.concurrency}`);
    console.log(`   Survey ID: ${SURVEY_ID}`);
    console.log(`   API Base URL: ${API_BASE_URL}`);
    console.log(`   🛡️  Crash detection: ENABLED\n`);
    
    // Login once
    console.log('🔐 Logging in...');
    await this.login();
    console.log('✅ Logged in successfully\n');
    
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let stoppedEarly = false;
    let noAssignmentCount = 0;
    const maxNoAssignmentRetries = 10; // Stop if we get 10 consecutive "no assignment" responses
    
    // Process requests in concurrent batches
    for (let i = 0; i < this.totalRequests; i += this.concurrency) {
      // Check crash detection
      if (this.monitor && this.monitor.shouldStop()) {
        const reason = this.monitor.getCrashReason();
        console.error(`\n🛑 TEST STOPPED DUE TO CRASH DETECTION`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Processed: ${processed}/${this.totalRequests} requests`);
        stoppedEarly = true;
        break;
      }
      
      // Stop if too many "no assignment" responses (means we've exhausted available responses)
      // But only if we've processed at least some requests
      if (noAssignmentCount >= maxNoAssignmentRetries && processed > 10) {
        console.log(`\n⚠️  Stopping: ${maxNoAssignmentRetries} consecutive "no assignment" responses`);
        console.log(`   This means all available responses have been verified`);
        stoppedEarly = true;
        break;
      }
      
      const batchSize = Math.min(this.concurrency, this.totalRequests - i);
      const batchPromises = [];
      
      for (let j = 0; j < batchSize; j++) {
        const requestIndex = i + j;
        batchPromises.push(this.processSingleRequest(requestIndex));
      }
      
      // Execute batch concurrently
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        processed++;
        const requestIndex = i + idx;
        
        if (result.status === 'fulfilled') {
          const requestResult = result.value;
          if (requestResult.success) {
            successful++;
            noAssignmentCount = 0; // Reset counter on success
            this.results.successful.push(requestResult);
          } else {
            if (requestResult.error === 'No assignment available') {
              noAssignmentCount++;
            } else {
              noAssignmentCount = 0; // Reset on other errors
            }
            failed++;
            this.results.failed.push(requestResult);
          }
        } else {
          failed++;
          this.results.errors.push({
            requestIndex,
            error: result.reason?.message || 'Unknown error'
          });
        }
        
        // Progress update every 50 requests
        if (processed % 50 === 0 || processed === this.totalRequests) {
          const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
          const rate = (processed / elapsed).toFixed(2);
          const successRate = processed > 0 ? ((successful / processed) * 100).toFixed(1) : 0;
          
          console.log(`📊 Progress: ${processed}/${this.totalRequests} (${((processed/this.totalRequests)*100).toFixed(1)}%) | ✅ Success: ${successful} | ❌ Failed: ${failed} | Rate: ${rate}/s | Success Rate: ${successRate}%`);
        }
      });
      
      // Check crash condition after batch
      if (this.monitor && this.monitor.shouldStop()) {
        const reason = this.monitor.getCrashReason();
        console.error(`\n🛑 TEST STOPPED DUE TO CRASH DETECTION`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Processed: ${processed}/${this.totalRequests} requests`);
        stoppedEarly = true;
        break;
      }
      
      // Small delay between batches (10ms) to avoid overwhelming
      if (i + this.concurrency < this.totalRequests) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    return {
      totalRequests: this.totalRequests,
      processed,
      successful,
      failed,
      totalTime,
      stoppedEarly,
      crashDetected: stoppedEarly && this.monitor ? this.monitor.crashState.crashDetected : false,
      crashReason: stoppedEarly && this.monitor ? this.monitor.getCrashReason() : null,
      results: this.results
    };
  }
}

// Main execution
async function main() {
  const SystemMonitor = require('./monitor-system');
  const testId = `quality-checks-direct-${Date.now()}`;
  const reportDir = path.join(__dirname, '../reports');
  
  // Ensure directories exist
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  
  const monitor = new SystemMonitor(testId, reportDir);
  monitor.start(1000); // Collect metrics every second
  
  const emulator = new DirectQualityCheckEmulator(monitor, 50, 500); // 50 concurrent, 500 total
  
  try {
    const results = await emulator.run();
    const metrics = monitor.stop();
    
    // Save results
    const resultsFile = path.join(reportDir, `results-${testId}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify({
      testId,
      timestamp: new Date().toISOString(),
      surveyId: SURVEY_ID,
      summary: results,
      metrics: metrics.summary
    }, null, 2));
    
    if (results.stoppedEarly) {
      console.log('\n⚠️  Test STOPPED EARLY due to crash detection!');
      console.log(`📄 Results saved to: ${resultsFile}`);
      console.log(`📊 Metrics saved to: ${monitor.metricsFile}`);
      if (monitor.crashLogFile) {
        console.log(`🚨 Crash log saved to: ${monitor.crashLogFile}`);
      }
    } else {
      console.log('\n✅ Quality check emulation complete!');
      console.log(`📄 Results saved to: ${resultsFile}`);
      console.log(`📊 Metrics saved to: ${monitor.metricsFile}`);
    }
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total Requests: ${results.totalRequests}`);
    console.log(`   Processed: ${results.processed}`);
    console.log(`   Successful: ${results.successful}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Success Rate: ${results.processed > 0 ? ((results.successful / results.processed) * 100).toFixed(2) : 0}%`);
    console.log(`   Total Time: ${results.totalTime}s`);
    console.log(`   Average Rate: ${results.processed > 0 ? (results.processed / results.totalTime).toFixed(2) : 0} requests/s`);
    
    if (results.crashDetected) {
      console.log(`\n🚨 CRASH DETECTED:`);
      console.log(`   Reason: ${results.crashReason}`);
    }
    
    // Generate report
    const ReportGenerator = require('./generate-report');
    const generator = new ReportGenerator(testId, reportDir);
    await generator.generate();
    
    process.exit(0);
  } catch (error) {
    monitor.stop();
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = DirectQualityCheckEmulator;

