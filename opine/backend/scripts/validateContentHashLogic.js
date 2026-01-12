#!/usr/bin/env node

/**
 * Validate Content Hash Logic
 * 
 * This script validates that the content hash generation logic is correct
 * by regenerating hashes for existing responses and comparing with stored hashes.
 * 
 * If hashes match: Logic is correct ✅
 * If hashes don't match: Logic needs to be fixed ❌
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

const SURVEY_ID = '68fd1915d41841da463f0d46';
const SAMPLE_SIZE = 1000; // Check first 1000 responses

async function validateContentHash() {
  try {
    console.log('='.repeat(80));
    console.log('🔍 VALIDATING CONTENT HASH LOGIC');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log(`Sample size: ${SAMPLE_SIZE} responses\n`);
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Get responses with contentHash
    console.log('📊 Fetching responses with contentHash...');
    const responses = await SurveyResponse.find({
      survey: SURVEY_ID,
      contentHash: { $exists: true, $ne: null }
    })
    .select('_id responseId sessionId status interviewMode startTime endTime totalTimeSpent responses contentHash selectedAC location call_id')
    .limit(SAMPLE_SIZE)
    .lean();
    
    console.log(`   Found ${responses.length} responses with contentHash\n`);
    
    if (responses.length === 0) {
      console.log('⚠️  No responses with contentHash found. Cannot validate.');
      await mongoose.disconnect();
      return;
    }
    
    // Validate each response
    let matchCount = 0;
    let mismatchCount = 0;
    const mismatches = [];
    
    console.log('🔍 Validating content hashes...\n');
    
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      
      if ((i + 1) % 100 === 0) {
        console.log(`   Checking ${i + 1}/${responses.length}...`);
      }
      
      try {
        // Regenerate content hash using current logic
        const regeneratedHash = SurveyResponse.generateContentHash(
          response.interviewer || null,
          response.survey || SURVEY_ID,
          response.startTime,
          response.responses || [],
          {
            interviewMode: response.interviewMode || null,
            location: response.location || null,
            call_id: response.call_id || null,
            endTime: response.endTime || null,
            totalTimeSpent: response.totalTimeSpent || null
          }
        );
        
        const storedHash = response.contentHash;
        
        if (regeneratedHash === storedHash) {
          matchCount++;
        } else {
          mismatchCount++;
          mismatches.push({
            responseId: response.responseId,
            mongoId: response._id.toString(),
            sessionId: response.sessionId,
            interviewMode: response.interviewMode,
            status: response.status,
            storedHash,
            regeneratedHash,
            startTime: response.startTime,
            endTime: response.endTime,
            totalTimeSpent: response.totalTimeSpent,
            responsesCount: (response.responses || []).length
          });
          
          // Log first 10 mismatches immediately
          if (mismatchCount <= 10) {
            console.log(`\n   ❌ MISMATCH #${mismatchCount}:`);
            console.log(`      Response ID: ${response.responseId}`);
            console.log(`      Mode: ${response.interviewMode}`);
            console.log(`      Stored:    ${storedHash}`);
            console.log(`      Generated: ${regeneratedHash}`);
          }
        }
      } catch (error) {
        console.error(`   ❌ Error validating response ${response.responseId}:`, error.message);
        mismatchCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 VALIDATION RESULTS');
    console.log('='.repeat(80));
    console.log(`Total responses checked: ${responses.length}`);
    console.log(`✅ Matches: ${matchCount} (${((matchCount / responses.length) * 100).toFixed(2)}%)`);
    console.log(`❌ Mismatches: ${mismatchCount} (${((mismatchCount / responses.length) * 100).toFixed(2)}%)`);
    console.log('');
    
    if (mismatchCount > 0) {
      console.log('⚠️  CONTENT HASH LOGIC HAS ISSUES!');
      console.log(`   ${mismatchCount} responses have mismatched hashes.`);
      console.log('');
      console.log('First 20 mismatches:');
      mismatches.slice(0, 20).forEach((m, idx) => {
        console.log(`\n${idx + 1}. Response ID: ${m.responseId}`);
        console.log(`   Mode: ${m.interviewMode} | Status: ${m.status}`);
        console.log(`   Stored:    ${m.storedHash}`);
        console.log(`   Generated: ${m.regeneratedHash}`);
        console.log(`   StartTime: ${m.startTime}`);
        console.log(`   EndTime: ${m.endTime}`);
        console.log(`   Duration: ${m.totalTimeSpent}s`);
        console.log(`   Responses: ${m.responsesCount}`);
      });
      
      // Save full mismatch report
      const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ContentHashValidation');
      if (!fs.existsSync(REPORT_DIR)) {
        fs.mkdirSync(REPORT_DIR, { recursive: true });
      }
      
      const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const reportPath = path.join(REPORT_DIR, `content_hash_mismatches_${TIMESTAMP}.json`);
      fs.writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        totalChecked: responses.length,
        matchCount,
        mismatchCount,
        mismatches: mismatches.map(m => ({
          ...m,
          startTime: m.startTime ? m.startTime.toISOString() : null,
          endTime: m.endTime ? m.endTime.toISOString() : null
        }))
      }, null, 2));
      
      console.log(`\n✅ Full mismatch report saved: ${reportPath}`);
    } else {
      console.log('✅✅✅ ALL CONTENT HASHES MATCH! Logic is correct! ✅✅✅');
    }
    
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Validation complete!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    await mongoose.disconnect();
    process.exit(1);
  }
}

// Run validation
if (require.main === module) {
  validateContentHash();
}

module.exports = { validateContentHash };






