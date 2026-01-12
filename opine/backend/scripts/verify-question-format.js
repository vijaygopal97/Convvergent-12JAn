/**
 * Verify how question_1767953047865_319 is stored in responses
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

const SURVEY_ID = '68fd1915d41841da463f0d46';
const QUESTION_ID = 'question_1767953047865_319';

async function verifyFormat() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // First check without date filter
    const totalWithQuestion = await SurveyResponse.countDocuments({
      survey: SURVEY_ID,
      status: { $in: ['Approved', 'Rejected', 'Pending_Approval'] },
      [`responses.${QUESTION_ID}`]: { $exists: true }
    });
    
    console.log(`📊 Total responses with this question (any date): ${totalWithQuestion}\n`);
    
    const filterDate = new Date('2026-01-04T00:00:00.000Z');
    
    // Find responses that have this question answered (with date filter)
    const sample = await SurveyResponse.find({
      survey: SURVEY_ID,
      status: { $in: ['Approved', 'Rejected', 'Pending_Approval'] },
      createdAt: { $gte: filterDate },
      [`responses.${QUESTION_ID}`]: { $exists: true }
    })
      .select(`responseId responses.${QUESTION_ID} status createdAt`)
      .limit(10)
      .lean();

    console.log(`📊 Found ${sample.length} responses with this question answered\n`);

    if (sample.length === 0) {
      console.log('⚠️  No responses found with this question answered in the filtered dataset.');
      await mongoose.disconnect();
      return;
    }

    console.log('Sample responses:\n');
    sample.forEach((r, i) => {
      const answer = r.responses?.[QUESTION_ID];
      console.log(`Response ${i + 1}:`);
      console.log(`  Response ID: ${r.responseId}`);
      console.log(`  Status: ${r.status}`);
      console.log(`  Created At: ${r.createdAt}`);
      console.log(`  Answer Type: ${Array.isArray(answer) ? 'array' : typeof answer}`);
      console.log(`  Is Array: ${Array.isArray(answer)}`);
      if (Array.isArray(answer)) {
        console.log(`  Array Length: ${answer.length}`);
        console.log(`  Array Contents: ${JSON.stringify(answer)}`);
      } else {
        console.log(`  Answer Value: ${JSON.stringify(answer)}`);
      }
      console.log('');
    });

    // Check for any arrays with length > 1
    const multiselect = sample.filter(r => {
      const answer = r.responses?.[QUESTION_ID];
      return Array.isArray(answer) && answer.length > 1;
    });

    console.log(`\n📊 Summary:`);
    console.log(`  Total samples: ${sample.length}`);
    console.log(`  Arrays with length > 1: ${multiselect.length}`);
    
    if (multiselect.length > 0) {
      console.log(`\n⚠️  Found ${multiselect.length} multiselect responses in sample!`);
      console.log(`   The detection logic might need adjustment.`);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

verifyFormat();

