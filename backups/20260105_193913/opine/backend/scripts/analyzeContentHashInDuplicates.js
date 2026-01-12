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
    console.log('ANALYZING CONTENT HASH IN EXACT DUPLICATE GROUPS');
    console.log('='.repeat(80));
    console.log('');
    
    // Load the exact duplicate groups report
    const reportFile = '/var/www/opine/Report-Generation/ImprovedDuplicateRemove/exact_duplicate_groups_2026-01-02T19-51-54.json';
    const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
    
    console.log(`Loaded report with ${report.groups.length} duplicate groups`);
    console.log('');
    
    // Get all response IDs from the report
    const allResponseIds = [];
    report.groups.forEach(group => {
      allResponseIds.push(group.original.mongoId);
      group.duplicates.forEach(dup => {
        allResponseIds.push(dup.mongoId);
      });
    });
    
    console.log(`Fetching ${allResponseIds.length} responses from database...`);
    
    // Fetch responses with contentHash and status
    const responses = await SurveyResponse.find({
      _id: { $in: allResponseIds.map(id => new mongoose.Types.ObjectId(id)) }
    })
      .select('_id responseId contentHash status responses startTime interviewer survey audioRecording location call_id interviewMode')
      .lean();
    
    const responseMap = {};
    responses.forEach(r => {
      responseMap[r._id.toString()] = r;
    });
    
    console.log(`Fetched ${responses.length} responses`);
    console.log('');
    
    // Get all unique interviewer IDs from all responses
    const allInterviewerIds = [...new Set(
      responses.map(r => r.interviewer.toString())
    )];
    
    console.log(`Fetching interviewer details for ${allInterviewerIds.length} interviewers...`);
    
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
    
    console.log(`Fetching project manager details...`);
    
    // Find project managers for each interviewer
    // Project managers have assignedTeamMembers array containing interviewer ObjectIds
    const projectManagers = await User.find({
      userType: 'project_manager',
      'assignedTeamMembers.user': { $in: allInterviewerIds.map(id => new mongoose.Types.ObjectId(id)) }
    })
      .select('_id firstName lastName email assignedTeamMembers')
      .lean();
    
    // Create a map: interviewerId -> array of projectManagers (multiple PMs can be assigned)
    const interviewerToPMs = {};
    projectManagers.forEach(pm => {
      if (pm.assignedTeamMembers && Array.isArray(pm.assignedTeamMembers)) {
        pm.assignedTeamMembers.forEach(assignment => {
          if (assignment.user) {
            const interviewerId = assignment.user.toString();
            if (!interviewerToPMs[interviewerId]) {
              interviewerToPMs[interviewerId] = [];
            }
            // Check if this PM is already in the array (avoid duplicates)
            const pmExists = interviewerToPMs[interviewerId].some(
              existingPM => existingPM._id.toString() === pm._id.toString()
            );
            if (!pmExists) {
              interviewerToPMs[interviewerId].push(pm);
            }
          }
        });
      }
    });
    
    const totalPMAssignments = Object.values(interviewerToPMs).reduce((sum, pms) => sum + pms.length, 0);
    console.log(`Found ${Object.keys(interviewerToPMs).length} interviewers with project managers`);
    console.log(`Total PM assignments: ${totalPMAssignments}`);
    console.log('');
    
    // Function to calculate contentHash (same as in SurveyResponse model)
    function calculateContentHash(response) {
      const interviewer = response.interviewer;
      const survey = response.survey;
      const startTime = response.startTime;
      const responses = response.responses || [];
      const interviewMode = response.interviewMode || 'capi';
      const audioRecording = response.audioRecording;
      const location = response.location;
      const call_id = response.call_id;
      
      // Normalize startTime to nearest minute
      const normalizedStartTime = new Date(startTime);
      normalizedStartTime.setSeconds(0, 0);
      normalizedStartTime.setMilliseconds(0);
      
      // Create response signature (first 20 questionIds sorted)
      const responseSignature = responses
        .map(r => r.questionId || '')
        .sort()
        .slice(0, 20)
        .join('|');
      
      let hashInput = `${interviewer.toString()}|${survey.toString()}|${normalizedStartTime.toISOString()}|${responses.length}|${responseSignature}`;
      
      // CAPI-specific: Add audio and GPS
      if (interviewMode === 'capi' || interviewMode === 'CAPI') {
        let audioSignature = '';
        if (audioRecording && audioRecording.recordingDuration) {
          const duration = Math.floor(audioRecording.recordingDuration || 0);
          const fileSize = Math.floor((audioRecording.fileSize || 0) / 1024);
          const format = (audioRecording.format || '').toLowerCase().trim();
          const codec = (audioRecording.codec || '').toLowerCase().trim();
          const bitrate = Math.floor((audioRecording.bitrate || 0) / 1000);
          audioSignature = `${duration}|${fileSize}|${format}|${codec}|${bitrate}`;
        }
        hashInput += `|audio:${audioSignature}`;
        
        let gpsSignature = '';
        if (location && location.latitude !== undefined && location.longitude !== undefined) {
          const lat = Math.floor(location.latitude * 10000) / 10000;
          const lon = Math.floor(location.longitude * 10000) / 10000;
          gpsSignature = `${lat}|${lon}`;
        }
        hashInput += `|gps:${gpsSignature}`;
      }
      // CATI-specific: Add call_id
      else if ((interviewMode === 'cati' || interviewMode === 'CATI') && call_id) {
        hashInput += `|call_id:${call_id.toString().trim()}`;
      }
      
      return crypto.createHash('sha256').update(hashInput).digest('hex').substring(0, 16);
    }
    
    // Function to analyze why contentHash differs
    function analyzeContentHashMismatch(original, duplicate) {
      const reasons = [];
      
      // Check interviewer
      if (original.interviewer.toString() !== duplicate.interviewer.toString()) {
        reasons.push('Different interviewer ObjectId');
      }
      
      // Check survey
      if (original.survey.toString() !== duplicate.survey.toString()) {
        reasons.push('Different survey');
      }
      
      // Check normalized startTime (to nearest minute)
      const origStart = new Date(original.startTime);
      origStart.setSeconds(0, 0);
      origStart.setMilliseconds(0);
      const dupStart = new Date(duplicate.startTime);
      dupStart.setSeconds(0, 0);
      dupStart.setMilliseconds(0);
      if (origStart.getTime() !== dupStart.getTime()) {
        reasons.push('Different normalized startTime (different minute)');
      }
      
      // Check responses length
      if ((original.responses || []).length !== (duplicate.responses || []).length) {
        reasons.push('Different responses count');
      }
      
      // Check response signature (first 20 questionIds sorted)
      const origSig = (original.responses || [])
        .map(r => r.questionId || '')
        .sort()
        .slice(0, 20)
        .join('|');
      const dupSig = (duplicate.responses || [])
        .map(r => r.questionId || '')
        .sort()
        .slice(0, 20)
        .join('|');
      if (origSig !== dupSig) {
        reasons.push('Different question IDs in response signature (question order/content mismatch)');
      }
      
      // Check audio (for CAPI)
      if (original.interviewMode === 'capi' || original.interviewMode === 'CAPI') {
        const origAudio = original.audioRecording;
        const dupAudio = duplicate.audioRecording;
        
        if (!origAudio && !dupAudio) {
          // Both missing, same
        } else if (!origAudio || !dupAudio) {
          reasons.push('One has audio, other does not');
        } else {
          const origDuration = Math.floor(origAudio.recordingDuration || 0);
          const dupDuration = Math.floor(dupAudio.recordingDuration || 0);
          if (origDuration !== dupDuration) {
            reasons.push('Different audio duration');
          }
          
          const origFileSize = Math.floor((origAudio.fileSize || 0) / 1024);
          const dupFileSize = Math.floor((dupAudio.fileSize || 0) / 1024);
          if (origFileSize !== dupFileSize) {
            reasons.push('Different audio file size');
          }
          
          const origFormat = (origAudio.format || '').toLowerCase().trim();
          const dupFormat = (dupAudio.format || '').toLowerCase().trim();
          if (origFormat !== dupFormat) {
            reasons.push('Different audio format');
          }
        }
        
        // Check GPS
        const origLoc = original.location;
        const dupLoc = duplicate.location;
        if (origLoc && dupLoc) {
          const origLat = Math.floor(origLoc.latitude * 10000) / 10000;
          const dupLat = Math.floor(dupLoc.latitude * 10000) / 10000;
          const origLon = Math.floor(origLoc.longitude * 10000) / 10000;
          const dupLon = Math.floor(dupLoc.longitude * 10000) / 10000;
          if (origLat !== dupLat || origLon !== dupLon) {
            reasons.push('Different GPS coordinates');
          }
        } else if (origLoc || dupLoc) {
          reasons.push('One has GPS, other does not');
        }
      }
      
      // Check call_id (for CATI)
      if (original.interviewMode === 'cati' || original.interviewMode === 'CATI') {
        const origCallId = (original.call_id || '').toString().trim();
        const dupCallId = (duplicate.call_id || '').toString().trim();
        if (origCallId !== dupCallId) {
          reasons.push('Different call_id');
        }
      }
      
      return reasons.length > 0 ? reasons.join('; ') : 'Unknown reason';
    }
    
    // Analyze each group
    const analyzedGroups = [];
    let totalExcluded = 0;
    let totalWithSameHash = 0;
    let totalWithDifferentHash = 0;
    
    report.groups.forEach((group, groupIdx) => {
      const original = responseMap[group.original.mongoId];
      if (!original) {
        console.warn(`⚠️  Original response not found: ${group.original.mongoId}`);
        return;
      }
      
      // Exclude abandoned/terminated responses - only keep Pending_Approval, Rejected, Approved
      const validDuplicates = group.duplicates.filter(dup => {
        const dupResponse = responseMap[dup.mongoId];
        if (!dupResponse) return false;
        const status = dupResponse.status;
        return status === 'Pending_Approval' || status === 'Rejected' || status === 'Approved';
      });
      
      const excludedCount = group.duplicates.length - validDuplicates.length;
      totalExcluded += excludedCount;
      
      // Skip groups with no valid duplicates
      if (validDuplicates.length === 0) {
        return;
      }
      
      // Group by contentHash
      const hashGroups = {};
      const originalHash = original.contentHash || calculateContentHash(original);
      
      // Add original to hash group
      if (!hashGroups[originalHash]) {
        hashGroups[originalHash] = [];
      }
      hashGroups[originalHash].push({
        responseId: original.responseId,
        mongoId: original._id.toString(),
        status: original.status,
        isOriginal: true
      });
      
      // Process duplicates
      validDuplicates.forEach(dup => {
        const dupResponse = responseMap[dup.mongoId];
        if (!dupResponse) return;
        
        const dupHash = dupResponse.contentHash || calculateContentHash(dupResponse);
        
        if (!hashGroups[dupHash]) {
          hashGroups[dupHash] = [];
        }
        hashGroups[dupHash].push({
          responseId: dupResponse.responseId,
          mongoId: dupResponse._id.toString(),
          status: dupResponse.status,
          isOriginal: false
        });
      });
      
      // Analyze - filter out abandoned/terminated from same hash group
      const sameHashGroup = (hashGroups[originalHash] || []).filter(resp => {
        if (resp.isOriginal) return true;
        const dupResponse = responseMap[resp.mongoId];
        if (!dupResponse) return false;
        const status = dupResponse.status;
        return status === 'Pending_Approval' || status === 'Rejected' || status === 'Approved';
      });
      const sameHashCount = sameHashGroup.filter(r => !r.isOriginal).length;
      totalWithSameHash += sameHashCount;
      
      const differentHashGroups = Object.keys(hashGroups).filter(h => h !== originalHash);
      const differentHashResponses = [];
      
      differentHashGroups.forEach(hash => {
        const hashGroup = hashGroups[hash];
        hashGroup.forEach(resp => {
          if (!resp.isOriginal) {
            const dupResponse = responseMap[resp.mongoId];
            if (!dupResponse) return;
            const status = dupResponse.status;
            // Only include Pending_Approval, Rejected, Approved
            if (status === 'Pending_Approval' || status === 'Rejected' || status === 'Approved') {
              const mismatchReason = analyzeContentHashMismatch(original, dupResponse);
              differentHashResponses.push({
                responseId: resp.responseId,
                mongoId: resp.mongoId,
                status: resp.status,
                contentHash: hash,
                mismatchReason: mismatchReason
              });
            }
          }
        });
      });
      
      totalWithDifferentHash += differentHashResponses.length;
      
      // Only include groups that have differentContentHashResponses (bypassed by system) with valid statuses
      if (differentHashResponses.length === 0) {
        return;
      }
      
      // Get interviewer details for original
      const originalInv = interviewerMap[original.interviewer.toString()];
      const originalPMs = interviewerToPMs[original.interviewer.toString()] || [];
      
      analyzedGroups.push({
        groupNumber: group.groupNumber,
        original: {
          responseId: original.responseId,
          mongoId: original._id.toString(),
          contentHash: originalHash,
          status: original.status,
          interviewer: {
            objectId: original.interviewer.toString(),
            memberId: originalInv?.memberId || originalInv?.memberID || 'N/A',
            name: `${originalInv?.firstName || ''} ${originalInv?.lastName || ''}`.trim() || 'N/A',
            email: originalInv?.email || 'N/A'
          },
          projectManagers: originalPMs.map(pm => ({
            name: `${pm.firstName || ''} ${pm.lastName || ''}`.trim() || 'N/A',
            email: pm.email || 'N/A'
          }))
        },
        statistics: {
          totalDuplicates: group.duplicates.length,
          excludedAbandonedTerminated: excludedCount,
          validDuplicates: validDuplicates.length,
          sameContentHash: sameHashCount,
          differentContentHash: differentHashResponses.length
        },
        sameContentHashResponses: sameHashGroup.filter(r => {
          if (r.isOriginal) return false;
          const resp = responseMap[r.mongoId];
          return resp && (resp.status === 'Pending_Approval' || resp.status === 'Rejected' || resp.status === 'Approved');
        }).map(r => {
          const resp = responseMap[r.mongoId];
          const inv = interviewerMap[resp.interviewer.toString()];
          const pms = interviewerToPMs[resp.interviewer.toString()] || [];
          return {
            responseId: r.responseId,
            mongoId: r.mongoId,
            status: r.status,
            interviewer: {
              objectId: resp.interviewer.toString(),
              memberId: inv?.memberId || inv?.memberID || 'N/A',
              name: `${inv?.firstName || ''} ${inv?.lastName || ''}`.trim() || 'N/A',
              email: inv?.email || 'N/A'
            },
            projectManagers: pms.map(pm => ({
              name: `${pm.firstName || ''} ${pm.lastName || ''}`.trim() || 'N/A',
              email: pm.email || 'N/A'
            }))
          };
        }),
        differentContentHashResponses: differentHashResponses.map(resp => {
          const dupResponse = responseMap[resp.mongoId];
          const inv = interviewerMap[dupResponse.interviewer.toString()];
          const pms = interviewerToPMs[dupResponse.interviewer.toString()] || [];
          return {
            responseId: resp.responseId,
            mongoId: resp.mongoId,
            status: resp.status,
            contentHash: resp.contentHash,
            mismatchReason: resp.mismatchReason,
            interviewer: {
              objectId: dupResponse.interviewer.toString(),
              memberId: inv?.memberId || inv?.memberID || 'N/A',
              name: `${inv?.firstName || ''} ${inv?.lastName || ''}`.trim() || 'N/A',
              email: inv?.email || 'N/A'
            },
            projectManagers: pms.map(pm => ({
              name: `${pm.firstName || ''} ${pm.lastName || ''}`.trim() || 'N/A',
              email: pm.email || 'N/A'
            }))
          };
        })
      });
    });
    
    // Build final report
    const analysisReport = {
      generatedAt: new Date().toISOString(),
      sourceReport: reportFile,
      overallStatistics: {
        totalGroups: analyzedGroups.length,
        totalResponsesInGroups: report.statistics.totalDuplicateResponses + report.statistics.totalOriginalResponses,
        totalExcludedAbandonedTerminated: totalExcluded,
        totalWithSameContentHash: totalWithSameHash,
        totalWithDifferentContentHash: totalWithDifferentHash,
        percentageDetectedBySystem: ((totalWithSameHash / (totalWithSameHash + totalWithDifferentHash)) * 100).toFixed(2) + '%'
      },
      groups: analyzedGroups
    };
    
    // Save report
    const reportDir = '/var/www/opine/Report-Generation/ImprovedDuplicateRemove';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const analysisFile = path.join(reportDir, `content_hash_analysis_${timestamp}.json`);
    
    fs.writeFileSync(analysisFile, JSON.stringify(analysisReport, null, 2));
    
    console.log(`✅ Analysis report saved to: ${analysisFile}`);
    console.log('');
    console.log('='.repeat(80));
    console.log('OVERALL STATISTICS');
    console.log('='.repeat(80));
    console.log(`Total groups analyzed: ${analysisReport.overallStatistics.totalGroups}`);
    console.log(`Total responses in groups: ${analysisReport.overallStatistics.totalResponsesInGroups}`);
    console.log(`Excluded (abandoned/terminated): ${analysisReport.overallStatistics.totalExcludedAbandonedTerminated}`);
    console.log(`Same contentHash (detected by system): ${analysisReport.overallStatistics.totalWithSameContentHash}`);
    console.log(`Different contentHash (bypassed): ${analysisReport.overallStatistics.totalWithDifferentContentHash}`);
    console.log(`Percentage detected by system: ${analysisReport.overallStatistics.percentageDetectedBySystem}`);
    console.log('');
    
    // Show top reasons for mismatch
    const mismatchReasons = {};
    analyzedGroups.forEach(group => {
      group.differentContentHashResponses.forEach(resp => {
        const reason = resp.mismatchReason;
        if (!mismatchReasons[reason]) {
          mismatchReasons[reason] = 0;
        }
        mismatchReasons[reason]++;
      });
    });
    
    console.log('Top reasons for contentHash mismatch:');
    Object.entries(mismatchReasons)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([reason, count], idx) => {
        console.log(`  ${idx + 1}. ${reason}: ${count} responses`);
      });
    
    // Create CSV
    const csvRows = [];
    csvRows.push([
      'Group Number',
      'Type',
      'Response ID',
      'Mongo ID',
      'Status',
      'Content Hash',
      'Interviewer ObjectId',
      'Interviewer MemberId',
      'Interviewer Name',
      'Interviewer Email',
      'Project Manager Names',
      'Project Manager Emails',
      'Mismatch Reason'
    ].join(','));
    
    analyzedGroups.forEach(group => {
      // Helper function to format project managers
      const formatPMs = (pms) => {
        if (!pms || pms.length === 0) return 'N/A';
        return pms.map(pm => pm.name).join('; ');
      };
      
      const formatPMEmails = (pms) => {
        if (!pms || pms.length === 0) return 'N/A';
        return pms.map(pm => pm.email).join('; ');
      };
      
      // Add row for original
      csvRows.push([
        group.groupNumber,
        'Original',
        group.original.responseId,
        group.original.mongoId,
        group.original.status,
        group.original.contentHash,
        group.original.interviewer.objectId,
        group.original.interviewer.memberId,
        `"${group.original.interviewer.name}"`,
        group.original.interviewer.email,
        `"${formatPMs(group.original.projectManagers)}"`,
        formatPMEmails(group.original.projectManagers),
        'N/A'
      ].join(','));
      
      // Add row for same contentHash responses
      if (group.sameContentHashResponses.length > 0) {
        group.sameContentHashResponses.forEach(resp => {
          csvRows.push([
            group.groupNumber,
            'Duplicate (Same Hash)',
            resp.responseId,
            resp.mongoId,
            resp.status,
            group.original.contentHash,
            resp.interviewer.objectId,
            resp.interviewer.memberId,
            `"${resp.interviewer.name}"`,
            resp.interviewer.email,
            `"${formatPMs(resp.projectManagers)}"`,
            formatPMEmails(resp.projectManagers),
            'SAME - Detected by system'
          ].join(','));
        });
      }
      
      // Add row for different contentHash responses
      if (group.differentContentHashResponses.length > 0) {
        group.differentContentHashResponses.forEach(resp => {
          csvRows.push([
            group.groupNumber,
            'Duplicate (Different Hash)',
            resp.responseId,
            resp.mongoId,
            resp.status,
            resp.contentHash,
            resp.interviewer.objectId,
            resp.interviewer.memberId,
            `"${resp.interviewer.name}"`,
            resp.interviewer.email,
            `"${formatPMs(resp.projectManagers)}"`,
            formatPMEmails(resp.projectManagers),
            `"${resp.mismatchReason}"`
          ].join(','));
        });
      }
    });
    
    const csvFile = path.join(reportDir, `content_hash_analysis_${timestamp}.csv`);
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

