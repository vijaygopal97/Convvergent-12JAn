/**
 * Generate All-Time CSV Export for a Survey
 * Exports all Approved + Rejected + Pending_Approval responses
 * Uses the csvGeneratorHelper with streaming to handle large datasets
 * 
 * Usage: node scripts/generateAllTimeCSVExport.js <surveyId> [mode]
 * Examples:
 *   node scripts/generateAllTimeCSVExport.js 694ac4f39cf18db6a88dcfd6 codes
 *   node scripts/generateAllTimeCSVExport.js 68fd1915d41841da463f0d46 codes
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { generateCSVForSurvey } = require('../utils/csvGeneratorHelper');

const connectDB = async () => {
  try {
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
  const mode = process.argv[3] || 'codes'; // 'codes' or 'responses'

  if (!surveyId) {
    console.error('❌ Error: Survey ID is required');
    console.log('Usage: node scripts/generateAllTimeCSVExport.js <surveyId> [mode]');
    console.log('  mode: codes (default) or responses');
    process.exit(1);
  }

  if (!mongoose.Types.ObjectId.isValid(surveyId)) {
    console.error(`❌ Error: Invalid survey ID format: ${surveyId}`);
    process.exit(1);
  }

  try {
    // Connect to database
    await connectDB();

    const Survey = require('../models/Survey');
    const SurveyResponse = require('../models/SurveyResponse');

    // Verify survey exists
    const survey = await Survey.findById(surveyId).select('surveyName').lean();
    if (!survey) {
      console.error(`❌ Error: Survey ${surveyId} not found`);
      process.exit(1);
    }

    console.log(`\n🚀 Starting All-Time CSV Export`);
    console.log(`📋 Survey: ${survey.surveyName || surveyId}`);
    console.log(`📊 Survey ID: ${surveyId}`);
    console.log(`📄 Mode: ${mode}`);
    console.log(`📅 Statuses: Approved, Rejected, Pending_Approval (All-Time)`);
    console.log(`⏰ Started at: ${new Date().toISOString()}`);
    console.log(`📅 IST Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}\n`);

    // Count responses first
    const surveyObjId = mongoose.Types.ObjectId.isValid(surveyId) 
      ? new mongoose.Types.ObjectId(surveyId) 
      : surveyId;
    
    const totalCount = await SurveyResponse.countDocuments({
      survey: surveyObjId,
      status: { $in: ['Approved', 'Rejected', 'Pending_Approval', 'approved', 'rejected', 'pending_approval'] }
    });

    console.log(`📊 Total responses to export: ${totalCount.toLocaleString()}\n`);

    if (totalCount === 0) {
      console.log('⚠️  No responses found with status Approved, Rejected, or Pending_Approval');
      console.log('   CSV file will be created with headers only.\n');
    }

    // Generate CSV using the helper (which uses streaming for large datasets)
    console.log(`📝 Generating ${mode} CSV...`);
    await generateCSVForSurvey(surveyId, mode);
    
    const path = require('path');
    const fs = require('fs');
    const csvPath = path.join(__dirname, '../generated-csvs', surveyId, mode === 'codes' ? 'responses_codes.csv' : 'responses_responses.csv');
    
    if (fs.existsSync(csvPath)) {
      const stats = fs.statSync(csvPath);
      const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`\n✅ CSV Export completed successfully!`);
      console.log(`📄 File: ${csvPath}`);
      console.log(`📊 File size: ${fileSizeMB} MB`);
      console.log(`📈 Total responses: ${totalCount.toLocaleString()}`);
    } else {
      console.log(`\n✅ CSV generation completed, but file not found at expected location`);
      console.log(`   Expected: ${csvPath}`);
    }

    console.log(`\n⏰ Finished at: ${new Date().toISOString()}`);
    console.log(`📅 IST Time: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);

  } catch (error) {
    console.error('\n❌ Error generating CSV:', error);
    console.error(error.stack);
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

