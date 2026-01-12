/**
 * Simple real-time monitor that tracks count changes and logs
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const QA_ID = process.argv[2] || '693ca75a518527155598e961';

let lastCount = 0;
let checkCount = 0;

async function simpleMonitor() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('\n' + '='.repeat(100));
    console.log('🔴 REAL-TIME REVIEWER COUNT MONITOR');
    console.log('='.repeat(100));
    console.log(`   QA ID: ${QA_ID}`);
    console.log(`   Started: ${new Date().toISOString()}`);
    console.log(`   Checking count every 2 seconds...\n`);
    console.log('='.repeat(100) + '\n');

    const qaObjectId = new mongoose.Types.ObjectId(QA_ID);
    
    // Get initial count
    lastCount = await SurveyResponse.countDocuments({
      'verificationData.reviewer': qaObjectId
    });
    console.log(`📊 Initial "Total Reviewed" count: ${lastCount}\n`);
    console.log('Monitoring... (Press Ctrl+C to stop)\n');

    // Monitor continuously
    setInterval(async () => {
      try {
        checkCount++;
        const currentCount = await SurveyResponse.countDocuments({
          'verificationData.reviewer': qaObjectId
        });

        if (currentCount !== lastCount) {
          const diff = currentCount - lastCount;
          const timestamp = new Date().toISOString();
          console.log('\n' + '⚠️'.repeat(50));
          console.log(`🔴 COUNT CHANGED! ${diff > 0 ? '+' : ''}${diff}`);
          console.log(`   Previous: ${lastCount}`);
          console.log(`   Current: ${currentCount}`);
          console.log(`   Time: ${timestamp}`);
          console.log('⚠️'.repeat(50) + '\n');
          lastCount = currentCount;
        }

        // Show status every 10 checks (20 seconds)
        if (checkCount % 10 === 0) {
          const now = new Date();
          process.stdout.write(`\r⏱️  ${now.toLocaleTimeString()} | Total Reviewed: ${currentCount} | Checks: ${checkCount}`);
        }
      } catch (error) {
        console.error('\n❌ Error checking count:', error.message);
      }
    }, 2000); // Check every 2 seconds

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Monitoring stopped');
  process.exit(0);
});

simpleMonitor();


