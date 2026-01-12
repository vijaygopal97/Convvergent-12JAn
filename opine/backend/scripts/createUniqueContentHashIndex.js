/**
 * Create unique sparse index on contentHash
 * This script removes contentHash from abandoned duplicates first, then creates the unique index
 */

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
require('dotenv').config();

const createUniqueIndex = async () => {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 Step 1: Removing contentHash from abandoned duplicates...');
    
    // Find all abandoned responses that have a contentHash
    const abandonedWithHash = await SurveyResponse.find({
      status: 'abandoned',
      contentHash: { $exists: true, $ne: null }
    }).select('_id responseId contentHash').lean();
    
    console.log(`   Found ${abandonedWithHash.length} abandoned responses with contentHash`);
    
    // Remove contentHash from abandoned duplicates to allow unique index creation
    let removedCount = 0;
    for (const response of abandonedWithHash) {
      // Check if there's another response (not abandoned) with the same contentHash
      const otherResponse = await SurveyResponse.findOne({
        contentHash: response.contentHash,
        status: { $ne: 'abandoned' },
        _id: { $ne: response._id }
      }).lean();
      
      if (otherResponse) {
        // This is a duplicate - remove contentHash from the abandoned one
        await SurveyResponse.updateOne(
          { _id: response._id },
          { $unset: { contentHash: '' } }
        );
        removedCount++;
        console.log(`   ✅ Removed contentHash from abandoned duplicate: ${response.responseId}`);
      }
    }
    
    console.log(`\n✅ Removed contentHash from ${removedCount} abandoned duplicates`);

    console.log('\n🔍 Step 2: Checking for remaining duplicates...');
    
    // Check if there are any remaining duplicates (should be none after removing from abandoned)
    const duplicates = await SurveyResponse.aggregate([
      {
        $match: {
          contentHash: { $exists: true, $ne: null },
          status: { $ne: 'abandoned' } // Exclude abandoned
        }
      },
      {
        $group: {
          _id: '$contentHash',
          count: { $sum: 1 },
          responseIds: { $push: '$responseId' }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    
    if (duplicates.length > 0) {
      console.log(`⚠️  WARNING: Found ${duplicates.length} remaining duplicate contentHash values:`);
      duplicates.forEach(dup => {
        console.log(`   ContentHash: ${dup._id}, Count: ${dup.count}, ResponseIds: ${dup.responseIds.join(', ')}`);
      });
      console.log('\n❌ Cannot create unique index with existing duplicates. Please resolve duplicates first.');
      process.exit(1);
    }
    
    console.log('✅ No remaining duplicates found (excluding abandoned)');

    console.log('\n🔍 Step 3: Creating unique sparse index on contentHash...');
    
    // Drop existing non-unique index if it exists
    try {
      await SurveyResponse.collection.dropIndex('contentHash_1');
      console.log('   ✅ Dropped existing contentHash index');
    } catch (error) {
      if (error.codeName === 'IndexNotFound') {
        console.log('   ℹ️  No existing index to drop');
      } else {
        throw error;
      }
    }
    
    // Create unique sparse index
    await SurveyResponse.collection.createIndex(
      { contentHash: 1 },
      { unique: true, sparse: true, name: 'contentHash_1_unique' }
    );
    
    console.log('✅ Created unique sparse index on contentHash');

    // Verify the index
    const indexes = await SurveyResponse.collection.indexes();
    const contentHashIndex = indexes.find(idx => idx.key && idx.key.contentHash);
    
    if (contentHashIndex && contentHashIndex.unique) {
      console.log('\n✅ Verification: Unique index created successfully');
      console.log(`   Index name: ${contentHashIndex.name}`);
      console.log(`   Unique: ${contentHashIndex.unique}`);
      console.log(`   Sparse: ${contentHashIndex.sparse || false}`);
    } else {
      console.log('\n❌ Verification failed: Index not found or not unique');
      process.exit(1);
    }

    await mongoose.connection.close();
    console.log('\n✅ Script complete!');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
};

createUniqueIndex();





