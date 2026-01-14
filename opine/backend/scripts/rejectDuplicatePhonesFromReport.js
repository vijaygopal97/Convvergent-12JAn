require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');

/**
 * Script to reject duplicate phone number responses from the report
 * Keeps the original response and rejects all duplicates
 */
async function rejectDuplicatePhonesFromReport() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('🔗 Connected to MongoDB\n');

    // Read the report file
    const reportPath = '/var/www/reports/Duplicate_Phone_Pending_Approval_From_Jan1_2026_2026-01-14T18-15-40.json';
    
    if (!fs.existsSync(reportPath)) {
      console.error(`❌ Report file not found: ${reportPath}`);
      process.exit(1);
    }

    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`📋 Loaded report with ${reportData.duplicateGroups.length} duplicate groups\n`);

    const changeReport = {
      generatedAt: new Date().toISOString(),
      sourceReport: reportPath,
      summary: {
        totalGroups: reportData.duplicateGroups.length,
        totalDuplicatesToReject: 0,
        totalOriginalsKept: 0,
        successfullyRejected: 0,
        failedRejections: 0,
        alreadyRejected: 0,
        notFound: 0
      },
      changes: []
    };

    // Process each duplicate group
    for (let i = 0; i < reportData.duplicateGroups.length; i++) {
      const group = reportData.duplicateGroups[i];
      const phoneNumber = group.phoneNumber;
      const originalResponseId = group.originalResponse.responseId;
      
      console.log(`\n📞 Processing group ${i + 1}/${reportData.duplicateGroups.length}: Phone ${phoneNumber}`);
      console.log(`   Original: ${originalResponseId}`);
      console.log(`   Duplicates: ${group.duplicateResponses.length}`);

      // Verify original response exists and is still in Pending_Approval
      const originalResponse = await SurveyResponse.findOne({ responseId: originalResponseId }).lean();
      
      if (!originalResponse) {
        console.log(`   ⚠️  Original response not found: ${originalResponseId}`);
        changeReport.summary.notFound++;
        changeReport.changes.push({
          phoneNumber,
          originalResponseId,
          action: 'skipped',
          reason: 'Original response not found',
          duplicatesProcessed: 0
        });
        continue;
      }

      // Process each duplicate
      const groupChanges = {
        phoneNumber,
        originalResponseId,
        originalStatus: originalResponse.status,
        duplicates: []
      };

      for (const duplicate of group.duplicateResponses) {
        const duplicateResponseId = duplicate.responseId;
        
        try {
          // Find the duplicate response
          const duplicateResponse = await SurveyResponse.findOne({ responseId: duplicateResponseId });
          
          if (!duplicateResponse) {
            console.log(`   ⚠️  Duplicate response not found: ${duplicateResponseId}`);
            changeReport.summary.notFound++;
            groupChanges.duplicates.push({
              responseId: duplicateResponseId,
              action: 'skipped',
              reason: 'Response not found',
              previousStatus: 'unknown'
            });
            continue;
          }

          const previousStatus = duplicateResponse.status;
          const previousAutoRejected = duplicateResponse.verificationData?.autoRejected || false;

          // Skip if already rejected
          if (previousStatus === 'Rejected' && previousAutoRejected) {
            console.log(`   ⏭️  Already rejected: ${duplicateResponseId}`);
            changeReport.summary.alreadyRejected++;
            groupChanges.duplicates.push({
              responseId: duplicateResponseId,
              action: 'skipped',
              reason: 'Already auto-rejected',
              previousStatus: previousStatus
            });
            continue;
          }

          // Skip if in final status (abandoned, Terminated, Approved)
          if (['abandoned', 'Terminated', 'Approved'].includes(previousStatus)) {
            console.log(`   ⏭️  Skipping final status: ${duplicateResponseId} (${previousStatus})`);
            groupChanges.duplicates.push({
              responseId: duplicateResponseId,
              action: 'skipped',
              reason: `Final status: ${previousStatus}`,
              previousStatus: previousStatus
            });
            continue;
          }

          // Preserve setNumber if it exists
          const preservedSetNumber = duplicateResponse.setNumber;

          // Reject the duplicate with proper auto-rejection data
          // Match the exact structure used by applyAutoRejection function
          // Note: Only set feedback, autoRejected, and autoRejectionReasons (no reviewer, reviewedAt, or criteria)
          duplicateResponse.status = 'Rejected';
          
          // Set verificationData exactly as auto-rejection does
          // Include original response ID in feedback as requested for easy explanation
          duplicateResponse.verificationData = {
            feedback: `Duplicate Phone Number; Original Response ID: ${originalResponseId}`,
            autoRejected: true,
            autoRejectionReasons: ['duplicate_phone']
          };

          // Re-apply setNumber if it was preserved
          if (preservedSetNumber !== null && preservedSetNumber !== undefined) {
            duplicateResponse.setNumber = preservedSetNumber;
            duplicateResponse.markModified('setNumber');
          }

          // Update updatedAt
          duplicateResponse.updatedAt = new Date();

          // Save the response
          await duplicateResponse.save();

          console.log(`   ✅ Rejected duplicate: ${duplicateResponseId} (was: ${previousStatus})`);
          
          changeReport.summary.successfullyRejected++;
          changeReport.summary.totalDuplicatesToReject++;
          
          groupChanges.duplicates.push({
            responseId: duplicateResponseId,
            action: 'rejected',
            previousStatus: previousStatus,
            newStatus: 'Rejected',
            autoRejected: true,
            originalResponseId: originalResponseId,
            feedback: `Duplicate Phone Number; Original Response ID: ${originalResponseId}`,
            autoRejectionReasons: ['duplicate_phone']
          });

        } catch (error) {
          console.error(`   ❌ Error rejecting duplicate ${duplicateResponseId}:`, error.message);
          changeReport.summary.failedRejections++;
          groupChanges.duplicates.push({
            responseId: duplicateResponseId,
            action: 'failed',
            reason: error.message,
            previousStatus: 'unknown'
          });
        }
      }

      // Track original kept
      if (originalResponse.status === 'Pending_Approval') {
        changeReport.summary.totalOriginalsKept++;
      }

      changeReport.changes.push(groupChanges);
    }

    // Generate report file
    const timestamp = Date.now();
    const reportFileName = `Reject_Duplicate_Phones_Report_${new Date().toISOString().split('T')[0]}_${timestamp}.json`;
    const reportDir = path.join(__dirname, '../../reports');
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportFilePath = path.join(reportDir, reportFileName);
    fs.writeFileSync(reportFilePath, JSON.stringify(changeReport, null, 2));
    
    console.log('\n' + '='.repeat(100));
    console.log('📊 SUMMARY');
    console.log('='.repeat(100));
    console.log(`Total Groups Processed: ${changeReport.summary.totalGroups}`);
    console.log(`Total Duplicates to Reject: ${changeReport.summary.totalDuplicatesToReject}`);
    console.log(`Successfully Rejected: ${changeReport.summary.successfullyRejected}`);
    console.log(`Already Rejected: ${changeReport.summary.alreadyRejected}`);
    console.log(`Failed Rejections: ${changeReport.summary.failedRejections}`);
    console.log(`Not Found: ${changeReport.summary.notFound}`);
    console.log(`Originals Kept: ${changeReport.summary.totalOriginalsKept}`);
    console.log(`\n📄 Detailed report saved to: ${reportFilePath}`);
    console.log('='.repeat(100));

    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully');

  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
rejectDuplicatePhonesFromReport();

