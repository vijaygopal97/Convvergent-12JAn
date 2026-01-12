/**
 * Generate Auto-Rejected Interviews JSON Report for Project Manager
 * 
 * Requirements:
 * 1. Find PM: dulal.roy@convergent.com
 * 2. Get all assigned interviewers from assignedTeamMembers
 * 3. Get all AUTO-REJECTED interviews (not manual rejections) from those interviewers since Jan 2, 2025
 * 4. Get all details of those responses
 * 5. If contentHash matches any earlier response, exclude it
 * 6. Generate JSON report
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

// Load models
const User = require('../models/User');
const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');

async function generateReport() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Step 1: Find Project Manager
    console.log('📋 Step 1: Finding Project Manager...');
    const pm = await User.findOne({ 
      email: 'dulal.roy@convergent.com',
      userType: 'project_manager'
    }).populate('assignedTeamMembers.user', 'firstName lastName email memberId');

    if (!pm) {
      console.error('❌ Project Manager not found with email: dulal.roy@convergent.com');
      process.exit(1);
    }

    console.log(`✅ Found PM: ${pm.firstName} ${pm.lastName}`);
    console.log(`   Email: ${pm.email}`);
    console.log(`   Assigned Interviewers: ${pm.assignedTeamMembers?.length || 0}\n`);

    // Step 2: Get assigned interviewer IDs
    const interviewerIds = pm.assignedTeamMembers
      .filter(member => member.userType === 'interviewer' && member.user)
      .map(member => member.user._id || member.user);

    if (interviewerIds.length === 0) {
      console.log('⚠️  No assigned interviewers found');
      process.exit(0);
    }

    console.log(`📊 Found ${interviewerIds.length} assigned interviewers\n`);

    // Step 3: Get all AUTO-REJECTED responses since Jan 2, 2025
    console.log('📋 Step 2: Fetching AUTO-REJECTED responses since Jan 2, 2025...');
    const startDate = new Date('2025-01-02T00:00:00.000Z');
    
    // Auto-rejections have:
    // - status: 'Rejected'
    // - verificationData.autoRejectionReasons exists (array with values)
    // - verificationData.reviewer is null or doesn't exist (no manual reviewer)
    const rejectedResponses = await SurveyResponse.find({
      interviewer: { $in: interviewerIds },
      status: 'Rejected',
      createdAt: { $gte: startDate },
      $or: [
        { 'verificationData.autoRejectionReasons': { $exists: true, $ne: [], $not: { $size: 0 } } },
        { 'verificationData.autoRejected': true },
        { 'metadata.autoRejected': true }
      ],
      $and: [
        {
          $or: [
            { 'verificationData.reviewer': { $exists: false } },
            { 'verificationData.reviewer': null }
          ]
        }
      ]
    })
    .populate('interviewer', 'firstName lastName email memberId')
    .populate('survey', 'surveyName surveyId')
    .sort({ createdAt: 1 }) // Sort by creation date to identify earlier responses
    .lean();

    console.log(`✅ Found ${rejectedResponses.length} auto-rejected responses\n`);

    // Step 4: Further filter - ensure they are auto-rejected (have autoRejectionReasons and no reviewer)
    const autoRejectedResponses = rejectedResponses.filter(response => {
      const vData = response.verificationData || {};
      const hasAutoReasons = vData.autoRejectionReasons && 
                            Array.isArray(vData.autoRejectionReasons) && 
                            vData.autoRejectionReasons.length > 0;
      const hasAutoRejectedFlag = vData.autoRejected === true || response.metadata?.autoRejected === true;
      const hasNoReviewer = !vData.reviewer || vData.reviewer === null;
      
      return (hasAutoReasons || hasAutoRejectedFlag) && hasNoReviewer;
    });

    console.log(`✅ Filtered to ${autoRejectedResponses.length} confirmed auto-rejections\n`);

    // Step 5: Filter out duplicates (contentHash matches earlier response)
    console.log('📋 Step 3: Filtering duplicates (contentHash matching earlier responses)...');
    
    const seenContentHashes = new Set();
    const uniqueResponses = [];
    const duplicateResponses = [];

    for (const response of autoRejectedResponses) {
      const contentHash = response.contentHash;
      
      if (!contentHash) {
        // If no contentHash, include it (can't determine if duplicate)
        uniqueResponses.push(response);
        continue;
      }

      if (seenContentHashes.has(contentHash)) {
        // This is a duplicate - exclude it
        duplicateResponses.push({
          responseId: response.responseId,
          interviewer: response.interviewer?.email || 'Unknown',
          createdAt: response.createdAt,
          contentHash: contentHash
        });
      } else {
        // First occurrence - include it
        seenContentHashes.add(contentHash);
        uniqueResponses.push(response);
      }
    }

    console.log(`✅ Unique auto-rejected responses: ${uniqueResponses.length}`);
    console.log(`⚠️  Duplicate responses excluded: ${duplicateResponses.length}\n`);

    // Step 6: Prepare JSON report data
    console.log('📋 Step 4: Preparing JSON report data...');
    
    // First, build summary statistics
    const summaryStats = {
      byRejectionReason: {},
      byInterviewer: {},
      byInterviewMode: {}
    };

    // Build responses and count statistics
    const responsesData = uniqueResponses.map(response => {
      const interviewer = response.interviewer || {};
      const survey = response.survey || {};
      const vData = response.verificationData || {};
      
      // Count rejection reasons
      const reasons = vData.autoRejectionReasons || [];
      reasons.forEach(reason => {
        if (!summaryStats.byRejectionReason[reason]) {
          summaryStats.byRejectionReason[reason] = 0;
        }
        summaryStats.byRejectionReason[reason]++;
      });

      // Count by interviewer
      const interviewerEmail = interviewer.email || 'Unknown';
      if (!summaryStats.byInterviewer[interviewerEmail]) {
        summaryStats.byInterviewer[interviewerEmail] = 0;
      }
      summaryStats.byInterviewer[interviewerEmail]++;

      // Count by interview mode
      const mode = response.interviewMode || 'Unknown';
      if (!summaryStats.byInterviewMode[mode]) {
        summaryStats.byInterviewMode[mode] = 0;
      }
      summaryStats.byInterviewMode[mode]++;

        return {
          responseId: response.responseId || response._id.toString(),
          interviewer: {
            id: interviewer._id?.toString() || '',
            name: `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim(),
            email: interviewer.email || '',
            memberId: interviewer.memberId || ''
          },
          survey: {
            id: survey._id?.toString() || '',
            name: survey.surveyName || '',
            surveyId: survey.surveyId || ''
          },
          interviewDetails: {
            mode: response.interviewMode || '',
            sessionId: response.sessionId || '',
            startTime: response.startTime ? new Date(response.startTime).toISOString() : null,
            endTime: response.endTime ? new Date(response.endTime).toISOString() : null,
            totalTimeSpent: response.totalTimeSpent || 0,
            setNumber: response.setNumber || null,
            callId: response.call_id || null
          },
          rejectionInfo: {
            autoRejectionReasons: vData.autoRejectionReasons || [],
            autoRejected: vData.autoRejected || response.metadata?.autoRejected || false,
            feedback: vData.feedback || '',
            rejectedAt: vData.reviewedAt ? new Date(vData.reviewedAt).toISOString() : null,
            reviewer: null // Confirmed no reviewer
          },
          location: response.location || null,
          selectedAC: response.selectedAC || null,
          selectedPollingStation: response.selectedPollingStation || null,
          consentResponse: response.consentResponse || null,
          responses: response.responses || [],
          responsesCount: response.responses?.length || 0,
          contentHash: response.contentHash || null,
          createdAt: response.createdAt ? new Date(response.createdAt).toISOString() : null,
          updatedAt: response.updatedAt ? new Date(response.updatedAt).toISOString() : null,
          metadata: response.metadata || {}
        };
      });

    // Now build complete report data
    const reportData = {
      metadata: {
        projectManager: {
          name: `${pm.firstName} ${pm.lastName}`,
          email: pm.email,
          id: pm._id.toString()
        },
        totalAssignedInterviewers: interviewerIds.length,
        reportDateRange: {
          from: startDate.toISOString(),
          to: new Date().toISOString()
        },
        totalAutoRejectedFound: rejectedResponses.length,
        confirmedAutoRejections: autoRejectedResponses.length,
        uniqueAutoRejections: uniqueResponses.length,
        duplicatesExcluded: duplicateResponses.length,
        generatedAt: new Date().toISOString()
      },
      summary: {
        totalRecords: uniqueResponses.length,
        byRejectionReason: summaryStats.byRejectionReason,
        byInterviewer: summaryStats.byInterviewer,
        byInterviewMode: summaryStats.byInterviewMode
      },
      responses: responsesData,
      excludedDuplicates: duplicateResponses
    };

    // Step 7: Save JSON report
    console.log('📋 Step 5: Saving JSON report...');
    
    const reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filename = `Auto_Rejected_Interviews_Report_${pm.firstName}_${pm.lastName}_${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(reportsDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2), 'utf8');
    
    console.log(`✅ JSON report generated successfully!`);
    console.log(`📄 File: ${filepath}`);
    console.log(`📊 File size: ${(fs.statSync(filepath).size / 1024 / 1024).toFixed(2)} MB\n`);

    // Print summary
    console.log('📊 Report Summary:');
    console.log('='.repeat(60));
    console.log(`Project Manager: ${pm.firstName} ${pm.lastName}`);
    console.log(`Assigned Interviewers: ${interviewerIds.length}`);
    console.log(`Total Auto-Rejected Found: ${rejectedResponses.length}`);
    console.log(`Confirmed Auto-Rejections: ${autoRejectedResponses.length}`);
    console.log(`Unique Auto-Rejections: ${uniqueResponses.length}`);
    console.log(`Duplicates Excluded: ${duplicateResponses.length}`);
    console.log('\n📊 By Rejection Reason:');
    Object.entries(reportData.summary.byRejectionReason).forEach(([reason, count]) => {
      console.log(`   ${reason}: ${count}`);
    });
    console.log('\n📊 By Interview Mode:');
    Object.entries(reportData.summary.byInterviewMode).forEach(([mode, count]) => {
      console.log(`   ${mode}: ${count}`);
    });
    console.log('='.repeat(60));

    // Close connection
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error generating report:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
generateReport();

