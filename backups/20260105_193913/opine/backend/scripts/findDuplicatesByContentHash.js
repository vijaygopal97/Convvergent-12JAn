#!/usr/bin/env node

/**
 * Find Duplicate SurveyResponses using ContentHash
 * 
 * This script uses the new contentHash field to quickly identify duplicates.
 * The contentHash includes:
 * - CAPI: interviewer + survey + startTime + responses + audio + GPS
 * - CATI: interviewer + survey + startTime + responses + call_id
 * 
 * This is much faster than the previous method as it uses indexed MongoDB queries.
 * 
 * Output format matches findAndMarkDuplicates.js for consistency.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const Survey = require('../models/Survey');

const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ImprovedDuplicateRemove');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

// Statistics
const stats = {
  totalProcessed: 0,
  capiProcessed: 0,
  catiProcessed: 0,
  capiDuplicatesFound: 0,
  catiDuplicatesFound: 0,
  totalDuplicateGroups: 0,
  errors: []
};

/**
 * Find duplicates by contentHash
 */
async function findDuplicatesByContentHash() {
  console.log('\n🔍 Finding duplicates using contentHash...\n');
  
  // Find all responses that share the same contentHash (potential duplicates)
  const duplicateGroups = await SurveyResponse.aggregate([
    {
      $match: {
        contentHash: { $exists: true, $ne: null },
        status: { $ne: 'abandoned' } // Exclude already abandoned
      }
    },
    {
      $group: {
        _id: '$contentHash',
        count: { $sum: 1 },
        responseIds: { $push: '$_id' }
      }
    },
    {
      $match: { count: { $gt: 1 } } // Only groups with duplicates
    },
    {
      $sort: { count: -1 }
    }
  ]);
  
  console.log(`   Found ${duplicateGroups.length} duplicate groups (same contentHash)`);
  
  if (duplicateGroups.length === 0) {
    console.log('   ✅ No duplicates found!');
    return [];
  }
  
  // Fetch full response details for all duplicates
  const allResponseIds = duplicateGroups.flatMap(g => g.responseIds);
  const responses = await SurveyResponse.find({ _id: { $in: allResponseIds } })
    .select('_id responseId sessionId interviewer survey startTime endTime totalTimeSpent responses audioRecording location call_id status createdAt interviewMode contentHash')
    .populate('interviewer', 'firstName lastName email memberId memberID')
    .populate('survey', 'surveyName')
    .lean()
    .sort({ createdAt: 1 }); // Sort by creation time to identify original
  
  // Create a map for quick lookup
  const responseMap = new Map();
  responses.forEach(r => {
    responseMap.set(r._id.toString(), r);
  });
  
  // Group duplicates by contentHash
  const duplicateGroupsDetailed = [];
  
  for (const group of duplicateGroups) {
    const groupResponses = group.responseIds
      .map(id => responseMap.get(id.toString()))
      .filter(r => r !== undefined)
      .sort((a, b) => {
        // Sort by createdAt to identify original (first created)
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return timeA - timeB;
      });
    
    if (groupResponses.length < 2) continue; // Need at least 2 for duplicates
    
    const original = groupResponses[0];
    const duplicates = groupResponses.slice(1);
    
    duplicateGroupsDetailed.push({
      mode: original.interviewMode?.toUpperCase() || 'UNKNOWN',
      contentHash: group._id,
      original: original,
      duplicates: duplicates
    });
    
    // Update stats
    if (original.interviewMode === 'capi') {
      stats.capiProcessed += groupResponses.length;
      stats.capiDuplicatesFound += duplicates.length;
    } else if (original.interviewMode === 'cati') {
      stats.catiProcessed += groupResponses.length;
      stats.catiDuplicatesFound += duplicates.length;
    }
    stats.totalDuplicateGroups++;
  }
  
  stats.totalProcessed = stats.capiProcessed + stats.catiProcessed;
  
  return duplicateGroupsDetailed;
}

/**
 * Generate comprehensive report (same format as findAndMarkDuplicates.js)
 */
