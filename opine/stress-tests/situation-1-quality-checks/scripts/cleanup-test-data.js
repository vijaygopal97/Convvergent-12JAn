/**
 * Cleanup Script for Stress Test Data
 * Removes all test data marked with STRESS_TEST_1 marker
 * CRITICAL: Only removes data that was created/modified during stress test
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const mongoose = require('mongoose');
const path = require('path');

// Use backend's models
const backendPath = path.join(__dirname, '../../../backend');
const User = require(path.join(backendPath, 'models/User'));
const SurveyResponse = require(path.join(backendPath, 'models/SurveyResponse'));
const Company = require(path.join(backendPath, 'models/Company'));

const STRESS_TEST_MARKER = 'STRESS_TEST_1';

class TestDataCleanup {
  constructor() {
    this.cleanupSummary = {
      users: { deleted: 0, restored: 0 },
      responses: { restored: 0, cleared: 0 },
      companies: { deleted: 0 }
    };
  }

  async connectDB() {
    const MONGODB_URI = process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      throw new Error('MONGODB_URI not found in environment variables');
    }
    
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      console.log('✅ Already connected to MongoDB');
      return;
    }
    
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 100,
      serverSelectionTimeoutMS: 60000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 60000
    });
    console.log('✅ Connected to MongoDB');
  }

  async cleanupQualityAgents() {
    console.log('\n🧹 Cleaning up test quality agents...');
    
    const testAgents = await User.find({
      'metadata.stressTest': true,
      'metadata.marker': STRESS_TEST_MARKER
    });
    
    console.log(`   Found ${testAgents.length} test quality agents`);
    
    if (testAgents.length > 0) {
      const result = await User.deleteMany({
        'metadata.stressTest': true,
        'metadata.marker': STRESS_TEST_MARKER
      });
      
      this.cleanupSummary.users.deleted = result.deletedCount;
      console.log(`   ✅ Deleted ${result.deletedCount} test quality agents`);
    }
  }

  async restoreTestResponses() {
    console.log('\n🔄 Restoring test responses to original state...');
    
    // Find responses that were marked for stress test
    const testResponses = await SurveyResponse.find({
      'metadata.stressTest': true,
      'metadata.stressTestMarker': STRESS_TEST_MARKER
    });
    
    console.log(`   Found ${testResponses.length} test responses`);
    
    if (testResponses.length > 0) {
      // Restore original status if it was saved
      // Note: MongoDB doesn't support $set with $metadata.field, so we need to do this in a loop
      let restoredCount = 0;
      for (const response of testResponses) {
        if (response.metadata?.stressTestOriginalStatus) {
          await SurveyResponse.updateOne(
            { _id: response._id },
            {
              $set: {
                status: response.metadata.stressTestOriginalStatus
              },
              $unset: {
                'metadata.stressTest': '',
                'metadata.stressTestMarker': '',
                'metadata.stressTestOriginalStatus': '',
                'reviewAssignment': ''
              }
            }
          );
          restoredCount++;
        }
      }
      
      const restoreResult = { modifiedCount: restoredCount };
      
      // For responses that don't have original status, just clear metadata
      const clearResult = await SurveyResponse.updateMany(
        {
          'metadata.stressTest': true,
          'metadata.stressTestMarker': STRESS_TEST_MARKER,
          'metadata.stressTestOriginalStatus': { $exists: false }
        },
        {
          $unset: {
            'metadata.stressTest': '',
            'metadata.stressTestMarker': '',
            'reviewAssignment': ''
          }
        }
      );
      
      this.cleanupSummary.responses.restored = restoreResult.modifiedCount;
      this.cleanupSummary.responses.cleared = clearResult.modifiedCount;
      
      console.log(`   ✅ Restored ${restoreResult.modifiedCount} responses`);
      console.log(`   ✅ Cleared metadata from ${clearResult.modifiedCount} responses`);
    }
  }

  async cleanupTestCompanies() {
    console.log('\n🧹 Cleaning up test companies...');
    
    const testCompanies = await Company.find({
      'metadata.stressTest': true,
      'metadata.marker': STRESS_TEST_MARKER
    });
    
    console.log(`   Found ${testCompanies.length} test companies`);
    
    if (testCompanies.length > 0) {
      const result = await Company.deleteMany({
        'metadata.stressTest': true,
        'metadata.marker': STRESS_TEST_MARKER
      });
      
      this.cleanupSummary.companies.deleted = result.deletedCount;
      console.log(`   ✅ Deleted ${result.deletedCount} test companies`);
    }
  }

  async verifyCleanup() {
    console.log('\n🔍 Verifying cleanup...');
    
    const remainingAgents = await User.countDocuments({
      'metadata.stressTest': true,
      'metadata.marker': STRESS_TEST_MARKER
    });
    
    const remainingResponses = await SurveyResponse.countDocuments({
      'metadata.stressTest': true,
      'metadata.stressTestMarker': STRESS_TEST_MARKER
    });
    
    const remainingCompanies = await Company.countDocuments({
      'metadata.stressTest': true,
      'metadata.marker': STRESS_TEST_MARKER
    });
    
    console.log(`   Remaining test agents: ${remainingAgents}`);
    console.log(`   Remaining test responses: ${remainingResponses}`);
    console.log(`   Remaining test companies: ${remainingCompanies}`);
    
    if (remainingAgents === 0 && remainingResponses === 0 && remainingCompanies === 0) {
      console.log('   ✅ Cleanup verified - no test data remaining');
      return true;
    } else {
      console.log('   ⚠️  Some test data still remains');
      return false;
    }
  }
}

// Main execution
async function main() {
  const cleanup = new TestDataCleanup();
  
  try {
    await cleanup.connectDB();
    
    console.log('🚀 Starting cleanup process...');
    console.log('⚠️  WARNING: This will remove all stress test data!');
    
    // Confirm before proceeding
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      rl.question('Are you sure you want to proceed? (yes/no): ', resolve);
    });
    rl.close();
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('❌ Cleanup cancelled');
      process.exit(0);
    }
    
    await cleanup.cleanupQualityAgents();
    await cleanup.restoreTestResponses();
    await cleanup.cleanupTestCompanies();
    
    const verified = await cleanup.verifyCleanup();
    
    console.log('\n✅ Cleanup complete!');
    console.log('\n📊 Summary:');
    console.log(JSON.stringify(cleanup.cleanupSummary, null, 2));
    
    if (verified) {
      console.log('\n✅ All test data successfully removed');
    } else {
      console.log('\n⚠️  Some test data may still remain - please verify manually');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = TestDataCleanup;

