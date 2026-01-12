const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Database connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/Opine';

// Load models
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const Survey = require('../models/Survey');

/**
 * Normalize responses for comparison
 */
function normalizeResponses(responses) {
  if (!Array.isArray(responses)) return [];
  return responses
    .map(r => ({
      questionId: r.questionId,
      response: normalizeResponseValue(r.response),
      questionType: r.questionType
    }))
    .sort((a, b) => a.questionId.localeCompare(b.questionId));
}

function normalizeResponseValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(v => normalizeResponseValue(v)).sort();
  if (typeof value === 'object') {
    const sorted = {};
    Object.keys(value).sort().forEach(key => {
      sorted[key] = normalizeResponseValue(value[key]);
    });
    return sorted;
  }
  return value;
}

function compareResponses(responses1, responses2) {
  const normalized1 = normalizeResponses(responses1);
  const normalized2 = normalizeResponses(responses2);
  if (normalized1.length !== normalized2.length) return false;
  for (let i = 0; i < normalized1.length; i++) {
    const r1 = normalized1[i];
    const r2 = normalized2[i];
    if (r1.questionId !== r2.questionId) return false;
    if (JSON.stringify(r1.response) !== JSON.stringify(r2.response)) return false;
  }
  return true;
}

function compareAudio(audio1, audio2) {
  if (!audio1 && !audio2) return true;
  if (!audio1 || !audio2) return false;
  const url1 = audio1.audioUrl || audio1.url || '';
  const url2 = audio2.audioUrl || audio2.url || '';
  if (url1 && url2) {
    const filename1 = url1.split('/').pop().split('?')[0];
    const filename2 = url2.split('/').pop().split('?')[0];
    return filename1 === filename2;
  }
  return !url1 && !url2;
}

/**
 * Get memberId from interviewer (handles both populated and unpopulated)
 */
function getInterviewerMemberId(response) {
  if (!response.interviewer) return null;
  
  // If interviewer is populated (object with memberId)
  if (typeof response.interviewer === 'object' && response.interviewer !== null) {
    return response.interviewer.memberId || response.interviewer.memberID || null;
  }
  
  // If interviewer is just an ObjectId string, we need to fetch it
  // This should be handled by population, but just in case
  return null;
}

function areDuplicates(response1, response2) {
  // Compare by memberId instead of ObjectId
  const memberId1 = getInterviewerMemberId(response1);
  const memberId2 = getInterviewerMemberId(response2);
  
  // If both have memberIds, compare by memberId
  if (memberId1 && memberId2) {
    if (memberId1 !== memberId2) return false;
  } else {
    // Fallback to ObjectId if memberId is missing
    const interviewer1 = response1.interviewer?._id?.toString() || response1.interviewer?.toString() || response1.interviewer;
    const interviewer2 = response2.interviewer?._id?.toString() || response2.interviewer?.toString() || response2.interviewer;
    if (interviewer1 !== interviewer2) return false;
  }
  
  const survey1 = response1.survey?._id?.toString() || response1.survey?.toString() || response1.survey;
  const survey2 = response2.survey?._id?.toString() || response2.survey?.toString() || response2.survey;
  if (survey1 !== survey2) return false;
  
  // Use startTime (interview date) instead of createdAt (sync date) for comparison
  const timeDiff = Math.abs(new Date(response1.startTime) - new Date(response2.startTime));
  if (timeDiff > 5000) return false; // 5 seconds tolerance
  
  const durationDiff = Math.abs((response1.totalTimeSpent || 0) - (response2.totalTimeSpent || 0));
  if (durationDiff > 5) return false; // 5 seconds tolerance
  
  if (!compareResponses(response1.responses, response2.responses)) return false;
  if (!compareAudio(response1.audioRecording, response2.audioRecording)) return false;
  
  return true;
}

