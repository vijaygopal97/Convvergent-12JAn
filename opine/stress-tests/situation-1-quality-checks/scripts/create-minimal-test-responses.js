/**
 * Create minimal test responses for stress testing
 * Creates responses that can be verified by quality agents
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const mongoose = require('mongoose');
const SurveyResponse = require('../../../backend/models/SurveyResponse');
const Survey = require('../../../backend/models/Survey');
const User = require('../../../backend/models/User');

const SURVEY_ID = '68fd1915d41841da463f0d46';
const TEST_MARKER = 'STRESS_TEST_1_DIRECT';

async function createTestResponses(count = 100) {
  try {
    console.log('🔌 Connecting to MongoDB...');
    
    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      mongoose.connection.once('connected', resolve);
      mongoose.connection.once('error', reject);
      
      mongoose.connect(process.env.MONGODB_URI, {
        serverSelectionTimeoutMS: 60000,
        connectTimeoutMS: 60000,
        maxPoolSize: 10
      }).catch(reject);
      
      setTimeout(() => reject(new Error('Connection timeout')), 60000);
    });
    
    console.log('✅ Connected to MongoDB\n');
    
    // Small delay to ensure connection is stable
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get survey
    const survey = await Survey.findById(SURVEY_ID);
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }

    // Get a test interviewer (CAPI)
    const capiInterviewer = await User.findOne({ 
      email: 'ajithinterviewer@gmail.com',
      userType: 'interviewer'
    });
    
    // Get a test interviewer (CATI)
    const catiInterviewer = await User.findOne({ 
      email: 'vishalinterviewer@gmail.com',
      userType: 'interviewer'
    });

    if (!capiInterviewer || !catiInterviewer) {
      throw new Error('Test interviewers not found');
    }

    console.log(`📝 Creating ${count} test responses (50% CAPI, 50% CATI)...`);

    const responses = [];
    const capiCount = Math.floor(count / 2);
    const catiCount = count - capiCount;

    // Create CAPI responses
    for (let i = 0; i < capiCount; i++) {
      responses.push({
        survey: SURVEY_ID,
        interviewer: capiInterviewer._id,
        status: 'Pending_Approval',
        interviewMode: 'capi',
        sessionId: `stress-test-${Date.now()}-${i}`,
        startTime: new Date(),
        endTime: new Date(),
        totalTimeSpent: 300 + Math.floor(Math.random() * 200),
        responses: [
          {
            sectionIndex: 0,
            questionIndex: 0,
            questionId: 'age',
            questionType: 'numeric',
            response: 25 + Math.floor(Math.random() * 50),
            responseTime: 1000
          },
          {
            sectionIndex: 1,
            questionIndex: 0,
            questionId: 'gender',
            questionType: 'multiple_choice',
            response: Math.random() < 0.5 ? 'male' : 'female',
            responseTime: 2000
          }
        ],
        selectedAC: 'Ranibandh',
        location: {
          latitude: 22.866141660215824,
          longitude: 86.78307081700281,
          accuracy: 50
        },
        metadata: {
          testMarker: TEST_MARKER,
          testIndex: i
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Create CATI responses
    for (let i = 0; i < catiCount; i++) {
      responses.push({
        survey: SURVEY_ID,
        interviewer: catiInterviewer._id,
        status: 'Pending_Approval',
        interviewMode: 'cati',
        sessionId: `stress-test-cati-${Date.now()}-${i}`,
        startTime: new Date(),
        endTime: new Date(),
        totalTimeSpent: 200 + Math.floor(Math.random() * 150),
        responses: [
          {
            sectionIndex: 0,
            questionIndex: 0,
            questionId: 'age',
            questionType: 'numeric',
            response: 25 + Math.floor(Math.random() * 50),
            responseTime: 800
          },
          {
            sectionIndex: 1,
            questionIndex: 0,
            questionId: 'gender',
            questionType: 'multiple_choice',
            response: Math.random() < 0.5 ? 'male' : 'female',
            responseTime: 1500
          }
        ],
        selectedAC: 'Ranibandh',
        location: {
          latitude: 22.866141660215824,
          longitude: 86.78307081700281,
          accuracy: 100
        },
        metadata: {
          testMarker: TEST_MARKER,
          testIndex: capiCount + i
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // Insert in batches
    const batchSize = 50;
    let inserted = 0;
    
    for (let i = 0; i < responses.length; i += batchSize) {
      const batch = responses.slice(i, i + batchSize);
      await SurveyResponse.insertMany(batch);
      inserted += batch.length;
      console.log(`   ✅ Created ${inserted}/${count} responses`);
    }

    console.log(`\n✅ Successfully created ${inserted} test responses`);
    console.log(`   CAPI: ${capiCount}, CATI: ${catiCount}`);
    console.log(`   Marker: ${TEST_MARKER}\n`);

    await mongoose.disconnect();
    return inserted;
  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.disconnect();
    throw error;
  }
}

if (require.main === module) {
  const count = parseInt(process.argv[2]) || 100;
  createTestResponses(count)
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = createTestResponses;

