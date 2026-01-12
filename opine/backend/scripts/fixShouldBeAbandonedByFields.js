#!/usr/bin/env node

/**
 * Fix Responses That Should Be Abandoned Based on Missing Fields
 * 
 * Reads the analysis report from analyzeShouldBeAbandonedByFields.js
 * and marks all identified responses as abandoned with appropriate reasons
 */

const path = require('path');
const fs = require('fs');
const readline = require('readline');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

/**
 * Prompt for user confirmation
 */
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => rl.question(query, ans => {
    rl.close();
    resolve(ans);
  }));
}

async function fixShouldBeAbandoned() {
  try {
    console.log('='.repeat(80));
    console.log('FIX RESPONSES THAT SHOULD BE ABANDONED (MISSING FIELDS)');
    console.log('='.repeat(80));
    console.log('');
    
    // Get the latest analysis report
    const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ImprovedDuplicateRemove');
    const files = fs.readdirSync(REPORT_DIR)
      .filter(f => f.startsWith('should_be_abandoned_analysis_') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      console.log('❌ No analysis report found. Please run analyzeShouldBeAbandonedByFields.js first.');
      process.exit(1);
    }
    
    const latestReport = files[0];
    const reportPath = path.join(REPORT_DIR, latestReport);
    
    console.log(`📄 Using analysis report: ${latestReport}`);
    console.log(`   Path: ${reportPath}\n`);
    
    // Read the report
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    
    console.log('📊 Report Summary:');
    console.log(`   Total Checked: ${report.summary.totalChecked}`);
    console.log(`   Problematic Responses: ${report.summary.totalProblematic}`);
    console.log(`   Missing AC: ${report.summary.byMissingField.missingAC}`);
    console.log(`   Missing Gender: ${report.summary.byMissingField.missingGender}`);
    console.log(`   Missing Age: ${report.summary.byMissingField.missingAge}`);
    console.log(`   Missing All: ${report.summary.byMissingField.missingAll}`);
    console.log('');
    
    if (report.problematicResponses.length === 0) {
      console.log('✅ No problematic responses to fix.');
      return;
    }
    
    // Show sample responses
    console.log('📋 Sample responses to be marked as abandoned:');
    report.problematicResponses.slice(0, 5).forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.responseId} (${r.interviewMode}) - Reasons: ${r.reasons.join(', ')}`);
    });
    if (report.problematicResponses.length > 5) {
      console.log(`   ... and ${report.problematicResponses.length - 5} more`);
    }
    console.log('');
    
    // Ask for confirmation
    const answer = await askQuestion(`⚠️  Are you sure you want to mark ${report.problematicResponses.length} responses as abandoned? (yes/no): `);
    
    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('❌ Operation cancelled.');
      return;
    }
    
    // Connect to database
    console.log('\n🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Prepare updates
    const updates = [];
    const responseIds = report.problematicResponses.map(r => r.mongoId);
    
    // Determine abandoned reason for each response
    report.problematicResponses.forEach(resp => {
      let abandonedReason = 'Missing required fields';
      const reasons = [];
      
      if (resp.missingAC) {
        reasons.push('AC');
      }
      if (resp.missingGender) {
        reasons.push('Gender');
      }
      if (resp.missingAge) {
        reasons.push('Age');
      }
      
      if (reasons.length > 0) {
        abandonedReason = `Missing ${reasons.join(', ')}`;
      }
      
      updates.push({
        mongoId: resp.mongoId,
        responseId: resp.responseId,
        abandonedReason: abandonedReason
      });
    });
    
    // Update in batches
    const BATCH_SIZE = 500;
    let updated = 0;
    const updateLog = [];
    
    console.log('🔄 Updating responses in batches...');
    
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = updates.slice(i, i + BATCH_SIZE);
      
      try {
        // Update each response individually with its specific abandoned reason
        for (const update of batch) {
          const result = await SurveyResponse.findByIdAndUpdate(
            update.mongoId,
            { 
              $set: { 
                status: 'abandoned',
                abandonedReason: update.abandonedReason
              }
            }
          );
          
          if (result) {
            updated++;
            
            const originalResp = report.problematicResponses.find(r => r.mongoId === update.mongoId);
            updateLog.push({
              responseId: update.responseId,
              mongoId: update.mongoId,
              sessionId: originalResp?.sessionId || 'Unknown',
              interviewMode: originalResp?.interviewMode || 'Unknown',
              oldStatus: originalResp?.status || 'Pending_Approval',
              newStatus: 'abandoned',
              abandonedReason: update.abandonedReason,
              missingAC: originalResp?.missingAC || false,
              missingGender: originalResp?.missingGender || false,
              missingAge: originalResp?.missingAge || false,
              updatedAt: new Date()
            });
          }
        }
        
        if ((i / BATCH_SIZE + 1) % 5 === 0 || i + BATCH_SIZE >= updates.length) {
          console.log(`   Updated ${updated}/${updates.length} responses...`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error updating batch ${i / BATCH_SIZE + 1}:`, error.message);
        throw error;
      }
    }
    
    console.log(`\n✅ Successfully updated ${updated} responses to abandoned status\n`);
    
    // Generate fix report
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const fixReport = {
      timestamp: new Date().toISOString(),
      operation: 'Fix Responses That Should Be Abandoned (Missing Fields)',
      sourceReport: latestReport,
      sourceReportPath: reportPath,
      summary: {
        totalFound: report.problematicResponses.length,
        totalUpdated: updated,
        success: updated === report.problematicResponses.length,
        byMissingField: report.summary.byMissingField,
        byMode: report.summary.byMode
      },
      updates: updateLog
    };
    
    // Save JSON report
    const jsonPath = path.join(REPORT_DIR, `fix_should_be_abandoned_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(fixReport, null, 2));
    console.log(`✅ Fix report saved: ${jsonPath}`);
    
    // Save CSV report
    const csvRows = [
      'Response ID,Mongo ID,Session ID,Interview Mode,Old Status,New Status,Abandoned Reason,Missing AC,Missing Gender,Missing Age,Updated At'
    ];
    
    updateLog.forEach(log => {
      csvRows.push([
        log.responseId,
        log.mongoId,
        log.sessionId,
        log.interviewMode,
        log.oldStatus,
        log.newStatus,
        log.abandonedReason,
        log.missingAC ? 'Yes' : 'No',
        log.missingGender ? 'Yes' : 'No',
        log.missingAge ? 'Yes' : 'No',
        new Date(log.updatedAt).toISOString()
      ].join(','));
    });
    
    const csvPath = path.join(REPORT_DIR, `fix_should_be_abandoned_${TIMESTAMP}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`✅ CSV report saved: ${csvPath}`);
    
    // Save simple response IDs list
    const responseIdsList = updateLog.map(u => u.responseId).join('\n');
    const idsPath = path.join(REPORT_DIR, `response_ids_fixed_${TIMESTAMP}.txt`);
    fs.writeFileSync(idsPath, responseIdsList);
    console.log(`✅ Response IDs list saved: ${idsPath}`);
    
    // Final summary
    console.log('');
    console.log('='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total Responses Found: ${report.problematicResponses.length}`);
    console.log(`Total Responses Updated: ${updated}`);
    console.log(`New Status: abandoned`);
    console.log(`By Missing Field:`);
    console.log(`  Missing AC: ${report.summary.byMissingField.missingAC}`);
    console.log(`  Missing Gender: ${report.summary.byMissingField.missingGender}`);
    console.log(`  Missing Age: ${report.summary.byMissingField.missingAge}`);
    console.log(`  Missing All: ${report.summary.byMissingField.missingAll}`);
    console.log('='.repeat(80));
    
    if (updated !== report.problematicResponses.length) {
      console.log(`\n⚠️  WARNING: Expected to update ${report.problematicResponses.length} but only updated ${updated}`);
    } else {
      console.log('\n✅ All responses successfully updated!');
    }
    
    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Run the fix
if (require.main === module) {
  fixShouldBeAbandoned();
}

module.exports = { fixShouldBeAbandoned };

