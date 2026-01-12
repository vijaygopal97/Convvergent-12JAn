#!/usr/bin/env node

/**
 * Fix responses that should be abandoned but are in Pending_Approval
 * Updates their status to 'abandoned' based on abandon indicators
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

// Calculate 24 hours ago
const twentyFourHoursAgo = new Date();
twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

async function fixAbandonedInPendingApproval() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    console.log(`📅 Checking responses from last 24 hours (since ${twentyFourHoursAgo.toISOString()})...\n`);

    // Find all responses from last 24 hours that are in Pending_Approval
    const pendingResponses = await SurveyResponse.find({
      status: 'Pending_Approval',
      createdAt: { $gte: twentyFourHoursAgo }
    })
      .select('_id responseId sessionId status interviewMode abandonedReason knownCallStatus metadata')
      .lean();

    console.log(`📊 Found ${pendingResponses.length} responses in Pending_Approval from last 24 hours\n`);

    // Find which ones should be abandoned
    const toFix = [];
    const updateOperations = [];

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
      }

      // 2. Check metadata.abandoned
      if (response.metadata?.abandoned === true || response.metadata?.abandoned === 'true') {
        isAbandoned = true;
        if (!abandonReason) {
          abandonReason = response.metadata?.abandonedReason || 'metadata.abandoned = true';
        }
        indicators.push('metadata.abandoned = true');
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
        }
      }

      if (isAbandoned) {
        toFix.push({
          _id: response._id,
          responseId: response.responseId,
          sessionId: response.sessionId,
          interviewMode: response.interviewMode,
          abandonReason: abandonReason,
          knownCallStatus: knownCallStatus,
          indicators: indicators
        });

        // Prepare update operation
        const update = {
          $set: {
            status: 'abandoned'
          }
        };

        // Set abandonedReason if not already set
        if (abandonReason && !response.abandonedReason) {
          update.$set.abandonedReason = abandonReason;
        }

        // Set knownCallStatus for CATI if not already set
        if (knownCallStatus && response.interviewMode === 'cati' && !response.knownCallStatus) {
          update.$set.knownCallStatus = knownCallStatus;
        }

        updateOperations.push({
          updateOne: {
            filter: { _id: response._id },
            update: update
          }
        });
      }
    }

    console.log(`🚫 Found ${toFix.length} responses that SHOULD be abandoned:\n`);

    if (toFix.length === 0) {
      console.log('✅ No responses need fixing! All are correctly marked.\n');
      return;
    }

    // Group by interview mode
    const capiCount = toFix.filter(r => r.interviewMode === 'capi' || r.interviewMode === 'CAPI').length;
    const catiCount = toFix.filter(r => r.interviewMode === 'cati' || r.interviewMode === 'CATI').length;

    console.log(`   📱 CAPI: ${capiCount} responses`);
    console.log(`   📞 CATI: ${catiCount} responses\n`);

    // Show first 10 examples
    console.log('📋 First 10 examples to be fixed:');
    console.log('='.repeat(100));
    toFix.slice(0, 10).forEach((response, index) => {
      console.log(`\n${index + 1}. Response ID: ${response.responseId}`);
      console.log(`   Session ID: ${response.sessionId}`);
      console.log(`   Mode: ${response.interviewMode}`);
      console.log(`   Abandon Reason: ${response.abandonReason || 'Not specified'}`);
      console.log(`   Indicators: ${response.indicators.join(', ')}`);
    });

    if (toFix.length > 10) {
      console.log(`\n... and ${toFix.length - 10} more responses\n`);
    }

    // Check for --yes flag to skip confirmation
    const skipConfirmation = process.argv.includes('--yes') || process.argv.includes('-y');
    
    if (!skipConfirmation) {
      // Ask for confirmation
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise((resolve) => {
        rl.question(`\n⚠️  Are you sure you want to update ${toFix.length} responses to 'abandoned' status? (yes/no): `, resolve);
      });
      rl.close();

      if (answer.trim().toLowerCase() !== 'yes') {
        console.log('\n❌ Update cancelled by user');
        return;
      }
    } else {
      console.log(`\n✅ Auto-confirming update of ${toFix.length} responses (--yes flag provided)`);
    }

    // Perform bulk update
    console.log('\n🔄 Updating responses...');
    const result = await SurveyResponse.bulkWrite(updateOperations);
    
    console.log(`\n✅ Update complete!`);
    console.log(`   Matched: ${result.matchedCount}`);
    console.log(`   Modified: ${result.modifiedCount}`);
    console.log(`   CAPI: ${capiCount} responses`);
    console.log(`   CATI: ${catiCount} responses\n`);

    // Verify the update
    const verifyCount = await SurveyResponse.countDocuments({
      _id: { $in: toFix.map(r => r._id) },
      status: 'abandoned'
    });

    console.log(`✅ Verification: ${verifyCount} out of ${toFix.length} responses are now marked as 'abandoned'`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the fix
fixAbandonedInPendingApproval();

