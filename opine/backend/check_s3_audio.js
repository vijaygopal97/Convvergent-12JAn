const AWS = require('aws-sdk');
require('dotenv').config();

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'ap-south-1'
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'convergent-audio-documents-bucket';

async function checkS3ForAudio() {
  try {
    // List all audio files in S3 from the last 2 days
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 2);
    
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const prevMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
    
    console.log('🔍 Searching S3 for recent audio files...');
    console.log();
    console.log();
    
    // Check current month
    const currentPrefix = `audio/interviews/${year}/${month}/`;
    const prevPrefix = `audio/interviews/${yesterday.getFullYear()}/${prevMonth}/`;
    
    const [currentFiles, prevFiles] = await Promise.all([
      listS3Files(currentPrefix),
      listS3Files(prevPrefix)
    ]);
    
    console.log(`\n📊 Found ${currentFiles.length} files in current month`);
    console.log(`📊 Found ${prevFiles.length} files in previous month`);
    
    const allFiles = [...currentFiles, ...prevFiles];
    console.log(`\n📋 Recent audio files (last 20):`);
    allFiles.slice(0, 20).forEach((file, idx) => {
      console.log(`   ${idx + 1}. ${file.key} (Size: ${(file.size / 1024).toFixed(2)} KB, Modified: ${file.lastModified})`);
    });
    
    return allFiles;
  } catch (error) {
    console.error('❌ Error checking S3:', error);
    throw error;
  }
}

async function listS3Files(prefix) {
  try {
    const params = {
      Bucket: BUCKET_NAME,
      Prefix: prefix
    };
    
    const data = await s3.listObjectsV2(params).promise();
    return (data.Contents || []).map(item => ({
      key: item.Key,
      size: item.Size,
      lastModified: item.LastModified
    }));
  } catch (error) {
    if (error.code === 'NoSuchBucket' || error.code === 'AccessDenied') {
      console.warn(`⚠️  Cannot access prefix ${prefix}: ${error.code}`);
      return [];
    }
    throw error;
  }
}

checkS3ForAudio()
  .then(() => {
    console.log('\n✅ S3 check completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Failed:', error);
    process.exit(1);
  });
