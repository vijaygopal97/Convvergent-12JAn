#!/usr/bin/env node

/**
 * Generate detailed report of responses that should be abandoned
 * Includes statistics, breakdowns, and full details
 */

const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

// Calculate 24 hours ago
const twentyFourHoursAgo = new Date();
twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

async function generateReport() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log(`📅 Analyzing responses from last 24 hours (since ${twentyFourHoursAgo.toISOString()})...\n`);

    // Find all responses from last 24 hours that are in Pending_Approval
    const pendingResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      createdAt: { $gte: twentyFourHoursAgo }
    })
      .select('_id responseId sessionId status interviewMode createdAt updatedAt abandonedReason knownCallStatus metadata survey interviewer')
      .populate('survey', 'name mode')
      .populate('interviewer', 'firstName lastName memberId email')
      .lean();

    console.log(`📊 Found ${pendingResponses.length} responses in Pending_Approval from last 24 hours\n`);

    // Analyze which ones should be abandoned
    const shouldBeAbandoned = [];
    const stats = {
      total: 0,
      byMode: {
        capi: 0,
        cati: 0
      },
      byAbandonReason: {},
      byCallStatus: {},
      bySurvey: {},
      byInterviewer: {},
      withAbandonReason: 0,
      withMetadataAbandoned: 0,
      withCallStatus: 0
    };

    for (const response of pendingResponses) {
      let isAbandoned = false;
      let abandonReason = null;
      let knownCallStatus = null;
      const indicators = [];

      // Check for abandoned indicators
      // 1. Check abandonedReason field directly
      if (response.abandonedReason && response.abandonedReason.trim() !== '') {
        isAbandoned = true;
        abandonReason = response.abandonedReason;
        indicators.push(`abandonedReason: "${response.abandonedReason}"`);
        stats.withAbandonReason++;
      }

      // 2. Check metadata.abandoned
      if (response.metadata?.abandoned === true || response.metadata?.abandoned === 'true') {
        isAbandoned = true;
        if (!abandonReason) {
          abandonReason = response.metadata?.abandonedReason || 'metadata.abandoned = true';
        }
        indicators.push('metadata.abandoned = true');
        stats.withMetadataAbandoned++;
      }

      // 3. Check metadata.abandonedReason
      if (response.metadata?.abandonedReason && response.metadata.abandonedReason.trim() !== '') {
        isAbandoned = true;
        if (!abandonReason) {
          abandonReason = response.metadata.abandonedReason;
        }
        indicators.push(`metadata.abandonedReason: "${response.metadata.abandonedReason}"`);
      }

      // 4. For CATI: Check call status
      if (response.interviewMode === 'cati' || response.interviewMode === 'CATI') {
        const callStatus = response.metadata?.callStatus || response.knownCallStatus;
        if (callStatus && 
            callStatus !== 'call_connected' && 
            callStatus !== 'success' &&
            callStatus !== null &&
            callStatus !== undefined &&
            callStatus.trim() !== '') {
          isAbandoned = true;
          if (!abandonReason) {
            abandonReason = `Call status: ${callStatus}`;
          }
          knownCallStatus = callStatus;
          indicators.push(`callStatus: "${callStatus}"`);
          stats.withCallStatus++;
        }
      }

      if (isAbandoned) {
        stats.total++;
        
        // Count by mode
        if (response.interviewMode === 'capi' || response.interviewMode === 'CAPI') {
          stats.byMode.capi++;
        } else if (response.interviewMode === 'cati' || response.interviewMode === 'CATI') {
          stats.byMode.cati++;
        }

        // Count by abandon reason
        const reasonKey = abandonReason || 'Not specified';
        stats.byAbandonReason[reasonKey] = (stats.byAbandonReason[reasonKey] || 0) + 1;

        // Count by call status (CATI only)
        if (knownCallStatus) {
          stats.byCallStatus[knownCallStatus] = (stats.byCallStatus[knownCallStatus] || 0) + 1;
        }

        // Count by survey
        const surveyName = response.survey?.name || response.survey?._id?.toString() || 'Unknown';
        if (!stats.bySurvey[surveyName]) {
          stats.bySurvey[surveyName] = { count: 0, capi: 0, cati: 0 };
        }
        stats.bySurvey[surveyName].count++;
        if (response.interviewMode === 'capi' || response.interviewMode === 'CAPI') {
          stats.bySurvey[surveyName].capi++;
        } else {
          stats.bySurvey[surveyName].cati++;
        }

        // Count by interviewer
        const interviewerName = response.interviewer 
          ? `${response.interviewer.firstName || ''} ${response.interviewer.lastName || ''}`.trim() || response.interviewer.memberId || response.interviewer.email || 'Unknown'
          : 'Unknown';
        if (!stats.byInterviewer[interviewerName]) {
          stats.byInterviewer[interviewerName] = { count: 0, capi: 0, cati: 0, memberId: response.interviewer?.memberId || null };
        }
        stats.byInterviewer[interviewerName].count++;
        if (response.interviewMode === 'capi' || response.interviewMode === 'CAPI') {
          stats.byInterviewer[interviewerName].capi++;
        } else {
          stats.byInterviewer[interviewerName].cati++;
        }

        shouldBeAbandoned.push({
          responseId: response.responseId,
          sessionId: response.sessionId,
          interviewMode: response.interviewMode,
          status: response.status,
          abandonReason: abandonReason,
          knownCallStatus: knownCallStatus,
          indicators: indicators,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          survey: {
            id: response.survey?._id?.toString() || 'Unknown',
            name: response.survey?.name || 'Unknown',
            mode: response.survey?.mode || 'Unknown'
          },
          interviewer: {
            id: response.interviewer?._id?.toString() || 'Unknown',
            name: interviewerName,
            memberId: response.interviewer?.memberId || null,
            email: response.interviewer?.email || null
          },
          _id: response._id.toString()
        });
      }
    }

    // Generate report
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const reportFile = path.join(__dirname, `abandoned_responses_detailed_report_${timestamp}.json`);
    const textReportFile = path.join(__dirname, `abandoned_responses_detailed_report_${timestamp}.txt`);

    const report = {
      generatedAt: new Date().toISOString(),
      timeRange: {
        from: twentyFourHoursAgo.toISOString(),
        to: new Date().toISOString(),
        hours: 24
      },
      summary: {
        totalPendingApproval: pendingResponses.length,
        shouldBeAbandoned: stats.total,
        correctlyMarked: pendingResponses.length - stats.total,
        percentageShouldBeAbandoned: ((stats.total / pendingResponses.length) * 100).toFixed(2) + '%'
      },
      statistics: stats,
      breakdowns: {
        byMode: stats.byMode,
        byAbandonReason: Object.entries(stats.byAbandonReason)
          .sort((a, b) => b[1] - a[1])
          .map(([reason, count]) => ({ reason, count })),
        byCallStatus: Object.entries(stats.byCallStatus)
          .sort((a, b) => b[1] - a[1])
          .map(([status, count]) => ({ status, count })),
        bySurvey: Object.entries(stats.bySurvey)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([survey, data]) => ({ survey, ...data })),
        byInterviewer: Object.entries(stats.byInterviewer)
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 20) // Top 20 interviewers
          .map(([interviewer, data]) => ({ interviewer, ...data }))
      },
      responses: shouldBeAbandoned
    };

    // Save JSON report
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));

    // Generate text report
    let textReport = '';
    textReport += '='.repeat(100) + '\n';
    textReport += 'ABANDONED RESPONSES DETAILED REPORT\n';
    textReport += '='.repeat(100) + '\n\n';
    textReport += `Generated: ${new Date().toISOString()}\n`;
    textReport += `Time Range: ${twentyFourHoursAgo.toISOString()} to ${new Date().toISOString()} (24 hours)\n\n`;

    textReport += '📊 SUMMARY\n';
    textReport += '-'.repeat(100) + '\n';
    textReport += `Total Pending_Approval (last 24h): ${pendingResponses.length}\n`;
    textReport += `Should be Abandoned: ${stats.total}\n`;
    textReport += `Correctly marked: ${pendingResponses.length - stats.total}\n`;
    textReport += `Percentage should be abandoned: ${((stats.total / pendingResponses.length) * 100).toFixed(2)}%\n\n`;

    textReport += '📱 BREAKDOWN BY INTERVIEW MODE\n';
    textReport += '-'.repeat(100) + '\n';
    textReport += `CAPI: ${stats.byMode.capi} responses (${((stats.byMode.capi / stats.total) * 100).toFixed(2)}%)\n`;
    textReport += `CATI: ${stats.byMode.cati} responses (${((stats.byMode.cati / stats.total) * 100).toFixed(2)}%)\n\n`;

    textReport += '🚫 BREAKDOWN BY ABANDON REASON\n';
    textReport += '-'.repeat(100) + '\n';
    Object.entries(stats.byAbandonReason)
      .sort((a, b) => b[1] - a[1])
      .forEach(([reason, count]) => {
        textReport += `${reason}: ${count} responses (${((count / stats.total) * 100).toFixed(2)}%)\n`;
      });
    textReport += '\n';

    if (Object.keys(stats.byCallStatus).length > 0) {
      textReport += '📞 BREAKDOWN BY CALL STATUS (CATI)\n';
      textReport += '-'.repeat(100) + '\n';
      Object.entries(stats.byCallStatus)
        .sort((a, b) => b[1] - a[1])
        .forEach(([status, count]) => {
          textReport += `${status}: ${count} responses (${((count / stats.byMode.cati) * 100).toFixed(2)}% of CATI)\n`;
        });
      textReport += '\n';
    }

    textReport += '📋 TOP 10 SURVEYS\n';
    textReport += '-'.repeat(100) + '\n';
    Object.entries(stats.bySurvey)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .forEach(([survey, data]) => {
        textReport += `${survey}:\n`;
        textReport += `  Total: ${data.count} responses\n`;
        textReport += `  CAPI: ${data.capi}, CATI: ${data.cati}\n`;
      });
    textReport += '\n';

    textReport += '👤 TOP 20 INTERVIEWERS\n';
    textReport += '-'.repeat(100) + '\n';
    Object.entries(stats.byInterviewer)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20)
      .forEach(([interviewer, data]) => {
        textReport += `${interviewer}${data.memberId ? ` (ID: ${data.memberId})` : ''}:\n`;
        textReport += `  Total: ${data.count} responses\n`;
        textReport += `  CAPI: ${data.capi}, CATI: ${data.cati}\n`;
      });
    textReport += '\n';

    textReport += '📋 INDICATOR STATISTICS\n';
    textReport += '-'.repeat(100) + '\n';
    textReport += `Responses with abandonedReason field: ${stats.withAbandonReason}\n`;
    textReport += `Responses with metadata.abandoned: ${stats.withMetadataAbandoned}\n`;
    textReport += `Responses with call status (CATI): ${stats.withCallStatus}\n\n`;

    textReport += '📝 FIRST 50 RESPONSES DETAILS\n';
    textReport += '='.repeat(100) + '\n';
    shouldBeAbandoned.slice(0, 50).forEach((response, index) => {
      textReport += `\n${index + 1}. Response ID: ${response.responseId}\n`;
      textReport += `   Session ID: ${response.sessionId}\n`;
      textReport += `   Mode: ${response.interviewMode}\n`;
      textReport += `   Survey: ${response.survey.name} (${response.survey.id})\n`;
      textReport += `   Interviewer: ${response.interviewer.name}${response.interviewer.memberId ? ` (ID: ${response.interviewer.memberId})` : ''}\n`;
      textReport += `   Current Status: ${response.status}\n`;
      textReport += `   Abandon Reason: ${response.abandonReason || 'Not specified'}\n`;
      if (response.knownCallStatus) {
        textReport += `   Call Status: ${response.knownCallStatus}\n`;
      }
      textReport += `   Indicators: ${response.indicators.join(', ')}\n`;
      textReport += `   Created: ${response.createdAt.toISOString()}\n`;
      textReport += `   Updated: ${response.updatedAt.toISOString()}\n`;
    });

    if (shouldBeAbandoned.length > 50) {
      textReport += `\n... and ${shouldBeAbandoned.length - 50} more responses (see JSON file for full list)\n`;
    }

    textReport += '\n' + '='.repeat(100) + '\n';
    textReport += 'END OF REPORT\n';
    textReport += '='.repeat(100) + '\n';

    // Save text report
    fs.writeFileSync(textReportFile, textReport);

    console.log(`\n✅ Report generated successfully!\n`);
    console.log(`📄 JSON Report: ${reportFile}`);
    console.log(`📄 Text Report: ${textReportFile}\n`);

    // Print summary to console
    console.log('📊 SUMMARY:');
    console.log(`   Total Pending_Approval (last 24h): ${pendingResponses.length}`);
    console.log(`   Should be Abandoned: ${stats.total}`);
    console.log(`   Correctly marked: ${pendingResponses.length - stats.total}`);
    console.log(`   Percentage: ${((stats.total / pendingResponses.length) * 100).toFixed(2)}%\n`);

    console.log('📱 BY MODE:');
    console.log(`   CAPI: ${stats.byMode.capi}`);
    console.log(`   CATI: ${stats.byMode.cati}\n`);

    console.log('🚫 TOP 5 ABANDON REASONS:');
    Object.entries(stats.byAbandonReason)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([reason, count]) => {
        console.log(`   ${reason}: ${count}`);
      });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the report generation
generateReport();

