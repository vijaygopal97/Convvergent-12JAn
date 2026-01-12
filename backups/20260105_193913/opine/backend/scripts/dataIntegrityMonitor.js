#!/usr/bin/env node

/**
 * Data Integrity Monitor - Real-time Monitoring
 * 
 * Monitors responses in real-time and marks them as "abandoned" if they are
 * missing required fields (AC, Gender, Age) but are currently in
 * Pending_Approval, Rejected, or Approved status.
 * 
 * This script runs continuously and checks for new responses that should
 * have been marked as abandoned.
 * 
 * Usage:
 *   node scripts/dataIntegrityMonitor.js
 *   OR
 *   pm2 start scripts/dataIntegrityMonitor.js --name data-integrity-monitor
 */

const path = require('path');
const fs = require('fs');

// Set up module resolution to use backend's node_modules
const backendPath = path.join(__dirname, '..');

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      const backendNodeModules = path.join(backendPath, 'node_modules');
      try {
        return originalRequire.apply(this, [path.join(backendNodeModules, id)]);
      } catch (e) {
        throw err;
      }
    }
    throw err;
  }
};

require('dotenv').config({ path: path.join(backendPath, '.env') });
const mongoose = require('mongoose');
const SurveyResponse = require(path.join(backendPath, 'models/SurveyResponse'));
const Survey = require(path.join(backendPath, 'models/Survey'));
const { extractACFromResponse } = require(path.join(backendPath, 'utils/respondentInfoUtils'));
const { getMainText } = require(path.join(backendPath, 'utils/genderUtils'));

// Configuration
const SURVEY_ID = '68fd1915d41841da463f0d46';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes
const LOOKBACK_MINUTES = 10; // Check responses created in last 10 minutes
const BATCH_SIZE = 100; // Process in batches

// Statistics
let stats = {
  totalChecks: 0,
  totalResponsesChecked: 0,
  totalMarkedAsAbandoned: 0,
  totalSkipped: 0,
  errors: [],
  lastCheckTime: null,
  startTime: new Date()
};

/**
 * Extract value from response (handle arrays)
 */
function extractValue(response) {
  if (!response || response === null || response === undefined) return null;
  if (Array.isArray(response)) {
    return response.length > 0 ? response[0] : null;
  }
  return response;
}

/**
 * Find response by question text
 */
function findResponseByQuestionText(responses, searchTexts) {
  if (!responses || !Array.isArray(responses)) return null;
  return responses.find(r => {
    if (!r.questionText) return false;
    const mainText = getMainText(r.questionText).toLowerCase();
    return searchTexts.some(text => mainText.includes(text.toLowerCase()));
  });
}

/**
 * Extract gender from responses
 */
function extractGender(responses, survey) {
  // Strategy 1: Find by fixed question ID
  let genderResponse = responses.find(r => {
    const questionId = r.questionId || '';
    return questionId.includes('fixed_respondent_gender');
  });
  
  if (genderResponse) {
    const genderValue = extractValue(genderResponse.response);
    if (genderValue && genderValue !== 'N/A' && genderValue !== null && genderValue !== undefined && String(genderValue).trim() !== '') {
      return getMainText(String(genderValue));
    }
  }
  
  // Strategy 2: Find by question text
  genderResponse = findResponseByQuestionText(responses, [
    'what is your gender',
    'please note the respondent\'s gender',
    'note the respondent\'s gender',
    'respondent\'s gender',
    'respondent gender',
    'note the gender',
    'gender'
  ]);
  
  if (genderResponse) {
    const genderValue = extractValue(genderResponse.response);
    if (genderValue && genderValue !== 'N/A' && genderValue !== null && genderValue !== undefined && String(genderValue).trim() !== '') {
      return getMainText(String(genderValue));
    }
  }
  
  return null;
}

/**
 * Extract age from responses
 */
function extractAge(responses) {
  const ageResponse = findResponseByQuestionText(responses, [
    'could you please tell me your age',
    'your age in complete years',
    'age in complete years',
    'age',
    'year'
  ]);
  
  if (ageResponse) {
    const ageValue = extractValue(ageResponse.response);
    if (ageValue !== null && ageValue !== undefined && ageValue !== 'N/A') {
      const ageStr = String(ageValue).trim();
      if (ageStr !== '') {
        const ageNum = parseInt(ageStr);
        if (!isNaN(ageNum) && ageNum > 0 && ageNum < 150) {
          return ageNum;
        }
        return ageStr;
      }
    }
  }
  
  return null;
}

/**
 * Extract AC from responses
 */
function extractAC(responseData, responses) {
  // First check selectedAC field (for CATI)
  if (responseData.selectedAC && responseData.selectedAC !== '' && responseData.selectedAC !== null) {
    return responseData.selectedAC;
  }
  
  // Try to extract from responses using extractACFromResponse
  try {
    const extractedAC = extractACFromResponse(responses, responseData);
    if (extractedAC && extractedAC !== 'N/A' && extractedAC !== '') {
      return extractedAC;
    }
  } catch (error) {
    // Ignore errors
  }
  
  return null;
}

/**
 * Generate abandoned reason based on what's missing
 */
function generateAbandonReason(missingAC, missingGender, missingAge) {
  const reasons = [];
  
  if (missingAC) {
    reasons.push('Missing AC');
  }
  if (missingGender) {
    reasons.push('Missing Gender');
  }
  if (missingAge) {
    reasons.push('Missing Age');
  }
  
  if (reasons.length === 0) {
    return 'Missing Required Fields';
  }
  
  return reasons.join(', ');
}

