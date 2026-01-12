#!/usr/bin/env node

/**
 * Mark Responses That Should Have Been Abandoned as Abandoned
 * 
 * Reads the analysis report and updates responses to abandoned status
 * with appropriate abandonedReason based on what's missing (AC, Gender, Age)
 */

const path = require('path');
const fs = require('fs');

// Set up module resolution to use backend's node_modules
const backendPath = path.join(__dirname, '..');

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      const backendNodeModules = path.join(backendPath, 'node_modules');
      try {
        return originalRequire.apply(this, [path.join(backendNodeModules, id)]);
      } catch (e) {
        throw err;
      }
    }
    throw err;
  }
};

require('dotenv').config({ path: path.join(backendPath, '.env') });
const mongoose = require('mongoose');
const SurveyResponse = require(path.join(backendPath, 'models/SurveyResponse'));

// Path to the latest analysis report
const REPORT_PATH = '/var/www/opine/Report-Generation/ImprovedDuplicateRemove/should_be_abandoned_analysis_2026-01-02T15-15-06.json';

/**
 * Generate abandoned reason based on what's missing
 */
function generateAbandonReason(missingAC, missingGender, missingAge) {
  const reasons = [];
  
  if (missingAC) {
    reasons.push('Missing AC');
  }
  if (missingGender) {
    reasons.push('Missing Gender');
  }
  if (missingAge) {
    reasons.push('Missing Age');
  }
  
  if (reasons.length === 0) {
    return 'Missing Required Fields';
  }
  
  return reasons.join(', ');
}

