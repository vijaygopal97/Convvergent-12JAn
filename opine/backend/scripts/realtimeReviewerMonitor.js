/**
 * Simple real-time monitor that shows reviewer replacements as they happen
 * Monitors database and logs continuously
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const QA_ID = process.argv[2] || '693ca75a518527155598e961';

let lastCheckTime = new Date();
let seenResponseIds = new Set();
let lastCount = 0;

async function realtimeMonitor() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('\n' + '='.repeat(100));
    console.log('🔴 REAL-TIME REVIEWER REPLACEMENT MONITOR');
    console.log('='.repeat(100));
    console.log(`   QA ID: ${QA_ID}`);
    console.log(`   Started: ${new Date().toISOString()}`);
    console.log(`   Checking every 3 seconds...\n`);
    console.log('='.repeat(100) + '\n');

    // Get initial count
    const qaObjectId = new mongoose.Types.ObjectId(QA_ID);
    lastCount = await SurveyResponse.countDocuments({
      'verificationData.reviewer': qaObjectId
    });
    console.log(`📊 Initial "Total Reviewed" count: ${lastCount}\n`);

    // Monitor continuously
    setInterval(async () => {
      await checkForChanges(qaObjectId);
    }, 3000); // Check every 3 seconds

    // Initial check
    await checkForChanges(qaObjectId);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function checkForChanges(qaObjectId) {
  try {
    const now = new Date();
    
    // Find responses that were recently updated and have review history indicating this QA was replaced
    const recentChanges = await SurveyResponse.find({
      $or: [
        { 'verificationData.previousReviewer': qaObjectId },
        { 'verificationData.originalReviewer': qaObjectId, 'verificationData.reviewer': { $ne: qaObjectId } }
      ],
      updatedAt: { $gte: lastCheckTime }
    })
    .select('responseId status verificationData updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

    // Check current count
    const currentCount = await SurveyResponse.countDocuments({
      'verificationData.reviewer': qaObjectId
    });

    // If count changed, show alert
    if (currentCount !== lastCount) {
      const diff = currentCount - lastCount;
      console.log('\n' + '⚠️'.repeat(50));
      console.log(`🔴 COUNT CHANGED! ${diff > 0 ? '+' : ''}${diff}`);
      console.log(`   Previous: ${lastCount}`);
      console.log(`   Current: ${currentCount}`);
      console.log(`   Time: ${now.toISOString()}`);
      console.log('⚠️'.repeat(50) + '\n');
      lastCount = currentCount;
    }

    // Show new replacements
    if (recentChanges.length > 0) {
      for (const response of recentChanges) {
        const responseId = response.responseId;
        
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
          console.log('🔴🔴🔴 REVIEWER REPLACEMENT DETECTED!');
          console.log('='.repeat(100));
          console.log(`   Response ID: ${responseId}`);
          console.log(`   Status: ${response.status}`);
          console.log(`   Current Reviewer: ${currentReviewer || 'None'}`);
          console.log(`   Previous Reviewer: ${previousReviewer || 'None'}`);
          console.log(`   Original Reviewer: ${originalReviewer || 'None'}`);
          console.log(`   Review History Entries: ${reviewHistory.length}`);
          console.log(`   Updated At: ${response.updatedAt}`);
          console.log(`   Detected At: ${now.toISOString()}`);
          
          if (reviewHistory.length > 0) {
            console.log(`\n   Review History (showing entries for this QA):`);
            reviewHistory.forEach((review, idx) => {
              if (review.reviewer?.toString() === QA_ID) {
                console.log(`      Entry ${idx + 1}:`);
                console.log(`         Reviewer: ${review.reviewer} (THIS QA)`);
                console.log(`         Reviewed At: ${review.reviewedAt}`);
                console.log(`         Status: ${review.status}`);
                console.log(`         Replaced At: ${review.replacedAt || 'N/A'}`);
                console.log(`         Replaced By: ${review.replacedBy || 'N/A'}`);
              }
            });
          }
          console.log('='.repeat(100) + '\n');
        }
      }
    }

    // Show status
    process.stdout.write(`\r⏱️  ${now.toLocaleTimeString()} | Total Reviewed: ${currentCount} | Monitoring...`);

    // Update last check time (subtract 1 second to catch overlapping changes)
    lastCheckTime = new Date(now.getTime() - 1000);

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

realtimeMonitor();

