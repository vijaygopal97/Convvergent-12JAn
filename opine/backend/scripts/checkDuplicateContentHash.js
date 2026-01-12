/**
 * Check for duplicate responses with same contentHash that are Approved or Pending_Approval
 * This script identifies potential duplicates that should have been rejected but weren't
 */

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');
require('dotenv').config();

const checkDuplicateContentHash = async () => {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 Checking for duplicates with same contentHash in Approved/Pending_Approval status...\n');

    // Find all responses with contentHash that are Approved or Pending_Approval
    const responses = await SurveyResponse.find({
      status: { $in: ['Approved', 'Pending_Approval'] },
      contentHash: { $exists: true, $ne: null }
    })
      .select('responseId status contentHash createdAt survey interviewer')
      .populate('survey', 'surveyName')
      .populate('interviewer', 'firstName lastName email')
      .lean();

    console.log(`📊 Total responses with contentHash in Approved/Pending_Approval: ${responses.length}`);

    // Group by contentHash
    const hashGroups = {};
    responses.forEach(response => {
      const hash = response.contentHash;
      if (!hashGroups[hash]) {
        hashGroups[hash] = [];
      }
      hashGroups[hash].push(response);
    });

    // Find hashes with duplicates (more than 1 response)
    const duplicates = {};
    Object.keys(hashGroups).forEach(hash => {
      if (hashGroups[hash].length > 1) {
        duplicates[hash] = hashGroups[hash];
      }
    });

    const duplicateHashes = Object.keys(duplicates);
    console.log(`\n⚠️  Found ${duplicateHashes.length} contentHash values with duplicates:`);

    let totalDuplicateResponses = 0;
    const duplicateDetails = [];

    duplicateHashes.forEach(hash => {
      const group = duplicates[hash];
      totalDuplicateResponses += group.length;
      
      console.log(`\n📋 ContentHash: ${hash}`);
      console.log(`   Count: ${group.length} responses`);
      
      const groupDetails = {
        contentHash: hash,
        count: group.length,
        responses: group.map(r => ({
          responseId: r.responseId,
          status: r.status,
          createdAt: r.createdAt,
          surveyName: r.survey?.surveyName || 'N/A',
          interviewer: r.interviewer ? `${r.interviewer.firstName} ${r.interviewer.lastName}` : 'N/A',
          interviewerEmail: r.interviewer?.email || 'N/A'
        }))
      };
      
      duplicateDetails.push(groupDetails);
      
      group.forEach((response, index) => {
        console.log(`   ${index + 1}. ResponseId: ${response.responseId}`);
        console.log(`      Status: ${response.status}`);
        console.log(`      Created: ${new Date(response.createdAt).toISOString()}`);
        console.log(`      Survey: ${response.survey?.surveyName || 'N/A'}`);
        console.log(`      Interviewer: ${response.interviewer ? `${response.interviewer.firstName} ${response.interviewer.lastName} (${response.interviewer.email})` : 'N/A'}`);
      });
    });

    console.log(`\n📊 Summary:`);
    console.log(`   Total duplicate contentHash values: ${duplicateHashes.length}`);
    console.log(`   Total duplicate responses: ${totalDuplicateResponses}`);
    console.log(`   Average duplicates per hash: ${duplicateHashes.length > 0 ? (totalDuplicateResponses / duplicateHashes.length).toFixed(2) : 0}`);

    // Save detailed report
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalDuplicateHashes: duplicateHashes.length,
        totalDuplicateResponses: totalDuplicateResponses,
        averageDuplicatesPerHash: duplicateHashes.length > 0 ? (totalDuplicateResponses / duplicateHashes.length).toFixed(2) : 0
      },
      duplicates: duplicateDetails
    };

    const fs = require('fs');
    const path = require('path');
    const reportDir = path.join(__dirname, '../../Report-Generation/DuplicateContentHash');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `duplicate_contenthash_${timestamp}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n✅ Detailed report saved to: ${reportPath}`);

    await mongoose.connection.close();
    console.log('\n✅ Analysis complete!');

    return report;

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

checkDuplicateContentHash();

