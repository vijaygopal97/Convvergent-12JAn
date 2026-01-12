/**
 * Script to retroactively apply auto-rejection to CAPI responses
 * that are < 3 minutes and still in Pending_Approval status
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
const envPaths = [
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../.env'),
  path.join(process.cwd(), '.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    if (process.env.MONGODB_URI || process.env.MONGO_URI) {
      break;
    }
  } catch (e) {
    // Continue to next path
  }
}

const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const { checkAutoRejection, applyAutoRejection } = require('../utils/autoRejectionHelper');

async function retroactiveAutoRejection(responseId = null) {
  try {
    const mongoUri = process.env.MONGODB_URI || 
                     process.env.MONGO_URI || 
                     process.env.MONGODB_URL ||
                     'mongodb://13.233.231.180:27017,3.109.186.86:27017,13.202.181.167:27017/opine?replicaSet=rs0';
    
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    let query = {};
    if (responseId) {
      query = { responseId: responseId };
      console.log(`🔍 Processing specific response: ${responseId}`);
    } else {
      // Find all CAPI responses < 3 minutes in Pending_Approval
      query = {
        interviewMode: 'capi',
        status: 'Pending_Approval',
        totalTimeSpent: { $lt: 180 } // Less than 3 minutes
      };
      console.log('🔍 Finding all CAPI responses < 3 minutes in Pending_Approval...');
    }

    const responses = await SurveyResponse.find(query)
      .populate('survey')
      .lean();

    console.log(`📊 Found ${responses.length} response(s) to process\n`);

    let rejectedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const response of responses) {
      try {
        console.log(`\n📝 Processing response: ${response.responseId}`);
        console.log(`   Duration: ${response.totalTimeSpent} seconds (${Math.round(response.totalTimeSpent / 60)} minutes)`);
        console.log(`   Status: ${response.status}`);
        console.log(`   Created: ${response.createdAt}`);

        // Check if it should be auto-rejected
        const rejectionInfo = await checkAutoRejection(response, response.responses || [], response.survey?._id || response.survey);

        if (rejectionInfo) {
          console.log(`   ✅ Should be auto-rejected!`);
          console.log(`   Reasons: ${JSON.stringify(rejectionInfo.reasons)}`);

          // Apply auto-rejection
          const responseDoc = await SurveyResponse.findById(response._id);
          if (responseDoc) {
            await applyAutoRejection(responseDoc, rejectionInfo);
            console.log(`   ✅ Applied auto-rejection - status changed to: ${responseDoc.status}`);
            rejectedCount++;
          } else {
            console.log(`   ⚠️  Could not find response document`);
            skippedCount++;
          }
        } else {
          console.log(`   ⏭️  Should NOT be auto-rejected (may be abandoned or other exception)`);
          skippedCount++;
        }

      } catch (error) {
        console.error(`   ❌ Error processing response ${response.responseId}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Auto-rejected: ${rejectedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get responseId from command line argument
const responseId = process.argv[2] || null;
retroactiveAutoRejection(responseId);





