#!/usr/bin/env node

/**
 * List Skipped Duplicates
 * 
 * This script finds duplicates from previous reports that were NOT abandoned
 * and outputs their response IDs along with their original response IDs.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ImprovedDuplicateRemove');

/**
 * Find all duplicate detection reports
 */
function findAllReports() {
  const files = fs.readdirSync(REPORT_DIR);
  const reports = files
    .filter(f => f.startsWith('duplicate_detection') && f.endsWith('.json'))
    .map(f => ({
      path: path.join(REPORT_DIR, f),
      name: f,
      timestamp: f.match(/duplicate_detection[^_]*_([^\.]+)\.json/)?.[1] || '',
      isLatest: f.includes('by_hash')
    }))
    .sort((a, b) => {
      // Sort by isLatest first (latest report first), then by timestamp
      if (a.isLatest && !b.isLatest) return -1;
      if (!a.isLatest && b.isLatest) return 1;
      return b.timestamp.localeCompare(a.timestamp);
    });
  
  return reports;
}

/**
 * Process reports and find non-abandoned duplicates
 */
async function findSkippedDuplicates() {
  console.log('🔍 Finding skipped duplicates (not abandoned)...\n');
  
  const allReports = findAllReports();
  console.log(`📋 Found ${allReports.length} reports to check\n`);
  
  const skippedDuplicates = [];
  
  for (const report of allReports) {
    const reportType = report.isLatest ? 'LATEST' : 'PREVIOUS';
    console.log(`📄 Processing [${reportType}]: ${report.name}`);
    
    if (!fs.existsSync(report.path)) {
      console.log(`   ⚠️  File not found, skipping\n`);
      continue;
    }
    
    const reportData = JSON.parse(fs.readFileSync(report.path, 'utf8'));
    const groups = reportData.groups || [];
    
    console.log(`   Found ${groups.length} duplicate groups`);
    
    let skippedInReport = 0;
    
    for (const group of groups) {
      const originalResponseId = group.original?.responseId || group.original?.mongoId;
      const originalMongoId = group.original?.mongoId;
      
      if (!originalResponseId) {
        continue;
      }
      
      for (const duplicate of group.duplicates || []) {
        const duplicateId = duplicate.mongoId || duplicate.responseId;
        const duplicateResponseId = duplicate.responseId || duplicate.mongoId;
        
        if (!duplicateId) {
          continue;
        }
        
        try {
          // Check current status in database
          const response = await SurveyResponse.findById(duplicateId)
            .select('status abandonedReason responseId')
            .lean();
          
          if (!response) {
            console.log(`   ⚠️  Response not found: ${duplicateId}`);
            continue;
          }
          
          // If not abandoned, add to skipped list
          if (response.status !== 'abandoned') {
            skippedInReport++;
            skippedDuplicates.push({
              duplicateResponseId: duplicateResponseId,
              duplicateMongoId: duplicateId,
              originalResponseId: originalResponseId,
              originalMongoId: originalMongoId,
              currentStatus: response.status,
              abandonedReason: response.abandonedReason || null,
              reportFile: report.name,
              reportType: reportType,
              groupNumber: group.groupNumber,
              mode: group.mode
            });
          }
        } catch (error) {
          console.error(`   ❌ Error checking ${duplicateId}:`, error.message);
        }
      }
    }
    
    console.log(`   ✅ Processed ${groups.length} groups (${skippedInReport} skipped - not abandoned)\n`);
  }
  
  return skippedDuplicates;
}

/**
 * Generate output files
 */
