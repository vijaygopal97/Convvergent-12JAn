const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const User = require('../models/User');
const Survey = require('../models/Survey');
const Company = require('../models/Company');

// Function to extract phone number (last 10 digits)
function extractPhoneNumber(phoneInput) {
  if (!phoneInput) return null;
  
  // Convert to string and remove spaces
  let phoneStr = String(phoneInput).trim().replace(/\s+/g, '');
  
  // If there are multiple numbers separated by /, take the first one
  if (phoneStr.includes('/')) {
    phoneStr = phoneStr.split('/')[0].trim();
  }
  
  // Remove all non-digit characters
  phoneStr = phoneStr.replace(/\D/g, '');
  
  // Extract last 10 digits
  if (phoneStr.length >= 10) {
    return phoneStr.slice(-10);
  }
  
  return null;
}

// Function to get next available member ID
async function getNextMemberId(startId = 2000) {
  const existingUsers = await User.find({ memberId: { $exists: true } })
    .select('memberId')
    .lean();
  
  const existingMemberIds = new Set(existingUsers.map(u => String(u.memberId)));
  
  for (let i = startId; i < 9999; i++) {
    const memberId = String(i);
    if (!existingMemberIds.has(memberId)) {
      return memberId;
    }
  }
  
  // If we can't find one in sequence, try random
  for (let i = 0; i < 100; i++) {
    const randomId = String(Math.floor(Math.random() * 9000) + 1000);
    if (!existingMemberIds.has(randomId)) {
      return randomId;
    }
  }
  
  throw new Error('Could not find available member ID');
}

// Function to test login
async function testLogin(email, password) {
  try {
    // Use findOne without lean() to get Mongoose document, then use select to include password
    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return { success: false, error: 'User not found' };
    }
    
    if (!user.password) {
      return { success: false, error: 'Password field not found in user object' };
    }
    
    // Use the comparePassword method from the User model
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return { success: false, error: 'Password mismatch' };
    }
    
    return { success: true, user: { name: `${user.firstName} ${user.lastName}`, email: user.email, memberId: user.memberId } };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
}

