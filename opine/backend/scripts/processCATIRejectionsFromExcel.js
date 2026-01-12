#!/usr/bin/env node

/**
 * Process CATI Rejections from Excel File
 * 
 * This script:
 * 1. Reads Response IDs and Rejection Reasons from Excel
 * 2. Marks those responses as "Rejected" with auto-rejection reason
 * 3. Marks all other non-abandoned CATI responses as "Pending_Approval" and adds to QC queue
 * 
 * Usage: node processCATIRejectionsFromExcel.js
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const Company = require('../models/Company'); // Required for QC batch helper
const { addResponseToBatch } = require('../utils/qcBatchHelper');
const XLSX = require('xlsx');

const EXCEL_PATH = '/var/www/Report-Generation/ManualMultireject/CATI Vijay Rejections_2.1 (1).xlsx';
const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ManualMultireject');
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

// Statistics
const stats = {
  excelResponseIds: 0,
  foundInDatabase: 0,
  setToRejected: 0,
  alreadyAbandoned: 0,
  alreadyTerminated: 0,
  alreadyRejected: 0,
  notFoundInDatabase: 0,
  setToPendingApproval: 0,
  addedToQCQueue: 0,
  errors: []
};

// Results
const results = {
  rejected: [],
  pendingApproval: [],
  alreadyAbandoned: [],
  alreadyTerminated: [],
  alreadyRejected: [],
  notFoundInExcel: []
};

/**
 * Read Excel file using xlsx library
 */
