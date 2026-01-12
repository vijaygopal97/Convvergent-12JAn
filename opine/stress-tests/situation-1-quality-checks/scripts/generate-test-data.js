/**
 * Test Data Generator for Stress Test - Situation 1
 * Creates test quality agents and test survey responses (50% CAPI, 50% CATI)
 * All test data is marked with STRESS_TEST_1 marker for easy cleanup
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../backend/.env') });
const mongoose = require('mongoose');
const path = require('path');

// Use backend's models and dependencies
const backendPath = path.join(__dirname, '../../../backend');
const User = require(path.join(backendPath, 'models/User'));
const Survey = require(path.join(backendPath, 'models/Survey'));
const SurveyResponse = require(path.join(backendPath, 'models/SurveyResponse'));
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const STRESS_TEST_MARKER = 'STRESS_TEST_1';
const TEST_COMPANY_CODE = 'STRESS_TEST';

class TestDataGenerator {
  constructor() {
    this.testQualityAgents = [];
    this.testResponses = [];
    this.testSurveys = [];
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
    
    console.log('🔄 Connecting to MongoDB...');
    
    // Use full URI but override readPreference to primary for writes
    // Replace readPreference if exists, otherwise add it
    let uriWithPrimary = MONGODB_URI;
    if (uriWithPrimary.includes('readPreference=')) {
      uriWithPrimary = uriWithPrimary.replace(/readPreference=[^&]*/, 'readPreference=primary');
    } else {
      uriWithPrimary += (uriWithPrimary.includes('?') ? '&' : '?') + 'readPreference=primary';
    }
    
    try {
      await mongoose.connect(uriWithPrimary, {
        maxPoolSize: 100,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000
      });
      
      // Wait for connection
      if (mongoose.connection.readyState !== 1) {
        await new Promise((resolve, reject) => {
          mongoose.connection.once('connected', resolve);
          mongoose.connection.once('error', reject);
          setTimeout(() => reject(new Error('Connection timeout')), 30000);
        });
      }
      
      // Verify with ping
      await mongoose.connection.db.admin().ping();
      console.log('✅ MongoDB connected and verified');
    } catch (err) {
      console.error('❌ MongoDB connection error:', err.message);
      throw err;
    }
  }

  async findOrCreateTestCompany() {
    const Company = require(path.join(backendPath, 'models/Company'));
    
    // Wait a moment for models to be registered
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Try to find ANY existing company first (for testing, we can use existing)
    let company;
    try {
      // First try to find test company
      company = await Company.findOne({ companyCode: TEST_COMPANY_CODE })
        .maxTimeMS(15000)
        .lean();
      
      if (!company) {
        // If test company doesn't exist, try to find any active company
        console.log('⚠️  Test company not found, looking for any existing company...');
        company = await Company.findOne({ status: 'active' })
          .maxTimeMS(15000)
          .lean();
        
        if (company) {
          console.log(`✅ Using existing company: ${company.companyName} (${company.companyCode})`);
          // Return the company ID as ObjectId
          const mongoose = require('mongoose');
          return { _id: mongoose.Types.ObjectId(company._id), companyCode: company.companyCode };
        }
      } else {
        console.log('✅ Found existing test company');
        const mongoose = require('mongoose');
        return { _id: mongoose.Types.ObjectId(company._id), companyCode: company.companyCode };
      }
    } catch (err) {
      console.log('⚠️  Error finding company:', err.message);
      console.log('⚠️  Will try to create test company...');
    }
    
    // If no company found, try to create one
    if (!company) {
      console.log('🔄 Creating test company...');
      const newCompany = new Company({
        companyName: 'Stress Test Company',
        companyCode: TEST_COMPANY_CODE,
        email: 'stresstest@example.com',
        phone: '9999999999',
        companySize: 'medium',
        industry: 'Technology',
        address: {
          street: 'Test Street',
          city: 'Test City',
          state: 'Test State',
          country: 'India',
          postalCode: '000000'
        },
        status: 'active',
        metadata: {
          stressTest: true,
          marker: STRESS_TEST_MARKER
        }
      });
      
      try {
        await newCompany.save({ maxTimeMS: 30000 });
        console.log('✅ Created test company');
        return { _id: newCompany._id, companyCode: TEST_COMPANY_CODE };
      } catch (err) {
        console.error('❌ Error creating company:', err.message);
        console.error('⚠️  Continuing without company - quality agents will be created without company assignment');
        return null; // Return null and continue without company
      }
    }
    
    return company;
  }

  async createTestQualityAgents(count = 500, companyId) {
    console.log(`📝 Creating ${count} test quality agents...`);
    const agents = [];
    const batchSize = 50; // Smaller batches for better reliability
    
    for (let i = 0; i < count; i += batchSize) {
      const batch = [];
      const end = Math.min(i + batchSize, count);
      
      for (let j = i; j < end; j++) {
        const email = `stress_test_qa_${j}@stresstest.com`;
        const phone = `9999${String(j).padStart(6, '0')}`;
        
        // Check if agent already exists
        try {
          const existing = await User.findOne({ email, 'metadata.stressTest': true })
            .maxTimeMS(10000)
            .lean();
          if (existing) {
            agents.push(existing);
            continue;
          }
        } catch (err) {
          // Continue if check fails
        }
        
        const hashedPassword = await bcrypt.hash('TestPassword123!', 12);
        
        const agentData = {
          firstName: `TestQA`,
          lastName: `${j}`,
          email: email,
          phone: phone,
          password: hashedPassword,
          userType: 'quality_agent',
          status: 'active',
          isActive: true,
          memberId: `STRESS_QA_${j}`,
          metadata: {
            stressTest: true,
            marker: STRESS_TEST_MARKER,
            testIndex: j
          }
        };
        
        // Add company info if available
        if (companyId) {
          agentData.company = companyId._id || companyId;
          agentData.companyCode = companyId.companyCode || TEST_COMPANY_CODE;
        }
        
        const agent = new User(agentData);
        batch.push(agent);
      }
      
      if (batch.length > 0) {
        try {
          const saved = await User.insertMany(batch, { 
            ordered: false,
            maxTimeMS: 30000
          });
          agents.push(...saved);
          console.log(`  ✅ Created batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(count / batchSize)} (${saved.length} agents)`);
        } catch (err) {
          console.error(`  ⚠️  Error in batch ${Math.floor(i / batchSize) + 1}:`, err.message);
          // Continue with next batch
        }
      }
    }
    
    this.testQualityAgents = agents;
    console.log(`✅ Total quality agents created: ${agents.length}`);
    return agents;
  }

  async findTestSurveys() {
    // Find surveys that have quality agents assigned
    const surveys = await Survey.find({
      'assignedQualityAgents.0': { $exists: true },
      status: 'active'
    }).limit(10);
    
    if (surveys.length === 0) {
      throw new Error('No active surveys with quality agents found. Please create at least one survey with quality agents assigned.');
    }
    
    this.testSurveys = surveys;
    console.log(`✅ Found ${surveys.length} test surveys`);
    return surveys;
  }

  async findTestResponses(count = 500) {
    // Find existing responses that are Pending_Approval
    // We'll use real responses but mark them for test processing
    console.log(`🔍 Finding ${count} test responses...`);
    
    let responses;
    try {
      responses = await SurveyResponse.find({
        status: 'Pending_Approval'
      })
      .populate('survey', 'mode')
      .limit(count * 2) // Get more than needed to ensure we have enough after filtering
      .maxTimeMS(30000)
      .lean();
    } catch (err) {
      console.error('❌ Error finding responses:', err.message);
      throw new Error(`Failed to find responses: ${err.message}`);
    }
    
    if (responses.length === 0) {
      throw new Error(`No pending responses found. Need at least ${count} for test.`);
    }
    
    if (responses.length < count) {
      console.log(`⚠️  Only found ${responses.length} pending responses. Will use all available.`);
    }
    
    // Separate CAPI and CATI
    const capiResponses = responses.filter(r => 
      r.survey?.mode === 'capi' || 
      (r.survey?.mode === 'multi_mode' && r.interviewMode === 'capi')
    );
    const catiResponses = responses.filter(r => 
      r.survey?.mode === 'cati' || 
      (r.survey?.mode === 'multi_mode' && r.interviewMode === 'cati')
    );
    
    // Ensure 50/50 split
    const targetCAPI = Math.floor(count / 2);
    const targetCATI = count - targetCAPI;
    
    const selectedCAPI = capiResponses.slice(0, Math.min(targetCAPI, capiResponses.length));
    const selectedCATI = catiResponses.slice(0, Math.min(targetCATI, catiResponses.length));
    
    // If we don't have enough, fill with what we have
    const totalSelected = selectedCAPI.length + selectedCATI.length;
    if (totalSelected < count) {
      const remaining = count - totalSelected;
      const remainingCAPI = capiResponses.slice(selectedCAPI.length, selectedCAPI.length + Math.ceil(remaining / 2));
      const remainingCATI = catiResponses.slice(selectedCATI.length, selectedCATI.length + Math.floor(remaining / 2));
      selectedCAPI.push(...remainingCAPI);
      selectedCATI.push(...remainingCATI);
    }
    
    const testResponses = [...selectedCAPI, ...selectedCATI].slice(0, count);
    
    // Mark responses for stress test
    await SurveyResponse.updateMany(
      { _id: { $in: testResponses.map(r => r._id) } },
      { 
        $set: { 
          'metadata.stressTest': true,
          'metadata.stressTestMarker': STRESS_TEST_MARKER,
          'metadata.stressTestOriginalStatus': 'Pending_Approval'
        }
      }
    );
    
    this.testResponses = testResponses;
    console.log(`✅ Selected ${testResponses.length} test responses:`);
    console.log(`   - CAPI: ${selectedCAPI.length}`);
    console.log(`   - CATI: ${selectedCATI.length}`);
    
    return testResponses;
  }

  async generateSummary() {
    return {
      testId: STRESS_TEST_MARKER,
      timestamp: new Date().toISOString(),
      qualityAgents: {
        total: this.testQualityAgents.length,
        ids: this.testQualityAgents.map(a => a._id.toString())
      },
      responses: {
        total: this.testResponses.length,
        capi: this.testResponses.filter(r => 
          r.survey?.mode === 'capi' || r.interviewMode === 'capi'
        ).length,
        cati: this.testResponses.filter(r => 
          r.survey?.mode === 'cati' || r.interviewMode === 'cati'
        ).length,
        responseIds: this.testResponses.map(r => r.responseId || r._id.toString())
      },
      surveys: {
        total: this.testSurveys.length,
        ids: this.testSurveys.map(s => s._id.toString())
      }
    };
  }
}

// Main execution
async function main() {
  const generator = new TestDataGenerator();
  
  try {
    await generator.connectDB();
    
    const company = await generator.findOrCreateTestCompany();
    
    console.log('\n📊 Generating test data...\n');
    
    // Create quality agents (SCALED DOWN TO 500 FOR TESTING)
    await generator.createTestQualityAgents(500, company);
    
    // Find test surveys
    await generator.findTestSurveys();
    
    // Find test responses (SCALED DOWN TO 500 FOR TESTING)
    await generator.findTestResponses(500);
    
    // Generate summary
    const summary = await generator.generateSummary();
    
    const fs = require('fs');
    const path = require('path');
    const summaryFile = path.join(__dirname, '../data/test-data-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2));
    
    console.log('\n✅ Test data generation complete!');
    console.log(`📄 Summary saved to: ${summaryFile}`);
    console.log('\n📊 Summary:');
    console.log(JSON.stringify(summary, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = TestDataGenerator;

