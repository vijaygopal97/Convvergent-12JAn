#!/usr/bin/env node

/**
 * Mark ContentHash Duplicates as Abandoned
 * 
 * This script reads the duplicate detection report and marks all duplicates
 * (except those already abandoned or terminated) as abandoned with reason
 * "{ContentHash matched}"
 * 
 * Usage: node markContentHashDuplicatesAsAbandoned.js
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const REPORT_PATH = '/var/www/Report-Generation/ImprovedDuplicateRemove/duplicate_detection_by_hash_with_status_2026-01-02T21-31-29.json';

// Statistics
const stats = {
  totalDuplicates: 0,
  alreadyAbandoned: 0,
  toAbandon: 0,
  updated: 0,
  errors: 0,
  skipped: 0
};

/**
 * Main function
 */
async function main() {
  try {
    console.log('\n' + '='.repeat(70));
    console.log('  MARK CONTENTHASH DUPLICATES AS ABANDONED');
    console.log('='.repeat(70));
    console.log('');
    
    // Load report
    console.log('📄 Loading duplicate detection report...');
    if (!fs.existsSync(REPORT_PATH)) {
      throw new Error(`Report file not found: ${REPORT_PATH}`);
    }
    
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    console.log(`✅ Loaded report with ${report.groups.length} duplicate groups`);
    console.log('');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    // Collect all duplicates that need to be marked as abandoned
    const duplicatesToAbandon = [];
    
    console.log('🔍 Analyzing duplicates...');
    report.groups.forEach(group => {
      // Check all duplicate categories
      const allDuplicates = [
        ...group.duplicates.abandonedOrTerminated,
        ...group.duplicates.rejected,
        ...group.duplicates.pendingApproval,
        ...group.duplicates.approved,
        ...group.duplicates.other
      ];
      
      stats.totalDuplicates += allDuplicates.length;
      
      allDuplicates.forEach(dup => {
        if (dup.status === 'abandoned' || dup.status === 'Terminated') {
          stats.alreadyAbandoned++;
        } else {
          // Need to mark as abandoned
          duplicatesToAbandon.push({
            mongoId: dup.mongoId,
            responseId: dup.responseId,
            currentStatus: dup.status,
            groupNumber: group.groupNumber,
            contentHash: group.contentHash
          });
          stats.toAbandon++;
        }
      });
    });
    
    console.log(`   Total duplicates: ${stats.totalDuplicates}`);
    console.log(`   Already abandoned/terminated: ${stats.alreadyAbandoned}`);
    console.log(`   To mark as abandoned: ${stats.toAbandon}`);
    console.log('');
    
    if (duplicatesToAbandon.length === 0) {
      console.log('✅ No duplicates to mark as abandoned!');
      await mongoose.disconnect();
      return;
    }
    
    // Show status breakdown
    const statusCounts = {};
    duplicatesToAbandon.forEach(d => {
      statusCounts[d.currentStatus] = (statusCounts[d.currentStatus] || 0) + 1;
    });
    
    console.log('📊 Status breakdown of duplicates to abandon:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
    console.log('');
    
    // Confirm before proceeding
    console.log('⚠️  About to mark', stats.toAbandon, 'duplicates as abandoned...');
    console.log('   Abandoned reason will be: "{ContentHash matched}"');
    console.log('');
    
    // Process in batches
    const BATCH_SIZE = 500;
    let processed = 0;
    
    console.log(`🔄 Processing in batches of ${BATCH_SIZE}...`);
    console.log('');
    
    for (let i = 0; i < duplicatesToAbandon.length; i += BATCH_SIZE) {
      const batch = duplicatesToAbandon.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(duplicatesToAbandon.length / BATCH_SIZE);
      
      const updates = batch.map(dup => ({
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(dup.mongoId) },
          update: {
            $set: {
              status: 'abandoned',
              abandonedReason: '{ContentHash matched}',
              // Preserve existing metadata if it exists
              'metadata.abandoned': true,
              'metadata.abandonReason': '{ContentHash matched}'
            }
          }
        }
      }));
      
      try {
        const result = await SurveyResponse.bulkWrite(updates, { ordered: false });
        stats.updated += result.modifiedCount;
        processed += batch.length;
        
        console.log(`   Batch ${batchNumber}/${totalBatches}: Updated ${result.modifiedCount}/${batch.length} responses (${Math.round(processed / duplicatesToAbandon.length * 100)}% complete)`);
      } catch (error) {
        console.error(`   ❌ Error in batch ${batchNumber}:`, error.message);
        stats.errors += batch.length;
      }
    }
    
    console.log('');
    console.log('='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total duplicates analyzed: ${stats.totalDuplicates}`);
    console.log(`Already abandoned/terminated: ${stats.alreadyAbandoned}`);
    console.log(`Duplicates to abandon: ${stats.toAbandon}`);
    console.log(`Successfully updated: ${stats.updated}`);
    console.log(`Errors: ${stats.errors}`);
    console.log('');
    
    if (stats.updated === stats.toAbandon) {
      console.log('✅ All duplicates successfully marked as abandoned!');
    } else {
      console.log(`⚠️  Some duplicates could not be updated (${stats.toAbandon - stats.updated} remaining)`);
    }
    
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







