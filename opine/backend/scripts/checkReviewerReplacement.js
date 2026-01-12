/**
 * Script to check for responses that might have had their reviewer replaced
 * This checks for responses that were reviewed by a specific QA but now have a different reviewer
 * 
 * Usage: node scripts/checkReviewerReplacement.js [qualityAgentId]
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');

const QUALITY_AGENT_ID = process.argv[2] || '693ca75a518527155598e961';

async function checkReviewerReplacement() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const qaObjectId = new mongoose.Types.ObjectId(QUALITY_AGENT_ID);
    
    // Get QA info
    const qa = await User.findById(qaObjectId).select('firstName lastName email').lean();
    console.log(`🔍 Checking for reviewer replacements for QA:`);
    console.log(`   Name: ${qa?.firstName} ${qa?.lastName}`);
    console.log(`   Email: ${qa?.email}`);
    console.log(`   ID: ${QUALITY_AGENT_ID}\n`);

    // Find all responses that have verificationData.reviewer set
    // These are responses that have been reviewed at least once
    const allReviewedResponses = await SurveyResponse.find({
      'verificationData.reviewer': { $exists: true, $ne: null }
    })
    .select('responseId status verificationData.reviewer verificationData.previousReviewer verificationData.originalReviewer verificationData.reviewHistory verificationData.reviewedAt createdAt updatedAt')
    .sort({ 'verificationData.reviewedAt': -1 })
    .lean();

    console.log(`📊 Total reviewed responses: ${allReviewedResponses.length}\n`);

    // Find responses that have review history or previousReviewer
    const responsesWithHistory = allReviewedResponses.filter(r => 
      (r.verificationData?.reviewHistory && r.verificationData.reviewHistory.length > 0) ||
      r.verificationData?.previousReviewer
    );

    console.log(`📝 Responses with review history: ${responsesWithHistory.length}\n`);

    // Find responses where this QA is in review history or is previousReviewer/originalReviewer
    // but current reviewer is different
    const replacedReviews = [];
    
    for (const response of allReviewedResponses) {
      const currentReviewer = response.verificationData?.reviewer?.toString();
      const previousReviewer = response.verificationData?.previousReviewer?.toString();
      const originalReviewer = response.verificationData?.originalReviewer?.toString();
      const reviewHistory = response.verificationData?.reviewHistory || [];
      
      const qaIdString = qaObjectId.toString();
      
      // Check if this QA was the original or previous reviewer but current reviewer is different
      if ((originalReviewer === qaIdString || previousReviewer === qaIdString) && 
          currentReviewer !== qaIdString) {
        replacedReviews.push({
          responseId: response.responseId,
          status: response.status,
          currentReviewer: currentReviewer,
          previousReviewer: previousReviewer,
          originalReviewer: originalReviewer,
          reviewHistoryCount: reviewHistory.length,
          reviewedAt: response.verificationData?.reviewedAt,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt
        });
      }
      
      // Also check review history
      const qaInHistory = reviewHistory.find(h => 
        h.reviewer?.toString() === qaIdString
      );
      
      if (qaInHistory && currentReviewer !== qaIdString) {
        replacedReviews.push({
          responseId: response.responseId,
          status: response.status,
          currentReviewer: currentReviewer,
          previousReviewer: previousReviewer,
          originalReviewer: originalReviewer,
          reviewHistoryCount: reviewHistory.length,
          reviewedAt: response.verificationData?.reviewedAt,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          foundInHistory: true
        });
      }
    }

    // Remove duplicates (same responseId might appear twice)
    const uniqueReplacedReviews = [];
    const seenResponseIds = new Set();
    for (const review of replacedReviews) {
      if (!seenResponseIds.has(review.responseId)) {
        uniqueReplacedReviews.push(review);
        seenResponseIds.add(review.responseId);
      }
    }

    console.log(`⚠️  Responses where this QA's review was replaced: ${uniqueReplacedReviews.length}\n`);

    if (uniqueReplacedReviews.length > 0) {
      console.log('📋 DETAILED REPORT:\n');
      console.log('='.repeat(100));
      
      uniqueReplacedReviews.slice(0, 50).forEach((r, i) => {
        console.log(`\n${i + 1}. Response ID: ${r.responseId}`);
        console.log(`   Status: ${r.status}`);
        console.log(`   Current Reviewer: ${r.currentReviewer}`);
        console.log(`   Previous Reviewer: ${r.previousReviewer || 'None'}`);
        console.log(`   Original Reviewer: ${r.originalReviewer || 'None'}`);
        console.log(`   Review History Entries: ${r.reviewHistoryCount}`);
        console.log(`   Created At: ${r.createdAt}`);
        console.log(`   Last Reviewed: ${r.reviewedAt || 'Unknown'}`);
        console.log(`   Updated At: ${r.updatedAt}`);
        if (r.foundInHistory) {
          console.log(`   ⚠️  Found in review history`);
        }
      });
      
      console.log('\n' + '='.repeat(100));
      console.log(`\n📊 SUMMARY:`);
      console.log(`   Total replaced reviews: ${uniqueReplacedReviews.length}`);
      console.log(`   Showing first 50 above\n`);
      
      // Save to file
      const fs = require('fs');
      const reportPath = `/var/www/MyLogos/reviewer_replacement_report_${QUALITY_AGENT_ID}_${Date.now()}.txt`;
      const reportContent = `REVIEWER REPLACEMENT REPORT
Generated: ${new Date().toISOString()}
Quality Agent ID: ${QUALITY_AGENT_ID}
Quality Agent: ${qa?.firstName} ${qa?.lastName} (${qa?.email})

Total Responses Where This QA's Review Was Replaced: ${uniqueReplacedReviews.length}

DETAILED LIST:
${'='.repeat(100)}
${uniqueReplacedReviews.map((r, i) => `
${i + 1}. Response ID: ${r.responseId}
   Status: ${r.status}
   Current Reviewer: ${r.currentReviewer}
   Previous Reviewer: ${r.previousReviewer || 'None'}
   Original Reviewer: ${r.originalReviewer || 'None'}
   Review History Entries: ${r.reviewHistoryCount}
   Created At: ${r.createdAt}
   Last Reviewed: ${r.reviewedAt || 'Unknown'}
   Updated At: ${r.updatedAt}
   ${r.foundInHistory ? '⚠️  Found in review history' : ''}
`).join('')}
`;
      
      fs.writeFileSync(reportPath, reportContent);
      console.log(`💾 Full report saved to: ${reportPath}\n`);
    } else {
      console.log('✅ No replaced reviews found (or tracking was just enabled)\n');
    }

    // Show current count for this QA
    const currentReviewedCount = await SurveyResponse.countDocuments({
      'verificationData.reviewer': qaObjectId
    });
    
    console.log(`📊 Current "Total Reviewed" count for this QA: ${currentReviewedCount}`);
    console.log(`   (This is based on verificationData.reviewer === QA ID)\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkReviewerReplacement();


