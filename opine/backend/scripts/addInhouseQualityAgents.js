const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const XLSX = require('xlsx');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Import models
const User = require('../models/User');
const Survey = require('../models/Survey');

// Function to extract phone number (last 10 digits from first number if multiple)
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

async function addInhouseQualityAgents() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Read Excel file
    console.log('\n📖 Reading Excel file...');
    const workbook = XLSX.readFile('/var/www/MyLogos/Inhouse List.xlsx');
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    
    console.log(`✅ Read Excel file: ${sheetName} (${data.length} rows)`);
    
    // Skip header row (row 0), process from row 1
    const qualityAgentsData = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length < 3) continue;
      
      const employeeId = row[0]; // Ignore this
      const name = row[1] ? String(row[1]).trim() : null;
      const phoneInput = row[2];
      
      if (!name || !phoneInput) {
        console.log(`⚠️  Skipping row ${i + 1}: Missing name or phone number`);
        continue;
      }
      
      const phoneNumber = extractPhoneNumber(phoneInput);
      if (!phoneNumber || phoneNumber.length !== 10) {
        console.log(`⚠️  Skipping row ${i + 1}: Invalid phone number (${phoneInput})`);
        continue;
      }
      
      qualityAgentsData.push({ name, phoneNumber, row: i + 1 });
    }
    
    console.log(`✅ Extracted ${qualityAgentsData.length} quality agents from Excel\n`);

    // Get company admin ID for assignedBy
    const companyAdmin = await User.findOne({ 
      userType: 'company_admin',
      companyCode: 'TEST001'
    }).lean();
    
    if (!companyAdmin) {
      throw new Error('Company admin not found for TEST001');
    }
    console.log(`✅ Found company admin: ${companyAdmin._id}`);

    // Get company ObjectId for assigning to quality agents
    const Company = require('../models/Company');
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

    const createdUsers = [];
    const errors = [];
    let memberIdCounter = 2000;

    // Process each quality agent
    for (const agentData of qualityAgentsData) {
      try {
        const name = agentData.name;
        const phoneNumber = agentData.phoneNumber;
        
        // Parse name into firstName and lastName
        const nameParts = name.split(/\s+/);
        const firstName = nameParts[0] || 'Unknown';
        const lastName = nameParts.slice(1).join(' ') || 'User';

        // Get next available member ID
        const memberId = await getNextMemberId(memberIdCounter);
        memberIdCounter = parseInt(memberId) + 1;
        
        // Email and password based on phone number
        const email = `${phoneNumber}@gmail.com`;
        const password = phoneNumber; // Password is the phone number (last 10 digits)
        
        // Check if user already exists by email
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
          createdUsers.push({
            firstName: existingUser.firstName,
            lastName: existingUser.lastName,
            email: existingUser.email,
            password: phoneNumber, // Store the phone number as password for testing
            memberId: existingUser.memberId,
            phone: existingUser.phone,
            status: 'updated'
          });
          continue;
        }

        // Check if member ID already exists
        const existingMemberId = await User.findOne({ memberId }).lean();
        if (existingMemberId) {
          console.log(`⚠️  User with memberId ${memberId} already exists, trying next...`);
          memberIdCounter = parseInt(memberId) + 1;
          const newMemberId = await getNextMemberId(memberIdCounter);
          memberIdCounter = parseInt(newMemberId) + 1;
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const userData = {
          firstName,
          lastName,
          email,
          phone: `+91${phoneNumber}`,
          password: hashedPassword,
          memberId,
          userType: 'quality_agent',
          company: company._id, // Set company ObjectId
          companyCode: 'TEST001',
          status: 'active',
          isEmailVerified: true,
          isPhoneVerified: true
        };

        const user = new User(userData);
        await user.save();
        
        console.log(`✅ Created user: ${firstName} ${lastName} (${email}) - MemberId: ${memberId}`);
        createdUsers.push({ 
          firstName, 
          lastName, 
          email, 
          password, 
          memberId, 
          phone: userData.phone,
          status: 'new'
        });

      } catch (error) {
        console.error(`❌ Error creating user for ${agentData.name} (Row ${agentData.row}):`, error.message);
        errors.push({ name: agentData.name, row: agentData.row, error: error.message });
      }
    }

    console.log(`\n📊 Summary: ${createdUsers.length} users processed (${createdUsers.filter(u => u.status === 'new').length} new, ${createdUsers.filter(u => u.status === 'updated').length} updated), ${errors.length} errors`);

    // Assign all quality agents to survey
    if (createdUsers.length > 0) {
      console.log('\n🔗 Assigning quality agents to survey...');
      
      // Get actual user IDs
      const userIds = await User.find({ 
        email: { $in: createdUsers.map(u => u.email) }
      }).select('_id email memberId').lean();
      
      const emailToUserId = {};
      userIds.forEach(u => {
        emailToUserId[u.email] = u._id;
      });

      const newAssignments = createdUsers
        .filter(u => emailToUserId[u.email])
        .map(u => ({
          qualityAgent: emailToUserId[u.email],
          assignedBy: companyAdmin._id,
          status: 'assigned',
          assignedACs: [],
          selectedState: survey.assignedQualityAgents?.[0]?.selectedState || null
        }));

      // Add to existing assignments (don't overwrite)
      const existingAssignments = survey.assignedQualityAgents || [];
      const existingAgentIds = new Set(existingAssignments.map(a => a.qualityAgent.toString()));
      
      const uniqueNewAssignments = newAssignments.filter(a => !existingAgentIds.has(a.qualityAgent.toString()));
      
      if (uniqueNewAssignments.length > 0) {
        survey.assignedQualityAgents = [...existingAssignments, ...uniqueNewAssignments];
        await survey.save();
        console.log(`✅ Assigned ${uniqueNewAssignments.length} new quality agents to survey`);
      } else {
        console.log('⚠️  All quality agents already assigned to survey');
      }
    }

    // Test logins - Wait a bit to ensure database writes are complete
    console.log('\n🔐 Testing logins...');
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second for DB writes to complete
    const loginResults = [];
    for (const user of createdUsers) {
      const result = await testLogin(user.email, user.password);
      loginResults.push({ ...user, loginTest: result });
      if (result.success) {
        console.log(`✅ Login test passed: ${user.email}`);
      } else {
        console.log(`❌ Login test failed: ${user.email} - ${result.error}`);
      }
    }

    // Print user details with credentials
    console.log('\n' + '='.repeat(100));
    console.log('📋 QUALITY AGENT CREDENTIALS');
    console.log('='.repeat(100));
    console.log('\n');
    
    createdUsers.forEach((user, index) => {
      const loginStatus = loginResults[index]?.loginTest?.success ? '✅ LOGIN TEST PASSED' : '❌ LOGIN TEST FAILED';
      console.log(`${index + 1}. Name: ${user.firstName} ${user.lastName}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Password: ${user.password}`);
      console.log(`   Member ID: ${user.memberId}`);
      console.log(`   Phone: ${user.phone}`);
      console.log(`   Status: ${user.status === 'new' ? 'NEW USER' : 'EXISTING USER'} - ${loginStatus}`);
      console.log('');
    });

    // Create credentials text file
    let credentialsText = 'QUALITY AGENT CREDENTIALS\n';
    credentialsText += '='.repeat(80) + '\n\n';
    
    createdUsers.forEach((user, index) => {
      const loginStatus = loginResults[index]?.loginTest?.success ? '✅' : '❌';
      credentialsText += `${index + 1}. ${user.firstName} ${user.lastName}\n`;
      credentialsText += `   Email: ${user.email}\n`;
      credentialsText += `   Password: ${user.password}\n`;
      credentialsText += `   Member ID: ${user.memberId}\n`;
      credentialsText += `   Phone: ${user.phone}\n`;
      credentialsText += `   Status: ${user.status === 'new' ? 'NEW USER' : 'UPDATED USER'}\n`;
      credentialsText += `   Login Test: ${loginStatus}\n\n`;
    });
    
    const fs = require('fs');
    const credentialsPath = '/var/www/MyLogos/quality_agents_credentials.txt';
    fs.writeFileSync(credentialsPath, credentialsText, 'utf8');
    console.log(`\n📄 Credentials saved to: ${credentialsPath}`);

    if (errors.length > 0) {
      console.log('\n❌ Errors:');
      errors.forEach(err => {
        console.log(`  - Row ${err.row}: ${err.name}: ${err.error}`);
      });
    }

    console.log('\n✅ Process completed!');
    console.log(`\n📊 Final Summary:`);
    console.log(`   - Total users processed: ${createdUsers.length}`);
    console.log(`   - New users created: ${createdUsers.filter(u => u.status === 'new').length}`);
    console.log(`   - Updated users: ${createdUsers.filter(u => u.status === 'updated').length}`);
    console.log(`   - Login tests passed: ${loginResults.filter(r => r.loginTest?.success).length}`);
    console.log(`   - Login tests failed: ${loginResults.filter(r => !r.loginTest?.success).length}`);
    console.log(`   - Errors: ${errors.length}`);
    
    process.exit(0);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
addInhouseQualityAgents();