async function addSingleQualityAgent() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Quality agent data
    const agentData = {
      name: 'Nikhat Saina',
      phone: '6290100681'
    };

    console.log(`📋 Adding Quality Agent: ${agentData.name} (${agentData.phone})`);

    // Extract phone number (last 10 digits)
    const phoneNumber = extractPhoneNumber(agentData.phone);
    if (!phoneNumber || phoneNumber.length !== 10) {
      throw new Error(`Invalid phone number: ${agentData.phone}`);
    }
    console.log(`✅ Extracted phone number: ${phoneNumber}`);

    // Parse name into firstName and lastName
    const nameParts = agentData.name.split(/\s+/);
    const firstName = nameParts[0] || 'Unknown';
    const lastName = nameParts.slice(1).join(' ') || 'User';
    console.log(`✅ Parsed name: firstName="${firstName}", lastName="${lastName}"`);

    // Get company admin ID for assignedBy
    const companyAdmin = await User.findOne({ 
      userType: 'company_admin',
      companyCode: 'TEST001'
    }).lean();
    
    if (!companyAdmin) {
      throw new Error('Company admin not found for TEST001');
    }
    console.log(`✅ Found company admin: ${companyAdmin._id}`);

    // Get company ObjectId for assigning to quality agent
    const company = await Company.findOne({ companyCode: 'TEST001' }).lean();
    if (!company) {
      throw new Error('Company not found for TEST001');
    }
    console.log(`✅ Found company: ${company.companyName} (${company._id})`);

    // Get survey
    const survey = await Survey.findById('68fd1915d41841da463f0d46');
    if (!survey) {
      throw new Error('Survey not found: 68fd1915d41841da463f0d46');
    }
    console.log(`✅ Found survey: ${survey.surveyName}\n`);

    // Get next available member ID
    const memberId = await getNextMemberId(2000);
    console.log(`✅ Assigned member ID: ${memberId}`);

    // Email and password based on phone number
    const email = `${phoneNumber}@gmail.com`;
    const password = phoneNumber; // Password is the phone number (last 10 digits)
    console.log(`✅ Generated email: ${email}`);
    console.log(`✅ Password: ${password} (phone number)\n`);

    // Check if user already exists by email
    let user;
    let isNewUser = false;
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      console.log(`⚠️  User with email ${email} already exists, updating password and company...`);
      // Update password to phone number (last 10 digits) - set as plain text, pre-save hook will hash it
      existingUser.password = password; // Set plain password, pre-save hook will hash it
      // Update phone if different
      if (existingUser.phone !== `+91${phoneNumber}`) {
        existingUser.phone = `+91${phoneNumber}`;
      }
      // Update company if not set
      if (!existingUser.company) {
        existingUser.company = company._id;
        existingUser.companyCode = 'TEST001';
      }
      await existingUser.save();
      console.log(`✅ Updated password and company for existing user: ${email}`);
      user = existingUser;
      isNewUser = false;
    } else {
      // Check if member ID already exists
      const existingMemberId = await User.findOne({ memberId }).lean();
      if (existingMemberId) {
        console.log(`⚠️  User with memberId ${memberId} already exists, getting next available...`);
        const newMemberId = await getNextMemberId(parseInt(memberId) + 1);
        memberId = newMemberId;
        console.log(`✅ Using member ID: ${memberId}`);
      }

      // Create user (password will be hashed by pre-save hook)
      const userData = {
        firstName,
        lastName,
        email,
        phone: `+91${phoneNumber}`,
        password: password, // Set plain password, pre-save hook will hash it
        memberId,
        userType: 'quality_agent',
        company: company._id, // Set company ObjectId
        companyCode: 'TEST001',
        status: 'active',
        isEmailVerified: true,
        isPhoneVerified: true
      };

      user = new User(userData);
      await user.save();
      console.log(`✅ Created new user: ${firstName} ${lastName} (${email}) - MemberId: ${memberId}`);
      isNewUser = true;
    }

    // Assign quality agent to survey
    console.log('\n🔗 Assigning quality agent to survey...');
    
    // Check if already assigned
    const existingAssignments = survey.assignedQualityAgents || [];
    const existingAgentIds = new Set(existingAssignments.map(a => a.qualityAgent.toString()));
    
    if (existingAgentIds.has(user._id.toString())) {
      console.log('⚠️  Quality agent already assigned to survey');
    } else {
      // Add new assignment
      const newAssignment = {
        qualityAgent: user._id,
        assignedBy: companyAdmin._id,
        status: 'assigned',
        assignedACs: [],
        selectedState: survey.assignedQualityAgents?.[0]?.selectedState || null
      };

      survey.assignedQualityAgents = [...existingAssignments, newAssignment];
      await survey.save();
      console.log(`✅ Assigned quality agent to survey`);
    }

    // Test login - Wait a bit to ensure database writes are complete
    console.log('\n🔐 Testing login...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for DB writes to complete
    const loginResult = await testLogin(email, password);
    
    if (loginResult.success) {
      console.log(`✅ Login test passed: ${email}`);
    } else {
      console.log(`❌ Login test failed: ${email} - ${loginResult.error}`);
    }

    // Print user details with credentials
    console.log('\n' + '='.repeat(100));
    console.log('📋 QUALITY AGENT CREDENTIALS');
    console.log('='.repeat(100));
    console.log('\n');
    console.log(`Name: ${user.firstName} ${user.lastName}`);
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log(`Member ID: ${user.memberId}`);
    console.log(`Phone: ${user.phone}`);
    console.log(`Company: ${company.companyName} (${company.companyCode})`);
    console.log(`Company ObjectId: ${user.company}`);
    console.log(`Survey: ${survey.surveyName}`);
    console.log(`Survey ID: ${survey._id}`);
    console.log(`Status: ${isNewUser ? 'NEW USER' : 'EXISTING USER (UPDATED)'} - ${loginResult.success ? '✅ LOGIN TEST PASSED' : '❌ LOGIN TEST FAILED'}`);
    console.log('');

    console.log('\n✅ Process completed successfully!');
    
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
addSingleQualityAgent();


