/**
 * Generate Rejected Interviews Report for Project Manager
 * 
 * Requirements:
 * 1. Find PM: dulal.roy@convergent.com
 * 2. Get all assigned interviewers from assignedTeamMembers
 * 3. Get all rejected interviews from those interviewers since Jan 2, 2025
 * 4. Get all details of those responses
 * 5. If contentHash matches any earlier response, exclude it
 * 6. Generate report
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

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

    // Step 3: Get all rejected responses since Jan 2, 2025
    console.log('📋 Step 2: Fetching rejected responses since Jan 2, 2025...');
    const startDate = new Date('2025-01-02T00:00:00.000Z');
    
    const rejectedResponses = await SurveyResponse.find({
      interviewer: { $in: interviewerIds },
      status: 'Rejected',
      createdAt: { $gte: startDate }
    })
    .populate('interviewer', 'firstName lastName email memberId')
    .populate('survey', 'surveyName surveyId')
    .sort({ createdAt: 1 }) // Sort by creation date to identify earlier responses
    .lean();

    console.log(`✅ Found ${rejectedResponses.length} rejected responses\n`);

    // Step 4: Filter out duplicates (contentHash matches earlier response)
    console.log('📋 Step 3: Filtering duplicates (contentHash matching earlier responses)...');
    
    const seenContentHashes = new Set();
    const uniqueResponses = [];
    const duplicateResponses = [];

    for (const response of rejectedResponses) {
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

    console.log(`✅ Unique responses: ${uniqueResponses.length}`);
    console.log(`⚠️  Duplicate responses excluded: ${duplicateResponses.length}\n`);

    // Step 5: Prepare report data
    console.log('📋 Step 4: Preparing report data...');
    
    const reportData = uniqueResponses.map(response => {
      const interviewer = response.interviewer || {};
      const survey = response.survey || {};
      
      // Format responses for display
      const responsesText = response.responses?.map(r => {
        const qText = r.questionText || '';
        const responseVal = Array.isArray(r.response) ? r.response.join(', ') : (r.response || '');
        return `${qText}: ${responseVal}`;
      }).join(' | ') || '';

      return {
        'Response ID': response.responseId || response._id.toString(),
        'Interviewer Name': `${interviewer.firstName || ''} ${interviewer.lastName || ''}`.trim(),
        'Interviewer Email': interviewer.email || '',
        'Interviewer Member ID': interviewer.memberId || '',
        'Survey Name': survey.surveyName || '',
        'Survey ID': survey.surveyId || survey._id?.toString() || '',
        'Interview Mode': response.interviewMode || '',
        'Status': response.status || '',
        'Session ID': response.sessionId || '',
        'Start Time': response.startTime ? new Date(response.startTime).toISOString() : '',
        'End Time': response.endTime ? new Date(response.endTime).toISOString() : '',
        'Total Time Spent (seconds)': response.totalTimeSpent || 0,
        'Created At': response.createdAt ? new Date(response.createdAt).toISOString() : '',
        'Updated At': response.updatedAt ? new Date(response.updatedAt).toISOString() : '',
        'Content Hash': response.contentHash || '',
        'Set Number': response.setNumber || '',
        'Call ID': response.call_id || '',
        'Consent Response': response.consentResponse || '',
        'Responses Count': response.responses?.length || 0,
        'All Responses': responsesText.substring(0, 500), // Limit to 500 chars
        'Verification Data': response.verificationData ? JSON.stringify(response.verificationData).substring(0, 200) : '',
        'Metadata': response.metadata ? JSON.stringify(response.metadata).substring(0, 200) : ''
      };
    });

    // Step 6: Generate Excel report
    console.log('📋 Step 5: Generating Excel report...');
    
    const workbook = XLSX.utils.book_new();
    
    // Main report sheet
    const worksheet = XLSX.utils.json_to_sheet(reportData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Rejected Interviews');

    // Duplicates summary sheet
    if (duplicateResponses.length > 0) {
      const dupSheet = XLSX.utils.json_to_sheet(duplicateResponses);
      XLSX.utils.book_append_sheet(workbook, dupSheet, 'Excluded Duplicates');
    }

    // Summary sheet
    const summaryData = [
      { 'Metric': 'Project Manager', 'Value': `${pm.firstName} ${pm.lastName} (${pm.email})` },
      { 'Metric': 'Total Assigned Interviewers', 'Value': interviewerIds.length },
      { 'Metric': 'Report Date Range', 'Value': `From ${startDate.toISOString().split('T')[0]} to ${new Date().toISOString().split('T')[0]}` },
      { 'Metric': 'Total Rejected Responses Found', 'Value': rejectedResponses.length },
      { 'Metric': 'Unique Rejected Responses', 'Value': uniqueResponses.length },
      { 'Metric': 'Duplicate Responses Excluded', 'Value': duplicateResponses.length },
      { 'Metric': 'Report Generated At', 'Value': new Date().toISOString() }
    ];
    const summarySheet = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Save report
    const reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filename = `Rejected_Interviews_Report_${pm.firstName}_${pm.lastName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filepath = path.join(reportsDir, filename);
    
    XLSX.writeFile(workbook, filepath);
    
    console.log(`✅ Report generated successfully!`);
    console.log(`📄 File: ${filepath}\n`);

    // Print summary
    console.log('📊 Report Summary:');
    console.log('='.repeat(60));
    console.log(`Project Manager: ${pm.firstName} ${pm.lastName}`);
    console.log(`Assigned Interviewers: ${interviewerIds.length}`);
    console.log(`Total Rejected Responses: ${rejectedResponses.length}`);
    console.log(`Unique Responses: ${uniqueResponses.length}`);
    console.log(`Duplicates Excluded: ${duplicateResponses.length}`);
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


