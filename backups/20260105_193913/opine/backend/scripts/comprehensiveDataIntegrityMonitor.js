#!/usr/bin/env node

/**
 * Comprehensive Data Integrity Monitor
 * 
 * Monitors responses every 10 minutes and checks for:
 * 1. Should be abandoned (missing AC/Gender/Age) - like analyzeShouldBeAbandoned.js
 * 2. Duplicate check using content hash (excluding abandoned/terminated)
 * 3. Abandoned reason but status is Pending_Approval
 * 4. Should be auto-rejected but Pending_Approval
 * 5. Should be Approved (QA response) but Pending_Approval (from Jan 4, 2025)
 * 6. Should be Rejected (QA response) but Pending_Approval (from Jan 4, 2025)
 * 
 * Logs all findings to files for real-time detection.
 * 
 * Usage:
 *   node scripts/comprehensiveDataIntegrityMonitor.js
 *   OR
 *   pm2 start scripts/comprehensiveDataIntegrityMonitor.js --name comprehensive-data-monitor
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
const { checkAutoRejection } = require(path.join(backendPath, 'utils/autoRejectionHelper'));

// Configuration
const SURVEY_ID = '68fd1915d41841da463f0d46';
const CHECK_INTERVAL_MS = 10 * 60 * 1000; // Check every 10 minutes
const JAN_4_2025 = new Date('2025-01-04T00:00:00.000Z'); // UTC start of Jan 4, 2025
const LOG_DIR = path.join(__dirname, '../../Report-Generation/DataIntegrityMonitor');
const BATCH_SIZE = 500;

// Statistics
let stats = {
  totalChecks: 0,
  lastCheckTime: null,
  startTime: new Date(),
  check1_shouldBeAbandoned: { total: 0, found: [] },
  check2_duplicates: { total: 0, found: [] },
  check3_abandonedReasonPending: { total: 0, found: [] },
  check4_shouldAutoReject: { total: 0, found: [] },
  check5_shouldBeApproved: { total: 0, found: [] },
  check6_shouldBeRejected: { total: 0, found: [] }
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
  if (responseData.selectedAC && responseData.selectedAC !== '' && responseData.selectedAC !== null) {
    return responseData.selectedAC;
  }
  
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
 * Check 1: Should be abandoned (missing AC/Gender/Age)
 */
async function checkShouldBeAbandoned() {
  const findings = [];
  
  try {
    const query = {
      survey: SURVEY_ID,
      interviewMode: { $in: ['capi', 'cati'] },
      status: { $in: ['Pending_Approval', 'Rejected', 'Approved'] }
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status responses interviewMode createdAt startTime selectedAC selectedPollingStation')
      .lean();
    
    stats.check1_shouldBeAbandoned.total = responses.length;
    
    for (const response of responses) {
      const responsesArray = response.responses || [];
      const gender = extractGender(responsesArray, null);
      const age = extractAge(responsesArray);
      const ac = extractAC(response, responsesArray);
      
      const missingAC = !ac || ac === 'N/A' || ac === null || String(ac).trim() === '';
      const missingGender = !gender || gender === 'N/A' || gender === null || String(gender).trim() === '';
      const missingAge = !age || age === 'N/A' || age === null || String(age).trim() === '';
      
      if (missingAC || missingGender || missingAge) {
        findings.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          sessionId: response.sessionId,
          interviewMode: response.interviewMode,
          status: response.status,
          missingAC,
          missingGender,
          missingAge,
          ac: ac || 'MISSING',
          gender: gender || 'MISSING',
          age: age || 'MISSING',
          createdAt: response.createdAt
        });
      }
    }
    
    stats.check1_shouldBeAbandoned.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkShouldBeAbandoned:', error);
  }
  
  return findings;
}

/**
 * Check 2: Duplicate check using content hash (excluding abandoned/terminated)
 */
