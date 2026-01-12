const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

async function checkAbandonedPendingApproval() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // First, get counts efficiently
    // Only include responses where abandonedReason is a non-empty string (not null, not empty)
    console.log('🔍 Counting responses with status "Pending_Approval" AND meaningful abandonedReason...');
    const countAbandoned = await SurveyResponse.countDocuments({
      status: 'Pending_Approval',
      abandonedReason: { 
        $type: 'string',  // Must be a string (not null)
        $ne: '',           // Not empty string
        $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined'] 
      }
    });
    console.log(`✅ Found ${countAbandoned} responses with meaningful abandonedReason\n`);

    // Get counts by interview mode
    const countByMode = {
      cati: await SurveyResponse.countDocuments({
        status: 'Pending_Approval',
        abandonedReason: { 
          $type: 'string',
          $ne: '',
          $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined'] 
        },
        interviewMode: 'cati'
      }),
      capi: await SurveyResponse.countDocuments({
        status: 'Pending_Approval',
        abandonedReason: { 
          $type: 'string',
          $ne: '',
          $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined'] 
        },
        interviewMode: 'capi'
      }),
      online: await SurveyResponse.countDocuments({
        status: 'Pending_Approval',
        abandonedReason: { 
          $type: 'string',
          $ne: '',
          $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined'] 
        },
        interviewMode: 'online'
      })
    };

    console.log(`📊 Breakdown by mode: CATI: ${countByMode.cati}, CAPI: ${countByMode.capi}, Online: ${countByMode.online}\n`);

    // Process in batches using cursor - only load essential fields
    console.log('📊 Processing responses in batches (memory-efficient)...');
    const BATCH_SIZE = 1000;
    let processedCount = 0;
    
    const allResponses = [];
    const groupedByReason = {};
    const responseMap = new Map(); // For deduplication

    // Query with minimal fields and lean()
    // Only include responses with meaningful abandonedReason (must be a string, not null, not empty)
    const query = SurveyResponse.find({
      status: 'Pending_Approval',
      abandonedReason: { 
        $type: 'string',  // Must be a string (excludes null)
        $ne: '',           // Not empty string
        $nin: ['No reason specified', 'N/A', 'NA', 'na', 'null', 'undefined'] 
      }
    })
    .select('_id survey interviewer status sessionId responseId interviewMode abandonedReason knownCallStatus createdAt updatedAt metadata')
    .sort({ createdAt: 1 })
    .lean()
    .batchSize(BATCH_SIZE)
    .cursor();

    // Process cursor in batches
    for await (const response of query) {
      processedCount++;
      
      // Skip if already processed (shouldn't happen, but safety check)
      if (responseMap.has(response._id.toString())) {
        continue;
      }
      
      responseMap.set(response._id.toString(), true);
      
      // Track abandoned reason (only meaningful ones)
      const reason = response.abandonedReason || 'Unknown';
      if (!groupedByReason[reason]) {
        groupedByReason[reason] = 0;
      }
      groupedByReason[reason]++;
      
      // Store minimal data
      allResponses.push({
        _id: response._id,
        survey: response.survey,
        interviewer: response.interviewer,
        status: response.status, // Include status
        sessionId: response.sessionId,
        responseId: response.responseId,
        interviewMode: response.interviewMode,
        abandonedReason: response.abandonedReason,
        knownCallStatus: response.knownCallStatus,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt,
        hasMetadataAbandoned: !!(response.metadata?.abandoned || response.metadata?.abandonedReason)
      });
      
      // Progress indicator every 5000 records
      if (processedCount % 5000 === 0) {
        console.log(`   Processed ${processedCount} responses...`);
      }
    }

    console.log(`✅ Processed ${processedCount} responses\n`);

    // Now populate survey and interviewer info in batches
    console.log('📋 Populating survey and interviewer information...');
    const surveyIds = [...new Set(allResponses.map(r => r.survey?.toString()).filter(Boolean))];
    const interviewerIds = [...new Set(allResponses.map(r => r.interviewer?.toString()).filter(Boolean))];

    const surveys = await Survey.find({ _id: { $in: surveyIds } })
      .select('_id surveyName')
      .lean();
    const surveyMap = new Map(surveys.map(s => [s._id.toString(), s]));

    const interviewers = await User.find({ _id: { $in: interviewerIds } })
      .select('_id firstName lastName email memberId')
      .lean();
    const interviewerMap = new Map(interviewers.map(i => [i._id.toString(), i]));

    // Attach populated data
    allResponses.forEach(response => {
      response.survey = surveyMap.get(response.survey?.toString()) || { _id: response.survey, surveyName: 'Unknown Survey' };
      response.interviewer = interviewerMap.get(response.interviewer?.toString()) || { firstName: 'Unknown', lastName: 'Interviewer', email: 'N/A', memberId: 'N/A' };
    });

    console.log('✅ Population complete\n');

    // Group by interview mode (already have counts, just verify)
    const groupedByMode = {
      cati: countByMode.cati,
      capi: countByMode.capi,
      online: countByMode.online,
      unknown: processedCount - countByMode.cati - countByMode.capi - countByMode.online
    };

    // Generate detailed report
    let report = '='.repeat(100) + '\n';
    report += 'ABANDONED INTERVIEWS INCORRECTLY IN PENDING_APPROVAL STATUS\n';
    report += '='.repeat(100) + '\n\n';
    
    report += `📊 SUMMARY\n`;
    report += `   Total Responses: ${allResponses.length}\n`;
    report += `   CATI: ${groupedByMode.cati}\n`;
    report += `   CAPI: ${groupedByMode.capi}\n`;
    report += `   Online: ${groupedByMode.online}\n`;
    report += `   Unknown Mode: ${groupedByMode.unknown}\n\n`;

    report += `⚠️  These responses have abandonedReason or abandoned metadata but status is "Pending_Approval"\n`;
    report += `   They should have status "abandoned" instead.\n\n`;

    report += `📋 GROUPED BY ABANDONED REASON\n`;
    report += '-'.repeat(100) + '\n';
    Object.keys(groupedByReason).sort().forEach(reason => {
      report += `   "${reason}": ${groupedByReason[reason]} responses\n`;
    });
    report += '\n';

    // Detailed list - limit to first 500 for performance
    const maxDetailed = 500;
    const detailedResponses = allResponses.slice(0, maxDetailed);
    
    report += '='.repeat(100) + '\n';
    report += `DETAILED RESPONSE LIST (First ${maxDetailed} of ${allResponses.length})\n`;
    report += '='.repeat(100) + '\n\n';

    detailedResponses.forEach((response, index) => {
      const surveyName = response.survey?.surveyName || 'Unknown Survey';
      const interviewerName = response.interviewer 
        ? `${response.interviewer.firstName} ${response.interviewer.lastName}`
        : 'Unknown Interviewer';
      const interviewerEmail = response.interviewer?.email || 'N/A';
      const interviewerMemberId = response.interviewer?.memberId || 'N/A';
      
      const abandonedReason = response.abandonedReason || response.metadata?.abandonedReason || 'Not specified';
      const createdAt = new Date(response.createdAt).toISOString();
      const updatedAt = new Date(response.updatedAt).toISOString();
      const interviewMode = response.interviewMode || 'unknown';
      const knownCallStatus = response.knownCallStatus || 'N/A';
      
      report += `${index + 1}. Response ID: ${response._id}\n`;
      report += `   Survey: ${surveyName} (${response.survey?._id})\n`;
      report += `   Interviewer: ${interviewerName} (${interviewerEmail}) - Member ID: ${interviewerMemberId}\n`;
      report += `   Interview Mode: ${interviewMode.toUpperCase()}\n`;
      report += `   Session ID: ${response.sessionId || 'N/A'}\n`;
      report += `   Response ID: ${response.responseId || 'N/A'}\n`;
      report += `   Status: ${response.status} ⚠️ (Should be "abandoned")\n`;
      report += `   Abandoned Reason: ${abandonedReason}\n`;
      if (interviewMode === 'cati') {
        report += `   Known Call Status: ${knownCallStatus}\n`;
      }
      report += `   Created At: ${createdAt}\n`;
      report += `   Updated At: ${updatedAt}\n`;
      report += `   Days Since Created: ${Math.floor((new Date() - new Date(response.createdAt)) / (1000 * 60 * 60 * 24))}\n`;
      report += `   Days Since Updated: ${Math.floor((new Date() - new Date(response.updatedAt)) / (1000 * 60 * 60 * 24))}\n`;
      
      // Check if there's metadata with abandoned info
      if (response.metadata?.abandoned) {
        report += `   Metadata Abandoned: ${response.metadata.abandoned}\n`;
      }
      if (response.metadata?.abandonedReason) {
        report += `   Metadata Abandoned Reason: ${response.metadata.abandonedReason}\n`;
      }
      
      report += '\n';
    });

    // Statistics by time ranges
    report += '='.repeat(100) + '\n';
    report += 'TIME-BASED STATISTICS\n';
    report += '='.repeat(100) + '\n\n';

    const now = new Date();
    
    // Calculate statistics
    const stats = {
      created: {
        'Last 24 hours': 0,
        'Last 7 days': 0,
        'Last 30 days': 0,
        'Last 90 days': 0,
        'Older than 90 days': 0
      },
      updated: {
        'Last 24 hours': 0,
        'Last 7 days': 0,
        'Last 30 days': 0,
        'Last 90 days': 0,
        'Older than 90 days': 0
      }
    };

    allResponses.forEach(response => {
      const createdDaysAgo = (now - new Date(response.createdAt)) / (1000 * 60 * 60 * 24);
      const updatedDaysAgo = (now - new Date(response.updatedAt)) / (1000 * 60 * 60 * 24);

      // Created stats
      if (createdDaysAgo <= 1) stats.created['Last 24 hours']++;
      else if (createdDaysAgo <= 7) stats.created['Last 7 days']++;
      else if (createdDaysAgo <= 30) stats.created['Last 30 days']++;
      else if (createdDaysAgo <= 90) stats.created['Last 90 days']++;
      else stats.created['Older than 90 days']++;

      // Updated stats
      if (updatedDaysAgo <= 1) stats.updated['Last 24 hours']++;
      else if (updatedDaysAgo <= 7) stats.updated['Last 7 days']++;
      else if (updatedDaysAgo <= 30) stats.updated['Last 30 days']++;
      else if (updatedDaysAgo <= 90) stats.updated['Last 90 days']++;
      else stats.updated['Older than 90 days']++;
    });

    report += 'Created Date Distribution:\n';
    Object.keys(stats.created).forEach(range => {
      if (stats.created[range] > 0) {
        report += `   ${range}: ${stats.created[range]} responses\n`;
      }
    });
    report += '\n';

    report += 'Updated Date Distribution:\n';
    report += '   (Note: updatedAt reflects last modification, not necessarily status change)\n';
    Object.keys(stats.updated).forEach(range => {
      if (stats.updated[range] > 0) {
        report += `   ${range}: ${stats.updated[range]} responses\n`;
      }
    });
    report += '\n';

    // Find oldest and newest
    const oldest = allResponses[0]; // Already sorted by createdAt
    const newest = allResponses[allResponses.length - 1];
    
    report += 'Oldest Response:\n';
    report += `   Response ID: ${oldest._id}\n`;
    report += `   Created At: ${new Date(oldest.createdAt).toISOString()}\n`;
    report += `   Updated At: ${new Date(oldest.updatedAt).toISOString()}\n`;
    report += `   Abandoned Reason: ${oldest.abandonedReason || 'Not specified'}\n\n`;
    
    report += 'Newest Response:\n';
    report += `   Response ID: ${newest._id}\n`;
    report += `   Created At: ${new Date(newest.createdAt).toISOString()}\n`;
    report += `   Updated At: ${new Date(newest.updatedAt).toISOString()}\n`;
    report += `   Abandoned Reason: ${newest.abandonedReason || 'Not specified'}\n\n`;

    // Most recent status update to Pending_Approval (we can't track this exactly, but we use updatedAt as proxy)
    const mostRecentUpdate = allResponses.reduce((latest, response) => {
      return new Date(response.updatedAt) > new Date(latest.updatedAt) ? response : latest;
    }, allResponses[0]);

    report += '='.repeat(100) + '\n';
    report += 'MOST RECENT UPDATE\n';
    report += '='.repeat(100) + '\n';
    if (mostRecentUpdate) {
      report += `   Response ID: ${mostRecentUpdate._id}\n`;
      report += `   Updated At: ${new Date(mostRecentUpdate.updatedAt).toISOString()}\n`;
      report += `   Created At: ${new Date(mostRecentUpdate.createdAt).toISOString()}\n`;
      report += `   Interview Mode: ${mostRecentUpdate.interviewMode}\n`;
      report += `   Abandoned Reason: ${mostRecentUpdate.abandonedReason || mostRecentUpdate.metadata?.abandonedReason || 'Not specified'}\n`;
    }

    // Save report to file
    const reportPath = '/var/www/MyLogos/abandoned_pending_approval_report.txt';
    fs.writeFileSync(reportPath, report, 'utf8');
    console.log(`\n📄 Report saved to: ${reportPath}`);

    // Print summary to console
    console.log('\n' + '='.repeat(100));
    console.log('SUMMARY');
    console.log('='.repeat(100));
    console.log(`Total Responses: ${allResponses.length}`);
    console.log(`CATI: ${groupedByMode.cati}`);
    console.log(`CAPI: ${groupedByMode.capi}`);
    console.log(`Online: ${groupedByMode.online}`);
    console.log(`Unknown: ${groupedByMode.unknown}`);
    
    if (mostRecentUpdate) {
      console.log(`\nMost Recent Update: ${new Date(mostRecentUpdate.updatedAt).toISOString()}`);
    }

    console.log('\n✅ Analysis completed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
checkAbandonedPendingApproval();

