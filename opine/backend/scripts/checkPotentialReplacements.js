/**
 * Script to check for responses that might have had their reviewer replaced
 * This is a heuristic check since we don't have historical data before tracking was enabled
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const QA_ID = '693ca75a518527155598e961';

async function checkPotentialReplacements() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const qaObjectId = new mongoose.Types.ObjectId(QA_ID);
    
    console.log('🔍 CHECKING FOR POTENTIAL REVIEWER REPLACEMENTS...\n');
    
    // Strategy 1: Responses in Pending_Approval that have verificationData.reviewer
    // These might have been reviewed, then set back to pending for re-review
    console.log('Strategy 1: Responses in Pending_Approval with reviewer set\n');
    const pendingWithReviewer = await SurveyResponse.find({
      status: 'Pending_Approval',
      'verificationData.reviewer': { $exists: true, $ne: null }
    })
    .select('responseId verificationData.reviewer verificationData.reviewedAt createdAt updatedAt')
    .sort({ 'verificationData.reviewedAt': -1 })
    .limit(100)
    .lean();

    console.log(`   Found: ${pendingWithReviewer.length} responses\n`);
    
    if (pendingWithReviewer.length > 0) {
      const qaInPending = pendingWithReviewer.filter(r => 
        r.verificationData?.reviewer?.toString() === QA_ID
      );
      console.log(`   Of which ${qaInPending.length} are currently assigned to this QA\n`);
    }

    // Strategy 2: Responses reviewed by this QA but updated recently (might have been re-reviewed)
    console.log('Strategy 2: Responses reviewed by this QA but updated in last 24h\n');
    const recentlyUpdated = await SurveyResponse.find({
      'verificationData.reviewer': qaObjectId,
      updatedAt: { $gte: new Date(Date.now() - 24*60*60*1000) }
    })
    .select('responseId status verificationData.reviewer verificationData.reviewedAt createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(50)
    .lean();

    console.log(`   Found: ${recentlyUpdated.length} responses\n`);

    if (recentlyUpdated.length > 0) {
      console.log('   Sample (first 20):');
      recentlyUpdated.slice(0, 20).forEach((r, i) => {
        const daysSinceReview = Math.round((new Date() - new Date(r.verificationData?.reviewedAt)) / (1000*60*60*24));
        const hoursSinceUpdate = Math.round((new Date() - new Date(r.updatedAt)) / (1000*60*60));
        console.log(`   ${i + 1}. ${r.responseId}`);
        console.log(`      Status: ${r.status} | Reviewed: ${daysSinceReview}d ago | Updated: ${hoursSinceUpdate}h ago`);
      });
      console.log('');
    }

    // Strategy 3: Check all responses that are NOT currently reviewed by this QA
    // but have been reviewed (to see current state)
    console.log('Strategy 3: All reviewed responses NOT currently assigned to this QA\n');
    const notReviewedByThisQA = await SurveyResponse.find({
      'verificationData.reviewer': { $exists: true, $ne: null, $ne: qaObjectId }
    })
    .countDocuments();

    console.log(`   Total: ${notReviewedByThisQA} responses reviewed by other QAs\n`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkPotentialReplacements();


