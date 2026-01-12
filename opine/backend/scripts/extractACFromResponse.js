/**
 * Script to extract selectedAC and selectedPollingStation from responses array
 * for responses that are missing these fields
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables - try multiple paths
const envPaths = [
  path.join(__dirname, '../../.env'),
  path.join(__dirname, '../.env'),
  path.join(process.cwd(), '.env')
];

for (const envPath of envPaths) {
  try {
    require('dotenv').config({ path: envPath });
    if (process.env.MONGODB_URI || process.env.MONGO_URI) {
      break;
    }
  } catch (e) {
    // Continue to next path
  }
}

const SurveyResponse = require('../models/SurveyResponse');
const { extractACFromResponse } = require('../utils/respondentInfoUtils');
const { getMainText } = require('../utils/genderUtils');

async function extractACAndPollingStation(responseId = null) {
  try {
    // Get MongoDB URI from environment - check multiple variable names
    const mongoUri = process.env.MONGODB_URI || 
                     process.env.MONGO_URI || 
                     process.env.MONGODB_URL ||
                     'mongodb://13.233.231.180:27017,3.109.186.86:27017,13.202.181.167:27017/opine?replicaSet=rs0';
    
    console.log('🔗 Connecting to MongoDB...');
    
    // Connect to MongoDB
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB');

    let query = {};
    if (responseId) {
      query = { responseId: responseId };
      console.log(`🔍 Checking specific response: ${responseId}`);
    } else {
      // Find all CAPI responses missing selectedAC or selectedPollingStation
      query = {
        interviewMode: 'capi',
        $or: [
          { selectedAC: { $exists: false } },
          { selectedAC: null },
          { selectedAC: '' },
          { 'selectedPollingStation': { $exists: false } },
          { 'selectedPollingStation': null }
        ]
      };
      console.log('🔍 Finding all CAPI responses missing selectedAC or selectedPollingStation...');
    }

    const responses = await SurveyResponse.find(query)
      .select('responseId selectedAC selectedPollingStation responses interviewMode createdAt status')
      .lean();

    console.log(`📊 Found ${responses.length} response(s) to process\n`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const response of responses) {
      try {
        console.log(`\n📝 Processing response: ${response.responseId}`);
        console.log(`   Status: ${response.status}, Created: ${response.createdAt}`);
        console.log(`   Current selectedAC: ${response.selectedAC || 'null'}`);
        console.log(`   Current selectedPollingStation: ${JSON.stringify(response.selectedPollingStation || null)}`);

        if (!response.responses || !Array.isArray(response.responses) || response.responses.length === 0) {
          console.log('   ⚠️  No responses array found, skipping...');
          skippedCount++;
          continue;
        }

        // Debug: Show all questionIds and questionTexts
        console.log(`   📋 Responses array has ${response.responses.length} items`);
        
        // Show first 10 responses for debugging
        console.log(`   📋 First 10 responses:`);
        response.responses.slice(0, 10).forEach((r, i) => {
          console.log(`      ${i+1}. questionId: ${r.questionId || 'N/A'}, questionText: ${(r.questionText || '').substring(0, 80)}..., response: ${JSON.stringify(r.response)?.substring(0, 60)}`);
        });
        
        const acRelated = response.responses.filter(r => 
          r.questionId === 'ac-selection' ||
          (r.questionText && (
            r.questionText.toLowerCase().includes('assembly') ||
            r.questionText.toLowerCase().includes('constituency')
          ))
        );
        const psRelated = response.responses.filter(r => 
          r.questionId === 'polling-station-selection' ||
          (r.questionText && (
            r.questionText.toLowerCase().includes('polling station')
          ))
        );
        
        console.log(`   🔍 Found ${acRelated.length} AC-related responses:`);
        acRelated.forEach((r, i) => {
          console.log(`      ${i+1}. questionId: ${r.questionId}, questionText: ${r.questionText?.substring(0, 60)}..., response: ${JSON.stringify(r.response)}`);
        });
        
        console.log(`   🔍 Found ${psRelated.length} Polling Station-related responses:`);
        psRelated.forEach((r, i) => {
          console.log(`      ${i+1}. questionId: ${r.questionId}, questionText: ${r.questionText?.substring(0, 60)}..., response: ${JSON.stringify(r.response)}`);
        });
        
        // Check if there's a question with "select" and "assembly" or "constituency"
        const selectACQuestions = response.responses.filter(r => {
          if (!r.questionText) return false;
          const text = r.questionText.toLowerCase();
          return (text.includes('select') && (text.includes('assembly') || text.includes('constituency')));
        });
        
        console.log(`   🔍 Found ${selectACQuestions.length} "Select Assembly Constituency" questions:`);
        selectACQuestions.forEach((r, i) => {
          console.log(`      ${i+1}. questionId: ${r.questionId}, questionText: ${r.questionText}, response: ${JSON.stringify(r.response)}`);
        });

        // Extract AC
        const responseData = {
          selectedAC: response.selectedAC || null,
          selectedPollingStation: response.selectedPollingStation || null
        };
        
        let extractedAC = null;
        if (!response.selectedAC) {
          extractedAC = extractACFromResponse(response.responses, responseData);
          if (extractedAC) {
            console.log(`   ✅ Extracted AC: ${extractedAC}`);
          } else {
            console.log('   ⚠️  Could not extract AC from responses');
          }
        } else {
          extractedAC = response.selectedAC;
          console.log(`   ✅ Using existing AC: ${extractedAC}`);
        }

        // Extract polling station
        let extractedPollingStation = response.selectedPollingStation || null;
        
        if (!extractedPollingStation) {
          // Find polling station selection response
          const pollingStationResponse = response.responses.find(r => 
            r.questionId === 'polling-station-selection' ||
            (r.questionText && (
              r.questionText.toLowerCase().includes('select polling station') ||
              r.questionText.toLowerCase().includes('polling station')
            ))
          );
          
          if (pollingStationResponse && pollingStationResponse.response) {
            const stationValue = pollingStationResponse.response;
            
            // Also check for group selection
            const groupResponse = response.responses.find(r => 
              r.questionId === 'polling-station-group' ||
              (r.questionText && r.questionText.toLowerCase().includes('select group'))
            );
            
            // Build selectedPollingStation object
            extractedPollingStation = {
              stationName: typeof stationValue === 'string' ? stationValue : String(stationValue),
              groupName: groupResponse?.response || null,
              acName: extractedAC || null
            };
            
            console.log(`   ✅ Extracted Polling Station: ${JSON.stringify(extractedPollingStation)}`);
          } else {
            console.log('   ⚠️  Could not extract polling station from responses');
          }
        } else {
          console.log(`   ✅ Using existing Polling Station: ${JSON.stringify(extractedPollingStation)}`);
        }

        // Only update if we found something new
        if (extractedAC && !response.selectedAC) {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                selectedAC: extractedAC,
                ...(extractedPollingStation && { selectedPollingStation: extractedPollingStation })
              }
            }
          );
          console.log(`   ✅ Updated response with AC: ${extractedAC}`);
          updatedCount++;
        } else if (extractedPollingStation && !response.selectedPollingStation) {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                selectedPollingStation: extractedPollingStation
              }
            }
          );
          console.log(`   ✅ Updated response with Polling Station`);
          updatedCount++;
        } else {
          console.log('   ⏭️  No updates needed');
          skippedCount++;
        }

      } catch (error) {
        console.error(`   ❌ Error processing response ${response.responseId}:`, error.message);
        errorCount++;
      }
    }

    console.log(`\n\n📊 Summary:`);
    console.log(`   ✅ Updated: ${updatedCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Errors: ${errorCount}`);

    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Get responseId from command line argument
const responseId = process.argv[2] || null;
extractACAndPollingStation(responseId);

