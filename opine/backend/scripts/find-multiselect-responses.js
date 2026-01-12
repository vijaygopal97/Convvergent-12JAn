/**
 * Find Survey Responses with multiple selections for a question that should be single-select
 * Survey: 68fd1915d41841da463f0d46
 * Question ID: question_1767953047865_319
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User'); // Required for populate

const SURVEY_ID = '68fd1915d41841da463f0d46';
const QUESTION_ID = 'question_1767953047865_319';
const REPORT_FILE = path.join(__dirname, '../../multiselect-responses-report.json');

async function findMultiselectResponses() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log(`🔍 Searching for responses with multiple selections...`);
    console.log(`   Survey ID: ${SURVEY_ID}`);
    console.log(`   Question ID: ${QUESTION_ID}\n`);

    // Filter criteria: Only Approved, Rejected, or Pending_Approval responses after Jan 4, 2026
    const filterDate = new Date('2026-01-04T00:00:00.000Z'); // Jan 4, 2026 00:00 UTC
    
    const queryFilter = {
      survey: SURVEY_ID,
      status: { $in: ['Approved', 'Rejected', 'Pending_Approval'] },
      createdAt: { $gte: filterDate }
    };

    // First, get total count
    const totalCount = await SurveyResponse.countDocuments(queryFilter);
    console.log(`📊 Total responses to check: ${totalCount}`);
    console.log(`   (Filtered: Status in [Approved, Rejected, Pending_Approval] and after Jan 4, 2026)\n`);

    const multiselectResponses = [];
    const BATCH_SIZE = 500;
    let checkedCount = 0;
    let skip = 0;

    console.log('🔍 Processing responses in batches...\n');

    while (skip < totalCount) {
      // Fetch batch of responses with filters applied
      const batch = await SurveyResponse.find(queryFilter)
        .select('responseId responses status interviewMode createdAt startTime interviewer')
        .populate('interviewer', 'firstName lastName memberId email')
        .sort({ createdAt: 1 }) // Sort for consistent processing
        .skip(skip)
        .limit(BATCH_SIZE)
        .lean();

      if (batch.length === 0) break;

      for (const response of batch) {
        checkedCount++;
        if (checkedCount % 1000 === 0) {
          console.log(`   Checked ${checkedCount}/${totalCount} responses...`);
        }

        // Check if responses field exists and is an object
        if (!response.responses || typeof response.responses !== 'object') {
          continue;
        }

        // Get the answer for this question
        const questionAnswer = response.responses[QUESTION_ID];

        // Skip if question not answered
        if (!questionAnswer) {
          continue;
        }

        // Check if answer is an array with multiple values
        let isMultiselect = false;
        let answerValue = null;
        let answerType = null;

        if (Array.isArray(questionAnswer)) {
          // If it's an array, check if it has more than one element
          if (questionAnswer.length > 1) {
            isMultiselect = true;
            answerValue = questionAnswer;
            answerType = 'array';
          } else if (questionAnswer.length === 1) {
            // Single element array - might be valid or might be incorrectly stored
            answerValue = questionAnswer[0];
            answerType = 'array_single';
          }
        } else if (typeof questionAnswer === 'string') {
          // Check if string contains multiple values (comma-separated, pipe-separated, etc.)
          const separators = [',', '|', ';', '||'];
          for (const sep of separators) {
            if (questionAnswer.includes(sep)) {
              const parts = questionAnswer.split(sep).map(s => s.trim()).filter(s => s);
              if (parts.length > 1) {
                isMultiselect = true;
                answerValue = parts;
                answerType = 'string_multiple';
                break;
              }
            }
          }
          if (!isMultiselect) {
            answerValue = questionAnswer;
            answerType = 'string_single';
          }
        } else if (typeof questionAnswer === 'object' && questionAnswer !== null) {
          // Check if object has multiple keys/values
          const keys = Object.keys(questionAnswer);
          if (keys.length > 1) {
            isMultiselect = true;
            answerValue = questionAnswer;
            answerType = 'object_multiple';
          } else if (keys.length === 1) {
            answerValue = questionAnswer[keys[0]];
            answerType = 'object_single';
          }
        } else {
          // Other types (number, boolean, etc.) - single value
          answerValue = questionAnswer;
          answerType = typeof questionAnswer;
        }

        if (isMultiselect) {
          multiselectResponses.push({
            responseId: response.responseId,
            mongoId: response._id.toString(),
            status: response.status,
            interviewMode: response.interviewMode,
            createdAt: response.createdAt,
            startTime: response.startTime,
            interviewer: response.interviewer ? {
              name: `${response.interviewer.firstName || ''} ${response.interviewer.lastName || ''}`.trim(),
              memberId: response.interviewer.memberId,
              email: response.interviewer.email
            } : null,
            questionId: QUESTION_ID,
            answerValue: answerValue,
            answerType: answerType,
            answerCount: Array.isArray(answerValue) ? answerValue.length : 
                        (typeof answerValue === 'object' && answerValue !== null ? Object.keys(answerValue).length : 1),
            rawAnswer: questionAnswer // Store original answer for reference
          });
        }
      }

      skip += BATCH_SIZE;
    }

    console.log(`\n✅ Analysis complete!\n`);

    // Generate report
    const report = {
      generatedAt: new Date().toISOString(),
      surveyId: SURVEY_ID,
      questionId: QUESTION_ID,
      totalResponsesChecked: checkedCount,
      multiselectResponsesFound: multiselectResponses.length,
      summary: {
        byStatus: {},
        byInterviewMode: {},
        byAnswerType: {},
        byAnswerCount: {}
      },
      details: multiselectResponses
    };

    // Generate summary statistics
    multiselectResponses.forEach(resp => {
      // By status
      report.summary.byStatus[resp.status] = (report.summary.byStatus[resp.status] || 0) + 1;
      
      // By interview mode
      report.summary.byInterviewMode[resp.interviewMode] = (report.summary.byInterviewMode[resp.interviewMode] || 0) + 1;
      
      // By answer type
      report.summary.byAnswerType[resp.answerType] = (report.summary.byAnswerType[resp.answerType] || 0) + 1;
      
      // By answer count
      report.summary.byAnswerCount[resp.answerCount] = (report.summary.byAnswerCount[resp.answerCount] || 0) + 1;
    });

    // Save report
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

    console.log(`📊 Report Summary:`);
    console.log(`   Total responses checked: ${report.totalResponsesChecked}`);
    console.log(`   Multiselect responses found: ${report.multiselectResponsesFound}`);
    console.log(`\n   By Status:`);
    Object.entries(report.summary.byStatus).forEach(([status, count]) => {
      console.log(`     ${status}: ${count}`);
    });
    console.log(`\n   By Interview Mode:`);
    Object.entries(report.summary.byInterviewMode).forEach(([mode, count]) => {
      console.log(`     ${mode}: ${count}`);
    });
    console.log(`\n   By Answer Type:`);
    Object.entries(report.summary.byAnswerType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
    console.log(`\n   By Answer Count:`);
    Object.entries(report.summary.byAnswerCount).forEach(([count, num]) => {
      console.log(`     ${count} option(s): ${num}`);
    });
    console.log(`\n📄 Detailed report saved to: ${REPORT_FILE}`);
    console.log(`\n✅ Analysis complete!`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

findMultiselectResponses();

