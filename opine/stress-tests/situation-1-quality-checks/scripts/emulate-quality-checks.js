/**
 * Quality Check Emulation Script
 * Emulates 10,000 Quality Agents submitting quality checks
 * Mimics the React Native app's quality agent dashboard behavior
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'https://convo.convergentview.com';
const STRESS_TEST_MARKER = 'STRESS_TEST_1';

class QualityCheckEmulator {
  constructor(testDataSummary, monitor, concurrency = 50) {
    this.testDataSummary = testDataSummary;
    this.monitor = monitor;
    this.concurrency = concurrency;
    this.results = {
      successful: [],
      failed: [],
      errors: []
    };
    this.startTime = Date.now();
  }

  async loginQualityAgent(email, password) {
    try {
      const startTime = Date.now();
      const response = await axios.post(`${API_BASE_URL}/api/auth/login`, {
        email,
        password
      }, {
        timeout: 30000
      });
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success && response.data.token) {
        return {
          token: response.data.token,
          user: response.data.user
        };
      }
      throw new Error('Login failed: ' + JSON.stringify(response.data));
    } catch (error) {
      throw new Error(`Login error for ${email}: ${error.message}`);
    }
  }

  async getNextReviewAssignment(token) {
    try {
      const startTime = Date.now();
      const response = await axios.get(`${API_BASE_URL}/api/survey-responses/next-review`, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        timeout: 30000
      });
      
      const responseTime = Date.now() - startTime;
      if (this.monitor) {
        this.monitor.recordAPICall(responseTime);
      }
      
      if (response.data.success) {
        return response.data.data || null;
      }
      return null;
    } catch (error) {
      if (error.response?.status === 404) {
        // No more assignments available
        return null;
      }
      throw error;
    }
  }

  generateVerificationCriteria(responseType = 'capi') {
    // Generate realistic verification criteria based on response type
    const criteria = {
      audioStatus: this.randomChoice(['1', '2', '3', '4', '7', '8']),
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
    
    // For CATI responses, audioStatus might be different
    if (responseType === 'cati') {
      criteria.audioStatus = this.randomChoice(['1', '2', '3', '4']);
    }
    
    return criteria;
  }

  randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  async submitVerification(token, responseId, responseType) {
    try {
      const criteria = this.generateVerificationCriteria(responseType);
      
      // Randomly approve or reject (70% approve, 30% reject for realistic test)
      const status = Math.random() < 0.7 ? 'approved' : 'rejected';
      const feedback = status === 'rejected' ? 'Test rejection feedback for stress test' : '';
      
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
            'Authorization': `Bearer ${token}`
          },
          timeout: 60000 // 60 second timeout for verification
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
          responseTime,
          criteria
        };
      }
      throw new Error('Verification failed: ' + JSON.stringify(response.data));
    } catch (error) {
      throw new Error(`Verification error for ${responseId}: ${error.message}`);
    }
  }

  async processQualityAgent(agentIndex, agentEmail) {
    const agentResult = {
      agentIndex,
      email: agentEmail,
      startTime: Date.now(),
      checksSubmitted: 0,
      errors: []
    };
    
    try {
      // Login
      const { token } = await this.loginQualityAgent(agentEmail, 'TestPassword123!');
      
      // Get and submit one review assignment
      const assignment = await this.getNextReviewAssignment(token);
      
      if (assignment && assignment.responseId) {
        // Determine response type
        const responseType = assignment.interviewMode === 'cati' ? 'cati' : 'capi';
        
        // Submit verification
        const result = await this.submitVerification(
          token,
          assignment.responseId,
          responseType
        );
        
        agentResult.checksSubmitted = 1;
        agentResult.endTime = Date.now();
        agentResult.duration = agentResult.endTime - agentResult.startTime;
        agentResult.success = true;
        agentResult.result = result;
        
        return agentResult;
      } else {
        // No assignment available
        agentResult.endTime = Date.now();
        agentResult.duration = agentResult.endTime - agentResult.startTime;
        agentResult.success = false;
        agentResult.error = 'No assignment available';
        return agentResult;
      }
    } catch (error) {
      agentResult.endTime = Date.now();
      agentResult.duration = agentResult.endTime - agentResult.startTime;
      agentResult.success = false;
      agentResult.error = error.message;
      agentResult.errors.push(error.message);
      return agentResult;
    }
  }

  async run() {
    console.log(`🚀 Starting quality check emulation...`);
    console.log(`   Agents: ${this.testDataSummary.qualityAgents.total}`);
    console.log(`   Concurrency: ${this.concurrency}`);
    console.log(`   API Base URL: ${API_BASE_URL}`);
    console.log(`   🛡️  Crash detection: ENABLED\n`);
    
    const agents = this.testDataSummary.qualityAgents.ids;
    const totalAgents = agents.length;
    let processed = 0;
    let successful = 0;
    let failed = 0;
    let stoppedEarly = false;
    
    // Process agents in batches
    for (let i = 0; i < totalAgents; i += this.concurrency) {
      // Check if we should stop due to crash detection
      if (this.monitor && this.monitor.shouldStop()) {
        const reason = this.monitor.getCrashReason();
        console.error(`\n🛑 TEST STOPPED DUE TO CRASH DETECTION`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Processed: ${processed}/${totalAgents} agents`);
        stoppedEarly = true;
        break;
      }
      
      const batch = agents.slice(i, Math.min(i + this.concurrency, totalAgents));
      const batchPromises = batch.map((agentId, idx) => {
        const agentIndex = i + idx;
        const agentEmail = `stress_test_qa_${agentIndex}@stresstest.com`;
        return this.processQualityAgent(agentIndex, agentEmail);
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, idx) => {
        processed++;
        const agentIndex = i + idx;
        
        if (result.status === 'fulfilled') {
          const agentResult = result.value;
          if (agentResult.success) {
            successful++;
            this.results.successful.push(agentResult);
          } else {
            failed++;
            this.results.failed.push(agentResult);
          }
        } else {
          failed++;
          this.results.errors.push({
            agentIndex,
            error: result.reason?.message || 'Unknown error'
          });
        }
        
        // Progress update
        if (processed % 100 === 0 || processed === totalAgents) {
          const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
          const rate = (processed / elapsed).toFixed(2);
          
          // Show current system state
          const cpuWarning = this.monitor && this.monitor.metrics.cpu.length > 0 
            ? this.monitor.metrics.cpu[this.monitor.metrics.cpu.length - 1].percent > 80 ? ' ⚠️' : ''
            : '';
          
          console.log(`📊 Progress: ${processed}/${totalAgents} (${((processed/totalAgents)*100).toFixed(1)}%) | Successful: ${successful} | Failed: ${failed} | Rate: ${rate}/s${cpuWarning}`);
        }
      });
      
      // Check crash condition after batch
      if (this.monitor && this.monitor.shouldStop()) {
        const reason = this.monitor.getCrashReason();
        console.error(`\n🛑 TEST STOPPED DUE TO CRASH DETECTION`);
        console.error(`   Reason: ${reason}`);
        console.error(`   Processed: ${processed}/${totalAgents} agents`);
        stoppedEarly = true;
        break;
      }
      
      // Small delay between batches to avoid overwhelming the system
      if (i + this.concurrency < totalAgents) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const totalTime = ((Date.now() - this.startTime) / 1000).toFixed(2);
    
    return {
      totalAgents,
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

module.exports = QualityCheckEmulator;

// Main execution
async function main() {
  const testDataFile = path.join(__dirname, '../data/test-data-summary.json');
  
  if (!fs.existsSync(testDataFile)) {
    console.error(`❌ Test data summary not found: ${testDataFile}`);
    console.error('   Please run generate-test-data.js first');
    process.exit(1);
  }
  
  const testDataSummary = JSON.parse(fs.readFileSync(testDataFile, 'utf8'));
  
  const SystemMonitor = require('./monitor-system');
  const testId = `quality-checks-${Date.now()}`;
  const reportDir = path.join(__dirname, '../reports');
  
  const monitor = new SystemMonitor(testId, reportDir);
  monitor.start(1000); // Collect metrics every second
  
  const emulator = new QualityCheckEmulator(testDataSummary, monitor, 50);
  
  try {
    const results = await emulator.run();
    const metrics = monitor.stop();
    
    // Save results
    const resultsFile = path.join(reportDir, `results-${testId}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify({
      testId,
      timestamp: new Date().toISOString(),
      summary: results,
      metrics: metrics.summary
    }, null, 2));
    
    if (results.stoppedEarly) {
      console.log('\n⚠️  Quality check emulation STOPPED EARLY due to crash detection!');
      console.log(`📄 Results saved to: ${resultsFile}`);
      console.log(`📊 Metrics saved to: ${monitor.metricsFile}`);
      if (monitor.crashLogFile) {
        console.log(`🚨 Crash log saved to: ${monitor.crashLogFile}`);
      }
      console.log(`\n📈 Summary:`);
      console.log(`   Total Agents: ${results.totalAgents}`);
      console.log(`   Processed: ${results.processed}`);
      console.log(`   Successful: ${results.successful}`);
      console.log(`   Failed: ${results.failed}`);
      console.log(`   Total Time: ${results.totalTime}s`);
      console.log(`   Average Rate: ${(results.processed / results.totalTime).toFixed(2)} checks/s`);
      console.log(`\n🚨 CRASH DETAILS:`);
      console.log(`   Reason: ${results.crashReason}`);
      console.log(`   Please review crash log for detailed metrics`);
    } else {
      console.log('\n✅ Quality check emulation complete!');
      console.log(`📄 Results saved to: ${resultsFile}`);
      console.log(`📊 Metrics saved to: ${monitor.metricsFile}`);
      console.log(`\n📈 Summary:`);
      console.log(`   Total Agents: ${results.totalAgents}`);
      console.log(`   Successful: ${results.successful}`);
      console.log(`   Failed: ${results.failed}`);
      console.log(`   Total Time: ${results.totalTime}s`);
      console.log(`   Average Rate: ${(results.processed / results.totalTime).toFixed(2)} checks/s`);
    }
    
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

