const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
require('dotenv').config({ path: './.env' });

// Helper function to check if abandonedReason is valid and meaningful
const hasValidAbandonedReason = function(abandonedReason) {
  return abandonedReason && 
         typeof abandonedReason === 'string' &&
         abandonedReason.trim() !== '' &&
         abandonedReason !== 'No reason specified' &&
         abandonedReason.toLowerCase() !== 'null' &&
         abandonedReason.toLowerCase() !== 'undefined';
};

async function fixFalsePendingApprovals() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Finding responses with abandonedReason but status Pending_Approval...\n');

    // Find all responses that have abandonedReason but status is Pending_Approval
    const query = {
      status: 'Pending_Approval',
      abandonedReason: { 
        $type: 'string',
        $ne: '',
        $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined']
      }
    };

    // Get count first
    const totalCount = await SurveyResponse.countDocuments(query);
    console.log(`📊 Total responses to fix: ${totalCount}\n`);

    if (totalCount === 0) {
      console.log('✅ No responses need fixing!');
      process.exit(0);
    }

    // Get breakdown by mode
    const catiCount = await SurveyResponse.countDocuments({
      ...query,
      interviewMode: { $in: ['cati', 'CATI'] }
    });
    const capiCount = await SurveyResponse.countDocuments({
      ...query,
      interviewMode: { $in: ['capi', 'CAPI'] }
    });

    console.log(`   CATI: ${catiCount}`);
    console.log(`   CAPI: ${capiCount}\n`);

    // Process in batches using cursor for memory efficiency
    const batchSize = 100;
    let processedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;
    const errors = [];

    console.log('🚀 Starting batch update...\n');

    const cursor = SurveyResponse.find(query)
      .select('_id responseId status abandonedReason interviewMode')
      .lean()
      .cursor({ batchSize });

    for await (const response of cursor) {
      processedCount++;

      try {
        // Double-check that abandonedReason is valid
        if (!hasValidAbandonedReason(response.abandonedReason)) {
          skippedCount++;
          if (processedCount % 100 === 0) {
            console.log(`   Processed: ${processedCount}/${totalCount} (Updated: ${updatedCount}, Skipped: ${skippedCount})`);
          }
          continue;
        }

        // Update status to "abandoned"
        const updateResult = await SurveyResponse.updateOne(
          { _id: response._id },
          { 
            $set: { 
              status: 'abandoned',
              // Ensure metadata flags are set
              'metadata.abandoned': true,
              'metadata.abandonedReason': response.abandonedReason
            }
          }
        );

        if (updateResult.modifiedCount === 1) {
          updatedCount++;
        } else {
          skippedCount++;
        }

        // Log progress every 100 responses
        if (processedCount % 100 === 0) {
          console.log(`   Processed: ${processedCount}/${totalCount} (Updated: ${updatedCount}, Skipped: ${skippedCount})`);
        }

        // Explicit memory cleanup hint every 500 responses
        if (processedCount % 500 === 0 && global.gc) {
          global.gc();
        }

      } catch (error) {
        errorCount++;
        errors.push({
          responseId: response.responseId || response._id.toString(),
          error: error.message
        });
        console.error(`   ❌ Error updating response ${response._id}: ${error.message}`);
      }
    }

    console.log('\n✅ Batch update complete!\n');
    console.log('📊 Summary:');
    console.log(`   Total processed: ${processedCount}`);
    console.log(`   Successfully updated: ${updatedCount}`);
    console.log(`   Skipped: ${skippedCount}`);
    console.log(`   Errors: ${errorCount}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors encountered:');
      errors.slice(0, 10).forEach(err => {
        console.log(`   - ${err.responseId}: ${err.error}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
    }

    // Verify the fix
    console.log('\n🔍 Verifying fix...');
    const remainingCount = await SurveyResponse.countDocuments(query);
    if (remainingCount === 0) {
      console.log('✅ All false Pending_Approval statuses have been fixed!');
    } else {
      console.log(`⚠️  Warning: ${remainingCount} responses still have status Pending_Approval with abandonedReason`);
    }

    // Show breakdown of current abandoned responses
    const abandonedCount = await SurveyResponse.countDocuments({
      status: 'abandoned',
      abandonedReason: { 
        $type: 'string',
        $ne: '',
        $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined']
      }
    });
    console.log(`\n📊 Current abandoned responses (with abandonedReason): ${abandonedCount}`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Run the fix
fixFalsePendingApprovals();