function readExcelFile() {
  try {
    // Read Excel file
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = workbook.SheetNames[0]; // Use first sheet
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet);
    
    // Find Response ID column (case-insensitive)
    let responseIdCol = null;
    let reasonCol = null;
    
    if (data.length > 0) {
      const firstRow = data[0];
      for (const col in firstRow) {
        const colLower = col.toLowerCase();
        if (colLower.includes('response') && colLower.includes('id')) {
          responseIdCol = col;
        }
        if (colLower.includes('reason') && colLower.includes('rejection')) {
          reasonCol = col;
        }
      }
    }
    
    if (!responseIdCol) {
      throw new Error(`Response ID column not found. Available columns: ${Object.keys(data[0] || {}).join(', ')}`);
    }
    
    if (!reasonCol) {
      throw new Error(`Reason for Rejection column not found. Available columns: ${Object.keys(data[0] || {}).join(', ')}`);
    }
    
    // Extract response IDs and reasons
    const result = [];
    for (const row of data) {
      const responseId = row[responseIdCol];
      const reason = row[reasonCol];
      
      if (responseId && String(responseId).trim() && String(responseId).trim() !== 'nan' && String(responseId).trim() !== 'None') {
        result.push({
          responseId: String(responseId).trim(),
          reason: (reason && String(reason).trim() && String(reason).trim() !== 'nan') ? String(reason).trim() : 'Manual Rejection'
        });
      }
    }
    
    return result;
  } catch (error) {
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('  PROCESS CATI REJECTIONS FROM EXCEL');
    console.log('='.repeat(70));
    console.log('');

    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log('');

    // Read Excel file
    console.log('📄 Reading Excel file...');
    const excelData = await readExcelFile();
    stats.excelResponseIds = excelData.length;
    console.log(`✅ Found ${excelData.length} Response IDs in Excel`);
    console.log('');

    // Create map of responseId -> reason
    const rejectionMap = new Map();
    excelData.forEach(item => {
      rejectionMap.set(item.responseId, item.reason || 'Manual Rejection');
    });

    // Find all CATI responses that are not abandoned or terminated
    console.log('🔍 Finding all CATI responses (not abandoned/terminated)...');
    const allCatiResponses = await SurveyResponse.find({
      interviewMode: { $in: ['cati', 'CATI'] },
      status: { $nin: ['abandoned', 'Terminated'] }
    })
      .select('_id responseId status survey interviewMode')
      .lean();

    console.log(`✅ Found ${allCatiResponses.length} CATI responses (not abandoned/terminated)`);
    console.log('');

    // Process responses from Excel
    console.log('🔄 Processing responses from Excel...');
    const responseIdsFromExcel = Array.from(rejectionMap.keys());
    
    const responsesFromExcel = await SurveyResponse.find({
      responseId: { $in: responseIdsFromExcel },
      interviewMode: { $in: ['cati', 'CATI'] }
    })
      .select('_id responseId status survey interviewMode')
      .lean();

    stats.foundInDatabase = responsesFromExcel.length;
    stats.notFoundInDatabase = responseIdsFromExcel.length - responsesFromExcel.length;

    const foundResponseIds = new Set(responsesFromExcel.map(r => r.responseId));

    // Process each response from Excel
    const updates = [];
    for (const response of responsesFromExcel) {
      const reason = rejectionMap.get(response.responseId);

      if (response.status === 'abandoned') {
        stats.alreadyAbandoned++;
        results.alreadyAbandoned.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          status: response.status
        });
        continue;
      }

      if (response.status === 'Terminated') {
        stats.alreadyTerminated++;
        results.alreadyTerminated.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          status: response.status
        });
        continue;
      }

      if (response.status === 'Rejected') {
        // Update rejection reason even if already rejected
        // Use verificationData.feedback field (which exists in schema) and metadata for storage
        updates.push({
          updateOne: {
            filter: { _id: response._id },
            update: {
              $set: {
                'verificationData.feedback': reason || 'Manual Rejection',
                'verificationData.autoRejected': true,
                'verificationData.rejectedAt': new Date(),
                'verificationData.rejectedBy': 'system',
                'metadata.rejectionReason': reason || 'Manual Rejection',
                'metadata.autoRejected': true,
                'metadata.manualRejectionReason': reason || 'Manual Rejection'
              }
            }
          }
        });
        
        stats.alreadyRejected++;
        results.alreadyRejected.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          status: response.status,
          reason: reason || 'Manual Rejection',
          note: 'Rejection reason updated'
        });
        continue;
      }

      // Mark as Rejected
      updates.push({
        updateOne: {
          filter: { _id: response._id },
          update: {
            $set: {
              status: 'Rejected',
              'verificationData.feedback': reason || 'Manual Rejection',
              'verificationData.autoRejected': true,
              'verificationData.rejectedAt': new Date(),
              'verificationData.rejectedBy': 'system',
              'metadata.rejectionReason': reason || 'Manual Rejection',
              'metadata.autoRejected': true,
              'metadata.manualRejectionReason': reason || 'Manual Rejection'
            }
          }
        }
      });

      results.rejected.push({
        responseId: response.responseId,
        mongoId: response._id.toString(),
        reason: reason || 'Manual Rejection',
        previousStatus: response.status
      });
    }

    // Bulk update rejected responses
    if (updates.length > 0) {
      console.log(`   Updating ${updates.length} responses to Rejected...`);
      const updateResult = await SurveyResponse.bulkWrite(updates, { ordered: false });
      stats.setToRejected = updateResult.modifiedCount;
      console.log(`   ✅ Updated ${updateResult.modifiedCount} responses`);
    }

    console.log('');

    // Process responses NOT in Excel - set to Pending_Approval and add to QC queue
    console.log('🔄 Processing CATI responses NOT in Excel...');
    const responsesNotInExcel = allCatiResponses.filter(r => !foundResponseIds.has(r.responseId));
    
    console.log(`   Found ${responsesNotInExcel.length} CATI responses not in Excel`);
    
    const pendingUpdates = [];
    const alreadyPending = [];
    
    for (const response of responsesNotInExcel) {
      if (response.status === 'Pending_Approval') {
        // Already pending, track for QC queue
        alreadyPending.push(response);
        results.pendingApproval.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          previousStatus: response.status,
          note: 'Already Pending_Approval'
        });
        continue;
      }

      // Set to Pending_Approval (only if not already pending)
      if (response.status !== 'Pending_Approval') {
        pendingUpdates.push({
          updateOne: {
            filter: { _id: response._id },
            update: {
              $set: {
                status: 'Pending_Approval'
              }
            }
          }
        });

        results.pendingApproval.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          previousStatus: response.status
        });
      } else {
        // Already pending, just track for QC queue
        results.pendingApproval.push({
          responseId: response.responseId,
          mongoId: response._id.toString(),
          previousStatus: response.status,
          note: 'Already Pending_Approval'
        });
      }
    }

    // Bulk update to Pending_Approval
    if (pendingUpdates.length > 0) {
      console.log(`   Updating ${pendingUpdates.length} responses to Pending_Approval...`);
      const updateResult = await SurveyResponse.bulkWrite(pendingUpdates, { ordered: false });
      stats.setToPendingApproval = updateResult.modifiedCount;
      console.log(`   ✅ Updated ${updateResult.modifiedCount} responses`);
    }

    // Note: QC queue addition will happen automatically when responses are set to Pending_Approval
    // The backend system will add them to QC batches when they're accessed
    console.log(`   ℹ️  Responses set to Pending_Approval will be added to QC queue automatically`);
    console.log(`   ℹ️  Total responses ready for QC: ${responsesNotInExcel.length}`);
    console.log('');

    // Generate report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        excelResponseIds: stats.excelResponseIds,
        foundInDatabase: stats.foundInDatabase,
        notFoundInDatabase: stats.notFoundInDatabase,
        setToRejected: stats.setToRejected,
        alreadyAbandoned: stats.alreadyAbandoned,
        alreadyTerminated: stats.alreadyTerminated,
        alreadyRejected: stats.alreadyRejected,
        setToPendingApproval: stats.setToPendingApproval,
        addedToQCQueue: stats.addedToQCQueue
      },
      results: results
    };

    // Save report
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }

    const reportPath = path.join(REPORT_DIR, `cati_rejection_processing_${TIMESTAMP}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`✅ Report saved: ${reportPath}`);

    // Print summary
    console.log('');
    console.log('='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log(`Excel Response IDs: ${stats.excelResponseIds}`);
    console.log(`Found in Database: ${stats.foundInDatabase}`);
    console.log(`Not Found in Database: ${stats.notFoundInDatabase}`);
    console.log('');
    console.log(`Set to Rejected: ${stats.setToRejected}`);
    console.log(`Already Abandoned: ${stats.alreadyAbandoned}`);
    console.log(`Already Terminated: ${stats.alreadyTerminated}`);
    console.log(`Already Rejected: ${stats.alreadyRejected}`);
    console.log('');
    console.log(`Set to Pending_Approval: ${stats.setToPendingApproval}`);
    console.log(`Added to QC Queue: ${stats.addedToQCQueue}`);
    console.log('='.repeat(70));

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run
main();