async function markAsAbandoned() {
  try {
    console.log('='.repeat(80));
    console.log('MARK RESPONSES THAT SHOULD HAVE BEEN ABANDONED AS ABANDONED');
    console.log('='.repeat(80));
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Read the analysis report
    console.log(`📄 Reading analysis report: ${REPORT_PATH}`);
    if (!fs.existsSync(REPORT_PATH)) {
      throw new Error(`Report file not found: ${REPORT_PATH}`);
    }
    
    const report = JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8'));
    const problematicResponses = report.problematicResponses || [];
    
    console.log(`   Found ${problematicResponses.length} problematic responses in report\n`);
    
    if (problematicResponses.length === 0) {
      console.log('✅ No problematic responses to update.');
      await mongoose.disconnect();
      return;
    }
    
    // Group by what's missing for summary
    const byMissing = {
      missingAC: 0,
      missingGender: 0,
      missingAge: 0,
      missingAll: 0,
      missingACAndGender: 0,
      missingACAndAge: 0,
      missingGenderAndAge: 0
    };
    
    // Update in batches
    const BATCH_SIZE = 500;
    const responseIds = problematicResponses.map(r => r.mongoId || r.responseId);
    let updated = 0;
    let skipped = 0;
    let errors = [];
    
    console.log('🔄 Updating responses in batches...');
    console.log('');
    
    for (let i = 0; i < responseIds.length; i += BATCH_SIZE) {
      const batch = responseIds.slice(i, i + BATCH_SIZE);
      const batchResponses = problematicResponses.slice(i, i + BATCH_SIZE);
      
      try {
        // Process each response in the batch
        for (let j = 0; j < batch.length; j++) {
          const responseId = batch[j];
          const responseData = batchResponses[j];
          
          if (!responseId) {
            console.warn(`   ⚠️  Skipping response without ID: ${JSON.stringify(responseData)}`);
            skipped++;
            continue;
          }
          
          try {
            // Find the response
            const response = await SurveyResponse.findById(responseId)
              .select('status abandonedReason')
              .lean();
            
            if (!response) {
              console.warn(`   ⚠️  Response not found: ${responseId}`);
              skipped++;
              continue;
            }
            
            // Skip if already abandoned
            if (response.status === 'abandoned') {
              skipped++;
              continue;
            }
            
            // Generate abandoned reason
            const abandonedReason = generateAbandonReason(
              responseData.missingAC,
              responseData.missingGender,
              responseData.missingAge
            );
            
            // Update statistics
            if (responseData.missingAC) byMissing.missingAC++;
            if (responseData.missingGender) byMissing.missingGender++;
            if (responseData.missingAge) byMissing.missingAge++;
            
            if (responseData.missingAC && responseData.missingGender && responseData.missingAge) {
              byMissing.missingAll++;
            } else if (responseData.missingAC && responseData.missingGender) {
              byMissing.missingACAndGender++;
            } else if (responseData.missingAC && responseData.missingAge) {
              byMissing.missingACAndAge++;
            } else if (responseData.missingGender && responseData.missingAge) {
              byMissing.missingGenderAndAge++;
            }
            
            // Update the response
            await SurveyResponse.findByIdAndUpdate(responseId, {
              $set: {
                status: 'abandoned',
                abandonedReason: abandonedReason
              }
            });
            
            updated++;
            
            if (updated % 100 === 0) {
              console.log(`   Updated ${updated}/${problematicResponses.length} responses...`);
            }
            
          } catch (error) {
            console.error(`   ❌ Error updating response ${responseId}:`, error.message);
            errors.push({
              responseId: responseId,
              error: error.message
            });
          }
        }
        
        if ((i / BATCH_SIZE + 1) % 5 === 0 || i + BATCH_SIZE >= responseIds.length) {
          console.log(`   Processed ${Math.min(i + BATCH_SIZE, responseIds.length)}/${responseIds.length} responses...`);
        }
        
      } catch (error) {
        console.error(`   ❌ Error processing batch ${i / BATCH_SIZE + 1}:`, error.message);
        errors.push({
          batch: i / BATCH_SIZE + 1,
          error: error.message
        });
      }
    }
    
    console.log(`\n✅ Successfully updated ${updated} responses to abandoned status`);
    console.log(`   Skipped: ${skipped} (already abandoned or not found)`);
    console.log(`   Errors: ${errors.length}\n`);
    
    // Display summary by missing fields
    console.log('='.repeat(80));
    console.log('SUMMARY BY MISSING FIELDS');
    console.log('='.repeat(80));
    console.log(`Missing AC only: ${byMissing.missingAC - byMissing.missingACAndGender - byMissing.missingACAndAge - byMissing.missingAll}`);
    console.log(`Missing Gender only: ${byMissing.missingGender - byMissing.missingACAndGender - byMissing.missingGenderAndAge - byMissing.missingAll}`);
    console.log(`Missing Age only: ${byMissing.missingAge - byMissing.missingACAndAge - byMissing.missingGenderAndAge - byMissing.missingAll}`);
    console.log(`Missing AC + Gender: ${byMissing.missingACAndGender}`);
    console.log(`Missing AC + Age: ${byMissing.missingACAndAge}`);
    console.log(`Missing Gender + Age: ${byMissing.missingGenderAndAge}`);
    console.log(`Missing All (AC + Gender + Age): ${byMissing.missingAll}`);
    console.log('');
    
    // Generate report
    const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ImprovedDuplicateRemove');
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const updateReport = {
      timestamp: new Date().toISOString(),
      operation: 'Mark Should Be Abandoned Responses as Abandoned',
      sourceReport: REPORT_PATH,
      summary: {
        totalInReport: problematicResponses.length,
        totalUpdated: updated,
        totalSkipped: skipped,
        totalErrors: errors.length,
        byMissing: byMissing
      },
      errors: errors
    };
    
    // Save JSON report
    const jsonPath = path.join(REPORT_DIR, `mark_as_abandoned_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(updateReport, null, 2));
    console.log(`✅ Update report saved: ${jsonPath}`);
    
    // Final summary
    console.log('');
    console.log('='.repeat(80));
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total responses in report: ${problematicResponses.length}`);
    console.log(`Total updated to abandoned: ${updated}`);
    console.log(`Total skipped: ${skipped}`);
    console.log(`Total errors: ${errors.length}`);
    console.log('='.repeat(80));
    
    if (errors.length > 0) {
      console.log('\n⚠️  ERRORS ENCOUNTERED:');
      errors.slice(0, 10).forEach((err, idx) => {
        console.log(`   ${idx + 1}. ${err.responseId || err.batch}: ${err.error}`);
      });
      if (errors.length > 10) {
        console.log(`   ... and ${errors.length - 10} more errors`);
      }
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
  markAsAbandoned();
}

module.exports = { markAsAbandoned };

