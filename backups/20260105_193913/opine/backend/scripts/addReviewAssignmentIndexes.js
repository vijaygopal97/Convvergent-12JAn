/**
 * Add indexes for getNextReviewAssignment query optimization
 * 
 * This script adds indexes on nested fields used in the getNextReviewAssignment query:
 * - reviewAssignment.assignedTo
 * - reviewAssignment.expiresAt
 * - isSampleResponse
 * 
 * These indexes will significantly speed up the query that matches 38,064+ documents.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');

(async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔌 Connected to MongoDB');

    console.log('📊 Adding indexes for getNextReviewAssignment optimization...');

    // Index 1: reviewAssignment.assignedTo (for filtering assigned responses)
    console.log('   Adding index on reviewAssignment.assignedTo...');
    await SurveyResponse.collection.createIndex(
      { 'reviewAssignment.assignedTo': 1 },
      { background: true, name: 'reviewAssignment_assignedTo_1' }
    );
    console.log('   ✅ Index on reviewAssignment.assignedTo created');

    // Index 2: reviewAssignment.expiresAt (for filtering expired assignments)
    console.log('   Adding index on reviewAssignment.expiresAt...');
    await SurveyResponse.collection.createIndex(
      { 'reviewAssignment.expiresAt': 1 },
      { background: true, name: 'reviewAssignment_expiresAt_1' }
    );
    console.log('   ✅ Index on reviewAssignment.expiresAt created');

    // Index 3: isSampleResponse (for filtering sample responses)
    console.log('   Adding index on isSampleResponse...');
    await SurveyResponse.collection.createIndex(
      { isSampleResponse: 1 },
      { background: true, name: 'isSampleResponse_1' }
    );
    console.log('   ✅ Index on isSampleResponse created');

    // Index 4: Compound index for efficient querying (status + createdAt for sorting)
    console.log('   Adding compound index on status + createdAt...');
    await SurveyResponse.collection.createIndex(
      { status: 1, createdAt: 1 },
      { background: true, name: 'status_1_createdAt_1' }
    );
    console.log('   ✅ Compound index on status + createdAt created');

    // Index 5: Compound index for reviewAssignment queries (status + reviewAssignment fields)
    console.log('   Adding compound index on status + reviewAssignment...');
    await SurveyResponse.collection.createIndex(
      { status: 1, 'reviewAssignment.assignedTo': 1, 'reviewAssignment.expiresAt': 1 },
      { background: true, name: 'status_1_reviewAssignment_compound' }
    );
    console.log('   ✅ Compound index on status + reviewAssignment created');

    // Verify indexes
    const indexes = await SurveyResponse.collection.indexes();
    console.log('\n📋 Current indexes:');
    indexes.forEach(idx => {
      const keys = Object.keys(idx.key).join(', ');
      console.log(`   - {${keys}}`);
    });

    console.log('\n✅ All indexes created successfully!');
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error adding indexes:', error);
    process.exit(1);
  }
})();

