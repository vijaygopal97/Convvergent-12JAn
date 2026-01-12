#!/usr/bin/env node

/**
 * Regenerate Content Hash and Find Duplicates (Efficient Version)
 * 
 * 1. Only processes responses added TODAY
 * 2. Regenerates content hash using corrected logic:
 *    - CAPI: survey|startTime|endTime|duration|responsesCount|responseSignature (NO GPS)
 *    - CATI: survey|call_id (ONLY call_id)
 * 
 * 3. Updates contentHash field in database using bulk operations
 * 
 * 4. Finds duplicates that were added TODAY
 * 
 * 5. Only considers duplicates in Pending_Approval, Approved, or Rejected status
 * 
 * 6. Generates detailed report
 * 
 * OPTIMIZED: Uses bulk operations, batch processing, and delays to avoid server overload
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

const SURVEY_ID = '68fd1915d41841da463f0d46';
const BATCH_SIZE = 100; // Smaller batches to avoid overload
const BATCH_DELAY_MS = 100; // Delay between batches (100ms)
const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ContentHashDuplicates');

// Helper: Sleep function
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function regenerateContentHashAndFindDuplicates() {
  try {
    console.log('='.repeat(80));
    console.log('🔄 REGENERATE CONTENT HASH AND FIND DUPLICATES (EFFICIENT)');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`Batch size: ${BATCH_SIZE}`);
    console.log(`Batch delay: ${BATCH_DELAY_MS}ms`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Calculate today's date range (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    const todayIST = new Date(now.getTime() + istOffset);
    todayIST.setUTCHours(0, 0, 0, 0);
    const todayISTEnd = new Date(todayIST);
    todayISTEnd.setUTCHours(23, 59, 59, 999);
    const todayStartUTC = new Date(todayIST.getTime() - istOffset);
    const todayEndUTC = new Date(todayISTEnd.getTime() - istOffset);
    
    console.log('📅 Today\'s date range (IST):');
    console.log(`   Date: ${todayIST.toISOString().split('T')[0]}`);
    console.log(`   UTC Range: ${todayStartUTC.toISOString()} to ${todayEndUTC.toISOString()}`);
    console.log('');
    
    // Step 1: Find responses added TODAY (only what we need)
    console.log('📊 Step 1: Finding responses added today...');
    
    const query = {
      survey: SURVEY_ID,
      status: { $in: ['Pending_Approval', 'Approved', 'Rejected'] },
      createdAt: { $gte: todayStartUTC, $lte: todayEndUTC }
    };
    
    // Count first to show progress
    const totalCount = await SurveyResponse.countDocuments(query);
    console.log(`   Found ${totalCount} responses to process\n`);
    
    if (totalCount === 0) {
      console.log('✅ No responses found for today. Exiting.');
      await mongoose.disconnect();
      return;
    }
    
    // Step 2: Process in batches and regenerate content hash
    console.log('🔄 Step 2: Regenerating content hash for today\'s responses...');
    console.log(`   Processing in batches of ${BATCH_SIZE} with ${BATCH_DELAY_MS}ms delay...\n`);
    
    let processedCount = 0;
    let updatedCount = 0;
    let errorCount = 0;
    const bulkOps = [];
    const responsesForDuplicateCheck = [];
    
    // Use cursor for efficient processing
    const cursor = SurveyResponse.find(query)
      .select('_id responseId sessionId status interviewMode startTime endTime totalTimeSpent responses contentHash selectedAC location call_id createdAt')
      .lean()
      .cursor();
    
    for await (const response of cursor) {
      try {
        // Regenerate content hash using new logic
        const newHash = SurveyResponse.generateContentHash(
          response.interviewer || null,
          response.survey || SURVEY_ID,
          response.startTime,
          response.responses || [],
          {
            interviewMode: response.interviewMode || null,
            location: response.location || null,
            call_id: response.call_id || null,
            endTime: response.endTime || null,
            totalTimeSpent: response.totalTimeSpent || null
          }
        );
        
        processedCount++;
        
        // Prepare for bulk update if hash changed
        if (response.contentHash !== newHash) {
          bulkOps.push({
            updateOne: {
              filter: { _id: response._id },
              update: { $set: { contentHash: newHash } }
            }
          });
          response.contentHash = newHash; // Update in memory
        }
        
        // Store response for duplicate checking (with updated hash)
        responsesForDuplicateCheck.push({
          ...response,
          contentHash: newHash
        });
        
        // Execute bulk update when batch is full
        if (bulkOps.length >= BATCH_SIZE) {
          if (bulkOps.length > 0) {
            const result = await SurveyResponse.bulkWrite(bulkOps, { ordered: false });
            updatedCount += result.modifiedCount;
            bulkOps.length = 0; // Clear array
          }
          await sleep(BATCH_DELAY_MS); // Delay to avoid overload
        }
        
        if (processedCount % 500 === 0) {
          console.log(`   Processed ${processedCount}/${totalCount} responses (Updated: ${updatedCount})...`);
        }
      } catch (error) {
        console.error(`   ❌ Error processing response ${response.responseId}:`, error.message);
        errorCount++;
      }
    }
    
    // Execute remaining bulk operations
    if (bulkOps.length > 0) {
      const result = await SurveyResponse.bulkWrite(bulkOps, { ordered: false });
      updatedCount += result.modifiedCount;
    }
    
    console.log(`\n✅ Regeneration complete:`);
    console.log(`   Total processed: ${processedCount}`);
    console.log(`   Updated: ${updatedCount}`);
    console.log(`   Errors: ${errorCount}\n`);
    
    // Step 3: Find duplicates using in-memory grouping (fast)
    console.log('🔍 Step 3: Finding duplicates...');
    
    // Group by contentHash
    const hashGroups = {};
    for (const response of responsesForDuplicateCheck) {
      const hash = response.contentHash;
      if (!hash) continue; // Skip if no hash
      
      if (!hashGroups[hash]) {
        hashGroups[hash] = [];
      }
      hashGroups[hash].push(response);
    }
    
    // Find duplicate groups (more than 1 response with same hash)
    const duplicateGroups = [];
    for (const [hash, group] of Object.entries(hashGroups)) {
      if (group.length > 1) {
        // Sort by createdAt to identify original vs duplicates
        group.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        duplicateGroups.push({
          contentHash: hash,
          count: group.length,
          original: group[0],
          duplicates: group.slice(1)
        });
      }
    }
    
    console.log(`   Found ${duplicateGroups.length} duplicate groups\n`);
    
    // Step 4: Generate report
    console.log('📄 Step 4: Generating report...');
    
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    // Calculate statistics
    const totalDuplicateResponses = duplicateGroups.reduce((sum, group) => sum + group.duplicates.length, 0);
    const byStatus = {
      Pending_Approval: 0,
      Approved: 0,
      Rejected: 0
    };
    const byMode = {
      capi: 0,
      cati: 0
    };
    
    duplicateGroups.forEach(group => {
      group.duplicates.forEach(dup => {
        byStatus[dup.status] = (byStatus[dup.status] || 0) + 1;
        byMode[dup.interviewMode] = (byMode[dup.interviewMode] || 0) + 1;
      });
    });
    
    // JSON Report
    const report = {
      timestamp: new Date().toISOString(),
      surveyId: SURVEY_ID,
      dateRange: {
        todayIST: todayIST.toISOString().split('T')[0],
        startUTC: todayStartUTC.toISOString(),
        endUTC: todayEndUTC.toISOString()
      },
      regeneration: {
        totalProcessed: processedCount,
        updated: updatedCount,
        errors: errorCount
      },
      duplicates: {
        totalGroups: duplicateGroups.length,
        totalDuplicateResponses: totalDuplicateResponses,
        byStatus: byStatus,
        byMode: byMode
      },
      duplicateGroups: duplicateGroups.map(group => ({
        contentHash: group.contentHash,
        count: group.count,
        original: {
          responseId: group.original.responseId,
          mongoId: group.original._id.toString(),
          sessionId: group.original.sessionId,
          status: group.original.status,
          interviewMode: group.original.interviewMode,
          createdAt: group.original.createdAt.toISOString(),
          call_id: group.original.call_id || null
        },
        duplicates: group.duplicates.map(dup => ({
          responseId: dup.responseId,
          mongoId: dup._id.toString(),
          sessionId: dup.sessionId,
          status: dup.status,
          interviewMode: dup.interviewMode,
          createdAt: dup.createdAt.toISOString(),
          call_id: dup.call_id || null
        }))
      }))
    };
    
    const jsonPath = path.join(REPORT_DIR, `duplicates_today_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`   ✅ JSON report saved: ${jsonPath}`);
    
    // CSV Report
    const csvRows = [
      'Content Hash,Group Size,Response ID,Mongo ID,Session ID,Status,Interview Mode,Call ID,Created At,Is Original'
    ];
    
    duplicateGroups.forEach(group => {
      // Original
      csvRows.push([
        group.contentHash,
        group.count,
        group.original.responseId,
        group.original._id.toString(),
        group.original.sessionId,
        group.original.status,
        group.original.interviewMode,
        group.original.call_id || '',
        group.original.createdAt.toISOString(),
        'Yes'
      ].join(','));
      
      // Duplicates
      group.duplicates.forEach(dup => {
        csvRows.push([
          group.contentHash,
          group.count,
          dup.responseId,
          dup._id.toString(),
          dup.sessionId,
          dup.status,
          dup.interviewMode,
          dup.call_id || '',
          dup.createdAt.toISOString(),
          'No'
        ].join(','));
      });
    });
    
    const csvPath = path.join(REPORT_DIR, `duplicates_today_${TIMESTAMP}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`   ✅ CSV report saved: ${csvPath}`);
    
    // Summary Report
    console.log('\n' + '='.repeat(80));
    console.log('📊 DUPLICATE REPORT SUMMARY');
    console.log('='.repeat(80));
    console.log(`Date: ${todayIST.toISOString().split('T')[0]} (IST)`);
    console.log(`Total responses checked: ${processedCount}`);
    console.log(`Content hashes updated: ${updatedCount}`);
    console.log(`Duplicate groups found: ${duplicateGroups.length}`);
    console.log(`Total duplicate responses: ${totalDuplicateResponses}`);
    console.log('');
    console.log('By Status:');
    console.log(`  Pending_Approval: ${byStatus.Pending_Approval}`);
    console.log(`  Approved: ${byStatus.Approved}`);
    console.log(`  Rejected: ${byStatus.Rejected}`);
    console.log('');
    console.log('By Mode:');
    console.log(`  CAPI: ${byMode.capi}`);
    console.log(`  CATI: ${byMode.cati}`);
    console.log('');
    
    if (duplicateGroups.length > 0) {
      console.log('Top 10 Duplicate Groups:');
      duplicateGroups.slice(0, 10).forEach((group, idx) => {
        console.log(`\n${idx + 1}. Content Hash: ${group.contentHash}`);
        console.log(`   Count: ${group.count} responses`);
        console.log(`   Original: ${group.original.responseId} (${group.original.status}, ${group.original.interviewMode})`);
        if (group.original.call_id) {
          console.log(`   Call ID: ${group.original.call_id}`);
        }
        console.log(`   Duplicates: ${group.duplicates.map(d => `${d.responseId} (${d.status})`).join(', ')}`);
      });
    } else {
      console.log('✅ No duplicates found for today!');
    }
    
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  regenerateContentHashAndFindDuplicates();
}

module.exports = { regenerateContentHashAndFindDuplicates };