function generateOutput(skippedDuplicates) {
  console.log('📊 Generating output files...\n');
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  
  // CSV output
  const csvRows = [
    'Duplicate Response ID,Duplicate Mongo ID,Original Response ID,Original Mongo ID,Current Status,Abandoned Reason,Report File,Group Number,Mode'
  ];
  
  skippedDuplicates.forEach(dup => {
    csvRows.push([
      dup.duplicateResponseId,
      dup.duplicateMongoId,
      dup.originalResponseId,
      dup.originalMongoId || '',
      dup.currentStatus,
      dup.abandonedReason || '',
      dup.reportFile,
      dup.groupNumber,
      dup.mode
    ].join(','));
  });
  
  const csvPath = path.join(REPORT_DIR, `skipped_duplicates_${timestamp}.csv`);
  fs.writeFileSync(csvPath, csvRows.join('\n'));
  console.log(`   ✅ CSV saved: ${csvPath}`);
  
  // JSON output
  const jsonPath = path.join(REPORT_DIR, `skipped_duplicates_${timestamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalSkipped: skippedDuplicates.length,
    skippedDuplicates: skippedDuplicates
  }, null, 2));
  console.log(`   ✅ JSON saved: ${jsonPath}`);
  
  // Text output (simple list)
  const txtPath = path.join(REPORT_DIR, `skipped_duplicates_${timestamp}.txt`);
  const txtContent = skippedDuplicates.map((dup, idx) => {
    return `${idx + 1}. Duplicate: ${dup.duplicateResponseId} | Original: ${dup.originalResponseId} | Status: ${dup.currentStatus} | Mode: ${dup.mode}`;
  }).join('\n');
  fs.writeFileSync(txtPath, `SKIPPED DUPLICATES (Not Abandoned)\n${'='.repeat(80)}\nTotal: ${skippedDuplicates.length}\n\n${txtContent}\n`);
  console.log(`   ✅ TXT saved: ${txtPath}`);
  
  return { csvPath, jsonPath, txtPath };
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('='.repeat(80));
    console.log('LIST SKIPPED DUPLICATES');
    console.log('='.repeat(80));
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Find skipped duplicates
    const skippedDuplicates = await findSkippedDuplicates();
    
    console.log('\n' + '='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Skipped Duplicates: ${skippedDuplicates.length}`);
    
    // Group by status
    const byStatus = {};
    skippedDuplicates.forEach(dup => {
      if (!byStatus[dup.currentStatus]) {
        byStatus[dup.currentStatus] = [];
      }
      byStatus[dup.currentStatus].push(dup);
    });
    
    console.log('\nBy Status:');
    Object.keys(byStatus).sort().forEach(status => {
      console.log(`   ${status}: ${byStatus[status].length}`);
    });
    
    // Group by mode
    const byMode = {};
    skippedDuplicates.forEach(dup => {
      if (!byMode[dup.mode]) {
        byMode[dup.mode] = [];
      }
      byMode[dup.mode].push(dup);
    });
    
    console.log('\nBy Mode:');
    Object.keys(byMode).sort().forEach(mode => {
      console.log(`   ${mode}: ${byMode[mode].length}`);
    });
    
    console.log('='.repeat(80));
    
    if (skippedDuplicates.length === 0) {
      console.log('\n✅ No skipped duplicates found!');
      await mongoose.disconnect();
      return;
    }
    
    // Generate output files
    const outputFiles = generateOutput(skippedDuplicates);
    
    console.log('\n' + '='.repeat(80));
    console.log('OUTPUT FILES');
    console.log('='.repeat(80));
    console.log(`CSV: ${path.basename(outputFiles.csvPath)}`);
    console.log(`JSON: ${path.basename(outputFiles.jsonPath)}`);
    console.log(`TXT: ${path.basename(outputFiles.txtPath)}`);
    console.log('='.repeat(80));
    console.log('');
    
    // Show first 10 examples
    console.log('📋 First 10 examples:');
    skippedDuplicates.slice(0, 10).forEach((dup, idx) => {
      console.log(`   ${idx + 1}. Duplicate: ${dup.duplicateResponseId}`);
      console.log(`      Original: ${dup.originalResponseId}`);
      console.log(`      Status: ${dup.currentStatus} | Mode: ${dup.mode}`);
      console.log('');
    });
    
    if (skippedDuplicates.length > 10) {
      console.log(`   ... and ${skippedDuplicates.length - 10} more (see output files)`);
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = { main };

