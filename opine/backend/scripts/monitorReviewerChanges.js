/**
 * Real-time monitor for reviewer replacements
 * Watches logs and polls database for reviewer changes
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const { exec } = require('child_process');

const QA_ID = process.argv[2] || '693ca75a518527155598e961';
const MONITOR_INTERVAL = 5000; // Check every 5 seconds

let lastCheckTime = new Date();
let seenResponseIds = new Set();

async function monitorReviewerChanges() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');
    console.log('🔍 REAL-TIME REVIEWER REPLACEMENT MONITOR');
    console.log(`   Monitoring QA: ${QA_ID}`);
    console.log(`   Polling every ${MONITOR_INTERVAL/1000} seconds\n`);
    console.log('='.repeat(100));
    console.log('');

    // Start monitoring logs in background
    startLogMonitoring();

    // Start database polling
    setInterval(async () => {
      await checkForRecentChanges();
    }, MONITOR_INTERVAL);

    // Initial check
    await checkForRecentChanges();

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

function startLogMonitoring() {
  console.log('📡 Starting log monitoring...\n');
  
  // Monitor PM2 logs for reviewer replacement messages
  const logProcess = exec('pm2 logs opine-backend --lines 0 --nostream --raw', {
    cwd: '/var/www/opine/backend'
  });

  logProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n');
    lines.forEach(line => {
      if (line.includes('⚠️⚠️⚠️ REVIEWER REPLACEMENT DETECTED') || 
          line.includes('REVIEWER REPLACEMENT DETECTED')) {
        console.log('\n🔴🔴🔴 LIVE REPLACEMENT DETECTED FROM LOGS:');
        console.log(`   ${new Date().toISOString()}`);
        console.log(`   ${line}`);
        console.log('');
      }
      
      if (line.includes('📝 REVIEW HISTORY UPDATED')) {
        console.log('\n📝 REVIEW HISTORY UPDATED:');
        console.log(`   ${new Date().toISOString()}`);
        console.log(`   ${line}`);
        console.log('');
      }
    });
  });

  logProcess.stderr.on('data', (data) => {
    // Ignore stderr for now
  });

  logProcess.on('error', (error) => {
    console.error('Log monitoring error:', error.message);
  });
}

async function checkForRecentChanges() {
  try {
    const qaObjectId = new mongoose.Types.ObjectId(QA_ID);
    
    // Find responses that were recently updated and have review history or previousReviewer
    const recentChanges = await SurveyResponse.find({
      $or: [
        { 'verificationData.previousReviewer': qaObjectId },
        { 'verificationData.originalReviewer': qaObjectId, 'verificationData.reviewer': { $ne: qaObjectId } }
      ],
      updatedAt: { $gte: lastCheckTime }
    })
    .select('responseId status verificationData.reviewer verificationData.previousReviewer verificationData.originalReviewer verificationData.reviewHistory verificationData.reviewedAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

    if (recentChanges.length > 0) {
      for (const response of recentChanges) {
        const responseId = response.responseId;
        
        // Skip if we've already seen this
        if (seenResponseIds.has(responseId)) {
          continue;
        }
        
        seenResponseIds.add(responseId);
        
        const currentReviewer = response.verificationData?.reviewer?.toString();
        const previousReviewer = response.verificationData?.previousReviewer?.toString();
        const originalReviewer = response.verificationData?.originalReviewer?.toString();
        const reviewHistory = response.verificationData?.reviewHistory || [];
        
        // Check if this QA's review was replaced
        if ((previousReviewer === QA_ID || originalReviewer === QA_ID) && currentReviewer !== QA_ID) {
          console.log('\n' + '='.repeat(100));
          console.log('⚠️⚠️⚠️  REVIEWER REPLACEMENT DETECTED!');
          console.log('='.repeat(100));
          console.log(`   Timestamp: ${new Date().toISOString()}`);
          console.log(`   Response ID: ${responseId}`);
          console.log(`   Status: ${response.status}`);
          console.log(`   Current Reviewer: ${currentReviewer}`);
          console.log(`   Previous Reviewer: ${previousReviewer || 'None'}`);
          console.log(`   Original Reviewer: ${originalReviewer || 'None'}`);
          console.log(`   Review History Entries: ${reviewHistory.length}`);
          console.log(`   Last Reviewed: ${response.verificationData?.reviewedAt || 'Unknown'}`);
          console.log(`   Updated At: ${response.updatedAt}`);
          
          if (reviewHistory.length > 0) {
            console.log(`\n   Review History:`);
            reviewHistory.forEach((review, idx) => {
              if (review.reviewer?.toString() === QA_ID) {
                console.log(`      ${idx + 1}. REVIEWER: ${review.reviewer} (THIS QA)`);
                console.log(`         Reviewed At: ${review.reviewedAt}`);
                console.log(`         Status: ${review.status}`);
                console.log(`         Replaced At: ${review.replacedAt}`);
                console.log(`         Replaced By: ${review.replacedBy}`);
              }
            });
          }
          console.log('='.repeat(100));
          console.log('');
        }
      }
    }

    // Update last check time
    lastCheckTime = new Date();

    // Also check current count
    const currentCount = await SurveyResponse.countDocuments({
      'verificationData.reviewer': qaObjectId
    });
    
    process.stdout.write(`\r⏱️  ${new Date().toLocaleTimeString()} | Current "Total Reviewed": ${currentCount} | Monitoring...`);

  } catch (error) {
    console.error('\n❌ Error checking for changes:', error);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Monitoring stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Monitoring stopped');
  process.exit(0);
});

monitorReviewerChanges();