async function checkDuplicates() {
  const findings = [];
  
  try {
    // Find all responses with contentHash, excluding abandoned/terminated
    const query = {
      survey: SURVEY_ID,
      contentHash: { $exists: true, $ne: null },
      status: { $nin: ['abandoned', 'Terminated'] }
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status contentHash interviewMode createdAt')
      .lean();
    
    stats.check2_duplicates.total = responses.length;
    
    // Group by contentHash
    const hashGroups = {};
    for (const response of responses) {
      const hash = response.contentHash;
      if (!hashGroups[hash]) {
        hashGroups[hash] = [];
      }
      hashGroups[hash].push(response);
    }
    
    // Find duplicates (hash groups with more than 1 response)
    for (const [hash, group] of Object.entries(hashGroups)) {
      if (group.length > 1) {
        // Sort by createdAt to identify original vs duplicates
        group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const original = group[0];
        const duplicates = group.slice(1);
        
        findings.push({
          contentHash: hash,
          original: {
            responseId: original.responseId,
            mongoId: original._id.toString(),
            sessionId: original.sessionId,
            status: original.status,
            createdAt: original.createdAt
          },
          duplicates: duplicates.map(d => ({
            responseId: d.responseId,
            mongoId: d._id.toString(),
            sessionId: d.sessionId,
            status: d.status,
            createdAt: d.createdAt
          })),
          duplicateCount: duplicates.length
        });
      }
    }
    
    stats.check2_duplicates.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkDuplicates:', error);
  }
  
  return findings;
}

/**
 * Check 3: Abandoned reason but status is Pending_Approval
 */
async function checkAbandonedReasonPending() {
  const findings = [];
  
  try {
    const query = {
      survey: SURVEY_ID,
      status: 'Pending_Approval',
      abandonedReason: { $exists: true, $ne: null, $ne: '' }
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status abandonedReason interviewMode createdAt')
      .lean();
    
    stats.check3_abandonedReasonPending.total = responses.length;
    
    for (const response of responses) {
      findings.push({
        responseId: response.responseId,
        mongoId: response._id.toString(),
        sessionId: response.sessionId,
        interviewMode: response.interviewMode,
        status: response.status,
        abandonedReason: response.abandonedReason,
        createdAt: response.createdAt
      });
    }
    
    stats.check3_abandonedReasonPending.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkAbandonedReasonPending:', error);
  }
  
  return findings;
}

/**
 * Check 4: Should be auto-rejected but Pending_Approval
 */
async function checkShouldAutoReject() {
  const findings = [];
  
  try {
    const query = {
      survey: SURVEY_ID,
      status: 'Pending_Approval',
      interviewMode: { $in: ['capi', 'cati'] }
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status responses interviewMode createdAt startTime endTime totalTimeSpent selectedAC location call_id abandonedReason metadata')
      .lean();
    
    stats.check4_shouldAutoReject.total = responses.length;
    
    // Process in batches
    for (let i = 0; i < responses.length; i += BATCH_SIZE) {
      const batch = responses.slice(i, i + BATCH_SIZE);
      
      for (const response of batch) {
        try {
          // Convert to Mongoose document for checkAutoRejection
          const responseDoc = await SurveyResponse.findById(response._id);
          if (!responseDoc) continue;
          
          const rejectionInfo = await checkAutoRejection(
            responseDoc,
            response.responses || [],
            SURVEY_ID
          );
          
          if (rejectionInfo && rejectionInfo.shouldReject) {
            findings.push({
              responseId: response.responseId,
              mongoId: response._id.toString(),
              sessionId: response.sessionId,
              interviewMode: response.interviewMode,
              status: response.status,
              rejectionReasons: rejectionInfo.reasons || [],
              feedback: rejectionInfo.feedback || '',
              createdAt: response.createdAt
            });
          }
        } catch (error) {
          console.error(`❌ Error checking auto-rejection for ${response.responseId}:`, error.message);
        }
      }
    }
    
    stats.check4_shouldAutoReject.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkShouldAutoReject:', error);
  }
  
  return findings;
}

/**
 * Check 5: Should be Approved (QA response) but Pending_Approval (from Jan 4, 2025)
 */
async function checkShouldBeApproved() {
  const findings = [];
  
  try {
    const query = {
      survey: SURVEY_ID,
      status: 'Pending_Approval',
      'verificationData.reviewer': { $exists: true, $ne: null },
      'verificationData.reviewedAt': { $exists: true, $ne: null },
      $or: [
        { createdAt: { $gte: JAN_4_2025 } },
        { updatedAt: { $gte: JAN_4_2025 } }
      ]
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status verificationData createdAt updatedAt')
      .lean();
    
    stats.check5_shouldBeApproved.total = responses.length;
    
    for (const response of responses) {
      const vd = response.verificationData || {};
      const criteria = vd.criteria || {};
      
      // Check if all criteria indicate approval
      // Approval criteria: audioStatus in ['1','4','7'], genderMatching='1', etc.
      const audioStatus = criteria.audioStatus || vd.audioStatus;
      const genderMatching = criteria.genderMatching || vd.genderMatching;
      
      // If reviewer exists and criteria suggest approval, but status is Pending_Approval
      if (vd.reviewer && vd.reviewedAt) {
        // Check if criteria indicate approval (all passing)
        const audioApproved = !audioStatus || ['1', '4', '7'].includes(audioStatus);
        const genderApproved = !genderMatching || genderMatching === '1';
        
        // If most criteria pass, it should be approved
        if (audioApproved && genderApproved) {
          findings.push({
            responseId: response.responseId,
            mongoId: response._id.toString(),
            sessionId: response.sessionId,
            status: response.status,
            reviewer: vd.reviewer?.toString(),
            reviewedAt: vd.reviewedAt,
            criteria: criteria,
            createdAt: response.createdAt,
            updatedAt: response.updatedAt
          });
        }
      }
    }
    
    stats.check5_shouldBeApproved.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkShouldBeApproved:', error);
  }
  
  return findings;
}

/**
 * Check 6: Should be Rejected (QA response) but Pending_Approval (from Jan 4, 2025)
 */
async function checkShouldBeRejected() {
  const findings = [];
  
  try {
    const query = {
      survey: SURVEY_ID,
      status: 'Pending_Approval',
      'verificationData.reviewer': { $exists: true, $ne: null },
      'verificationData.reviewedAt': { $exists: true, $ne: null },
      $or: [
        { createdAt: { $gte: JAN_4_2025 } },
        { updatedAt: { $gte: JAN_4_2025 } }
      ]
    };
    
    const responses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status verificationData createdAt updatedAt')
      .lean();
    
    stats.check6_shouldBeRejected.total = responses.length;
    
    for (const response of responses) {
      const vd = response.verificationData || {};
      const criteria = vd.criteria || {};
      
      // Check if criteria indicate rejection
      const audioStatus = criteria.audioStatus || vd.audioStatus;
      const genderMatching = criteria.genderMatching || vd.genderMatching;
      
      // If reviewer exists and criteria suggest rejection, but status is Pending_Approval
      if (vd.reviewer && vd.reviewedAt) {
        // Check if criteria indicate rejection (any failing)
        const audioRejected = audioStatus && !['1', '4', '7'].includes(audioStatus);
        const genderRejected = genderMatching && genderMatching !== '1';
        
        // If any criteria fail, it should be rejected
        if (audioRejected || genderRejected || vd.feedback) {
          findings.push({
            responseId: response.responseId,
            mongoId: response._id.toString(),
            sessionId: response.sessionId,
            status: response.status,
            reviewer: vd.reviewer?.toString(),
            reviewedAt: vd.reviewedAt,
            criteria: criteria,
            feedback: vd.feedback || '',
            rejectionIndicators: {
              audioRejected,
              genderRejected,
              hasFeedback: !!vd.feedback
            },
            createdAt: response.createdAt,
            updatedAt: response.updatedAt
          });
        }
      }
    }
    
    stats.check6_shouldBeRejected.found = findings;
    
  } catch (error) {
    console.error('❌ Error in checkShouldBeRejected:', error);
  }
  
  return findings;
}

/**
 * Run all checks and log results
 */
async function runAllChecks() {
  try {
    stats.totalChecks++;
    stats.lastCheckTime = new Date();
    const checkStartTime = Date.now();
    
    console.log(`\n[${new Date().toISOString()}] 🔍 Starting comprehensive data integrity check #${stats.totalChecks}...\n`);
    
    // Run all checks in parallel
    const [
      check1Results,
      check2Results,
      check3Results,
      check4Results,
      check5Results,
      check6Results
    ] = await Promise.all([
      checkShouldBeAbandoned(),
      checkDuplicates(),
      checkAbandonedReasonPending(),
      checkShouldAutoReject(),
      checkShouldBeApproved(),
      checkShouldBeRejected()
    ]);
    
    const checkDuration = Date.now() - checkStartTime;
    
    // Log summary
    console.log(`[${new Date().toISOString()}] ✅ Check complete (${checkDuration}ms)`);
    console.log(`   1. Should be abandoned: ${check1Results.length} found`);
    console.log(`   2. Duplicates: ${check2Results.length} groups found`);
    console.log(`   3. Abandoned reason but Pending: ${check3Results.length} found`);
    console.log(`   4. Should auto-reject: ${check4Results.length} found`);
    console.log(`   5. Should be Approved (QA): ${check5Results.length} found`);
    console.log(`   6. Should be Rejected (QA): ${check6Results.length} found\n`);
    
    // Save detailed logs
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    
    // Save JSON report
    const report = {
      timestamp: new Date().toISOString(),
      checkNumber: stats.totalChecks,
      duration: checkDuration,
      summary: {
        check1_shouldBeAbandoned: check1Results.length,
        check2_duplicates: check2Results.length,
        check3_abandonedReasonPending: check3Results.length,
        check4_shouldAutoReject: check4Results.length,
        check5_shouldBeApproved: check5Results.length,
        check6_shouldBeRejected: check6Results.length
      },
      findings: {
        check1_shouldBeAbandoned: check1Results,
        check2_duplicates: check2Results,
        check3_abandonedReasonPending: check3Results,
        check4_shouldAutoReject: check4Results,
        check5_shouldBeApproved: check5Results,
        check6_shouldBeRejected: check6Results
      }
    };
    
    const jsonPath = path.join(LOG_DIR, `integrity_check_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    
    // Save summary CSV
    const csvRows = [
      'Check,Response ID,Mongo ID,Session ID,Status,Interview Mode,Issue,Details,Created At'
    ];
    
    check1Results.forEach(r => {
      csvRows.push([
        'Should Be Abandoned',
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.status,
        r.interviewMode,
        `Missing: ${[r.missingAC ? 'AC' : '', r.missingGender ? 'Gender' : '', r.missingAge ? 'Age' : ''].filter(x => x).join(', ')}`,
        `AC: ${r.ac}, Gender: ${r.gender}, Age: ${r.age}`,
        r.createdAt.toISOString()
      ].join(','));
    });
    
    check2Results.forEach(r => {
      r.duplicates.forEach(d => {
        csvRows.push([
          'Duplicate',
          d.responseId,
          d.mongoId,
          d.sessionId,
          d.status,
          '',
          `Duplicate of ${r.original.responseId}`,
          `ContentHash: ${r.contentHash}`,
          d.createdAt.toISOString()
        ].join(','));
      });
    });
    
    check3Results.forEach(r => {
      csvRows.push([
        'Abandoned Reason But Pending',
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.status,
        r.interviewMode,
        `Has abandonedReason: ${r.abandonedReason}`,
        '',
        r.createdAt.toISOString()
      ].join(','));
    });
    
    check4Results.forEach(r => {
      csvRows.push([
        'Should Auto-Reject',
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.status,
        r.interviewMode,
        r.feedback,
        JSON.stringify(r.rejectionReasons),
        r.createdAt.toISOString()
      ].join(','));
    });
    
    check5Results.forEach(r => {
      csvRows.push([
        'Should Be Approved (QA)',
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.status,
        '',
        'QA reviewed but status is Pending_Approval',
        `Reviewed by: ${r.reviewer}, At: ${r.reviewedAt.toISOString()}`,
        r.createdAt.toISOString()
      ].join(','));
    });
    
    check6Results.forEach(r => {
      csvRows.push([
        'Should Be Rejected (QA)',
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.status,
        '',
        'QA reviewed but status is Pending_Approval',
        `Reviewed by: ${r.reviewer}, Feedback: ${r.feedback}`,
        r.createdAt.toISOString()
      ].join(','));
    });
    
    const csvPath = path.join(LOG_DIR, `integrity_check_${TIMESTAMP}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    
    console.log(`   📄 Reports saved:`);
    console.log(`      JSON: ${jsonPath}`);
    console.log(`      CSV: ${csvPath}\n`);
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error in runAllChecks:`, error);
  }
}

/**
 * Main monitoring loop
 */
async function startMonitoring() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 COMPREHENSIVE DATA INTEGRITY MONITOR - Starting');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`Check interval: ${CHECK_INTERVAL_MS / 1000} seconds (10 minutes)`);
    console.log(`Log directory: ${LOG_DIR}`);
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
    await runAllChecks();
    
    // Set up interval for periodic checks
    const intervalId = setInterval(async () => {
      await runAllChecks();
    }, CHECK_INTERVAL_MS);
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\n\n🛑 Received SIGINT, shutting down gracefully...');
      clearInterval(intervalId);
      await mongoose.disconnect();
      console.log('✅ Shutdown complete');
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('\n\n🛑 Received SIGTERM, shutting down gracefully...');
      clearInterval(intervalId);
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

module.exports = { startMonitoring, runAllChecks };


