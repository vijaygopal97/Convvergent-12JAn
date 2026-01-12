#!/usr/bin/env node

/**
 * Check how many responses from last 24 hours that should be abandoned
 * are currently in "Pending_Approval" status
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

// Calculate 24 hours ago
const twentyFourHoursAgo = new Date();
twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

async function checkAbandonedInPendingApproval() {
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
      .select('_id responseId sessionId status interviewMode createdAt updatedAt abandonedReason knownCallStatus metadata')
      .lean();

    console.log(`📊 Found ${pendingResponses.length} responses in Pending_Approval from last 24 hours\n`);

    // Check which ones should be abandoned
    const shouldBeAbandoned = [];

    for (const response of pendingResponses) {
      let isAbandoned = false;
      let abandonReason = null;
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
          indicators.push(`callStatus: "${callStatus}"`);
        }
      }

      if (isAbandoned) {
        shouldBeAbandoned.push({
          responseId: response.responseId,
          sessionId: response.sessionId,
          interviewMode: response.interviewMode,
          status: response.status,
          abandonReason: abandonReason,
          indicators: indicators,
          createdAt: response.createdAt,
          updatedAt: response.updatedAt,
          _id: response._id
        });
      }
    }

    console.log(`🚫 Found ${shouldBeAbandoned.length} responses that SHOULD be abandoned but are in Pending_Approval:\n`);

    if (shouldBeAbandoned.length > 0) {
      // Group by interview mode
      const capiCount = shouldBeAbandoned.filter(r => r.interviewMode === 'capi' || r.interviewMode === 'CAPI').length;
      const catiCount = shouldBeAbandoned.filter(r => r.interviewMode === 'cati' || r.interviewMode === 'CATI').length;

      console.log(`   📱 CAPI: ${capiCount} responses`);
      console.log(`   📞 CATI: ${catiCount} responses\n`);

      // Show first 20 examples
      console.log('📋 First 20 examples:');
      console.log('='.repeat(100));
      shouldBeAbandoned.slice(0, 20).forEach((response, index) => {
        console.log(`\n${index + 1}. Response ID: ${response.responseId}`);
        console.log(`   Session ID: ${response.sessionId}`);
        console.log(`   Mode: ${response.interviewMode}`);
        console.log(`   Current Status: ${response.status}`);
        console.log(`   Abandon Reason: ${response.abandonReason || 'Not specified'}`);
        console.log(`   Indicators: ${response.indicators.join(', ')}`);
        console.log(`   Created: ${response.createdAt.toISOString()}`);
        console.log(`   Updated: ${response.updatedAt.toISOString()}`);
      });

      if (shouldBeAbandoned.length > 20) {
        console.log(`\n... and ${shouldBeAbandoned.length - 20} more responses\n`);
      }

      // Save to JSON file for detailed analysis
      const fs = require('fs');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const outputFile = path.join(__dirname, `should_be_abandoned_pending_approval_${timestamp}.json`);
      
      fs.writeFileSync(outputFile, JSON.stringify({
        summary: {
          totalFound: shouldBeAbandoned.length,
          capiCount: capiCount,
          catiCount: catiCount,
          checkedAt: new Date().toISOString(),
          timeRange: {
            from: twentyFourHoursAgo.toISOString(),
            to: new Date().toISOString()
          }
        },
        responses: shouldBeAbandoned
      }, null, 2));

      console.log(`\n💾 Full results saved to: ${outputFile}`);
    } else {
      console.log('✅ No responses found that should be abandoned! All are correctly marked.\n');
    }

    // Summary statistics
    console.log('\n📊 Summary:');
    console.log(`   Total Pending_Approval (last 24h): ${pendingResponses.length}`);
    console.log(`   Should be Abandoned: ${shouldBeAbandoned.length}`);
    console.log(`   Correctly marked: ${pendingResponses.length - shouldBeAbandoned.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the check
checkAbandonedInPendingApproval();