function generateReport(duplicateGroups) {
  console.log('\n📊 Generating report...');
  
  const report = {
    timestamp: new Date().toISOString(),
    method: 'contentHash-based duplicate detection',
    summary: {
      totalDuplicateGroups: duplicateGroups.length,
      capiDuplicateGroups: duplicateGroups.filter(g => g.mode === 'CAPI').length,
      catiDuplicateGroups: duplicateGroups.filter(g => g.mode === 'CATI').length,
      totalDuplicatesToMark: duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
      totalOriginals: duplicateGroups.length
    },
    statistics: {
      totalProcessed: stats.totalProcessed,
      capiProcessed: stats.capiProcessed,
      catiProcessed: stats.catiProcessed,
      capiDuplicatesFound: stats.capiDuplicatesFound,
      catiDuplicatesFound: stats.catiDuplicatesFound
    },
    groups: duplicateGroups.map((group, index) => {
      const original = group.original;
      return {
        groupNumber: index + 1,
        mode: group.mode,
        contentHash: group.contentHash,
        original: {
          responseId: original.responseId || original._id.toString(),
          mongoId: original._id.toString(),
          sessionId: original.sessionId,
          interviewer: {
            id: original.interviewer?._id?.toString() || original.interviewer?.toString() || 'Unknown',
            name: original.interviewer ? `${original.interviewer.firstName || ''} ${original.interviewer.lastName || ''}`.trim() || 'N/A' : 'N/A',
            email: original.interviewer?.email || 'N/A',
            phone: 'N/A',
            memberId: original.interviewer?.memberId || original.interviewer?.memberID || 'N/A'
          },
          survey: {
            id: original.survey?._id?.toString() || original.survey?.toString() || 'Unknown',
            name: original.survey?.surveyName || 'N/A'
          },
          startTime: original.startTime,
          endTime: original.endTime,
          duration: original.totalTimeSpent,
          status: original.status,
          call_id: original.call_id || null,
          audioUrl: original.audioRecording?.audioUrl || original.audioRecording?.url || 'No audio',
          audioDuration: original.audioRecording?.recordingDuration || 0,
          audioFileSize: original.audioRecording?.fileSize || 0,
          location: original.location ? {
            latitude: original.location.latitude,
            longitude: original.location.longitude
          } : null,
          responseCount: original.responses?.length || 0,
          createdAt: original.createdAt || (original._id.getTimestamp ? original._id.getTimestamp() : new Date(original._id)),
          contentHash: original.contentHash
        },
        duplicates: group.duplicates.map(dup => ({
          responseId: dup.responseId || dup._id.toString(),
          mongoId: dup._id.toString(),
          sessionId: dup.sessionId,
          startTime: dup.startTime,
          endTime: dup.endTime,
          duration: dup.totalTimeSpent,
          status: dup.status,
          call_id: dup.call_id || null,
          audioUrl: dup.audioRecording?.audioUrl || dup.audioRecording?.url || 'No audio',
          audioDuration: dup.audioRecording?.recordingDuration || 0,
          audioFileSize: dup.audioRecording?.fileSize || 0,
          location: dup.location ? {
            latitude: dup.location.latitude,
            longitude: dup.location.longitude
          } : null,
          responseCount: dup.responses?.length || 0,
          createdAt: dup.createdAt || (dup._id.getTimestamp ? dup._id.getTimestamp() : new Date(dup._id)),
          timeDifference: Math.abs(new Date(original.startTime) - new Date(dup.startTime)),
          contentHash: dup.contentHash
        }))
      };
    })
  };
  
  // Save JSON report
  const jsonPath = path.join(REPORT_DIR, `duplicate_detection_by_hash_${TIMESTAMP}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`   ✅ JSON report saved: ${jsonPath}`);
  
  // Save CSV report
  const csvRows = [
    'Group Number,Mode,Type,Response ID,Mongo ID,Session ID,Interviewer Name,Interviewer Member ID,Survey Name,Start Time,End Time,Duration (seconds),Status,Call ID,Audio URL,Audio Duration,Audio File Size,Latitude,Longitude,Response Count,Created At,Time Difference (ms),Content Hash'
  ];
  
  report.groups.forEach(group => {
    // Original row
    const orig = group.original;
    csvRows.push([
      group.groupNumber,
      group.mode,
      'ORIGINAL',
      orig.responseId,
      orig.mongoId,
      orig.sessionId,
      `"${orig.interviewer.name}"`,
      orig.interviewer.memberId || 'N/A',
      `"${orig.survey.name}"`,
      new Date(orig.startTime).toISOString(),
      orig.endTime ? new Date(orig.endTime).toISOString() : '',
      orig.duration,
      orig.status,
      orig.call_id || '',
      orig.audioUrl,
      orig.audioDuration,
      orig.audioFileSize,
      orig.location?.latitude || '',
      orig.location?.longitude || '',
      orig.responseCount,
      new Date(orig.createdAt).toISOString(),
      '',
      orig.contentHash
    ].join(','));
    
    // Duplicate rows
    group.duplicates.forEach(dup => {
      csvRows.push([
        group.groupNumber,
        group.mode,
        'DUPLICATE',
        dup.responseId,
        dup.mongoId,
        dup.sessionId,
        `"${group.original.interviewer.name}"`,
        group.original.interviewer.memberId || 'N/A',
        `"${group.original.survey.name}"`,
        new Date(dup.startTime).toISOString(),
        dup.endTime ? new Date(dup.endTime).toISOString() : '',
        dup.duration,
        dup.status,
        dup.call_id || '',
        dup.audioUrl,
        dup.audioDuration,
        dup.audioFileSize,
        dup.location?.latitude || '',
        dup.location?.longitude || '',
        dup.responseCount,
        new Date(dup.createdAt).toISOString(),
        dup.timeDifference,
        dup.contentHash
      ].join(','));
    });
  });
  
  const csvPath = path.join(REPORT_DIR, `duplicate_detection_by_hash_${TIMESTAMP}.csv`);
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`   ✅ CSV report saved: ${csvPath}`);
  
  return report;
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('='.repeat(80));
    console.log('DUPLICATE DETECTION BY CONTENT HASH');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Report Directory: ${REPORT_DIR}`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Get total counts
    const totalResponses = await SurveyResponse.countDocuments({});
    const capiTotal = await SurveyResponse.countDocuments({ interviewMode: 'capi' });
    const catiTotal = await SurveyResponse.countDocuments({ interviewMode: 'cati' });
    const withHash = await SurveyResponse.countDocuments({ contentHash: { $exists: true, $ne: null } });
    
    console.log('📊 Database Statistics:');
    console.log(`   Total Responses: ${totalResponses}`);
    console.log(`   CAPI Responses: ${capiTotal}`);
    console.log(`   CATI Responses: ${catiTotal}`);
    console.log(`   Responses with contentHash: ${withHash} (${((withHash/totalResponses)*100).toFixed(2)}%)`);
    console.log('');
    
    // Find duplicates
    const duplicateGroups = await findDuplicatesByContentHash();
    
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Duplicate Groups Found: ${duplicateGroups.length}`);
    console.log(`  - CAPI Groups: ${duplicateGroups.filter(g => g.mode === 'CAPI').length}`);
    console.log(`  - CATI Groups: ${duplicateGroups.filter(g => g.mode === 'CATI').length}`);
    console.log(`Total Duplicates Found: ${duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0)}`);
    console.log(`  - CAPI Duplicates: ${stats.capiDuplicatesFound}`);
    console.log(`  - CATI Duplicates: ${stats.catiDuplicatesFound}`);
    console.log('='.repeat(80));
    
    if (duplicateGroups.length === 0) {
      console.log('\n✅ No duplicates found! Database is clean.');
      await mongoose.disconnect();
      return;
    }
    
    // Generate report
    const report = generateReport(duplicateGroups);
    
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Duplicate Groups: ${duplicateGroups.length}`);
    console.log(`Total Duplicates: ${duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0)}`);
    console.log(`Reports Generated:`);
    console.log(`  - JSON: duplicate_detection_by_hash_${TIMESTAMP}.json`);
    console.log(`  - CSV: duplicate_detection_by_hash_${TIMESTAMP}.csv`);
    console.log('='.repeat(80));
    console.log('\n⚠️  NOTE: No duplicates were marked as abandoned.');
    console.log('   Review the reports and manually decide on duplicates.');
    console.log('');
    
    await mongoose.disconnect();
    console.log('✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };

