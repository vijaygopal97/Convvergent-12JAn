const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, 'backend/.env') });

(async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    const SurveyResponse = require('./backend/models/SurveyResponse');
    
    console.log('Creating indexes...');
    
    // Create indexes in background (non-blocking)
    await SurveyResponse.collection.createIndex({ survey: 1, startTime: -1, status: 1 }, { background: true });
    console.log('✅ Index: { survey: 1, startTime: -1, status: 1 }');
    
    await SurveyResponse.collection.createIndex({ survey: 1, interviewer: 1, startTime: -1 }, { background: true });
    console.log('✅ Index: { survey: 1, interviewer: 1, startTime: -1 }');
    
    await SurveyResponse.collection.createIndex({ startTime: -1 }, { background: true });
    console.log('✅ Index: { startTime: -1 }');
    
    console.log('\n✅ All indexes created!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
})();
