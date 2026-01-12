/**
 * Mark 2nd duplicate responses as abandoned (where interviewer is the same)
 * This script processes the duplicate_contenthash report and marks later duplicates as abandoned
 */

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const markDuplicatesAsAbandoned = async () => {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Read the duplicate report
    const reportPath = '/var/www/opine/Report-Generation/DuplicateContentHash/duplicate_contenthash_2026-01-06T00-52-18-229Z.json';
    
    if (!fs.existsSync(reportPath)) {
      console.error(`❌ Report file not found: ${reportPath}`);
      process.exit(1);
    }

    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    console.log(`\n📊 Processing ${report.summary.totalDuplicateHashes} duplicate groups...\n`);

    let totalMarked = 0;
    let totalSkipped = 0;
    const results = [];

    for (const duplicateGroup of report.duplicates) {
      const { contentHash, count, responses } = duplicateGroup;
      
      if (count !== 2) {
        console.log(`⚠️  Skipping group with ${count} responses (expected 2): ${contentHash}`);
        continue;
      }

      const [firstResponse, secondResponse] = responses;
      
      // Check if both have the same interviewer email
      const sameInterviewer = firstResponse.interviewerEmail === secondResponse.interviewerEmail;
      
      if (!sameInterviewer) {
        console.log(`⏭️  Skipping ${contentHash}: Different interviewers (${firstResponse.interviewerEmail} vs ${secondResponse.interviewerEmail})`);
        totalSkipped++;
        continue;
      }

      // Sort by createdAt to identify which is the 2nd (later) duplicate
      const sortedResponses = [firstResponse, secondResponse].sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );
      
      const firstDuplicate = sortedResponses[0];
      const secondDuplicate = sortedResponses[1];

      // Find the 2nd duplicate response in database
      const secondResponseDoc = await SurveyResponse.findOne({ 
        responseId: secondDuplicate.responseId 
      });

      if (!secondResponseDoc) {
        console.log(`⚠️  Response not found: ${secondDuplicate.responseId}`);
        continue;
      }

      // Check if already abandoned
      if (secondResponseDoc.status === 'abandoned') {
        console.log(`✅ Already abandoned: ${secondDuplicate.responseId}`);
        totalSkipped++;
        continue;
      }

      // Check if it's in a final status that shouldn't be changed
      const finalStatuses = ['Approved', 'Rejected'];
      if (finalStatuses.includes(secondResponseDoc.status)) {
        console.log(`⚠️  Skipping ${secondDuplicate.responseId}: Has final status '${secondResponseDoc.status}'`);
        totalSkipped++;
        continue;
      }

      // Mark as abandoned
      secondResponseDoc.status = 'abandoned';
      secondResponseDoc.abandonedReason = `Duplicate contentHash detected. Original response: ${firstDuplicate.responseId} (created ${firstDuplicate.createdAt})`;
      secondResponseDoc.metadata = secondResponseDoc.metadata || {};
      secondResponseDoc.metadata.duplicateMarkedAt = new Date().toISOString();
      secondResponseDoc.metadata.originalDuplicateResponseId = firstDuplicate.responseId;
      
      await secondResponseDoc.save();

      console.log(`✅ Marked as abandoned: ${secondDuplicate.responseId}`);
      console.log(`   Original: ${firstDuplicate.responseId} (${firstDuplicate.createdAt})`);
      console.log(`   Duplicate: ${secondDuplicate.responseId} (${secondDuplicate.createdAt})`);
      console.log(`   Interviewer: ${secondDuplicate.interviewerEmail}`);
      
      totalMarked++;
      
      results.push({
        contentHash,
        originalResponseId: firstDuplicate.responseId,
        duplicateResponseId: secondDuplicate.responseId,
        interviewerEmail: secondDuplicate.interviewerEmail,
        originalCreatedAt: firstDuplicate.createdAt,
        duplicateCreatedAt: secondDuplicate.createdAt,
        status: 'marked_as_abandoned'
      });
    }

    console.log(`\n📊 Summary:`);
    console.log(`   Total duplicate groups processed: ${report.summary.totalDuplicateHashes}`);
    console.log(`   Total marked as abandoned: ${totalMarked}`);
    console.log(`   Total skipped: ${totalSkipped}`);

    // Save results
    const resultsPath = path.join(__dirname, '../../Report-Generation/DuplicateContentHash', `duplicate_marking_results_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const resultsDir = path.dirname(resultsPath);
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }
    
    fs.writeFileSync(resultsPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        totalGroups: report.summary.totalDuplicateHashes,
        totalMarked: totalMarked,
        totalSkipped: totalSkipped
      },
      results: results
    }, null, 2));
    
    console.log(`\n✅ Results saved to: ${resultsPath}`);

    await mongoose.connection.close();
    console.log('\n✅ Script complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

markDuplicatesAsAbandoned();





