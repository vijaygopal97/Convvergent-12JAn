/**
 * Update Response Status from Excel File
 * 
 * Reads an Excel file with Response IDs and new statuses, then updates the database.
 * 
 * Excel Format:
 * - Column A (0): Response ID
 * - Column D (3): New Status (Approved or Rejected)
 * - Column E (4): Rejection Reason (if Rejected)
 * 
 * Requirements:
 * 1. Read Excel file
 * 2. Update status for each response
 * 3. If Rejected, add reason to verificationData.feedback
 * 4. Set verificationData.reviewedAt
 * 5. Generate detailed report
 * 6. Only update responses in the Excel file - don't affect others
 */

require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Load models
const SurveyResponse = require('../models/SurveyResponse');

// Excel file path
const EXCEL_FILE_PATH = path.join(__dirname, '../generated-csvs/694ac4f39cf18db6a88dcfd6/new status(without nwr).xlsx');

async function updateResponsesFromExcel() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Step 1: Read Excel file
    console.log('📋 Step 1: Reading Excel file...');
    console.log(`   File: ${EXCEL_FILE_PATH}`);
    
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      throw new Error(`Excel file not found: ${EXCEL_FILE_PATH}`);
    }

    const workbook = XLSX.readFile(EXCEL_FILE_PATH);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    console.log(`✅ Read ${data.length} rows from Excel file`);
    
    // Remove header row
    const headerRow = data[0];
    const dataRows = data.slice(1);

    console.log(`   Header: ${JSON.stringify(headerRow)}`);
    console.log(`   Data rows: ${dataRows.length}\n`);

    // Step 2: Parse Excel data
    console.log('📋 Step 2: Parsing Excel data...');
    
    const updates = [];
    const errors = [];

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNumber = i + 2; // +2 because Excel rows start at 1 and we skipped header

      const responseId = row[0] ? String(row[0]).trim() : null;
      const newStatus = row[3] ? String(row[3]).trim() : null;
      const rejectionReason = row[4] ? String(row[4]).trim() : null;

      // Validate row data
      if (!responseId || responseId === '') {
        errors.push({
          row: rowNumber,
          error: 'Missing Response ID',
          data: row
        });
        continue;
      }

      if (!newStatus || newStatus === '') {
        errors.push({
          row: rowNumber,
          responseId: responseId,
          error: 'Missing New Status',
          data: row
        });
        continue;
      }

      const normalizedStatus = newStatus.charAt(0).toUpperCase() + newStatus.slice(1).toLowerCase();
      if (normalizedStatus !== 'Approved' && normalizedStatus !== 'Rejected') {
        errors.push({
          row: rowNumber,
          responseId: responseId,
          error: `Invalid status: ${newStatus}. Must be 'Approved' or 'Rejected'`,
          data: row
        });
        continue;
      }

      // If Rejected, ensure we have a reason
      if (normalizedStatus === 'Rejected' && (!rejectionReason || rejectionReason === '')) {
        errors.push({
          row: rowNumber,
          responseId: responseId,
          error: 'Rejected status requires a rejection reason',
          data: row
        });
        continue;
      }

      updates.push({
        responseId: responseId,
        newStatus: normalizedStatus,
        rejectionReason: normalizedStatus === 'Rejected' ? rejectionReason : null,
        row: rowNumber
      });
    }

    console.log(`✅ Parsed ${updates.length} valid updates`);
    console.log(`⚠️  Found ${errors.length} errors in Excel data\n`);

    if (updates.length === 0) {
      console.log('❌ No valid updates to process. Exiting.');
      process.exit(0);
    }

    // Step 3: Verify all response IDs exist in database
    console.log('📋 Step 3: Verifying Response IDs exist in database...');
    
    const responseIds = updates.map(u => u.responseId);
    const existingResponses = await SurveyResponse.find({
      responseId: { $in: responseIds }
    }).select('responseId status').lean();

    const existingResponseIds = new Set(existingResponses.map(r => r.responseId));
    const missingResponseIds = responseIds.filter(id => !existingResponseIds.has(id));

    if (missingResponseIds.length > 0) {
      console.log(`⚠️  Warning: ${missingResponseIds.length} Response IDs not found in database:`);
      missingResponseIds.slice(0, 10).forEach(id => console.log(`   - ${id}`));
      if (missingResponseIds.length > 10) {
        console.log(`   ... and ${missingResponseIds.length - 10} more`);
      }
      console.log('');
    }

    console.log(`✅ Found ${existingResponseIds.size} existing responses out of ${responseIds.length} requested\n`);

    // Step 4: Update responses
    console.log('📋 Step 4: Updating responses in database...');
    
    const updateResults = {
      successful: [],
      failed: [],
      notFound: [],
      skipped: [] // Same status already
    };

    const updateTimestamp = new Date();

    for (const update of updates) {
      try {
        // Check if response exists
        if (!existingResponseIds.has(update.responseId)) {
          updateResults.notFound.push({
            responseId: update.responseId,
            row: update.row,
            newStatus: update.newStatus,
            rejectionReason: update.rejectionReason
          });
          continue;
        }

        // Find current response to check status
        const currentResponse = await SurveyResponse.findOne({ responseId: update.responseId })
          .select('status verificationData').lean();

        if (!currentResponse) {
          updateResults.notFound.push({
            responseId: update.responseId,
            row: update.row,
            newStatus: update.newStatus,
            rejectionReason: update.rejectionReason
          });
          continue;
        }

        // Check if status is already the same
        if (currentResponse.status === update.newStatus) {
          updateResults.skipped.push({
            responseId: update.responseId,
            row: update.row,
            currentStatus: currentResponse.status,
            requestedStatus: update.newStatus,
            message: 'Status already matches'
          });
          continue;
        }

        // Prepare update document
        const updateDoc = {
          $set: {
            status: update.newStatus,
            'verificationData.reviewedAt': updateTimestamp
          }
        };

        // If Rejected, add feedback
        if (update.newStatus === 'Rejected' && update.rejectionReason) {
          updateDoc.$set['verificationData.feedback'] = update.rejectionReason;
        } else if (update.newStatus === 'Approved') {
          // Clear feedback if approving
          updateDoc.$set['verificationData.feedback'] = '';
        }

        // Use MongoDB native driver to bypass Mongoose pre-save hooks
        const result = await SurveyResponse.collection.updateOne(
          { responseId: update.responseId },
          updateDoc,
          { bypassDocumentValidation: true }
        );

        if (result.modifiedCount === 1) {
          updateResults.successful.push({
            responseId: update.responseId,
            row: update.row,
            previousStatus: currentResponse.status,
            newStatus: update.newStatus,
            rejectionReason: update.rejectionReason || null,
            updatedAt: updateTimestamp.toISOString()
          });
        } else {
          updateResults.failed.push({
            responseId: update.responseId,
            row: update.row,
            newStatus: update.newStatus,
            rejectionReason: update.rejectionReason,
            error: `Update failed - modifiedCount: ${result.modifiedCount}`
          });
        }

      } catch (error) {
        updateResults.failed.push({
          responseId: update.responseId,
          row: update.row,
          newStatus: update.newStatus,
          rejectionReason: update.rejectionReason,
          error: error.message,
          stack: error.stack
        });
      }
    }

    console.log(`✅ Successfully updated: ${updateResults.successful.length}`);
    console.log(`❌ Failed: ${updateResults.failed.length}`);
    console.log(`⚠️  Not found: ${updateResults.notFound.length}`);
    console.log(`⏭️  Skipped (same status): ${updateResults.skipped.length}\n`);

    // Step 5: Generate report
    console.log('📋 Step 5: Generating report...');
    
    const reportDir = path.join(__dirname, '../../reports');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `Response_Status_Update_Report_${new Date().toISOString().split('T')[0]}_${Date.now()}.json`);

    const report = {
      metadata: {
        sourceFile: EXCEL_FILE_PATH,
        executedAt: new Date().toISOString(),
        totalRowsInExcel: dataRows.length,
        validUpdates: updates.length,
        excelErrors: errors.length
      },
      summary: {
        successful: updateResults.successful.length,
        failed: updateResults.failed.length,
        notFound: updateResults.notFound.length,
        skipped: updateResults.skipped.length,
        byStatus: {
          approved: updateResults.successful.filter(u => u.newStatus === 'Approved').length,
          rejected: updateResults.successful.filter(u => u.newStatus === 'Rejected').length
        }
      },
      successfulUpdates: updateResults.successful,
      failedUpdates: updateResults.failed,
      notFoundResponses: updateResults.notFound,
      skippedUpdates: updateResults.skipped,
      excelErrors: errors
    };

    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');

    console.log(`✅ Report generated successfully!`);
    console.log(`📄 File: ${reportPath}`);
    console.log(`📊 File size: ${(fs.statSync(reportPath).size / 1024 / 1024).toFixed(2)} MB\n`);

    // Print summary
    console.log('📊 Update Summary:');
    console.log('='.repeat(60));
    console.log(`Total rows in Excel: ${dataRows.length}`);
    console.log(`Valid updates: ${updates.length}`);
    console.log(`Excel errors: ${errors.length}`);
    console.log(`\nDatabase Updates:`);
    console.log(`  ✅ Successful: ${updateResults.successful.length}`);
    console.log(`    - Approved: ${report.summary.byStatus.approved}`);
    console.log(`    - Rejected: ${report.summary.byStatus.rejected}`);
    console.log(`  ❌ Failed: ${updateResults.failed.length}`);
    console.log(`  ⚠️  Not found: ${updateResults.notFound.length}`);
    console.log(`  ⏭️  Skipped (same status): ${updateResults.skipped.length}`);
    console.log('='.repeat(60));

    // Close connection
    await mongoose.disconnect();
    console.log('\n✅ Done!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error updating responses:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
updateResponsesFromExcel();

