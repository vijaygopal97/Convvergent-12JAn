/**
 * Cleanup all test account data:
 * 1. Remove all responses created by test interviewer accounts
 * 2. Revert all reviews done by test quality agent account (change status back to Pending_Approval)
 * 
 * Test Accounts:
 * - Quality Agent: adarshquality123@gmail.com
 * - CATI Interviewer: vishalinterviewer@gmail.com
 * - CAPI Interviewer: ajithinterviewer@gmail.com
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const TEST_ACCOUNTS = {
  qualityAgent: 'adarshquality123@gmail.com',
  catiInterviewer: 'vishalinterviewer@gmail.com',
  capiInterviewer: 'ajithinterviewer@gmail.com'
};

const REPORT_FILE = path.join(__dirname, '../../test-accounts-cleanup-report.json');

async function cleanupTestAccounts() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log('🔍 Finding test accounts...\n');

    // Find test user IDs
    const qualityAgent = await User.findOne({ email: TEST_ACCOUNTS.qualityAgent }).select('_id email').lean();
    const catiInterviewer = await User.findOne({ email: TEST_ACCOUNTS.catiInterviewer }).select('_id email').lean();
    const capiInterviewer = await User.findOne({ email: TEST_ACCOUNTS.capiInterviewer }).select('_id email').lean();

    if (!qualityAgent) {
      console.error(`❌ Quality Agent account not found: ${TEST_ACCOUNTS.qualityAgent}`);
    }
    if (!catiInterviewer) {
      console.error(`❌ CATI Interviewer account not found: ${TEST_ACCOUNTS.catiInterviewer}`);
    }
    if (!capiInterviewer) {
      console.error(`❌ CAPI Interviewer account not found: ${TEST_ACCOUNTS.capiInterviewer}`);
    }

    console.log('📋 Test Accounts:');
    console.log(`   Quality Agent: ${qualityAgent ? qualityAgent._id : 'NOT FOUND'} (${TEST_ACCOUNTS.qualityAgent})`);
    console.log(`   CATI Interviewer: ${catiInterviewer ? catiInterviewer._id : 'NOT FOUND'} (${TEST_ACCOUNTS.catiInterviewer})`);
    console.log(`   CAPI Interviewer: ${capiInterviewer ? capiInterviewer._id : 'NOT FOUND'} (${TEST_ACCOUNTS.capiInterviewer})\n`);

    const report = {
      startTime: new Date().toISOString(),
      testAccounts: {
        qualityAgent: qualityAgent ? qualityAgent._id.toString() : null,
        catiInterviewer: catiInterviewer ? catiInterviewer._id.toString() : null,
        capiInterviewer: capiInterviewer ? capiInterviewer._id.toString() : null
      },
      responses: {
        found: 0,
        deleted: 0,
        failed: 0,
        details: []
      },
      reviews: {
        found: 0,
        reverted: 0,
        failed: 0,
        details: []
      }
    };

    // Step 1: Find and delete all responses created by test interviewer accounts
    console.log('🔍 Step 1: Finding responses created by test interviewer accounts...\n');

    const interviewerIds = [];
    if (catiInterviewer) interviewerIds.push(catiInterviewer._id);
    if (capiInterviewer) interviewerIds.push(capiInterviewer._id);

    if (interviewerIds.length > 0) {
      const testResponses = await SurveyResponse.find({
        interviewer: { $in: interviewerIds }
      })
        .select('responseId status interviewMode createdAt interviewer verificationData')
        .populate('interviewer', 'email')
        .lean();

      report.responses.found = testResponses.length;
      console.log(`   Found ${testResponses.length} responses created by test interviewers\n`);

      if (testResponses.length > 0) {
        console.log('🗑️  Deleting test responses...\n');

        for (const response of testResponses) {
          try {
            const deleteResult = await SurveyResponse.deleteOne({ _id: response._id });
            if (deleteResult.deletedCount > 0) {
              report.responses.deleted++;
              report.responses.details.push({
                responseId: response.responseId,
                status: response.status,
                interviewMode: response.interviewMode,
                createdAt: response.createdAt,
                interviewer: response.interviewer?.email || 'unknown'
              });
              if (report.responses.deleted % 100 === 0) {
                console.log(`   Deleted ${report.responses.deleted}/${testResponses.length} responses...`);
              }
            } else {
              report.responses.failed++;
              console.error(`   ⚠️  Failed to delete response: ${response.responseId}`);
            }
          } catch (error) {
            report.responses.failed++;
            console.error(`   ❌ Error deleting response ${response.responseId}:`, error.message);
          }
        }

        console.log(`\n   ✅ Deleted ${report.responses.deleted} responses`);
        console.log(`   ❌ Failed: ${report.responses.failed} responses\n`);
      }
    } else {
      console.log('   ⚠️  No test interviewer accounts found, skipping response deletion\n');
    }

    // Step 2: Find and revert all reviews done by test quality agent
    console.log('🔍 Step 2: Finding reviews done by test quality agent...\n');

    if (qualityAgent) {
      // Find all responses that were reviewed by the test quality agent
      // Based on the model schema, it's verificationData.reviewer (not verifiedBy)
      const reviewedResponses = await SurveyResponse.find({
        'verificationData.reviewer': qualityAgent._id,
        status: { $in: ['Approved', 'Rejected'] } // Only revert Approved/Rejected, not Pending_Approval
      })
        .select('responseId status verificationData reviewAssignment createdAt')
        .lean();

      report.reviews.found = reviewedResponses.length;
      console.log(`   Found ${reviewedResponses.length} responses reviewed by test quality agent\n`);

      if (reviewedResponses.length > 0) {
        console.log('🔄 Reverting reviews (changing status back to Pending_Approval)...\n');

        for (const response of reviewedResponses) {
          try {
            // Store original data for report
            const originalStatus = response.status;
            const originalVerificationData = response.verificationData;
            const originalReviewAssignment = response.reviewAssignment;

            // Revert to Pending_Approval and clear verification data and review assignment
            // Following the same pattern as comprehensive-5min-stress-test.js cleanup
            const updateData = {
              $set: {
                status: 'Pending_Approval'
              }
            };

            // Restore verificationData if it existed before review (unlikely, but safe)
            if (originalVerificationData !== null && originalVerificationData !== undefined) {
              // Only restore if it wasn't set by this quality agent
              // For now, we'll unset it to be safe
              updateData.$unset = updateData.$unset || {};
              updateData.$unset.verificationData = '';
            } else {
              updateData.$unset = updateData.$unset || {};
              updateData.$unset.verificationData = '';
            }

            // Restore reviewAssignment if it existed
            if (originalReviewAssignment !== null && originalReviewAssignment !== undefined) {
              updateData.$set.reviewAssignment = originalReviewAssignment;
            } else {
              updateData.$unset = updateData.$unset || {};
              updateData.$unset.reviewAssignment = '';
            }

            const updateResult = await SurveyResponse.updateOne(
              { _id: response._id },
              updateData
            );

            if (updateResult.modifiedCount > 0) {
              report.reviews.reverted++;
              report.reviews.details.push({
                responseId: response.responseId,
                originalStatus: originalStatus,
                revertedAt: new Date().toISOString()
              });
              if (report.reviews.reverted % 100 === 0) {
                console.log(`   Reverted ${report.reviews.reverted}/${reviewedResponses.length} reviews...`);
              }
            } else {
              report.reviews.failed++;
              console.error(`   ⚠️  Failed to revert review for response: ${response.responseId}`);
            }
          } catch (error) {
            report.reviews.failed++;
            console.error(`   ❌ Error reverting review for ${response.responseId}:`, error.message);
          }
        }

        console.log(`\n   ✅ Reverted ${report.reviews.reverted} reviews`);
        console.log(`   ❌ Failed: ${report.reviews.failed} reviews\n`);
      }
    } else {
      console.log('   ⚠️  Test quality agent account not found, skipping review reversion\n');
    }

    report.endTime = new Date().toISOString();
    report.duration = `${((new Date(report.endTime) - new Date(report.startTime)) / 1000).toFixed(2)} seconds`;

    // Save report
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

    console.log('✅ Cleanup complete!\n');
    console.log('📊 Summary:');
    console.log(`   Responses found: ${report.responses.found}`);
    console.log(`   Responses deleted: ${report.responses.deleted}`);
    console.log(`   Responses failed: ${report.responses.failed}`);
    console.log(`   Reviews found: ${report.reviews.found}`);
    console.log(`   Reviews reverted: ${report.reviews.reverted}`);
    console.log(`   Reviews failed: ${report.reviews.failed}`);
    console.log(`\n📄 Detailed report saved to: ${REPORT_FILE}`);
    console.log(`\n✅ Process completed!`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

cleanupTestAccounts();

