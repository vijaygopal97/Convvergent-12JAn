require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SurveyResponse = require('../models/SurveyResponse');

/**
 * Script to fix the verificationData structure for duplicate phone rejections
 * Removes reviewer, reviewedAt, and criteria fields to match actual auto-rejection structure
 */
async function fixDuplicateRejectionStructure() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('🔗 Connected to MongoDB\n');

    // Read the report to get all response IDs that were rejected
    const reportPath = '/var/www/opine/reports/Reject_Duplicate_Phones_Report_2026-01-14_1768418928718.json';
    
    if (!fs.existsSync(reportPath)) {
      console.error(`❌ Report file not found: ${reportPath}`);
      process.exit(1);
    }

    const reportData = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`📋 Loaded report with ${reportData.changes.length} duplicate groups\n`);

    const fixReport = {
      generatedAt: new Date().toISOString(),
      sourceReport: reportPath,
      summary: {
        totalDuplicatesToFix: 0,
        successfullyFixed: 0,
        alreadyCorrect: 0,
        notFound: 0,
        failedFixes: 0
      },
      fixes: []
    };

    // Collect all duplicate response IDs
    const duplicateResponseIds = [];
    for (const group of reportData.changes) {
      for (const duplicate of group.duplicates) {
        if (duplicate.action === 'rejected') {
          duplicateResponseIds.push(duplicate.responseId);
        }
      }
    }

    console.log(`📊 Found ${duplicateResponseIds.length} duplicate responses to fix\n`);

    // Process each duplicate response
    for (let i = 0; i < duplicateResponseIds.length; i++) {
      const responseId = duplicateResponseIds[i];
      
      try {
        const response = await SurveyResponse.findOne({ responseId: responseId });
        
        if (!response) {
          console.log(`   ⚠️  Response not found: ${responseId}`);
          fixReport.summary.notFound++;
          continue;
        }

        // Check if it has the wrong structure (has reviewer, reviewedAt, or criteria)
        const hasWrongStructure = response.verificationData && (
          response.verificationData.reviewer !== undefined ||
          response.verificationData.reviewedAt !== undefined ||
          response.verificationData.criteria !== undefined
        );

        // Check if it's already correct
        const isAlreadyCorrect = response.verificationData && 
                                 response.verificationData.autoRejected === true &&
                                 response.verificationData.autoRejectionReasons &&
                                 response.verificationData.autoRejectionReasons.includes('duplicate_phone') &&
                                 !hasWrongStructure;

        if (isAlreadyCorrect) {
          console.log(`   ✓ Already correct: ${responseId}`);
          fixReport.summary.alreadyCorrect++;
          continue;
        }

        // Get the original response ID from the feedback if it exists
        let originalResponseId = null;
        if (response.verificationData && response.verificationData.feedback) {
          const match = response.verificationData.feedback.match(/Original Response ID: ([a-f0-9-]+)/i);
          if (match) {
            originalResponseId = match[1];
          }
        }

        // If no original ID in feedback, try to find it from the report
        if (!originalResponseId) {
          for (const group of reportData.changes) {
            for (const dup of group.duplicates) {
              if (dup.responseId === responseId) {
                originalResponseId = group.originalResponseId;
                break;
              }
            }
            if (originalResponseId) break;
          }
        }

        // Preserve setNumber
        const preservedSetNumber = response.setNumber;

        // Fix the verificationData structure using MongoDB updateOne directly
        // This ensures all fields are saved correctly
        const mongoose = require('mongoose');
        const collection = mongoose.connection.collection('surveyresponses');
        
        const updateData = {
          verificationData: {
            feedback: originalResponseId 
              ? `Duplicate Phone Number; Original Response ID: ${originalResponseId}`
              : 'Duplicate Phone Number',
            autoRejected: true,
            autoRejectionReasons: ['duplicate_phone']
          }
        };
        
        // Preserve setNumber if it exists
        if (preservedSetNumber !== null && preservedSetNumber !== undefined) {
          updateData.setNumber = preservedSetNumber;
        }
        
        // Use MongoDB updateOne directly to ensure all fields are saved
        await collection.updateOne(
          { _id: response._id },
          { $set: updateData }
        );

        console.log(`   ✅ Fixed: ${responseId}${originalResponseId ? ` (Original: ${originalResponseId})` : ''}`);
        
        fixReport.summary.successfullyFixed++;
        fixReport.summary.totalDuplicatesToFix++;
        
        fixReport.fixes.push({
          responseId: responseId,
          originalResponseId: originalResponseId,
          previousStructure: hasWrongStructure ? 'incorrect' : 'missing',
          newStructure: 'correct'
        });

      } catch (error) {
        console.error(`   ❌ Error fixing ${responseId}:`, error.message);
        fixReport.summary.failedFixes++;
        fixReport.fixes.push({
          responseId: responseId,
          action: 'failed',
          reason: error.message
        });
      }
    }

    // Generate report file
    const timestamp = Date.now();
    const reportFileName = `Fix_Duplicate_Rejection_Structure_${new Date().toISOString().split('T')[0]}_${timestamp}.json`;
    const reportDir = path.join(__dirname, '../../reports');
    
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportFilePath = path.join(reportDir, reportFileName);
    fs.writeFileSync(reportFilePath, JSON.stringify(fixReport, null, 2));
    
    console.log('\n' + '='.repeat(100));
    console.log('📊 SUMMARY');
    console.log('='.repeat(100));
    console.log(`Total Duplicates to Fix: ${fixReport.summary.totalDuplicatesToFix}`);
    console.log(`Successfully Fixed: ${fixReport.summary.successfullyFixed}`);
    console.log(`Already Correct: ${fixReport.summary.alreadyCorrect}`);
    console.log(`Failed Fixes: ${fixReport.summary.failedFixes}`);
    console.log(`Not Found: ${fixReport.summary.notFound}`);
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
fixDuplicateRejectionStructure();

