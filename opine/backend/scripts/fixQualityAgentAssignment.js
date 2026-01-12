const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const User = require('../models/User');
const Survey = require('../models/Survey');

async function fixQualityAgentAssignment() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Get survey
    const survey = await Survey.findById('68fd1915d41841da463f0d46');
    if (!survey) {
      throw new Error('Survey not found: 68fd1915d41841da463f0d46');
    }
    console.log(`✅ Found survey: ${survey.surveyName}`);

    // Get all quality agents with email pattern @gmail.com created recently
    // Get the emails from the credentials file or query by memberId range
    const qualityAgents = await User.find({
      userType: 'quality_agent',
      companyCode: 'TEST001',
      memberId: { $gte: '2000', $lte: '2100' } // Member IDs we assigned
    }).select('_id email memberId firstName lastName').lean();
    
    console.log(`✅ Found ${qualityAgents.length} quality agents to assign`);

    // Get company admin ID for assignedBy
    const companyAdmin = await User.findOne({ 
      userType: 'company_admin',
      companyCode: 'TEST001'
    }).lean();
    
    if (!companyAdmin) {
      throw new Error('Company admin not found for TEST001');
    }
    console.log(`✅ Found company admin: ${companyAdmin._id}`);

    // Get existing assignments
    const existingAssignments = survey.assignedQualityAgents || [];
    const existingAgentIds = new Set(existingAssignments.map(a => 
      a.qualityAgent ? a.qualityAgent.toString() : null
    ).filter(Boolean));
    
    console.log(`📊 Current assignments in survey: ${existingAgentIds.size}`);

    // Create new assignments for agents not yet assigned
    const newAssignments = qualityAgents
      .filter(agent => !existingAgentIds.has(agent._id.toString()))
      .map(agent => ({
        qualityAgent: agent._id,
        assignedBy: companyAdmin._id,
        assignedAt: new Date(),
        status: 'assigned',
        assignedACs: [],
        selectedState: survey.assignedQualityAgents?.[0]?.selectedState || null,
        selectedCountry: survey.assignedQualityAgents?.[0]?.selectedCountry || null
      }));

    console.log(`📝 New assignments to add: ${newAssignments.length}`);

    if (newAssignments.length > 0) {
      // Add new assignments to existing ones
      survey.assignedQualityAgents = [...existingAssignments, ...newAssignments];
      await survey.save();
      console.log(`✅ Successfully assigned ${newAssignments.length} quality agents to survey`);
      
      // Verify the assignments
      const updatedSurvey = await Survey.findById('68fd1915d41841da463f0d46')
        .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email memberId')
        .lean();
      
      console.log(`\n📊 Verification: Survey now has ${updatedSurvey.assignedQualityAgents?.length || 0} assigned quality agents`);
      
      // List newly assigned agents
      console.log('\n📋 Newly Assigned Quality Agents:');
      newAssignments.forEach((assignment, index) => {
        const agent = qualityAgents.find(a => a._id.toString() === assignment.qualityAgent.toString());
        console.log(`${index + 1}. ${agent?.firstName} ${agent?.lastName} (${agent?.email}) - Member ID: ${agent?.memberId}`);
      });
    } else {
      console.log('⚠️  All quality agents are already assigned to the survey');
      
      // Still verify current assignments
      const updatedSurvey = await Survey.findById('68fd1915d41841da463f0d46')
        .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email memberId')
        .lean();
      
      console.log(`\n📊 Current assignments: ${updatedSurvey.assignedQualityAgents?.length || 0} quality agents`);
      
      // List all assigned agents
      console.log('\n📋 All Assigned Quality Agents:');
      updatedSurvey.assignedQualityAgents?.forEach((assignment, index) => {
        if (assignment.qualityAgent) {
          const agent = assignment.qualityAgent;
          console.log(`${index + 1}. ${agent.firstName} ${agent.lastName} (${agent.email}) - Member ID: ${agent.memberId}`);
        }
      });
    }

    console.log('\n✅ Process completed!');
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
fixQualityAgentAssignment();



