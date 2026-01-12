const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const User = require('../models/User');
const Company = require('../models/Company');

async function fixQualityAgentCompany() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get company
    const company = await Company.findOne({ companyCode: 'TEST001' }).lean();
    if (!company) {
      throw new Error('Company not found: TEST001');
    }
    console.log(`✅ Found company: ${company.companyName} (${company._id})`);

    // Get all quality agents with memberId in range 2000-2100
    const qualityAgents = await User.find({
      userType: 'quality_agent',
      companyCode: 'TEST001',
      memberId: { $gte: '2000', $lte: '2100' },
      $or: [
        { company: { $exists: false } },
        { company: null }
      ]
    }).select('_id email memberId firstName lastName company companyCode').lean();
    
    console.log(`✅ Found ${qualityAgents.length} quality agents without company field`);

    if (qualityAgents.length > 0) {
      // Update all quality agents to set company field
      const updateResult = await User.updateMany(
        {
          _id: { $in: qualityAgents.map(a => a._id) }
        },
        {
          $set: {
            company: company._id,
            companyCode: 'TEST001' // Ensure companyCode is also set
          }
        }
      );

      console.log(`✅ Updated ${updateResult.modifiedCount} quality agents with company field`);

      // Verify the update
      const updatedAgents = await User.find({
        _id: { $in: qualityAgents.map(a => a._id) }
      }).select('_id email memberId company companyCode').lean();

      console.log(`\n📋 Updated Quality Agents:`);
      updatedAgents.forEach((agent, index) => {
        console.log(`${index + 1}. ${agent.email} - Company: ${agent.company}, CompanyCode: ${agent.companyCode}`);
      });
    } else {
      console.log('⚠️  All quality agents already have company field set');
    }

    console.log('\n✅ Process completed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
fixQualityAgentCompany();



