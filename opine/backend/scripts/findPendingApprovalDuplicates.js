#!/usr/bin/env node

/**
 * Find Pending_Approval Duplicates (All Time)
 * 
 * 1. Finds all duplicate groups by contentHash (all time)
 * 2. Only considers duplicates in Pending_Approval, Approved, or Rejected status
 * 3. Skips groups where ALL duplicates (except original) are Pending_Approval
 * 4. Lists groups where some duplicates are Pending_Approval (but not all)
 * 
 * OPTIMIZED: Uses aggregation pipeline for efficient processing
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
const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ContentHashDuplicates');

async function findPendingApprovalDuplicates() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 FIND PENDING_APPROVAL DUPLICATES (ALL TIME)');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Step 1: Find all responses with contentHash and valid status
    console.log('📊 Step 1: Finding all responses with contentHash...');
    
    const query = {
      survey: SURVEY_ID,
      status: { $in: ['Pending_Approval', 'Approved', 'Rejected'] },
      contentHash: { $exists: true, $ne: null }
    };
    
    const totalCount = await SurveyResponse.countDocuments(query);
    console.log(`   Found ${totalCount} responses with contentHash\n`);
    
    if (totalCount === 0) {
      console.log('✅ No responses found. Exiting.');
      await mongoose.disconnect();
      return;
    }
    
    // Step 2: Use aggregation to find duplicate groups efficiently
    console.log('🔍 Step 2: Finding duplicate groups using aggregation...');
    
    const duplicateGroups = await SurveyResponse.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$contentHash',
          responses: {
            $push: {
              responseId: '$responseId',
              mongoId: { $toString: '$_id' },
              sessionId: '$sessionId',
              status: '$status',
              interviewMode: '$interviewMode',
              call_id: '$call_id',
              createdAt: '$createdAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }, // Only groups with duplicates
      { $sort: { count: -1 } } // Sort by count descending
    ]);
    
    console.log(`   Found ${duplicateGroups.length} duplicate groups\n`);
    
    // Step 3: Process groups and filter based on criteria
    console.log('🔍 Step 3: Processing groups and filtering...');
    
    const filteredGroups = [];
    let skippedAllPendingCount = 0;
    
    for (const group of duplicateGroups) {
      // Sort by createdAt to identify original
      group.responses.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const original = group.responses[0];
      const duplicates = group.responses.slice(1);
      
      // Count statuses in duplicates (not original)
      const duplicateStatuses = duplicates.map(d => d.status);
      const pendingCount = duplicateStatuses.filter(s => s === 'Pending_Approval').length;
      const approvedCount = duplicateStatuses.filter(s => s === 'Approved').length;
      const rejectedCount = duplicateStatuses.filter(s => s === 'Rejected').length;
      
      // Skip if ALL duplicates are Pending_Approval
      if (pendingCount === duplicates.length) {
        skippedAllPendingCount++;
        continue;
      }
      
      // Include if there are Pending_Approval duplicates (but not all)
      if (pendingCount > 0) {
        filteredGroups.push({
          contentHash: group._id,
          count: group.count,
          original: original,
          duplicates: duplicates,
          statusBreakdown: {
            pending: pendingCount,
            approved: approvedCount,
            rejected: rejectedCount
          },
          pendingApprovalDuplicates: duplicates.filter(d => d.status === 'Pending_Approval')
        });
      }
    }
    
    console.log(`   Skipped ${skippedAllPendingCount} groups where all duplicates are Pending_Approval`);
    console.log(`   Found ${filteredGroups.length} groups with mixed status duplicates\n`);
    
    // Step 4: Generate report
    console.log('📄 Step 4: Generating report...');
    
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    // Calculate statistics
    const totalPendingDuplicates = filteredGroups.reduce((sum, group) => sum + group.pendingApprovalDuplicates.length, 0);
    const byMode = {
      capi: 0,
      cati: 0
    };
    
    filteredGroups.forEach(group => {
      group.pendingApprovalDuplicates.forEach(dup => {
        byMode[dup.interviewMode] = (byMode[dup.interviewMode] || 0) + 1;
      });
    });
    
    // JSON Report
    const report = {
      timestamp: new Date().toISOString(),
      surveyId: SURVEY_ID,
      summary: {
        totalDuplicateGroups: duplicateGroups.length,
        skippedAllPendingGroups: skippedAllPendingCount,
        groupsWithMixedStatus: filteredGroups.length,
        totalPendingApprovalDuplicates: totalPendingDuplicates,
        byMode: byMode
      },
      groups: filteredGroups.map(group => ({
        contentHash: group.contentHash,
        count: group.count,
        original: {
          responseId: group.original.responseId,
          mongoId: group.original.mongoId,
          sessionId: group.original.sessionId,
          status: group.original.status,
          interviewMode: group.original.interviewMode,
          call_id: group.original.call_id || null,
          createdAt: group.original.createdAt
        },
        allDuplicates: group.duplicates.map(dup => ({
          responseId: dup.responseId,
          mongoId: dup.mongoId,
          sessionId: dup.sessionId,
          status: dup.status,
          interviewMode: dup.interviewMode,
          call_id: dup.call_id || null,
          createdAt: dup.createdAt
        })),
        statusBreakdown: group.statusBreakdown,
        pendingApprovalDuplicates: group.pendingApprovalDuplicates.map(dup => ({
          responseId: dup.responseId,
          mongoId: dup.mongoId,
          sessionId: dup.sessionId,
          interviewMode: dup.interviewMode,
          call_id: dup.call_id || null,
          createdAt: dup.createdAt
        }))
      }))
    };
    
    const jsonPath = path.join(REPORT_DIR, `pending_approval_duplicates_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`   ✅ JSON report saved: ${jsonPath}`);
    
    // CSV Report - Only Pending_Approval duplicates
    const csvRows = [
      'Content Hash,Group Size,Original Response ID,Original Status,Duplicate Response ID,Duplicate Mongo ID,Duplicate Session ID,Interview Mode,Call ID,Duplicate Created At'
    ];
    
    filteredGroups.forEach(group => {
      group.pendingApprovalDuplicates.forEach(dup => {
        csvRows.push([
          group.contentHash,
          group.count,
          group.original.responseId,
          group.original.status,
          dup.responseId,
          dup.mongoId,
          dup.sessionId,
          dup.interviewMode,
          dup.call_id || '',
          dup.createdAt.toISOString()
        ].join(','));
      });
    });
    
    const csvPath = path.join(REPORT_DIR, `pending_approval_duplicates_${TIMESTAMP}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`   ✅ CSV report saved: ${csvPath}`);
    
    // Summary Report
    console.log('\n' + '='.repeat(80));
    console.log('📊 PENDING_APPROVAL DUPLICATES REPORT');
    console.log('='.repeat(80));
    console.log(`Total duplicate groups (all time): ${duplicateGroups.length}`);
    console.log(`Groups skipped (all duplicates are Pending_Approval): ${skippedAllPendingCount}`);
    console.log(`Groups with mixed status duplicates: ${filteredGroups.length}`);
    console.log(`Total Pending_Approval duplicates to review: ${totalPendingDuplicates}`);
    console.log('');
    console.log('By Mode:');
    console.log(`  CAPI: ${byMode.capi}`);
    console.log(`  CATI: ${byMode.cati}`);
    console.log('');
    
    if (filteredGroups.length > 0) {
      console.log('Top 20 Groups with Pending_Approval Duplicates:');
      filteredGroups.slice(0, 20).forEach((group, idx) => {
        console.log(`\n${idx + 1}. Content Hash: ${group.contentHash}`);
        console.log(`   Group Size: ${group.count} responses`);
        console.log(`   Original: ${group.original.responseId} (${group.original.status}, ${group.original.interviewMode})`);
        if (group.original.call_id) {
          console.log(`   Call ID: ${group.original.call_id}`);
        }
        console.log(`   Status Breakdown: Pending=${group.statusBreakdown.pending}, Approved=${group.statusBreakdown.approved}, Rejected=${group.statusBreakdown.rejected}`);
        console.log(`   Pending_Approval Duplicates:`);
        group.pendingApprovalDuplicates.forEach(dup => {
          console.log(`     - ${dup.responseId} (${dup.interviewMode}${dup.call_id ? `, Call ID: ${dup.call_id}` : ''})`);
        });
      });
    } else {
      console.log('✅ No groups found with mixed status duplicates!');
      console.log('   (All duplicate groups have all duplicates in Pending_Approval status)');
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
  findPendingApprovalDuplicates();
}

module.exports = { findPendingApprovalDuplicates };