/**
 * Check and mark responses as abandoned
 */
async function checkAndMarkAbandoned() {
  try {
    stats.totalChecks++;
    stats.lastCheckTime = new Date();
    
    const now = new Date();
    const lookbackTime = new Date(now.getTime() - (LOOKBACK_MINUTES * 60 * 1000));
    
    // Query responses created in the last LOOKBACK_MINUTES minutes
    // that are in Pending_Approval, Rejected, or Approved status
    // and are NOT already abandoned
    const query = {
      survey: SURVEY_ID,
      interviewMode: { $in: ['capi', 'cati'] },
      status: { $in: ['Pending_Approval', 'Rejected', 'Approved'] },
      createdAt: { $gte: lookbackTime, $lte: now }
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status responses interviewMode createdAt startTime selectedAC selectedPollingStation metadata')
      .lean();
    
    stats.totalResponsesChecked += responses.length;
    
    if (responses.length === 0) {
      console.log(`[${new Date().toISOString()}] ✅ No responses to check (checked ${stats.totalResponsesChecked} total)`);
      return;
    }
    
    console.log(`[${new Date().toISOString()}] 🔍 Checking ${responses.length} responses...`);
    
    let markedCount = 0;
    let skippedCount = 0;
    
    // Process in batches
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const batch = responses.slice(i, i + BATCH_SIZE);
      
      for (const response of batch) {
        try {
          const responsesArray = response.responses || [];
          const gender = extractGender(responsesArray, null);
          const age = extractAge(responsesArray);
          const ac = extractAC(response, responsesArray);
          
          // Check if AC, gender, or age is missing
          const missingAC = !ac || ac === 'N/A' || ac === null || String(ac).trim() === '';
          const missingGender = !gender || gender === 'N/A' || gender === null || String(gender).trim() === '';
          const missingAge = !age || age === 'N/A' || age === null || String(age).trim() === '';
          
          if (missingAC || missingGender || missingAge) {
            // Check if already abandoned (double-check)
            const currentResponse = await SurveyResponse.findById(response._id)
              .select('status')
              .lean();
            
            if (currentResponse && currentResponse.status === 'abandoned') {
              skippedCount++;
              continue;
            }
            
            // Generate abandoned reason
            const abandonedReason = generateAbandonReason(missingAC, missingGender, missingAge);
            
            // Mark as abandoned
            await SurveyResponse.findByIdAndUpdate(response._id, {
              $set: {
                status: 'abandoned',
                abandonedReason: abandonedReason
              }
            });
            
            markedCount++;
            stats.totalMarkedAsAbandoned++;
            
            console.log(`   ✅ Marked ${response.responseId} as abandoned (${abandonedReason})`);
          } else {
            skippedCount++;
          }
        } catch (error) {
          console.error(`   ❌ Error processing response ${response.responseId}:`, error.message);
          stats.errors.push({
            responseId: response.responseId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
    }
    
    stats.totalSkipped += skippedCount;
    
    console.log(`[${new Date().toISOString()}] ✅ Check complete: ${markedCount} marked as abandoned, ${skippedCount} skipped`);
    console.log(`   📊 Total stats: ${stats.totalMarkedAsAbandoned} marked, ${stats.totalResponsesChecked} checked, ${stats.totalChecks} checks`);
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error in checkAndMarkAbandoned:`, error);
    stats.errors.push({
      type: 'checkAndMarkAbandoned',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Print statistics
 */
function printStats() {
  const uptime = Math.floor((new Date() - stats.startTime) / 1000);
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 DATA INTEGRITY MONITOR STATISTICS');
  console.log('='.repeat(80));
  console.log(`Uptime: ${hours}h ${minutes}m ${seconds}s`);
  console.log(`Total checks: ${stats.totalChecks}`);
  console.log(`Total responses checked: ${stats.totalResponsesChecked}`);
  console.log(`Total marked as abandoned: ${stats.totalMarkedAsAbandoned}`);
  console.log(`Total skipped: ${stats.totalSkipped}`);
  console.log(`Errors: ${stats.errors.length}`);
  console.log(`Last check: ${stats.lastCheckTime ? stats.lastCheckTime.toISOString() : 'Never'}`);
  console.log('='.repeat(80) + '\n');
}

/**
 * Main monitoring loop
 */
async function startMonitoring() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 DATA INTEGRITY MONITOR - Starting');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000} seconds`);
    console.log(`Lookback window: ${LOOKBACK_MINUTES} minutes`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName || 'Unknown'}\n`);
    
    // Run initial check
    console.log('🔄 Running initial check...\n');
    await checkAndMarkAbandoned();
    
    // Set up interval for periodic checks
    const intervalId = setInterval(async () => {
      await checkAndMarkAbandoned();
    }, CHECK_INTERVAL_MS);
    
    // Print stats every hour
    setInterval(() => {
      printStats();
    }, 60 * 60 * 1000);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
      clearInterval(intervalId);
      printStats();
      await mongoose.disconnect();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
      clearInterval(intervalId);
      printStats();
      await mongoose.disconnect();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
    
    console.log(`✅ Monitor started. Checking every ${CHECK_INTERVAL_MS / 1000} seconds...\n`);
    
  } catch (error) {
    console.error('\n❌ Error starting monitor:', error);
    if (error.stack) console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the monitor
if (require.main === module) {
  startMonitoring();
}

module.exports = { startMonitoring, checkAndMarkAbandoned };


