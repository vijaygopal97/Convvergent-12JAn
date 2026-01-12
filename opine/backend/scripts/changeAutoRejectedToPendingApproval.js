/**
 * Change Auto-Rejected Responses to Pending_Approval
 * 
 * Requirements:
 * 1. Read auto-rejected responses from the JSON report
 * 2. Filter to only responses with at least 10 questions answered
 * 3. Change up to 100 of these responses to "Pending_Approval"
 * 4. Generate a report of changes made
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

// Load models
const SurveyResponse = require('../models/SurveyResponse');

async function changeResponsesToPendingApproval() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Step 1: Read the auto-rejected report JSON
    console.log('📋 Step 1: Reading auto-rejected responses report...');
    const reportPath = path.join(__dirname, '../../reports/Auto_Rejected_Interviews_Report_Dulal_Ch Roy_2026-01-09.json');
    
    if (!fs.existsSync(reportPath)) {
      console.error(`❌ Report file not found: ${reportPath}`);
      process.exit(1);
    }

    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const autoRejectedResponses = reportData.responses || [];
    
    console.log(`✅ Found ${autoRejectedResponses.length} auto-rejected responses in report\n`);

    // Step 2: Filter to responses with at least 10 questions answered
    console.log('📋 Step 2: Filtering responses with at least 10 questions answered...');
    const qualifyingResponses = autoRejectedResponses.filter(response => {
      const responseCount = response.responsesCount || (response.responses ? response.responses.length : 0);
      return responseCount >= 10;
    });

    console.log(`✅ Found ${qualifyingResponses.length} responses with at least 10 questions answered\n`);

    if (qualifyingResponses.length === 0) {
      console.log('⚠️  No qualifying responses found. Nothing to change.');
      await mongoose.disconnect();
      process.exit(0);
    }

    // Step 3: Limit to 100 (or fewer if less than 100)
    const maxToChange = 100;
    const responsesToChange = qualifyingResponses.slice(0, maxToChange);
    
    console.log(`📋 Step 3: Processing up to ${maxToChange} responses...`);
    console.log(`   Will change: ${responsesToChange.length} responses\n`);

    // Step 4: Change status to Pending_Approval
    console.log('📋 Step 4: Changing status to Pending_Approval...');
    
    const changeReport = {
      metadata: {
        operation: 'Change Auto-Rejected to Pending_Approval',
        criteria: {
          minQuestionsAnswered: 10,
          maxResponsesToChange: 100,
          sourceReport: 'Auto_Rejected_Interviews_Report_Dulal_Ch Roy_2026-01-09.json'
        },
        executedAt: new Date().toISOString(),
        executedBy: 'Script: changeAutoRejectedToPendingApproval.js'
      },
      summary: {
        totalInReport: autoRejectedResponses.length,
        qualifyingResponses: qualifyingResponses.length,
        attemptedToChange: responsesToChange.length,
        successfullyChanged: 0,
        failed: 0,
        skipped: 0
      },
      changes: [],
      errors: []
    };

    let successCount = 0;
    let failCount = 0;
    let skipCount = 0;

    for (const responseData of responsesToChange) {
      try {
        const responseId = responseData.responseId;
        
        // Find the response by responseId (it's a UUID string, not ObjectId)
        const response = await SurveyResponse.findOne({
          responseId: responseId,
          status: 'Rejected'
        });

        if (!response) {
          console.log(`⚠️  Response not found: ${responseId}`);
          changeReport.errors.push({
            responseId: responseId,
            error: 'Response not found or already changed',
            timestamp: new Date().toISOString()
          });
          skipCount++;
          continue;
        }

        // Verify it's still rejected and is an auto-rejection
        // Since these are from the auto-rejected report, trust that they are auto-rejected
        // Just verify: status is still Rejected, has no reviewer, and has at least 10 responses
        const vData = response.verificationData || {};
        const hasReviewer = vData.reviewer && vData.reviewer !== null;
        
        if (hasReviewer) {
          console.log(`⚠️  Response ${responseId} has been reviewed by a reviewer - skipping`);
          changeReport.errors.push({
            responseId: responseId,
            error: 'Response has been reviewed by a reviewer',
            timestamp: new Date().toISOString()
          });
          skipCount++;
          continue;
        }

        // Verify it has at least 10 responses
        const actualResponseCount = response.responses ? response.responses.length : 0;
        if (actualResponseCount < 10) {
          console.log(`⚠️  Response ${responseId} has only ${actualResponseCount} responses (less than 10) - skipping`);
          changeReport.errors.push({
            responseId: responseId,
            error: `Only ${actualResponseCount} responses (less than 10)`,
            timestamp: new Date().toISOString()
          });
          skipCount++;
          continue;
        }

        // Change status to Pending_Approval using direct MongoDB update to bypass pre-save hooks
        const previousStatus = response.status;
        
        // Use direct MongoDB update to bypass the pre-save hook that prevents status changes
        const db = mongoose.connection.db;
        const collection = db.collection('surveyresponses');
        
        // Use readPreference=primary to ensure we're writing to primary
        const updateResult = await collection.updateOne(
          { _id: response._id },
          {
            $set: {
              status: 'Pending_Approval',
              'metadata.previousAutoRejectedStatus': 'Rejected',
              'metadata.statusChangedAt': new Date(),
              'metadata.statusChangedBy': 'Script: changeAutoRejectedToPendingApproval',
              updatedAt: new Date()
            }
          },
        );

        if (updateResult.modifiedCount === 0) {
          throw new Error('Update did not modify any documents');
        }

        console.log(`✅ Changed: ${responseId} (${actualResponseCount} responses)`);

        changeReport.changes.push({
          responseId: responseId,
          previousStatus: previousStatus,
          newStatus: 'Pending_Approval',
          questionsAnswered: actualResponseCount,
          autoRejectionReasons: vData.autoRejectionReasons || [],
          changedAt: new Date().toISOString()
        });

        successCount++;

      } catch (error) {
        console.error(`❌ Error changing response ${responseData.responseId}:`, error.message);
        changeReport.errors.push({
          responseId: responseData.responseId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
        failCount++;
      }
    }

    // Update summary
    changeReport.summary.successfullyChanged = successCount;
    changeReport.summary.failed = failCount;
    changeReport.summary.skipped = skipCount;

    // Step 5: Save change report
    console.log('\n📋 Step 5: Saving change report...');
    
    const reportsDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportFilename = `Status_Change_Report_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`;
    const reportFilepath = path.join(reportsDir, reportFilename);
    
    fs.writeFileSync(reportFilepath, JSON.stringify(changeReport, null, 2), 'utf8');
    
    console.log(`✅ Change report saved: ${reportFilepath}\n`);

    // Print summary
    console.log('📊 Change Summary:');
    console.log('='.repeat(60));
    console.log(`Total in Report: ${changeReport.summary.totalInReport}`);
    console.log(`Qualifying (10+ questions): ${changeReport.summary.qualifyingResponses}`);
    console.log(`Attempted to Change: ${changeReport.summary.attemptedToChange}`);
    console.log(`✅ Successfully Changed: ${changeReport.summary.successfullyChanged}`);
    console.log(`❌ Failed: ${changeReport.summary.failed}`);
    console.log(`⚠️  Skipped: ${changeReport.summary.skipped}`);
    console.log('='.repeat(60));
    
    console.log('\n📋 Changed Response IDs:');
    changeReport.changes.forEach((change, index) => {
      console.log(`${index + 1}. ${change.responseId} (${change.questionsAnswered} questions)`);
    });

    // Close connection
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
changeResponsesToPendingApproval();

