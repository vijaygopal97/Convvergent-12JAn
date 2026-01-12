#!/usr/bin/env node

/**
 * Script to generate CSV files for all time data
 * Uses the existing csvGeneratorHelper to generate CSVs efficiently
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { generateCSVForSurvey } = require('../utils/csvGeneratorHelper');

const SURVEY_ID = '68fd1915d41841da463f0d46';

async function main() {
  try {
    console.log('🚀 Starting CSV generation for all time data...');
    console.log(`📋 Survey ID: ${SURVEY_ID}`);
    
    // Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
    
    // Generate codes CSV
    console.log('\n📊 Generating responses_codes.csv...');
    console.log('   This may take several minutes for large datasets...');
    const startTimeCodes = Date.now();
    await generateCSVForSurvey(SURVEY_ID, 'codes');
    const endTimeCodes = Date.now();
    const durationCodes = ((endTimeCodes - startTimeCodes) / 1000).toFixed(2);
    console.log(`✅ responses_codes.csv generated in ${durationCodes} seconds`);
    
    // Generate responses CSV
    console.log('\n📊 Generating responses_responses.csv...');
    console.log('   This may take several minutes for large datasets...');
    const startTimeResponses = Date.now();
    await generateCSVForSurvey(SURVEY_ID, 'responses');
    const endTimeResponses = Date.now();
    const durationResponses = ((endTimeResponses - startTimeResponses) / 1000).toFixed(2);
    console.log(`✅ responses_responses.csv generated in ${durationResponses} seconds`);
    
    console.log('\n✅ CSV generation completed successfully!');
    console.log(`📁 Files saved to: /var/www/opine/backend/generated-csvs/${SURVEY_ID}/`);
    console.log('   - responses_codes.csv');
    console.log('   - responses_responses.csv');
    
  } catch (error) {
    console.error('❌ Error generating CSV:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n🔌 MongoDB connection closed');
    process.exit(0);
  }
}

// Run the script
main();

