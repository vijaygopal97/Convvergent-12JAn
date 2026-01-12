#!/usr/bin/env node

/**
 * Find Duplicate Groups with Pending_Approval Status
 * 
 * 1. Groups responses by contentHash
 * 2. Only includes groups where at least ONE response has status "Pending_Approval"
 * 3. Excludes groups where ALL responses are "Abandoned" or "Terminated"
 * 4. Generates report in the same format as duplicate_detection_by_hash JSON
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
const User = require(path.join(backendPath, 'models/User'));

const SURVEY_ID = '68fd1915d41841da463f0d46';
const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ImprovedDuplicateRemove');

async function findPendingApprovalDuplicateGroups() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 FINDING PENDING_APPROVAL DUPLICATE GROUPS');
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
    
    // Step 1: Find all responses with contentHash
    console.log('📊 Step 1: Finding all responses with contentHash...');
    
    const surveyObjectId = mongoose.Types.ObjectId.isValid(SURVEY_ID) 
      ? new mongoose.Types.ObjectId(SURVEY_ID) 
      : SURVEY_ID;
    
    const query = {
      survey: surveyObjectId,
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
              startTime: '$startTime',
              endTime: '$endTime',
              totalTimeSpent: '$totalTimeSpent',
              createdAt: '$createdAt',
              interviewer: '$interviewer',
              audioRecording: '$audioRecording',
              location: '$location',
              responses: '$responses'
            }
          },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }, // Only groups with duplicates
      { $sort: { count: -1 } } // Sort by count descending
    ]);
    
    console.log(`   Found ${duplicateGroups.length} duplicate groups\n`);
    
    // Step 3: Filter groups - only include if at least one is Pending_Approval
    console.log('🔍 Step 3: Filtering groups with Pending_Approval status...');
    
    const filteredGroups = [];
    let excludedCount = 0;
    
    for (const group of duplicateGroups) {
      // Check if any response has Pending_Approval status
      const hasPendingApproval = group.responses.some(r => r.status === 'Pending_Approval');
      
      // Check if all responses are Abandoned or Terminated
      const allAbandonedOrTerminated = group.responses.every(r => 
        r.status === 'abandoned' || r.status === 'Terminated'
      );
      
      // Include if has Pending_Approval AND not all are Abandoned/Terminated
      if (hasPendingApproval && !allAbandonedOrTerminated) {
        filteredGroups.push(group);
      } else {
        excludedCount++;
      }
    }
    
    console.log(`   Excluded ${excludedCount} groups (all Abandoned/Terminated or no Pending_Approval)`);
    console.log(`   Found ${filteredGroups.length} groups with Pending_Approval duplicates\n`);
    
    // Step 4: Process groups and enrich with interviewer/survey data
    console.log('📊 Step 4: Enriching groups with interviewer and survey data...');
    
    const survey = await Survey.findById(SURVEY_ID).lean();
    const enrichedGroups = [];
    
    for (let i = 0; i < filteredGroups.length; i++) {
      const group = filteredGroups[i];
      
      // Sort by createdAt to identify original (earliest)
      group.responses.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const original = group.responses[0];
      const duplicates = group.responses.slice(1);
      
      // Get interviewer details for original
      let interviewerDetails = null;
      if (original.interviewer) {
        try {
          const interviewer = await User.findById(original.interviewer).lean();
          if (interviewer) {
            interviewerDetails = {
              id: interviewer._id.toString(),
              name: `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim(),
              email: interviewer.email || 'N/A',
              phone: interviewer.phone || 'N/A',
              memberId: interviewer.memberId || 'N/A'
            };
          }
        } catch (error) {
          console.error(`   ⚠️  Error fetching interviewer for ${original.responseId}:`, error.message);
        }
      }
      
      // Calculate audio info
      const audioUrl = original.audioRecording?.audioUrl || null;
      const audioDuration = original.audioRecording?.duration || original.totalTimeSpent || 0;
      const audioFileSize = original.audioRecording?.fileSize || 0;
      
      // Build enriched group
      const enrichedGroup = {
        groupNumber: i + 1,
        mode: (original.interviewMode || 'CAPI').toUpperCase(),
        contentHash: group._id,
        original: {
          responseId: original.responseId,
          mongoId: original.mongoId,
          sessionId: original.sessionId,
          interviewer: interviewerDetails,
          survey: {
            id: SURVEY_ID,
            name: survey?.surveyName || 'Unknown Survey'
          },
          startTime: original.startTime,
          endTime: original.endTime,
          duration: original.totalTimeSpent || 0,
          status: original.status,
          call_id: original.call_id || null,
          audioUrl: audioUrl,
          audioDuration: audioDuration,
          audioFileSize: audioFileSize,
          location: original.location,
          responseCount: original.responses?.length || 0,
          createdAt: original.createdAt,
          contentHash: group._id
        },
        duplicates: duplicates.map(dup => {
          // Calculate time difference from original
          const timeDiff = new Date(dup.createdAt) - new Date(original.createdAt);
          
          return {
            responseId: dup.responseId,
            mongoId: dup.mongoId,
            sessionId: dup.sessionId,
            startTime: dup.startTime,
            endTime: dup.endTime,
            duration: dup.totalTimeSpent || 0,
            status: dup.status,
            call_id: dup.call_id || null,
            audioUrl: dup.audioRecording?.audioUrl || null,
            audioDuration: dup.audioRecording?.duration || dup.totalTimeSpent || 0,
            audioFileSize: dup.audioRecording?.fileSize || 0,
            location: dup.location,
            responseCount: dup.responses?.length || 0,
            createdAt: dup.createdAt,
            timeDifference: Math.floor(timeDiff / 1000), // in seconds
            contentHash: group._id
          };
        })
      };
      
      enrichedGroups.push(enrichedGroup);
      
      if ((i + 1) % 100 === 0) {
        console.log(`   Processed ${i + 1}/${filteredGroups.length} groups...`);
      }
    }
    
    console.log(`\n✅ Enriched ${enrichedGroups.length} groups\n`);
    
    // Step 5: Calculate statistics
    console.log('📊 Step 5: Calculating statistics...');
    
    const capiGroups = enrichedGroups.filter(g => g.mode === 'CAPI');
    const catiGroups = enrichedGroups.filter(g => g.mode === 'CATI');
    const totalDuplicates = enrichedGroups.reduce((sum, g) => sum + g.duplicates.length, 0);
    const pendingApprovalDuplicates = enrichedGroups.reduce((sum, g) => {
      return sum + g.duplicates.filter(d => d.status === 'Pending_Approval').length;
    }, 0);
    
    // Step 6: Generate report
    console.log('📄 Step 6: Generating report...');
    
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const report = {
      timestamp: new Date().toISOString(),
      method: "contentHash-based duplicate detection (Pending_Approval filter)",
      summary: {
        totalDuplicateGroups: enrichedGroups.length,
        capiDuplicateGroups: capiGroups.length,
        catiDuplicateGroups: catiGroups.length,
        totalDuplicatesToMark: totalDuplicates,
        totalOriginals: enrichedGroups.length,
        pendingApprovalDuplicates: pendingApprovalDuplicates
      },
      statistics: {
        totalProcessed: totalCount,
        capiProcessed: enrichedGroups.filter(g => g.mode === 'CAPI').length,
        catiProcessed: enrichedGroups.filter(g => g.mode === 'CATI').length,
        capiDuplicatesFound: capiGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
        catiDuplicatesFound: catiGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
        excludedGroups: excludedCount
      },
      groups: enrichedGroups
    };
    
    const jsonPath = path.join(REPORT_DIR, `pending_approval_duplicate_groups_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`   ✅ JSON report saved: ${jsonPath}`);
    
    // Summary Report
    console.log('\n' + '='.repeat(80));
    console.log('📊 PENDING_APPROVAL DUPLICATE GROUPS REPORT');
    console.log('='.repeat(80));
    console.log(`Total responses processed: ${totalCount}`);
    console.log(`Total duplicate groups found: ${duplicateGroups.length}`);
    console.log(`Groups excluded (all Abandoned/Terminated or no Pending_Approval): ${excludedCount}`);
    console.log(`Groups with Pending_Approval duplicates: ${enrichedGroups.length}`);
    console.log('');
    console.log('Breakdown:');
    console.log(`  CAPI groups: ${capiGroups.length}`);
    console.log(`  CATI groups: ${catiGroups.length}`);
    console.log(`  Total duplicates: ${totalDuplicates}`);
    console.log(`  Pending_Approval duplicates: ${pendingApprovalDuplicates}`);
    console.log(`  Total originals: ${enrichedGroups.length}`);
    console.log('');
    console.log(`✅ Report saved: ${jsonPath}`);
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
  findPendingApprovalDuplicateGroups();
}

module.exports = { findPendingApprovalDuplicateGroups };

