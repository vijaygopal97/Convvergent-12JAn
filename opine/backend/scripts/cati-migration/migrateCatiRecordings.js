/**
 * CATI Audio Migration Script
 * 
 * Migrates existing CATI call recordings from DeepCall URLs to S3
 * 
 * Usage:
 *   node migrateCatiRecordings.js [options]
 * 
 * Options:
 *   --batch-size=N    Number of calls to process per batch (default: 50)
 *   --delay-ms=N       Delay between batches in milliseconds (default: 2000)
 *   --max-calls=N      Maximum number of calls to process (default: all)
 *   --dry-run          Don't actually upload, just check what would be migrated
 *   --skip-uploaded    Skip calls that are already uploaded to S3
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const CatiCall = require('../../models/CatiCall');
const { downloadAndUploadCatiAudio } = require('../../utils/cloudStorage');

// Configuration
const BATCH_SIZE = parseInt(process.argv.find(arg => arg.startsWith('--batch-size='))?.split('=')[1] || '50');
const DELAY_MS = parseInt(process.argv.find(arg => arg.startsWith('--delay-ms='))?.split('=')[1] || '2000');
const MAX_CALLS = process.argv.find(arg => arg.startsWith('--max-calls='))?.split('=')[1] ? 
  parseInt(process.argv.find(arg => arg.startsWith('--max-calls='))?.split('=')[1]) : null;
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_UPLOADED = process.argv.includes('--skip-uploaded');

const DEEPCALL_TOKEN = process.env.DEEPCALL_TOKEN || '6GQJuwW6lB8ZBHntzaRU';
const DEEPCALL_USER_ID = process.env.DEEPCALL_USER_ID || '89130240';

// Statistics
let stats = {
  total: 0,
  processed: 0,
  uploaded: 0,
  failed: 0,
  deleted: 0,
  skipped: 0,
  errors: []
};

async function migrateBatch(calls, batchNumber) {
  console.log(`\n📦 Processing batch ${batchNumber} (${calls.length} calls)...`);
  
  const batchPromises = calls.map(async (call, index) => {
    try {
      // Skip if already uploaded
      if (SKIP_UPLOADED && call.s3AudioUploadStatus === 'uploaded' && call.s3AudioUrl) {
        stats.skipped++;
        console.log(`⏭️  [${batchNumber}-${index + 1}] Skipping callId ${call.callId} - already uploaded`);
        return;
      }

      // Skip if no recording URL
      if (!call.recordingUrl || !call.recordingUrl.startsWith('http')) {
        stats.skipped++;
        console.log(`⏭️  [${batchNumber}-${index + 1}] Skipping callId ${call.callId} - no recording URL`);
        return;
      }

      stats.processed++;
      console.log(`🔄 [${batchNumber}-${index + 1}/${calls.length}] Processing callId: ${call.callId}`);

      if (DRY_RUN) {
        console.log(`   📋 Would migrate: ${call.recordingUrl.substring(0, 80)}...`);
        stats.uploaded++;
        return;
      }

      // Mark as pending
      await CatiCall.updateOne(
        { _id: call._id },
        { 
          $set: { 
            s3AudioUploadStatus: 'pending',
            s3AudioUploadError: null
          } 
        }
      );

      // Download and upload
      const uploadResult = await downloadAndUploadCatiAudio(
        call.recordingUrl,
        call.callId,
        { DEEPCALL_TOKEN, DEEPCALL_USER_ID }
      );

      // Update with S3 key
      await CatiCall.updateOne(
        { _id: call._id },
        { 
          $set: { 
            s3AudioUrl: uploadResult.s3Key,
            s3AudioUploadedAt: new Date(),
            s3AudioUploadStatus: 'uploaded',
            s3AudioUploadError: null
          } 
        }
      );

      stats.uploaded++;
      console.log(`   ✅ Uploaded to S3: ${uploadResult.s3Key}`);

    } catch (error) {
      stats.failed++;
      const errorMessage = error.message || 'Unknown error';
      
      if (errorMessage === 'RECORDING_DELETED' || errorMessage.includes('404')) {
        stats.deleted++;
        console.log(`   🗑️  Recording deleted from DeepCall (404)`);
        
        if (!DRY_RUN) {
          await CatiCall.updateOne(
            { _id: call._id },
            { 
              $set: { 
                s3AudioUploadStatus: 'deleted',
                s3AudioUploadError: 'Recording already deleted from DeepCall'
              } 
            }
          ).catch(err => {
            console.error(`   ❌ Failed to update status:`, err.message);
          });
        }
      } else {
        console.error(`   ❌ Failed: ${errorMessage}`);
        stats.errors.push({
          callId: call.callId,
          error: errorMessage
        });
        
        if (!DRY_RUN) {
          await CatiCall.updateOne(
            { _id: call._id },
            { 
              $set: { 
                s3AudioUploadStatus: 'failed',
                s3AudioUploadError: errorMessage.substring(0, 500)
              } 
            }
          ).catch(err => {
            console.error(`   ❌ Failed to update error status:`, err.message);
          });
        }
      }
    }
  });

  await Promise.all(batchPromises);
}

async function main() {
  try {
    console.log('🚀 Starting CATI Audio Migration...\n');
    console.log('Configuration:');
    console.log(`  Batch size: ${BATCH_SIZE}`);
    console.log(`  Delay between batches: ${DELAY_MS}ms`);
    console.log(`  Max calls: ${MAX_CALLS || 'all'}`);
    console.log(`  Dry run: ${DRY_RUN ? 'YES' : 'NO'}`);
    console.log(`  Skip uploaded: ${SKIP_UPLOADED ? 'YES' : 'NO'}\n`);

    // Connect to database
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/opine';
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');

    // Find all calls with recording URLs
    const query = {
      recordingUrl: { $exists: true, $ne: null, $ne: '' }
    };

    // If skip-uploaded flag is set, exclude already uploaded calls
    if (SKIP_UPLOADED) {
      query.$or = [
        { s3AudioUploadStatus: { $ne: 'uploaded' } },
        { s3AudioUploadStatus: { $exists: false } },
        { s3AudioUrl: { $exists: false } }
      ];
    }

    stats.total = await CatiCall.countDocuments(query);
    console.log(`📊 Found ${stats.total} calls to migrate\n`);

    if (stats.total === 0) {
      console.log('✅ No calls to migrate. Exiting.');
      process.exit(0);
    }

    // Process in batches
    let processedCount = 0;
    let batchNumber = 1;
    const processedIds = new Set(); // Track processed IDs to avoid duplicates

    while (processedCount < stats.total && (!MAX_CALLS || processedCount < MAX_CALLS)) {
      const remaining = MAX_CALLS ? Math.min(MAX_CALLS - processedCount, BATCH_SIZE) : BATCH_SIZE;
      const calls = await CatiCall.find({
        ...query,
        _id: { $nin: Array.from(processedIds) } // Exclude already processed
      })
        .select('_id callId recordingUrl s3AudioUrl s3AudioUploadStatus')
        .limit(remaining)
        .lean();
      
      // Add to processed set
      calls.forEach(call => processedIds.add(call._id));

      if (calls.length === 0) {
        break;
      }

      await migrateBatch(calls, batchNumber);
      processedCount += calls.length;
      batchNumber++;

      // Delay between batches (except for last batch)
      if (processedCount < stats.total && (!MAX_CALLS || processedCount < MAX_CALLS)) {
        console.log(`\n⏳ Waiting ${DELAY_MS}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, DELAY_MS));
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary');
    console.log('='.repeat(60));
    console.log(`Total calls found: ${stats.total}`);
    console.log(`Processed: ${stats.processed}`);
    console.log(`✅ Uploaded to S3: ${stats.uploaded}`);
    console.log(`❌ Failed: ${stats.failed}`);
    console.log(`🗑️  Deleted (404): ${stats.deleted}`);
    console.log(`⏭️  Skipped: ${stats.skipped}`);
    
    if (stats.errors.length > 0) {
      console.log(`\n❌ Errors (first 10):`);
      stats.errors.slice(0, 10).forEach((err, i) => {
        console.log(`  ${i + 1}. callId: ${err.callId} - ${err.error}`);
      });
      if (stats.errors.length > 10) {
        console.log(`  ... and ${stats.errors.length - 10} more errors`);
      }
    }

    console.log('\n✅ Migration complete!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run migration
main();

