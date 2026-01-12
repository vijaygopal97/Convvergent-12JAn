#!/usr/bin/env node

/**
 * Script to safely remove a MongoDB replica set member
 * Usage: node removeReplicaMember.js <member_host:port>
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MEMBER_TO_REMOVE = process.argv[2] || '3.109.186.86:27017';

async function removeReplicaMember() {
  try {
    console.log('='.repeat(80));
    console.log('REMOVING MONGODB REPLICA SET MEMBER');
    console.log('='.repeat(80));
    console.log('');
    console.log('Member to remove:', MEMBER_TO_REMOVE);
    console.log('');
    
    // Connect directly to primary (Server 3)
    const PRIMARY_URI = 'mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin';
    
    console.log('📡 Connecting to primary MongoDB server...');
    await mongoose.connect(PRIMARY_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    console.log('✅ Connected to primary');
    console.log('');
    
    const admin = mongoose.connection.db.admin();
    
    // Get current replica set status
    console.log('🔍 Getting current replica set status...');
    const status = await admin.command({ replSetGetStatus: 1 });
    
    console.log('Current members:');
    status.members.forEach((member, i) => {
      console.log(`  ${i + 1}. ${member.name} - ${member.stateStr} (ID: ${member._id})`);
    });
    console.log('');
    
    // Find the member to remove
    const memberToRemove = status.members.find(m => m.name.includes(MEMBER_TO_REMOVE.split(':')[0]));
    
    if (!memberToRemove) {
      console.log('✅ Member not found in replica set (may already be removed)');
      await mongoose.disconnect();
      return;
    }
    
    console.log(`⚠️  Found member to remove: ${memberToRemove.name} (ID: ${memberToRemove._id})`);
    console.log('');
    
    // Remove the member
    console.log('🗑️  Removing member from replica set...');
    try {
      await admin.command({
        replSetReconfig: {
          _id: status.set,
          version: status.version + 1,
          members: status.members
            .filter(m => m._id !== memberToRemove._id)
            .map((m, index) => ({
              _id: index,
              host: m.name
            }))
        }
      });
      console.log('✅ Member removed successfully');
    } catch (error) {
      if (error.message.includes('version')) {
        // Retry with correct version
        const newStatus = await admin.command({ replSetGetStatus: 1 });
        await admin.command({
          replSetReconfig: {
            _id: newStatus.set,
            version: newStatus.version + 1,
            members: newStatus.members
              .filter(m => m._id !== memberToRemove._id)
              .map((m, index) => ({
                _id: index,
                host: m.name
              }))
          }
        });
        console.log('✅ Member removed successfully (after version retry)');
      } else {
        throw error;
      }
    }
    
    console.log('');
    console.log('🔍 Verifying new replica set status...');
    const newStatus = await admin.command({ replSetGetStatus: 1 });
    console.log('Remaining members:');
    newStatus.members.forEach((member, i) => {
      console.log(`  ${i + 1}. ${member.name} - ${member.stateStr}`);
    });
    
    await mongoose.disconnect();
    console.log('');
    console.log('✅ Replica set member removal completed successfully!');
    
  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Note: If you see "not authorized" error, you may need to:');
    console.error('  1. Connect to MongoDB with admin credentials');
    console.error('  2. Or manually remove the member using mongosh:');
    console.error(`     rs.remove("${MEMBER_TO_REMOVE}")`);
    process.exit(1);
  }
}

removeReplicaMember();







