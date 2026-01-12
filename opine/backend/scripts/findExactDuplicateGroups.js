const mongoose = require('mongoose');
require('dotenv').config();
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('='.repeat(80));
    console.log('FINDING EXACT DUPLICATE GROUPS');
    console.log('='.repeat(80));
    console.log('');
    console.log('Comparison Criteria:');
    console.log('  - Same startTime (exact)');
    console.log('  - Same endTime (exact)');
    console.log('  - Same totalTimeSpent (exact)');
    console.log('  - Same responses content (exact)');
    console.log('  - Same audioRecording (exact)');
    console.log('');
    
    // Get all CAPI responses
    const allResponses = await SurveyResponse.find({
      interviewMode: { $in: ['capi', 'CAPI'] }
    })
      .select('responseId sessionId interviewer survey startTime endTime totalTimeSpent responses audioRecording createdAt')
      .lean()
      .sort({ createdAt: 1 });
    
    console.log(`Total CAPI responses: ${allResponses.length}`);
    console.log('Grouping by exact matches...');
    console.log('');
    
    // Normalize responses by sorting by questionId (order shouldn't matter)
    function normalizeResponses(responses) {
      if (!Array.isArray(responses)) return [];
      return responses
        .map(r => ({
          questionId: r.questionId || '',
          response: r.response,
          questionType: r.questionType || ''
        }))
        .sort((a, b) => a.questionId.localeCompare(b.questionId));
    }
    
    // Create a signature for each response
    function createSignature(response) {
      const startTime = response.startTime ? new Date(response.startTime).getTime() : 0;
      const endTime = response.endTime ? new Date(response.endTime).getTime() : 0;
      const totalTimeSpent = response.totalTimeSpent || 0;
      
      // Normalize responses first (sort by questionId), then create hash
      const normalizedResponses = normalizeResponses(response.responses || []);
      const responsesHash = crypto.createHash('md5')
        .update(JSON.stringify(normalizedResponses))
        .digest('hex');
      
      // Audio signature
      let audioSig = '';
      if (response.audioRecording) {
        const duration = Math.floor(response.audioRecording.recordingDuration || 0);
        const fileSize = Math.floor((response.audioRecording.fileSize || 0) / 1024);
        const format = (response.audioRecording.format || '').toLowerCase().trim();
        const codec = (response.audioRecording.codec || '').toLowerCase().trim();
        const bitrate = Math.floor((response.audioRecording.bitrate || 0) / 1000);
        audioSig = `${duration}|${fileSize}|${format}|${codec}|${bitrate}`;
      }
      
      return `${startTime}|${endTime}|${totalTimeSpent}|${responsesHash}|${audioSig}`;
    }
    
    // Group by signature (store only IDs to save memory)
    const groups = {};
    const responseMap = {}; // Store full response data separately
    
    allResponses.forEach(response => {
      const sig = createSignature(response);
      if (!groups[sig]) {
        groups[sig] = [];
      }
      // Store only ID and minimal data
      const responseId = response._id.toString();
      groups[sig].push(responseId);
      responseMap[responseId] = {
        _id: response._id,
        responseId: response.responseId,
        sessionId: response.sessionId,
        interviewer: response.interviewer,
        survey: response.survey,
        startTime: response.startTime,
        endTime: response.endTime,
        totalTimeSpent: response.totalTimeSpent,
        responses: response.responses,
        audioRecording: response.audioRecording,
        createdAt: response.createdAt
      };
    });
    
    // Filter groups with duplicates (more than 1)
    const duplicateGroups = Object.values(groups).filter(group => group.length > 1);
    
    console.log(`Found ${duplicateGroups.length} duplicate groups`);
    console.log('');
    
    // Get all unique interviewer IDs
    const allInterviewerIds = [...new Set(
      duplicateGroups.flatMap(group => group.map(responseId => responseMap[responseId].interviewer.toString()))
    )];
    
    // Fetch interviewer details
    const interviewers = await User.find({
      _id: { $in: allInterviewerIds.map(id => new mongoose.Types.ObjectId(id)) }
    })
      .select('_id memberId memberID firstName lastName email')
      .lean();
    
    const interviewerMap = {};
    interviewers.forEach(inv => {
      interviewerMap[inv._id.toString()] = inv;
    });
    
    // Find project managers for each interviewer
    // Project managers have assignedTeamMembers array containing interviewer ObjectIds
    const projectManagers = await User.find({
      userType: 'project_manager',
      'assignedTeamMembers.user': { $in: allInterviewerIds.map(id => new mongoose.Types.ObjectId(id)) }
    })
      .select('_id firstName lastName email assignedTeamMembers')
      .lean();
    
    // Create a map: interviewerId -> projectManager
    const interviewerToPM = {};
    projectManagers.forEach(pm => {
      if (pm.assignedTeamMembers && Array.isArray(pm.assignedTeamMembers)) {
        pm.assignedTeamMembers.forEach(assignment => {
          if (assignment.user) {
            const interviewerId = assignment.user.toString();
            if (!interviewerToPM[interviewerId]) {
              interviewerToPM[interviewerId] = pm;
            }
          }
        });
      }
    });
    
    // Build report
    const report = {
      generatedAt: new Date().toISOString(),
      statistics: {
        totalResponsesProcessed: allResponses.length,
        totalDuplicateGroups: duplicateGroups.length,
        totalDuplicateResponses: duplicateGroups.reduce((sum, group) => sum + group.length - 1, 0),
        totalOriginalResponses: duplicateGroups.length,
        groupsBySize: {}
      },
      groups: []
    };
    
    // Calculate statistics
    duplicateGroups.forEach(group => {
      const size = group.length;
      if (!report.statistics.groupsBySize[size]) {
        report.statistics.groupsBySize[size] = 0;
      }
      report.statistics.groupsBySize[size]++;
    });
    
    duplicateGroups.forEach((group, groupIdx) => {
      // Convert response IDs back to full response objects
      const groupResponses = group.map(responseId => responseMap[responseId]);
      
      // Sort by createdAt to identify original
      groupResponses.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      
      const original = groupResponses[0];
      const duplicates = groupResponses.slice(1);
      
      const originalInv = interviewerMap[original.interviewer.toString()];
      const originalPM = interviewerToPM[original.interviewer.toString()] || null;
      
      const groupData = {
        groupNumber: groupIdx + 1,
        original: {
          responseId: original.responseId,
          mongoId: original._id.toString(),
          sessionId: original.sessionId,
          createdAt: new Date(original.createdAt).toISOString(),
          interviewer: {
            objectId: original.interviewer.toString(),
            memberId: originalInv?.memberId || originalInv?.memberID || 'N/A',
            name: `${originalInv?.firstName || ''} ${originalInv?.lastName || ''}`.trim() || 'N/A',
            email: originalInv?.email || 'N/A'
          },
          projectManager: originalPM ? {
            name: `${originalPM.firstName || ''} ${originalPM.lastName || ''}`.trim() || 'N/A',
            email: originalPM.email || 'N/A'
          } : null,
          matchFields: {
            startTime: new Date(original.startTime).toISOString(),
            endTime: original.endTime ? new Date(original.endTime).toISOString() : null,
            totalTimeSpent: original.totalTimeSpent || 0,
            responsesMatched: true, // All responses match exactly
            responsesCount: original.responses?.length || 0,
            audioRecording: original.audioRecording ? {
              duration: original.audioRecording.recordingDuration || null,
              fileSize: original.audioRecording.fileSize || null,
              format: original.audioRecording.format || null,
              codec: original.audioRecording.codec || null,
              bitrate: original.audioRecording.bitrate || null
            } : null
          }
        },
        duplicates: duplicates.map(dup => {
          const dupInv = interviewerMap[dup.interviewer.toString()];
          const dupPM = interviewerToPM[dup.interviewer.toString()] || null;
          return {
            responseId: dup.responseId,
            mongoId: dup._id.toString(),
            sessionId: dup.sessionId,
            createdAt: new Date(dup.createdAt).toISOString(),
            interviewer: {
              objectId: dup.interviewer.toString(),
              memberId: dupInv?.memberId || dupInv?.memberID || 'N/A',
              name: `${dupInv?.firstName || ''} ${dupInv?.lastName || ''}`.trim() || 'N/A',
              email: dupInv?.email || 'N/A'
            },
            projectManager: dupPM ? {
              name: `${dupPM.firstName || ''} ${dupPM.lastName || ''}`.trim() || 'N/A',
              email: dupPM.email || 'N/A'
            } : null,
            matchFields: {
              startTime: new Date(dup.startTime).toISOString(),
              endTime: dup.endTime ? new Date(dup.endTime).toISOString() : null,
              totalTimeSpent: dup.totalTimeSpent || 0,
              responsesMatched: true, // All responses match exactly
              responsesCount: dup.responses?.length || 0,
              audioRecording: dup.audioRecording ? {
                duration: dup.audioRecording.recordingDuration || null,
                fileSize: dup.audioRecording.fileSize || null,
                format: dup.audioRecording.format || null,
                codec: dup.audioRecording.codec || null,
                bitrate: dup.audioRecording.bitrate || null
              } : null
            }
          };
        })
      };
      
      report.groups.push(groupData);
    });
    
    // Sort groups by number of duplicates (descending)
    report.groups.sort((a, b) => b.duplicates.length - a.duplicates.length);
    
    // Save report
    const reportDir = '/var/www/opine/Report-Generation/ImprovedDuplicateRemove';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const reportFile = path.join(reportDir, `exact_duplicate_groups_${timestamp}.json`);
    
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    
    console.log(`✅ Report saved to: ${reportFile}`);
    console.log('');
    console.log('='.repeat(80));
    console.log('STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total responses processed: ${report.statistics.totalResponsesProcessed}`);
    console.log(`Total duplicate groups: ${report.statistics.totalDuplicateGroups}`);
    console.log(`Total duplicate responses: ${report.statistics.totalDuplicateResponses}`);
    console.log(`Total original responses: ${report.statistics.totalOriginalResponses}`);
    console.log('');
    console.log('Groups by size:');
    Object.keys(report.statistics.groupsBySize).sort((a, b) => parseInt(b) - parseInt(a)).forEach(size => {
      console.log(`  ${size} responses per group: ${report.statistics.groupsBySize[size]} groups`);
    });
    console.log('');
    console.log('Top 10 groups with most duplicates:');
    report.groups.slice(0, 10).forEach((group, idx) => {
      console.log(`  ${idx + 1}. Group ${group.groupNumber}: ${group.duplicates.length} duplicates`);
      console.log(`     Original: ${group.original.responseId.substring(0, 12)}... (Interviewer: ${group.original.interviewer.memberId} - ${group.original.interviewer.name})`);
      console.log(`     StartTime: ${group.original.matchFields.startTime}`);
      console.log(`     PM: ${group.original.projectManager ? group.original.projectManager.name : 'N/A'}`);
    });
    
    // Also create CSV
    const csvRows = [];
    csvRows.push([
      'Group Number',
      'Type',
      'Response ID',
      'Mongo ID',
      'Session ID',
      'Created At',
      'Interviewer ObjectId',
      'Interviewer MemberId',
      'Interviewer Name',
      'Interviewer Email',
      'Project Manager Name',
      'Project Manager Email',
      'Start Time',
      'End Time',
      'Total Time Spent (seconds)',
      'Responses Matched',
      'Responses Count',
      'Audio Duration (seconds)',
      'Audio File Size (bytes)',
      'Audio Format',
      'Audio Codec',
      'Audio Bitrate'
    ].join(','));
    
    report.groups.forEach(group => {
      // Original
      csvRows.push([
        group.groupNumber,
        'Original',
        group.original.responseId,
        group.original.mongoId,
        group.original.sessionId,
        group.original.createdAt,
        group.original.interviewer.objectId,
        group.original.interviewer.memberId,
        `"${group.original.interviewer.name}"`,
        group.original.interviewer.email,
        group.original.projectManager ? `"${group.original.projectManager.name}"` : 'N/A',
        group.original.projectManager ? group.original.projectManager.email : 'N/A',
        group.original.matchFields.startTime,
        group.original.matchFields.endTime || 'N/A',
        group.original.matchFields.totalTimeSpent,
        group.original.matchFields.responsesMatched ? 'Yes' : 'No',
        group.original.matchFields.responsesCount,
        group.original.matchFields.audioRecording?.duration || 'N/A',
        group.original.matchFields.audioRecording?.fileSize || 'N/A',
        group.original.matchFields.audioRecording?.format || 'N/A',
        group.original.matchFields.audioRecording?.codec || 'N/A',
        group.original.matchFields.audioRecording?.bitrate || 'N/A'
      ].join(','));
      
      // Duplicates
      group.duplicates.forEach(dup => {
        csvRows.push([
          group.groupNumber,
          'Duplicate',
          dup.responseId,
          dup.mongoId,
          dup.sessionId,
          dup.createdAt,
          dup.interviewer.objectId,
          dup.interviewer.memberId,
          `"${dup.interviewer.name}"`,
          dup.interviewer.email,
          dup.projectManager ? `"${dup.projectManager.name}"` : 'N/A',
          dup.projectManager ? dup.projectManager.email : 'N/A',
          dup.matchFields.startTime,
          dup.matchFields.endTime || 'N/A',
          dup.matchFields.totalTimeSpent,
          dup.matchFields.responsesMatched ? 'Yes' : 'No',
          dup.matchFields.responsesCount,
          dup.matchFields.audioRecording?.duration || 'N/A',
          dup.matchFields.audioRecording?.fileSize || 'N/A',
          dup.matchFields.audioRecording?.format || 'N/A',
          dup.matchFields.audioRecording?.codec || 'N/A',
          dup.matchFields.audioRecording?.bitrate || 'N/A'
        ].join(','));
      });
    });
    
    const csvFile = path.join(reportDir, `exact_duplicate_groups_${timestamp}.csv`);
    fs.writeFileSync(csvFile, csvRows.join('\n'));
    console.log(`✅ CSV saved to: ${csvFile}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
  }
}

main();
