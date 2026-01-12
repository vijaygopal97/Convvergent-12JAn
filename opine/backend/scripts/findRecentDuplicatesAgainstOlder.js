#!/usr/bin/env node

/**
 * Find Recent Duplicates Against Older Responses
 * 
 * Strategy:
 * 1. Find all responses created in the last 20 hours
 * 2. For each, check if duplicate (by contentHash) exists that was created BEFORE 24 hours ago
 * 3. Group multiple duplicates if they exist today itself
 * 4. Generate report with new response(s) and old duplicate(s)
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

async function findRecentDuplicatesAgainstOlder() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 FINDING RECENT DUPLICATES AGAINST OLDER RESPONSES');
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
    
    // Calculate time boundaries
    const now = new Date();
    const twentyHoursAgo = new Date(now.getTime() - (20 * 60 * 60 * 1000));
    
    console.log('⏰ Time Boundaries:');
    console.log(`   Now: ${now.toISOString()}`);
    console.log(`   20 hours ago: ${twentyHoursAgo.toISOString()}`);
    console.log(`   Strategy: For each recent response, find duplicates created BEFORE that response's createdAt\n`);
    
    const surveyObjectId = mongoose.Types.ObjectId.isValid(SURVEY_ID) 
      ? new mongoose.Types.ObjectId(SURVEY_ID) 
      : SURVEY_ID;
    
    // Step 1: Find all responses created in last 20 hours with contentHash
    console.log('📊 Step 1: Finding responses created in last 20 hours...');
    
    const recentResponses = await SurveyResponse.find({
      survey: surveyObjectId,
      createdAt: { $gte: twentyHoursAgo },
      contentHash: { $exists: true, $ne: null }
    }).lean();
    
    console.log(`   Found ${recentResponses.length} recent responses with contentHash\n`);
    
    if (recentResponses.length === 0) {
      console.log('✅ No recent responses found. Exiting.');
      await mongoose.disconnect();
      return;
    }
    
    // Step 2: Group recent responses by contentHash (to handle multiple duplicates today)
    console.log('🔍 Step 2: Grouping recent responses by contentHash...');
    
    const recentGroups = {};
    for (const response of recentResponses) {
      const hash = response.contentHash;
      if (!recentGroups[hash]) {
        recentGroups[hash] = [];
      }
      recentGroups[hash].push(response);
    }
    
    // Count groups with multiple recent responses
    const groupsWithMultipleRecent = Object.values(recentGroups).filter(g => g.length > 1).length;
    
    console.log(`   Found ${Object.keys(recentGroups).length} unique contentHash groups in recent responses`);
    console.log(`   Groups with multiple recent responses (duplicates today): ${groupsWithMultipleRecent}\n`);
    
    // Step 3: For each group, find older duplicates (created before the earliest recent response)
    console.log('🔍 Step 3: Finding older duplicates for each recent group...');
    
    const duplicateGroups = [];
    const contentHashes = Object.keys(recentGroups);
    
    for (let i = 0; i < contentHashes.length; i++) {
      const contentHash = contentHashes[i];
      const recentGroup = recentGroups[contentHash];
      
      // Sort recent responses by createdAt to get the earliest one
      recentGroup.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      const earliestRecent = recentGroup[0];
      const earliestRecentTime = new Date(earliestRecent.createdAt);
      
      // Find older duplicates (created before the earliest recent response in this group)
      const olderDuplicates = await SurveyResponse.find({
        survey: surveyObjectId,
        contentHash: contentHash,
        createdAt: { $lt: earliestRecentTime }
      }).lean();
      
      // Include if older duplicates exist OR if there are multiple recent responses (duplicates within today)
      if (olderDuplicates.length > 0 || recentGroup.length > 1) {
        duplicateGroups.push({
          contentHash: contentHash,
          recentResponses: recentGroup,
          olderDuplicates: olderDuplicates,
          earliestRecentTime: earliestRecentTime,
          hasOlderDuplicates: olderDuplicates.length > 0,
          hasMultipleRecent: recentGroup.length > 1
        });
      }
      
      if ((i + 1) % 100 === 0) {
        console.log(`   Processed ${i + 1}/${contentHashes.length} groups... (found ${duplicateGroups.length} so far)`);
      }
    }
    
    const groupsWithOlder = duplicateGroups.filter(g => g.hasOlderDuplicates).length;
    const groupsWithMultipleRecentOnly = duplicateGroups.filter(g => !g.hasOlderDuplicates && g.hasMultipleRecent).length;
    
    console.log(`   Found ${duplicateGroups.length} duplicate groups:`);
    console.log(`     - ${groupsWithOlder} groups with older duplicates`);
    console.log(`     - ${groupsWithMultipleRecentOnly} groups with multiple recent duplicates only\n`);
    
    // Step 4: Enrich with interviewer and survey data
    console.log('📊 Step 4: Enriching with interviewer and survey data...');
    
    const survey = await Survey.findById(SURVEY_ID).lean();
    const enrichedGroups = [];
    
    for (let i = 0; i < duplicateGroups.length; i++) {
      const group = duplicateGroups[i];
      
      // Sort recent responses by createdAt
      group.recentResponses.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      
      // Sort older duplicates by createdAt (oldest first)
      if (group.olderDuplicates.length > 0) {
        group.olderDuplicates.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      }
      
      // Get the oldest duplicate as the "original" (use oldest older duplicate, or earliest recent if no older)
      const originalDuplicate = group.olderDuplicates.length > 0 
        ? group.olderDuplicates[0] 
        : group.recentResponses[0];
      
      // Helper function to get interviewer details
      const getInterviewerDetails = async (interviewerId) => {
        if (!interviewerId) return null;
        try {
          const interviewer = await User.findById(interviewerId).lean();
          if (interviewer) {
            return {
              id: interviewer._id.toString(),
              name: `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim(),
              email: interviewer.email || 'N/A',
              phone: interviewer.phone || 'N/A',
              memberId: interviewer.memberId || 'N/A'
            };
          }
        } catch (error) {
          // Ignore errors
        }
        return null;
      };
      
      // Get interviewer for original duplicate
      const originalInterviewer = await getInterviewerDetails(originalDuplicate.interviewer);
      
      // Build enriched group
      const enrichedGroup = {
        groupNumber: i + 1,
        mode: (originalDuplicate.interviewMode || 'CAPI').toUpperCase(),
        contentHash: group.contentHash,
        originalDuplicate: {
          responseId: originalDuplicate.responseId,
          mongoId: originalDuplicate._id.toString(),
          sessionId: originalDuplicate.sessionId,
          interviewer: originalInterviewer,
          survey: {
            id: SURVEY_ID,
            name: survey?.surveyName || 'Unknown Survey'
          },
          startTime: originalDuplicate.startTime,
          endTime: originalDuplicate.endTime,
          duration: originalDuplicate.totalTimeSpent || 0,
          status: originalDuplicate.status,
          call_id: originalDuplicate.call_id || null,
          audioUrl: originalDuplicate.audioRecording?.audioUrl || null,
          audioDuration: originalDuplicate.audioRecording?.duration || originalDuplicate.totalTimeSpent || 0,
          audioFileSize: originalDuplicate.audioRecording?.fileSize || 0,
          location: originalDuplicate.location,
          responseCount: originalDuplicate.responses?.length || 0,
          createdAt: originalDuplicate.createdAt,
          contentHash: group.contentHash
        },
        allOlderDuplicates: group.olderDuplicates.map(dup => {
          const timeDiff = new Date(dup.createdAt) - new Date(originalDuplicate.createdAt);
          return {
            responseId: dup.responseId,
            mongoId: dup._id.toString(),
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
            timeDifferenceFromOriginal: Math.floor(timeDiff / 1000), // in seconds
            contentHash: group.contentHash
          };
        }),
        recentDuplicates: await Promise.all(group.recentResponses.map(async (dup) => {
          const interviewer = await getInterviewerDetails(dup.interviewer);
          const timeDiff = new Date(dup.createdAt) - new Date(originalDuplicate.createdAt);
          return {
            responseId: dup.responseId,
            mongoId: dup._id.toString(),
            sessionId: dup.sessionId,
            interviewer: interviewer,
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
            timeDifferenceFromOriginal: Math.floor(timeDiff / 1000), // in seconds
            contentHash: group.contentHash
          };
        }))
      };
      
      enrichedGroups.push(enrichedGroup);
      
      if ((i + 1) % 50 === 0) {
        console.log(`   Processed ${i + 1}/${duplicateGroups.length} groups...`);
      }
    }
    
    console.log(`\n✅ Enriched ${enrichedGroups.length} groups\n`);
    
    // Step 5: Calculate statistics
    console.log('📊 Step 5: Calculating statistics...');
    
    const capiGroups = enrichedGroups.filter(g => g.mode === 'CAPI');
    const catiGroups = enrichedGroups.filter(g => g.mode === 'CATI');
    const totalRecentDuplicates = enrichedGroups.reduce((sum, g) => sum + g.recentDuplicates.length, 0);
    const totalOlderDuplicates = enrichedGroups.reduce((sum, g) => sum + g.allOlderDuplicates.length, 0);
    const pendingApprovalRecent = enrichedGroups.reduce((sum, g) => {
      return sum + g.recentDuplicates.filter(d => d.status === 'Pending_Approval').length;
    }, 0);
    
    // Step 6: Generate report
    console.log('📄 Step 6: Generating report...');
    
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const report = {
      timestamp: new Date().toISOString(),
      method: "Recent duplicates (last 20 hours) against older responses (before 24 hours)",
      timeBoundaries: {
        now: now.toISOString(),
        twentyHoursAgo: twentyHoursAgo.toISOString(),
        strategy: "For each recent response, find duplicates created BEFORE that response's createdAt"
      },
      summary: {
        totalDuplicateGroups: enrichedGroups.length,
        capiDuplicateGroups: capiGroups.length,
        catiDuplicateGroups: catiGroups.length,
        totalRecentDuplicates: totalRecentDuplicates,
        totalOlderDuplicates: totalOlderDuplicates,
        pendingApprovalRecentDuplicates: pendingApprovalRecent
      },
      statistics: {
        totalRecentResponsesProcessed: recentResponses.length,
        uniqueContentHashesInRecent: Object.keys(recentGroups).length,
        groupsWithOlderDuplicates: enrichedGroups.length,
        capiRecentDuplicates: capiGroups.reduce((sum, g) => sum + g.recentDuplicates.length, 0),
        catiRecentDuplicates: catiGroups.reduce((sum, g) => sum + g.recentDuplicates.length, 0)
      },
      groups: enrichedGroups
    };
    
    const jsonPath = path.join(REPORT_DIR, `recent_duplicates_against_older_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`   ✅ JSON report saved: ${jsonPath}`);
    
    // Summary Report
    console.log('\n' + '='.repeat(80));
    console.log('📊 RECENT DUPLICATES AGAINST OLDER RESPONSES REPORT');
    console.log('='.repeat(80));
    console.log(`Time Analysis:`);
    console.log(`  Now: ${now.toISOString()}`);
    console.log(`  Recent responses: Created after ${twentyHoursAgo.toISOString()}`);
    console.log(`  Strategy: Find duplicates created BEFORE each recent response's createdAt`);
    console.log('');
    console.log(`Total recent responses processed: ${recentResponses.length}`);
    console.log(`Unique contentHash groups in recent: ${Object.keys(recentGroups).length}`);
    console.log(`Groups with older duplicates: ${enrichedGroups.length}`);
    console.log('');
    console.log('Breakdown:');
    console.log(`  CAPI groups: ${catiGroups.length}`);
    console.log(`  CATI groups: ${catiGroups.length}`);
    console.log(`  Total recent duplicates: ${totalRecentDuplicates}`);
    console.log(`  Total older duplicates: ${totalOlderDuplicates}`);
    console.log(`  Recent Pending_Approval duplicates: ${pendingApprovalRecent}`);
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
  findRecentDuplicatesAgainstOlder();
}

module.exports = { findRecentDuplicatesAgainstOlder };