async function findDuplicates() {
  try {
    console.log('🔌 Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database\n');
    
    // Filter: Only analyze responses with status: Approved, Pending_Approval, or Rejected
    // Exclude: abandoned, Terminated, completed
    const validStatuses = ['Approved', 'Pending_Approval', 'Rejected'];
    const excludedStatuses = ['abandoned', 'Terminated', 'completed'];
    
    const totalCount = await SurveyResponse.countDocuments({});
    const validCount = await SurveyResponse.countDocuments({ status: { $in: validStatuses } });
    const excludedCount = await SurveyResponse.countDocuments({ status: { $in: excludedStatuses } });
    
    console.log(`📊 Total responses in database: ${totalCount}`);
    console.log(`   ✅ Valid statuses (${validStatuses.join(', ')}): ${validCount}`);
    console.log(`   ❌ Excluded statuses (${excludedStatuses.join(', ')}): ${excludedCount}\n`);
    
    // Step 1: Find duplicate sessionIds (only for valid statuses)
    console.log('🔍 Step 1: Finding duplicate sessionIds (valid statuses only)...');
    const duplicateSessionIds = await SurveyResponse.aggregate([
      { $match: { status: { $in: validStatuses } } },
      { $group: { _id: '$sessionId', count: { $sum: 1 }, responseIds: { $push: '$_id' } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]);
    console.log(`   Found ${duplicateSessionIds.length} sessionIds with multiple responses\n`);
    
    // Step 2: Group by interviewer memberId-survey (using $lookup to get memberId)
    console.log('🔍 Step 2: Grouping by interviewer memberId and survey (valid statuses only)...');
    console.log('   Using memberId instead of ObjectId for grouping...\n');
    
    const potentialGroups = await SurveyResponse.aggregate([
      { $match: { status: { $in: validStatuses } } },
      {
        $lookup: {
          from: 'users',
          localField: 'interviewer',
          foreignField: '_id',
          as: 'interviewerDetails'
        }
      },
      {
        $unwind: {
          path: '$interviewerDetails',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          responseId: 1,
          sessionId: 1,
          interviewer: 1,
          interviewerMemberId: {
            $ifNull: [
              '$interviewerDetails.memberId',
              '$interviewerDetails.memberID'
            ]
          },
          survey: 1,
          startTime: 1,
          endTime: 1,
          totalTimeSpent: 1,
          responses: 1,
          audioRecording: 1,
          status: 1,
          createdAt: 1
        }
      },
      {
        $group: {
          _id: {
            interviewerMemberId: {
              $ifNull: ['$interviewerMemberId', '$interviewer'] // Fallback to ObjectId if no memberId
            },
            survey: '$survey'
          },
          count: { $sum: 1 },
          responseIds: { $push: '$_id' }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    console.log(`   Found ${potentialGroups.length} interviewer memberId-survey combinations with multiple responses\n`);
    
    // Step 3: Detailed comparison
    console.log('🔍 Step 3: Detailed comparison...');
    const duplicateGroups = [];
    const BATCH_SIZE = 10;
    
    for (let i = 0; i < potentialGroups.length; i += BATCH_SIZE) {
      const batch = potentialGroups.slice(i, i + BATCH_SIZE);
      if ((i / BATCH_SIZE + 1) % 10 === 0) {
        console.log(`   Processing ${Math.min(i + BATCH_SIZE, potentialGroups.length)}/${potentialGroups.length} groups...`);
      }
      
      for (const group of batch) {
        const fullResponses = await SurveyResponse.find({ 
          _id: { $in: group.responseIds },
          status: { $in: validStatuses }
        })
          .populate('interviewer', 'firstName lastName email phone memberId memberID')
          .populate('survey', 'surveyName')
          .select('_id responseId sessionId interviewer survey startTime endTime totalTimeSpent responses audioRecording status createdAt')
          .lean();
        
        const processed = new Set();
        for (let j = 0; j < fullResponses.length; j++) {
          if (processed.has(j)) continue;
          const response1 = fullResponses[j];
          const duplicates = [response1];
          
          for (let k = j + 1; k < fullResponses.length; k++) {
            if (processed.has(k)) continue;
            if (areDuplicates(response1, fullResponses[k])) {
              duplicates.push(fullResponses[k]);
              processed.add(k);
            }
          }
          
          if (duplicates.length > 1) {
            // Sort by startTime (interview date) instead of createdAt (sync date)
            duplicates.sort((a, b) => {
              const timeA = a.startTime ? new Date(a.startTime).getTime() : (a.createdAt ? new Date(a.createdAt).getTime() : a._id.getTimestamp().getTime());
              const timeB = b.startTime ? new Date(b.startTime).getTime() : (b.createdAt ? new Date(b.createdAt).getTime() : b._id.getTimestamp().getTime());
              return timeA - timeB;
            });
            duplicateGroups.push(duplicates);
            processed.add(j);
          }
        }
      }
    }
    
    console.log(`✅ Found ${duplicateGroups.length} confirmed duplicate groups\n`);
    
    // Generate report
    const report = {
      totalResponses: totalCount,
      validStatusResponses: validCount,
      excludedStatusResponses: excludedCount,
      validStatuses: validStatuses,
      excludedStatuses: excludedStatuses,
      duplicateSessionIds: duplicateSessionIds.length,
      duplicateGroups: duplicateGroups.length,
      totalDuplicates: duplicateGroups.reduce((sum, group) => sum + group.length, 0),
      detectionMethod: 'memberId-based (with ObjectId fallback)',
      dateComparisonField: 'startTime (interview date)',
      duplicateSessionIdDetails: duplicateSessionIds.map(g => ({
        sessionId: g._id,
        count: g.count,
        responseIds: g.responseIds.map(id => id.toString())
      })),
      groups: duplicateGroups.map((group, index) => {
        const original = group[0];
        const duplicates = group.slice(1);
        const memberId = getInterviewerMemberId(original) || original.interviewer?._id?.toString() || original.interviewer?.toString() || 'Unknown';
        
        return {
          groupNumber: index + 1,
          interviewerMemberId: memberId,
          original: {
            responseId: original.responseId || original._id.toString(),
            mongoId: original._id.toString(),
            sessionId: original.sessionId,
            interviewer: {
              id: original.interviewer?._id?.toString() || original.interviewer?.toString() || 'Unknown',
              memberId: memberId,
              name: original.interviewer?.firstName && original.interviewer?.lastName
                ? `${original.interviewer.firstName} ${original.interviewer.lastName}`
                : original.interviewer?.name || 'Unknown',
              email: original.interviewer?.email || 'N/A',
              phone: original.interviewer?.phone || 'N/A'
            },
            survey: {
              id: original.survey?._id?.toString() || original.survey?.toString() || 'Unknown',
              name: original.survey?.surveyName || 'Unknown'
            },
            startTime: original.startTime,
            endTime: original.endTime,
            duration: original.totalTimeSpent,
            status: original.status,
            audioUrl: original.audioRecording?.audioUrl || original.audioRecording?.url || 'No audio',
            createdAt: original.createdAt || original._id.getTimestamp(),
            responseCount: original.responses?.length || 0
          },
          duplicates: duplicates.map(dup => {
            const dupMemberId = getInterviewerMemberId(dup) || dup.interviewer?._id?.toString() || dup.interviewer?.toString() || 'Unknown';
            return {
              responseId: dup.responseId || dup._id.toString(),
              mongoId: dup._id.toString(),
              sessionId: dup.sessionId,
              interviewer: {
                id: dup.interviewer?._id?.toString() || dup.interviewer?.toString() || 'Unknown',
                memberId: dupMemberId,
                name: dup.interviewer?.firstName && dup.interviewer?.lastName
                  ? `${dup.interviewer.firstName} ${dup.interviewer.lastName}`
                  : dup.interviewer?.name || 'Unknown',
                email: dup.interviewer?.email || 'N/A',
                phone: dup.interviewer?.phone || 'N/A'
              },
              startTime: dup.startTime,
              endTime: dup.endTime,
              duration: dup.totalTimeSpent,
              status: dup.status,
              audioUrl: dup.audioRecording?.audioUrl || dup.audioRecording?.url || 'No audio',
              createdAt: dup.createdAt || dup._id.getTimestamp(),
              responseCount: dup.responses?.length || 0,
              timeDifference: Math.abs(new Date(original.startTime) - new Date(dup.startTime))
            };
          })
        };
      })
    };
    
    // Print summary
    console.log('='.repeat(80));
    console.log('DUPLICATE RESPONSES REPORT (MEMBERID-BASED DETECTION)');
    console.log('='.repeat(80));
    console.log(`Total Responses: ${report.totalResponses}`);
    console.log(`Valid Status Responses (${validStatuses.join(', ')}): ${report.validStatusResponses}`);
    console.log(`Excluded Status Responses (${excludedStatuses.join(', ')}): ${report.excludedStatusResponses}`);
    console.log(`Duplicate SessionIds: ${report.duplicateSessionIds} (CRITICAL)`);
    console.log(`Duplicate Groups: ${report.duplicateGroups}`);
    console.log(`Total Duplicate Entries: ${report.totalDuplicates - report.duplicateGroups}`);
    console.log(`Detection Method: ${report.detectionMethod}`);
    console.log(`Date Comparison Field: ${report.dateComparisonField}`);
    console.log('='.repeat(80));
    
    if (duplicateSessionIds.length > 0) {
      console.log('\n🔴 CRITICAL: Duplicate SessionIds:');
      duplicateSessionIds.slice(0, 10).forEach((g, idx) => {
        console.log(`   ${idx + 1}. SessionId: ${g._id} - ${g.count} responses`);
      });
      if (duplicateSessionIds.length > 10) {
        console.log(`   ... and ${duplicateSessionIds.length - 10} more`);
      }
    }
    
    // Save reports
    const fs = require('fs');
    const reportPath = path.join(__dirname, `../duplicate_responses_report_memberid_${new Date().toISOString().split('T')[0]}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n✅ JSON report saved to: ${reportPath}`);
    
    // CSV
    const csvRows = ['Group Number,Type,Response ID,Mongo ID,Session ID,Interviewer Member ID,Interviewer Name,Interviewer Email,Survey Name,Start Time,Duration (seconds),Status,Audio URL,Created At,Time Difference (ms)'];
    report.groups.forEach(group => {
      csvRows.push([
        group.groupNumber, 'ORIGINAL', group.original.responseId, group.original.mongoId, group.original.sessionId,
        group.original.interviewer.memberId, `"${group.original.interviewer.name}"`, group.original.interviewer.email, `"${group.original.survey.name}"`,
        new Date(group.original.startTime).toISOString(), group.original.duration, group.original.status,
        group.original.audioUrl, new Date(group.original.createdAt).toISOString(), '0'
      ].join(','));
      group.duplicates.forEach(dup => {
        csvRows.push([
          group.groupNumber, 'DUPLICATE', dup.responseId, dup.mongoId, dup.sessionId,
          dup.interviewer.memberId, `"${dup.interviewer.name}"`, dup.interviewer.email, `"${group.original.survey.name}"`,
          new Date(dup.startTime).toISOString(), dup.duration, dup.status,
          dup.audioUrl, new Date(dup.createdAt).toISOString(), dup.timeDifference
        ].join(','));
      });
    });
    
    const csvPath = path.join(__dirname, `../duplicate_responses_report_memberid_${new Date().toISOString().split('T')[0]}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`✅ CSV report saved to: ${csvPath}`);
    
    await mongoose.disconnect();
    console.log('\n✅ Analysis complete!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

findDuplicates();







