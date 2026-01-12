const mongoose = require('mongoose');
const { generateCSVForSurvey } = require('../utils/csvGeneratorHelper');
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

/**
 * Script to generate CSV files for a specific survey
 * Usage: node scripts/generateCSVForSurvey.js <surveyId> [mode]
 * 
 * Examples:
 *   node scripts/generateCSVForSurvey.js 68fd1915d41841da463f0d46
 *   node scripts/generateCSVForSurvey.js 68fd1915d41841da463f0d46 responses
 *   node scripts/generateCSVForSurvey.js 68fd1915d41841da463f0d46 codes
 */

const connectDB = async () => {
  try {
    // Try MONGODB_URI first (used by server.js), then MONGO_URI as fallback
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_URI or MONGO_URI not found in environment variables');
    }
    
    const conn = await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

const main = async () => {
  // Get survey ID from command line arguments
  const surveyId = process.argv[2];
  const mode = process.argv[3] || 'both'; // 'codes', 'responses', or 'both'

  if (!surveyId) {
    console.error('❌ Error: Survey ID is required');
    console.log('Usage: node scripts/generateCSVForSurvey.js <surveyId> [mode]');
    console.log('  mode: codes, responses, or both (default: both)');
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(surveyId)) {
    console.error(`❌ Error: Invalid survey ID format: ${surveyId}`);
    process.exit(1);
  }

  try {
    // Connect to database
    await connectDB();

    console.log(`\n🚀 Starting CSV generation for survey: ${surveyId}`);
    console.log(`📊 Mode: ${mode}`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log(`📅 IST Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`);

    // Generate CSV files based on mode
    if (mode === 'both' || mode === 'codes') {
      console.log('📝 Generating codes CSV...');
      await generateCSVForSurvey(surveyId, 'codes');
      console.log('✅ Codes CSV generated successfully\n');
    }

    if (mode === 'both' || mode === 'responses') {
      console.log('📝 Generating responses CSV...');
      await generateCSVForSurvey(surveyId, 'responses');
      console.log('✅ Responses CSV generated successfully\n');
    }

    console.log('✅ All CSV generation completed successfully!');
    console.log(`⏰ Finished at: ${new Date().toISOString()}`);
    console.log(`📅 IST Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  } catch (error) {
    console.error('❌ Error generating CSV:', error);
    process.exit(1);
  } finally {
    // Close database connection
    await mongoose.connection.close();
    console.log('\n🔌 Database connection closed');
    process.exit(0);
  }
};

// Run the script
main();

