#!/usr/bin/env node

/**
 * Script to add a new MongoDB replica set member
 * Usage: node addMongoDBReplicaMember.js <new_member_host:port>
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const NEW_MEMBER = process.argv[2] || '13.127.22.11:27017';

// Get MongoDB URI from environment
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

async function addReplicaMember() {
  try {
    console.log('='.repeat(80));
    console.log('ADDING MONGODB REPLICA SET MEMBER');
    console.log('='.repeat(80));
    console.log('');
    console.log('New member to add:', NEW_MEMBER);
    console.log('');
    
    console.log('📡 Connecting to MongoDB (primary)...');
    console.log(`   URI: ${MONGODB_URI.replace(/\/\/.*@/, '//***@')}`);
    
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      connectTimeoutMS: 15000
    });
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    const admin = mongoose.connection.db.admin();
    
    // Get current replica set status
    console.log('🔍 Getting current replica set status...');
    const status = await admin.command({ replSetGetStatus: 1 });
    
    console.log('Current replica set members:');
    status.members.forEach((member, i) => {
      const role = member.stateStr === 'PRIMARY' ? '👑' : '📋';
      console.log(`  ${i + 1}. ${role} ${member.name} - ${member.stateStr}`);
    });
    console.log('');
    
    // Check if member already exists
    const memberExists = status.members.some(m => {
      const memberHost = m.name.split(':')[0];
      const newHost = NEW_MEMBER.split(':')[0];
      return memberHost === newHost;
    });
    
    if (memberExists) {
      console.log('✅ Member already exists in replica set');
      const existing = status.members.find(m => m.name.includes(NEW_MEMBER.split(':')[0]));
      console.log(`   Status: ${existing.stateStr}`);
      await mongoose.disconnect();
      return;
    }
    
    // Get current configuration
    console.log('📋 Getting current replica set configuration...');
    const configResult = await admin.command({ replSetGetConfig: 1 });
    const currentConfig = configResult.config;
    
    // Find the highest member ID
    const maxId = Math.max(...currentConfig.members.map(m => m._id));
    const newMemberId = maxId + 1;
    
    console.log(`➕ Adding new member with ID ${newMemberId}: ${NEW_MEMBER}`);
    
    // Create new configuration with added member
    const newConfig = {
      _id: currentConfig._id,
      version: currentConfig.version + 1,
      members: [
        ...currentConfig.members.map(m => ({
          _id: m._id,
          host: m.name
        })),
        {
          _id: newMemberId,
          host: NEW_MEMBER
        }
      ]
    };
    
    // Apply new configuration
    console.log('🔄 Applying new replica set configuration...');
    await admin.command({
      replSetReconfig: newConfig
    });
    
    console.log('✅ Configuration applied successfully');
    console.log('');
    
    // Wait for replica set to stabilize
    console.log('⏳ Waiting for replica set to stabilize (10 seconds)...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Check new status
    console.log('🔍 Verifying new replica set status...');
    const newStatus = await admin.command({ replSetGetStatus: 1 });
    
    console.log('');
    console.log('Updated replica set members:');
    newStatus.members.forEach((member, i) => {
      const role = member.stateStr === 'PRIMARY' ? '👑' : 
                   member.stateStr === 'SECONDARY' ? '📋' : '⚠️';
      const syncStatus = member.stateStr === 'SECONDARY' ? 
        (member.optimeDate ? ' (syncing)' : ' (initializing)') : '';
      console.log(`  ${i + 1}. ${role} ${member.name} - ${member.stateStr}${syncStatus}`);
    });
    
    // Verify the new member
    const newMember = newStatus.members.find(m => 
      m.name.includes(NEW_MEMBER.split(':')[0])
    );
    
    if (newMember) {
      if (newMember.stateStr === 'SECONDARY' || newMember.stateStr === 'PRIMARY') {
        console.log('');
        console.log('✅ New member successfully added and is', newMember.stateStr);
      } else {
        console.log('');
        console.log('⚠️  New member added but state is:', newMember.stateStr);
        console.log('   It may take some time to sync. Please check again later.');
      }
    } else {
      console.log('');
      console.log('⚠️  New member not found in status (may still be initializing)');
    }
    
    await mongoose.disconnect();
    console.log('');
    console.log('✅ Replica set member addition completed!');
    console.log('');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    
    if (error.message.includes('version')) {
      console.error('');
      console.error('💡 Version conflict detected. This usually means the replica set');
      console.error('   configuration changed. The script will retry with fresh config.');
      console.error('');
      
      try {
        // Retry with fresh config
        const admin = mongoose.connection.db.admin();
        const configResult = await admin.command({ replSetGetConfig: 1 });
        const currentConfig = configResult.config;
        const maxId = Math.max(...currentConfig.members.map(m => m._id));
        
        const newConfig = {
          _id: currentConfig._id,
          version: currentConfig.version + 1,
          members: [
            ...currentConfig.members.map(m => ({
              _id: m._id,
              host: m.name
            })),
            {
              _id: maxId + 1,
              host: NEW_MEMBER
            }
          ]
        };
        
        await admin.command({ replSetReconfig: newConfig });
        console.log('✅ Member added successfully after retry');
      } catch (retryError) {
        console.error('❌ Retry failed:', retryError.message);
        console.error('');
        console.error('💡 You may need to add the member manually using mongosh:');
        console.error(`   rs.add("${NEW_MEMBER}")`);
      }
    }
    
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

addReplicaMember();

