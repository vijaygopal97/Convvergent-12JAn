require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in environment variables');
  process.exit(1);
}

async function createIndexes() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    console.log('✅ Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('catirespondentqueues');

    console.log('\n📊 Creating optimized indexes for CATI queue...');

    // Phase 1: Composite index for exact query pattern + sort
    // Query: { survey, status, 'respondentContact.ac': { $in: acNames } } + sort by createdAt
    const index1 = {
      survey: 1,
      status: 1,
      'respondentContact.ac': 1,
      createdAt: 1
    };

    console.log('\n1. Creating index: { survey: 1, status: 1, "respondentContact.ac": 1, createdAt: 1 }');
    try {
      await collection.createIndex(index1, {
        name: 'survey_1_status_1_respondentContact.ac_1_createdAt_1',
        background: true
      });
      console.log('   ✅ Index created successfully');
    } catch (err) {
      if (err.code === 85 || err.codeName === 'IndexOptionsConflict') {
        console.log('   ⚠️  Index already exists (updating if needed)');
        // Index exists, that's fine
      } else if (err.code === 86 || err.codeName === 'IndexKeySpecsConflict') {
        console.log('   ⚠️  Similar index exists with different options');
      } else {
        throw err;
      }
    }

    // Verify indexes
    console.log('\n📋 Verifying indexes...');
    const indexes = await collection.indexes();
    const indexNames = indexes.map(idx => idx.name);
    
    console.log('\n✅ Existing indexes:');
    indexes.forEach(idx => {
      console.log(`   - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    const requiredIndex = 'survey_1_status_1_respondentContact.ac_1_createdAt_1';
    if (indexNames.includes(requiredIndex)) {
      console.log(`\n✅ Required index "${requiredIndex}" exists`);
    } else {
      console.log(`\n⚠️  Required index "${requiredIndex}" not found, but similar indexes may work`);
    }

    console.log('\n✅ Index creation complete');
    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
    await mongoose.disconnect();
    process.exit(1);
  }
}

createIndexes();
