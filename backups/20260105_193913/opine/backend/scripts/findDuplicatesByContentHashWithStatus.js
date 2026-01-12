#!/usr/bin/env node

/**
 * Find Duplicate SurveyResponses using ContentHash (NEW LOGIC - Excludes Interviewer)
 * 
 * This script uses the new contentHash field to identify duplicates.
 * The NEW contentHash EXCLUDES interviewer (same interview can be synced by different users).
 * The contentHash includes:
 * - CAPI: survey + startTime + endTime + totalTimeSpent + responses + audio signatures + GPS
 * - CATI: survey + startTime + endTime + totalTimeSpent + responses + call_id
 * 
 * This script includes ALL duplicates regardless of status and separates them by status.
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

// Ensure report directory exists
if (!fs.existsSync(REPORT_DIR)) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
}

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
 * Find duplicates by contentHash (includes ALL statuses)
 */
async function findDuplicatesByContentHash() {
  console.log('\n🔍 Finding duplicates using contentHash (NEW LOGIC - Excludes Interviewer)...\n');
  
  // Find all responses that share the same contentHash (potential duplicates)
  // INCLUDE ALL STATUSES - no filtering
  const duplicateGroups = await SurveyResponse.aggregate([
    {
      $match: {
        contentHash: { $exists: true, $ne: null }
        // NO status filter - include ALL responses
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
    .select('_id responseId sessionId interviewer survey startTime endTime totalTimeSpent responses audioRecording location call_id status createdAt interviewMode contentHash abandonedReason')
    .populate('interviewer', 'firstName lastName email memberId memberID')
    .populate('survey', 'surveyName')
    .lean()
    .sort({ createdAt: 1 }); // Sort by creation time to identify original
  
  // Create a map for quick lookup
  const responseMap = new Map();
  responses.forEach(r => {
    responseMap.set(r._id.toString(), r);
  });
  
  // Group duplicates by contentHash and separate by status
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
    
    // Separate duplicates by status
    const abandonedOrTerminated = duplicates.filter(d => 
      d.status === 'abandoned' || d.status === 'Terminated'
    );
    const otherStatuses = duplicates.filter(d => 
      d.status !== 'abandoned' && d.status !== 'Terminated'
    );
    
    // Further separate other statuses
    const rejected = otherStatuses.filter(d => d.status === 'Rejected');
    const pendingApproval = otherStatuses.filter(d => d.status === 'Pending_Approval');
    const approved = otherStatuses.filter(d => d.status === 'Approved');
    const other = otherStatuses.filter(d => 
      d.status !== 'Rejected' && d.status !== 'Pending_Approval' && d.status !== 'Approved'
    );
    
    duplicateGroupsDetailed.push({
      groupNumber: duplicateGroupsDetailed.length + 1,
      mode: original.interviewMode?.toUpperCase() || 'UNKNOWN',
      contentHash: group._id,
      original: {
        responseId: original.responseId,
        mongoId: original._id.toString(),
        sessionId: original.sessionId,
        interviewer: {
          name: original.interviewer ? `${original.interviewer.firstName || ''} ${original.interviewer.lastName || ''}`.trim() : 'Unknown',
          memberId: original.interviewer?.memberId || original.interviewer?.memberID || 'N/A',
          objectId: original.interviewer?._id?.toString() || 'N/A'
        },
        survey: {
          name: original.survey?.surveyName || 'Unknown',
          id: original.survey?._id?.toString() || original.survey?.toString() || 'N/A'
        },
        startTime: original.startTime,
        endTime: original.endTime,
        totalTimeSpent: original.totalTimeSpent,
        status: original.status,
        createdAt: original.createdAt,
        interviewMode: original.interviewMode
      },
      duplicates: {
        abandonedOrTerminated: abandonedOrTerminated.map(d => ({
          responseId: d.responseId,
          mongoId: d._id.toString(),
          sessionId: d.sessionId,
          interviewer: {
            name: d.interviewer ? `${d.interviewer.firstName || ''} ${d.interviewer.lastName || ''}`.trim() : 'Unknown',
            memberId: d.interviewer?.memberId || d.interviewer?.memberID || 'N/A',
            objectId: d.interviewer?._id?.toString() || 'N/A'
          },
          status: d.status,
          abandonedReason: d.abandonedReason || null,
          createdAt: d.createdAt
        })),
        rejected: rejected.map(d => ({
          responseId: d.responseId,
          mongoId: d._id.toString(),
          sessionId: d.sessionId,
          interviewer: {
            name: d.interviewer ? `${d.interviewer.firstName || ''} ${d.interviewer.lastName || ''}`.trim() : 'Unknown',
            memberId: d.interviewer?.memberId || d.interviewer?.memberID || 'N/A',
            objectId: d.interviewer?._id?.toString() || 'N/A'
          },
          status: d.status,
          createdAt: d.createdAt
        })),
        pendingApproval: pendingApproval.map(d => ({
          responseId: d.responseId,
          mongoId: d._id.toString(),
          sessionId: d.sessionId,
          interviewer: {
            name: d.interviewer ? `${d.interviewer.firstName || ''} ${d.interviewer.lastName || ''}`.trim() : 'Unknown',
            memberId: d.interviewer?.memberId || d.interviewer?.memberID || 'N/A',
            objectId: d.interviewer?._id?.toString() || 'N/A'
          },
          status: d.status,
          createdAt: d.createdAt
        })),
        approved: approved.map(d => ({
          responseId: d.responseId,
          mongoId: d._id.toString(),
          sessionId: d.sessionId,
          interviewer: {
            name: d.interviewer ? `${d.interviewer.firstName || ''} ${d.interviewer.lastName || ''}`.trim() : 'Unknown',
            memberId: d.interviewer?.memberId || d.interviewer?.memberID || 'N/A',
            objectId: d.interviewer?._id?.toString() || 'N/A'
          },
          status: d.status,
          createdAt: d.createdAt
        })),
        other: other.map(d => ({
          responseId: d.responseId,
          mongoId: d._id.toString(),
          sessionId: d.sessionId,
          interviewer: {
            name: d.interviewer ? `${d.interviewer.firstName || ''} ${d.interviewer.lastName || ''}`.trim() : 'Unknown',
            memberId: d.interviewer?.memberId || d.interviewer?.memberID || 'N/A',
            objectId: d.interviewer?._id?.toString() || 'N/A'
          },
          status: d.status,
          createdAt: d.createdAt
        }))
      },
      totalDuplicates: duplicates.length,
      counts: {
        abandonedOrTerminated: abandonedOrTerminated.length,
        rejected: rejected.length,
        pendingApproval: pendingApproval.length,
        approved: approved.length,
        other: other.length
      }
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
 * Generate comprehensive report
 */
function generateReport(duplicateGroups) {
  console.log('\n📊 Generating report...');
  
  // Calculate overall statistics
  const totalAbandonedOrTerminated = duplicateGroups.reduce((sum, g) => sum + g.counts.abandonedOrTerminated, 0);
  const totalRejected = duplicateGroups.reduce((sum, g) => sum + g.counts.rejected, 0);
  const totalPendingApproval = duplicateGroups.reduce((sum, g) => sum + g.counts.pendingApproval, 0);
  const totalApproved = duplicateGroups.reduce((sum, g) => sum + g.counts.approved, 0);
  const totalOther = duplicateGroups.reduce((sum, g) => sum + g.counts.other, 0);
  const totalDuplicates = duplicateGroups.reduce((sum, g) => sum + g.totalDuplicates, 0);
  
  const report = {
    timestamp: new Date().toISOString(),
    method: 'contentHash-based duplicate detection (NEW LOGIC - Excludes Interviewer)',
    summary: {
      totalDuplicateGroups: duplicateGroups.length,
      capiDuplicateGroups: duplicateGroups.filter(g => g.mode === 'CAPI').length,
      catiDuplicateGroups: duplicateGroups.filter(g => g.mode === 'CATI').length,
      totalDuplicates: totalDuplicates,
      totalOriginals: duplicateGroups.length,
      duplicatesByStatus: {
        abandonedOrTerminated: totalAbandonedOrTerminated,
        rejected: totalRejected,
        pendingApproval: totalPendingApproval,
        approved: totalApproved,
        other: totalOther
      }
    },
    statistics: {
      totalProcessed: stats.totalProcessed,
      capiProcessed: stats.capiProcessed,
      catiProcessed: stats.catiProcessed,
      capiDuplicatesFound: stats.capiDuplicatesFound,
      catiDuplicatesFound: stats.catiDuplicatesFound,
      totalDuplicateGroups: stats.totalDuplicateGroups
    },
    groups: duplicateGroups
  };
  
  // Save JSON report
  const jsonPath = path.join(REPORT_DIR, `duplicate_detection_by_hash_with_status_${TIMESTAMP}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`✅ JSON report saved: ${jsonPath}`);
  
  // Generate CSV report
  generateCSVReport(report, TIMESTAMP);
  
  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('  DUPLICATE DETECTION SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total Duplicate Groups: ${report.summary.totalDuplicateGroups}`);
  console.log(`  - CAPI: ${report.summary.capiDuplicateGroups}`);
  console.log(`  - CATI: ${report.summary.catiDuplicateGroups}`);
  console.log(`Total Duplicates: ${totalDuplicates}`);
  console.log(`  - Abandoned/Terminated: ${totalAbandonedOrTerminated}`);
  console.log(`  - Rejected: ${totalRejected}`);
  console.log(`  - Pending Approval: ${totalPendingApproval}`);
  console.log(`  - Approved: ${totalApproved}`);
  console.log(`  - Other: ${totalOther}`);
  console.log(`Total Originals: ${report.summary.totalOriginals}`);
  console.log('='.repeat(70));
  
  return report;
}

/**
 * Generate CSV report
 */
function generateCSVReport(report, timestamp) {
  const csvPath = path.join(REPORT_DIR, `duplicate_detection_by_hash_with_status_${timestamp}.csv`);
  const rows = [];
  
  // Header
  rows.push([
    'Group Number',
    'Mode',
    'Content Hash',
    'Original Response ID',
    'Original Session ID',
    'Original Interviewer',
    'Original Member ID',
    'Original Status',
    'Original Created At',
    'Total Duplicates',
    'Abandoned/Terminated',
    'Rejected',
    'Pending Approval',
    'Approved',
    'Other',
    'Duplicate Response IDs',
    'Duplicate Session IDs',
    'Duplicate Interviewers',
    'Duplicate Member IDs',
    'Duplicate Statuses'
  ]);
  
  // Data rows
  for (const group of report.groups) {
    const allDuplicates = [
      ...group.duplicates.abandonedOrTerminated,
      ...group.duplicates.rejected,
      ...group.duplicates.pendingApproval,
      ...group.duplicates.approved,
      ...group.duplicates.other
    ];
    
    rows.push([
      group.groupNumber,
      group.mode,
      group.contentHash,
      group.original.responseId,
      group.original.sessionId || 'N/A',
      group.original.interviewer.name,
      group.original.interviewer.memberId,
      group.original.status,
      new Date(group.original.createdAt).toISOString(),
      group.totalDuplicates,
      group.counts.abandonedOrTerminated,
      group.counts.rejected,
      group.counts.pendingApproval,
      group.counts.approved,
      group.counts.other,
      allDuplicates.map(d => d.responseId).join('; '),
      allDuplicates.map(d => d.sessionId || 'N/A').join('; '),
      allDuplicates.map(d => d.interviewer.name).join('; '),
      allDuplicates.map(d => d.interviewer.memberId).join('; '),
      allDuplicates.map(d => d.status).join('; ')
    ]);
  }
  
  // Convert to CSV
  const csv = rows.map(row => 
    row.map(cell => {
      const str = String(cell || '');
      return str.includes(',') || str.includes('"') || str.includes('\n') 
        ? `"${str.replace(/"/g, '""')}"` 
        : str;
    }).join(',')
  ).join('\n');
  
  fs.writeFileSync(csvPath, csv);
  console.log(`✅ CSV report saved: ${csvPath}`);
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('  DUPLICATE DETECTION BY CONTENT HASH (NEW LOGIC)');
    console.log('='.repeat(70));
    console.log('Method: ContentHash-based (Excludes Interviewer)');
    console.log('Includes: ALL statuses (abandoned, terminated, rejected, pending, approved, etc.)');
    console.log('='.repeat(70));
    
    // Connect to MongoDB
    console.log('\n📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Find duplicates
    const duplicateGroups = await findDuplicatesByContentHash();
    
    if (duplicateGroups.length === 0) {
      console.log('\n✅ No duplicates found!');
      await mongoose.disconnect();
      return;
    }
    
    // Generate report
    const report = generateReport(duplicateGroups);
    
    console.log('\n✅ Duplicate detection complete!');
    console.log(`📄 Reports saved in: ${REPORT_DIR}`);
    
    await mongoose.disconnect();
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    stats.errors.push(error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run
main();







