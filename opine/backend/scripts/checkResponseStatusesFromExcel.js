const mongoose = require('mongoose');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const SurveyResponse = require('../models/SurveyResponse');

// Path to Excel file
const EXCEL_FILE_PATH = '/var/www/Report-Generation/ManualMultireject/CATI Vijay Rejections_2.1 (1).xlsx';

/**
 * Connect to MongoDB
 */
async function connectDatabase() {
  try {
    const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');
  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
    throw error;
  }
}

/**
 * Read response IDs from Excel file
 */
function readResponseIdsFromExcel() {
  if (!require('fs').existsSync(EXCEL_FILE_PATH)) {
    throw new Error(`Excel file not found: ${EXCEL_FILE_PATH}`);
  }

  console.log(`📖 Reading Excel file: ${EXCEL_FILE_PATH}\n`);
  const workbook = XLSX.readFile(EXCEL_FILE_PATH);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // Convert to JSON
  const data = XLSX.utils.sheet_to_json(worksheet);
  
  console.log(`📋 Found ${data.length} rows in Excel file\n`);
  
  // Extract response IDs - try different possible column names
  const responseIds = [];
  const responseIdColumnNames = [
    'responseId', 'Response ID', 'ResponseID', 'response_id', 
    'ID', 'id', '_id', 'mongoId', 'MongoID', 'mongo_id',
    'Response', 'RESPONSE_ID'
  ];
  
  for (const row of data) {
    let responseId = null;
    
    // Try to find response ID in any of the possible column names
    for (const colName of responseIdColumnNames) {
      if (row[colName] !== undefined && row[colName] !== null && row[colName] !== '') {
        responseId = String(row[colName]).trim();
        break;
      }
    }
    
    // If not found, try first column that looks like an ID (MongoDB ObjectId or responseId format)
    if (!responseId) {
      for (const key in row) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== '') {
          const strValue = String(value).trim();
          // Check if it looks like a MongoDB ObjectId (24 hex chars) or responseId format
          if (mongoose.Types.ObjectId.isValid(strValue) || /^[A-Z0-9]{8,}$/i.test(strValue)) {
            responseId = strValue;
            break;
          }
        }
      }
    }
    
    if (responseId) {
      responseIds.push(responseId);
    } else {
      console.log(`⚠️  Could not extract response ID from row:`, row);
    }
  }
  
  console.log(`📋 Extracted ${responseIds.length} response IDs from Excel\n`);
  if (responseIds.length > 0) {
    console.log(`📋 Sample response IDs: ${responseIds.slice(0, 10).join(', ')}${responseIds.length > 10 ? '...' : ''}\n`);
  }
  
  return responseIds;
}

/**
 * Check response statuses in database
 */
async function checkResponseStatuses(responseIds) {
  console.log('🔍 Checking response statuses in database...\n');
  
  const results = {
    total: responseIds.length,
    rejected: 0,
    notRejected: 0,
    notFound: 0,
    notRejectedDetails: [],
    notFoundDetails: []
  };
  
  // Process in batches to avoid overwhelming the database
  const batchSize = 100;
  for (let i = 0; i < responseIds.length; i += batchSize) {
    const batch = responseIds.slice(i, i + batchSize);
    
    // Try to find by responseId first (most common)
    const responsesById = await SurveyResponse.find({
      responseId: { $in: batch }
    }).select('_id responseId status').lean();
    
    // Create a map of responseId -> response
    const responseMap = new Map();
    responsesById.forEach(resp => {
      responseMap.set(resp.responseId, resp);
    });
    
    // For any not found by responseId, try MongoDB _id
    const notFoundById = batch.filter(id => !responseMap.has(id));
    if (notFoundById.length > 0) {
      const validObjectIds = notFoundById.filter(id => mongoose.Types.ObjectId.isValid(id));
      if (validObjectIds.length > 0) {
        const responsesByMongoId = await SurveyResponse.find({
          _id: { $in: validObjectIds.map(id => new mongoose.Types.ObjectId(id)) }
        }).select('_id responseId status').lean();
        
        responsesByMongoId.forEach(resp => {
          responseMap.set(resp.responseId, resp);
          // Also map by _id in case the Excel had _id
          responseMap.set(resp._id.toString(), resp);
        });
      }
    }
    
    // Check each response in the batch
    for (const responseId of batch) {
      const response = responseMap.get(responseId) || 
                      (mongoose.Types.ObjectId.isValid(responseId) ? 
                        responseMap.get(new mongoose.Types.ObjectId(responseId).toString()) : null);
      
      if (!response) {
        results.notFound++;
        results.notFoundDetails.push({
          responseId: responseId,
          reason: 'Not found in database'
        });
      } else {
        const status = response.status || 'unknown';
        if (status === 'Rejected') {
          results.rejected++;
        } else {
          results.notRejected++;
          results.notRejectedDetails.push({
            responseId: response.responseId || response._id.toString(),
            mongoId: response._id.toString(),
            currentStatus: status
          });
        }
      }
    }
    
    // Progress update
    if ((i + batchSize) % 500 === 0 || i + batchSize >= responseIds.length) {
      console.log(`   Processed ${Math.min(i + batchSize, responseIds.length)} / ${responseIds.length} responses...`);
    }
  }
  
  return results;
}

/**
 * Main function
 */
async function main() {
  try {
    await connectDatabase();
    
    // Read response IDs from Excel
    const responseIds = readResponseIdsFromExcel();
    
    if (responseIds.length === 0) {
      console.log('❌ No response IDs found in Excel file');
      await mongoose.disconnect();
      process.exit(1);
    }
    
    // Check statuses
    const results = await checkResponseStatuses(responseIds);
    
    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESULTS:');
    console.log('='.repeat(60));
    console.log(`   Total response IDs in Excel: ${results.total}`);
    console.log(`   ✅ Rejected: ${results.rejected}`);
    console.log(`   ❌ NOT Rejected: ${results.notRejected}`);
    console.log(`   ⚠️  Not Found: ${results.notFound}`);
    console.log('='.repeat(60) + '\n');
    
    if (results.notRejected > 0) {
      console.log(`\n❌ Responses that are NOT in Rejected status (${results.notRejected}):\n`);
      results.notRejectedDetails.forEach((detail, index) => {
        console.log(`   ${index + 1}. Response ID: ${detail.responseId}`);
        console.log(`      Mongo ID: ${detail.mongoId}`);
        console.log(`      Current Status: ${detail.currentStatus}\n`);
      });
      
      // Save to file
      const fs = require('fs');
      const outputPath = path.join(__dirname, '../../Report-Generation/ManualMultireject/not_rejected_responses.json');
      fs.writeFileSync(outputPath, JSON.stringify({
        summary: {
          total: results.total,
          rejected: results.rejected,
          notRejected: results.notRejected,
          notFound: results.notFound
        },
        notRejectedDetails: results.notRejectedDetails,
        notFoundDetails: results.notFoundDetails
      }, null, 2));
      console.log(`\n💾 Detailed results saved to: ${outputPath}`);
    }
    
    if (results.notFound > 0) {
      console.log(`\n⚠️  Responses not found in database (${results.notFound}):\n`);
      results.notFoundDetails.slice(0, 20).forEach((detail, index) => {
        console.log(`   ${index + 1}. Response ID: ${detail.responseId}`);
      });
      if (results.notFoundDetails.length > 20) {
        console.log(`   ... and ${results.notFoundDetails.length - 20} more`);
      }
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Analysis complete');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error);
    console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run the script
main();





