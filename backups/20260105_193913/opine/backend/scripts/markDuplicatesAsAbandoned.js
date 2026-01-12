#!/usr/bin/env node

/**
 * Mark Duplicates as Abandoned
 * 
 * This script:
 * 1. Marks duplicates from the latest report as "abandoned" with proper abandonedReason
 * 2. Updates abandonedReason for already-abandoned duplicates from previous reports
 * 
 * IMPORTANT: Only marks duplicates as abandoned, never originals.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ImprovedDuplicateRemove');

/**
 * Process a report file and mark duplicates as abandoned
 */
async function processReport(reportPath, isLatestReport = false) {
  console.log(`\n📄 Processing report: ${path.basename(reportPath)}`);
  
  if (!fs.existsSync(reportPath)) {
    console.log(`   ⚠️  File not found: ${reportPath}`);
    return { processed: 0, updated: 0, skipped: 0, errors: [] };
  }
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const groups = report.groups || [];
  
  console.log(`   Found ${groups.length} duplicate groups`);
  
  let processed = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  
  for (const group of groups) {
    const originalResponseId = group.original?.responseId || group.original?.mongoId;
    if (!originalResponseId) {
      console.log(`   ⚠️  Skipping group ${group.groupNumber}: No original response ID`);
      continue;
    }
    
    const abandonedReason = `Duplicate Response: Original: ${originalResponseId}`;
    
    for (const duplicate of group.duplicates || []) {
      processed++;
      const duplicateId = duplicate.mongoId || duplicate.responseId;
      
      if (!duplicateId) {
        console.log(`   ⚠️  Skipping duplicate: No ID found`);
        skipped++;
        continue;
      }
      
      try {
        // Check current status
        const response = await SurveyResponse.findById(duplicateId)
          .select('status abandonedReason')
          .lean();
        
        if (!response) {
          console.log(`   ⚠️  Response not found: ${duplicateId}`);
          skipped++;
          continue;
        }
        
        if (isLatestReport) {
          // For latest report: Mark as abandoned regardless of current status
          if (response.status !== 'abandoned') {
            await SurveyResponse.findByIdAndUpdate(duplicateId, {
              $set: {
                status: 'abandoned',
                abandonedReason: abandonedReason
              }
            });
            updated++;
            console.log(`   ✅ Marked as abandoned: ${duplicateId} (Original: ${originalResponseId})`);
          } else {
            // Already abandoned, just update the reason
            await SurveyResponse.findByIdAndUpdate(duplicateId, {
              $set: {
                abandonedReason: abandonedReason
              }
            });
            updated++;
            console.log(`   ✅ Updated abandonedReason: ${duplicateId} (Original: ${originalResponseId})`);
          }
        } else {
          // For previous reports: Only update if already abandoned
          if (response.status === 'abandoned') {
            // Update abandonedReason to include original response ID
            await SurveyResponse.findByIdAndUpdate(duplicateId, {
              $set: {
                abandonedReason: abandonedReason
              }
            });
            updated++;
            console.log(`   ✅ Updated abandonedReason: ${duplicateId} (Original: ${originalResponseId})`);
          } else {
            // Not abandoned, leave it alone
            skipped++;
            console.log(`   ⏭️  Skipped (not abandoned): ${duplicateId}`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error processing ${duplicateId}:`, error.message);
        errors.push({ duplicateId, error: error.message });
      }
    }
  }
  
  return { processed, updated, skipped, errors };
}

/**
 * Find all duplicate detection reports
 */
function findDuplicateReports() {
  const files = fs.readdirSync(REPORT_DIR);
  const reports = files
    .filter(f => f.startsWith('duplicate_detection') && f.endsWith('.json'))
    .map(f => {
      // Extract timestamp more accurately - handle both patterns:
      // - duplicate_detection_report_2026-01-01T15-57-57.json
      // - duplicate_detection_by_hash_2026-01-02T13-47-09.json
      // - duplicate_detection_error_2025-12-30T20-23-14.json
      let timestamp = '';
      const match1 = f.match(/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})\.json/);
      if (match1) {
        timestamp = match1[1];
      } else {
        // Fallback to old pattern
        timestamp = f.match(/duplicate_detection[^_]*_([^\.]+)\.json/)?.[1] || '';
      }
      
      return {
        path: path.join(REPORT_DIR, f),
        name: f,
        timestamp: timestamp,
        isByHash: f.includes('by_hash'),
        isError: f.includes('error')
      };
    })
    .filter(r => !r.isError) // Exclude error reports
    .sort((a, b) => {
      // Sort by timestamp (latest first), with by_hash reports taking priority if same date
      if (a.timestamp !== b.timestamp) {
        return b.timestamp.localeCompare(a.timestamp);
      }
      // If same timestamp, prefer by_hash reports
      if (a.isByHash && !b.isByHash) return -1;
      if (!a.isByHash && b.isByHash) return 1;
      return 0;
    });
  
  return reports;
}

/**
 * Main execution function
 */
async function main() {
  try {
    console.log('='.repeat(80));
    console.log('MARK DUPLICATES AS ABANDONED');
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
    
    // Find all reports
    const reports = findDuplicateReports();
    console.log(`📋 Found ${reports.length} duplicate detection reports:`);
    reports.forEach((r, idx) => {
      console.log(`   ${idx + 1}. ${r.name}`);
    });
    console.log('');
    
    if (reports.length === 0) {
      console.log('⚠️  No reports found. Nothing to do.');
      await mongoose.disconnect();
      return;
    }
    
    // Process latest report (mark as abandoned)
    const latestReport = reports[0];
    console.log(`\n🔄 Processing LATEST report: ${latestReport.name}`);
    console.log('   (Will mark all duplicates as abandoned)');
    const latestStats = await processReport(latestReport.path, true);
    
    // Process previous reports (only update if already abandoned)
    const previousReports = reports.slice(1);
    let totalStats = {
      processed: latestStats.processed,
      updated: latestStats.updated,
      skipped: latestStats.skipped,
      errors: [...latestStats.errors]
    };
    
    if (previousReports.length > 0) {
      console.log(`\n🔄 Processing ${previousReports.length} PREVIOUS reports:`);
      console.log('   (Will only update abandonedReason for already-abandoned duplicates)');
      
      for (const report of previousReports) {
        const stats = await processReport(report.path, false);
        totalStats.processed += stats.processed;
        totalStats.updated += stats.updated;
        totalStats.skipped += stats.skipped;
        totalStats.errors.push(...stats.errors);
      }
    }
    
    // Final summary
    console.log('\n' + '='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Duplicates Processed: ${totalStats.processed}`);
    console.log(`Total Updated: ${totalStats.updated}`);
    console.log(`Total Skipped: ${totalStats.skipped}`);
    console.log(`Total Errors: ${totalStats.errors.length}`);
    
    if (totalStats.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      totalStats.errors.forEach(err => {
        console.log(`   - ${err.duplicateId}: ${err.error}`);
      });
    }
    
    console.log('='.repeat(80));
    console.log('');
    
    await mongoose.disconnect();
    console.log('✅ Script completed successfully!');
    
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

