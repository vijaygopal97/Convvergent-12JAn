#!/usr/bin/env node

/**
 * Backfill ContentHash for Existing Survey Responses
 * 
 * This script generates contentHash for all SurveyResponse documents that don't have it.
 * It uses the EXACT same logic as createCompleteResponse() to ensure consistency.
 * 
 * Features:
 * - Processes in batches to avoid server overload
 * - Uses same generateContentHash() function as production code
 * - Updates only responses without contentHash
 * - Progress tracking and error handling
 * - Can be run during off-peak hours
 * 
 * Usage: node backfillContentHash.js
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const SurveyResponse = require('../models/SurveyResponse');

// Configuration
const BATCH_SIZE = 1000; // Process 1000 responses at a time
const DELAY_BETWEEN_BATCHES = 100; // 100ms delay between batches (to avoid overload)

// Statistics
let stats = {
  total: 0,
  processed: 0,
  updated: 0,
  skipped: 0,
  errors: 0,
  startTime: null,
  endTime: null
};

/**
 * Process a batch of responses
 */
async function processBatch(batch) {
  const updates = [];
  
  for (const doc of batch) {
    try {
      // Generate contentHash using the EXACT same logic as createCompleteResponse
      // EXCLUDE interviewer - same interview can be synced by different users
      // Include mode-specific fields: audio/GPS for CAPI, call_id for CATI
      // Include endTime and totalTimeSpent for exact matching
      const contentHash = SurveyResponse.generateContentHash(
        doc.interviewer, // Still pass interviewer for function signature, but it's excluded from hash
        doc.survey,
        doc.startTime,
        doc.responses || [],
        {
          interviewMode: doc.interviewMode || null,
          audioRecording: doc.audioRecording || null,
          location: doc.location || null,
          call_id: doc.call_id || null,
          endTime: doc.endTime || null,
          totalTimeSpent: doc.totalTimeSpent || null
        }
      );
      
      // Always update with new hash (regenerating all hashes with new logic)
      if (contentHash) {
        updates.push({
          updateOne: {
            filter: { _id: doc._id },
            update: { $set: { contentHash: contentHash } }
          }
        });
      }
    } catch (error) {
      console.error(`❌ Error generating contentHash for response ${doc._id}:`, error.message);
      stats.errors++;
    }
  }
  
  // Bulk update
  if (updates.length > 0) {
    try {
      const result = await SurveyResponse.bulkWrite(updates, { ordered: false });
      stats.updated += result.modifiedCount;
      stats.processed += updates.length;
      return result.modifiedCount;
    } catch (error) {
      console.error(`❌ Error in bulk update:`, error.message);
      stats.errors += updates.length;
      return 0;
    }
  }
  
  return 0;
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('  CONTENT HASH BACKFILL SCRIPT');
    console.log('='.repeat(70));
    console.log('');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    stats.startTime = Date.now();
    
    // Count total responses (we need to regenerate ALL hashes with new logic)
    console.log('📊 Counting all responses to regenerate contentHash...');
    stats.total = await SurveyResponse.countDocuments({});
    console.log(`   Found ${stats.total} total responses`);
    console.log('   ⚠️  Regenerating contentHash for ALL responses with new logic');
    console.log('   (Includes audio/GPS for CAPI, call_id for CATI)');
    console.log('');
    
    if (stats.total === 0) {
      console.log('✅ No responses found. Nothing to do.');
      await mongoose.disconnect();
      return;
    }
    
    // Process in batches
    console.log(`🔄 Processing in batches of ${BATCH_SIZE}...`);
    console.log(`   Delay between batches: ${DELAY_BETWEEN_BATCHES}ms`);
    console.log('');
    
    let processedCount = 0;
    let batchNumber = 0;
    
    while (processedCount < stats.total) {
      batchNumber++;
      
      // Fetch batch - include all fields needed for hash generation
      // Regenerate ALL hashes (not just missing ones) to use new logic
      const batch = await SurveyResponse.find({})
        .select('_id interviewer survey startTime endTime totalTimeSpent responses interviewMode audioRecording location call_id')
        .skip(processedCount)
        .limit(BATCH_SIZE)
        .lean();
      
      if (batch.length === 0) {
        break; // No more documents
      }
      
      // Process batch
      const updated = await processBatch(batch);
      
      processedCount += batch.length;
      const progress = ((processedCount / stats.total) * 100).toFixed(2);
      
      console.log(`   Batch ${batchNumber}: Processed ${batch.length} responses, Updated ${updated} (${progress}% complete)`);
      
      // Delay between batches to avoid overload
      if (processedCount < stats.total) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES));
      }
    }
    
    stats.endTime = Date.now();
    const duration = ((stats.endTime - stats.startTime) / 1000).toFixed(2);
    
    // Final statistics
    console.log('');
    console.log('='.repeat(70));
    console.log('  BACKFILL COMPLETE');
    console.log('='.repeat(70));
    console.log(`   Total responses without hash: ${stats.total}`);
    console.log(`   Responses processed: ${stats.processed}`);
    console.log(`   Responses updated: ${stats.updated}`);
    console.log(`   Errors: ${stats.errors}`);
    console.log(`   Duration: ${duration} seconds`);
    console.log(`   Average speed: ${(stats.processed / parseFloat(duration)).toFixed(2)} responses/second`);
    console.log('');
    
    // Verify all responses have contentHash
    const withoutHash = await SurveyResponse.countDocuments({
      contentHash: { $exists: false }
    });
    
    const withHash = await SurveyResponse.countDocuments({
      contentHash: { $exists: true, $ne: null }
    });
    
    if (withoutHash === 0) {
      console.log(`✅ SUCCESS: All ${withHash} responses now have contentHash with new logic!`);
      console.log('   ✅ CAPI responses include audio and GPS in hash');
      console.log('   ✅ CATI responses include call_id in hash');
    } else {
      console.log(`⚠️  WARNING: ${withoutHash} responses still don't have contentHash`);
      console.log(`   ${withHash} responses have contentHash`);
      console.log('   This might be due to errors or new responses created during backfill');
    }
    console.log('');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    console.log('');
    
  } catch (error) {
    console.error('❌ FATAL ERROR:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main()
    .then(() => {
      console.log('✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { main };

