/**
 * Recover and Cleanup Orphaned Files
 * 
 * 1. Recover files matching responses without audio
 * 2. Delete duplicates (responses already have audio)
 * 3. Delete completely orphaned files
 * 
 * All actions are logged and reported
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SurveyResponse = require('../models/SurveyResponse');
const { uploadToS3, generateAudioKey } = require('../utils/cloudStorage');

const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const RECOVERY_REPORT_FILE = path.join(__dirname, '../../orphaned-files-cleanup-report.json');
const BATCH_SIZE = 500; // Process in larger batches for speed
const DB_BATCH_SIZE = 1000; // Bulk database queries

// Report structure
const report = {
  startTime: new Date().toISOString(),
  endTime: null,
  duration: null,
  totalFilesProcessed: 0,
  recovery: {
    attempted: 0,
    successful: 0,
    failed: 0,
    skipped: 0,
    details: []
  },
  deletion: {
    duplicates: {
      count: 0,
      size: 0,
      details: []
    },
    orphaned: {
      count: 0,
      size: 0,
      details: []
    }
  },
  errors: []
};

/**
 * Validate audio file
 */
function validateAudioFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, error: 'File does not exist' };
    }

    const stats = fs.statSync(filePath);
    
    if (stats.size === 0) {
      return { valid: false, error: 'File is empty' };
    }

    if (stats.size < 1024) {
      return { valid: false, error: 'File too small (likely corrupted)' };
    }

    return { 
      valid: true, 
      size: stats.size,
      extension: path.extname(filePath).toLowerCase()
    };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Recover a single file
 */
async function recoverFile(filename, response, matchType) {
  const filePath = path.join(TEMP_DIR, filename);
  const result = {
    filename,
    responseId: response.responseId,
    matchType,
    status: 'failed',
    error: null,
    s3Key: null,
    fileSize: 0
  };

  try {
    // Validate file
    const validation = validateAudioFile(filePath);
    if (!validation.valid) {
      result.error = validation.error;
      report.recovery.failed++;
      return result;
    }

    result.fileSize = validation.size;

    // Check if response already has audio (shouldn't happen, but double-check)
    const existingResponse = await SurveyResponse.findById(response._id)
      .select('audioRecording')
      .lean();

    if (existingResponse?.audioRecording?.hasAudio && existingResponse.audioRecording.audioUrl) {
      result.status = 'skipped';
      result.error = 'Response already has audio';
      report.recovery.skipped++;
      return result;
    }

    // Upload to S3
    const s3Key = generateAudioKey(response.responseId, filename);
    const uploadResult = await uploadToS3(filePath, s3Key, {
      contentType: validation.extension === '.m4a' ? 'audio/mp4' : 
                   validation.extension === '.mp3' ? 'audio/mpeg' :
                   validation.extension === '.webm' ? 'audio/webm' :
                   'audio/mpeg',
      metadata: {
        responseId: response.responseId,
        recovered: 'true',
        recoveredAt: new Date().toISOString(),
        matchType: matchType,
        originalFilename: filename
      }
    });

    result.s3Key = uploadResult.key;

    // Link to response
    const updateData = {
      'audioRecording.hasAudio': true,
      'audioRecording.audioUrl': uploadResult.key,
      'audioRecording.uploadedAt': new Date(),
      'audioRecording.storageType': 's3',
      'audioRecording.filename': filename,
      'audioRecording.fileSize': validation.size,
      'audioRecording.format': validation.extension.replace('.', ''),
      'audioRecording.mimetype': validation.extension === '.m4a' ? 'audio/mp4' : 
                                 validation.extension === '.mp3' ? 'audio/mpeg' :
                                 validation.extension === '.webm' ? 'audio/webm' :
                                 'audio/mpeg',
      'audioRecording.recovered': true,
      'audioRecording.recoveredAt': new Date(),
      'audioRecording.recoveryMatchType': matchType
    };

    const updateResult = await SurveyResponse.updateOne(
      { _id: response._id },
      { $set: updateData }
    );

    if (updateResult.modifiedCount > 0) {
      result.status = 'success';
      report.recovery.successful++;
      console.log(`✅ Recovered: ${filename} -> ${response.responseId}`);
    } else {
      result.status = 'failed';
      result.error = 'Database update failed';
      report.recovery.failed++;
    }

  } catch (error) {
    result.status = 'failed';
    result.error = error.message;
    report.recovery.failed++;
    console.error(`❌ Failed to recover ${filename}:`, error.message);
  }

  report.recovery.details.push(result);
  return result;
}

/**
 * Delete a file safely
 */
function deleteFileSafely(filename, reason) {
  const filePath = path.join(TEMP_DIR, filename);
  
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const stats = fs.statSync(filePath);
    const fileSize = stats.size;

    fs.unlinkSync(filePath);

    return {
      success: true,
      filename,
      size: fileSize,
      reason
    };
  } catch (error) {
    return {
      success: false,
      filename,
      error: error.message,
      reason
    };
  }
}

/**
 * Main processing function
 */
async function processOrphanedFiles() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load recovery report to exclude already recovered files
    const recoveryReportPath = path.join(__dirname, '../../recovery-report.json');
    let recoveredFilenames = new Set();
    if (fs.existsSync(recoveryReportPath)) {
      const recoveryReport = JSON.parse(fs.readFileSync(recoveryReportPath, 'utf8'));
      recoveredFilenames = new Set(recoveryReport.details.map(d => path.basename(d.filename || d.filePath)));
    }

    // Get all temp files
    const tempFiles = fs.readdirSync(TEMP_DIR)
      .filter(f => f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.webm'))
      .filter(f => !recoveredFilenames.has(f));

    console.log(`📊 Processing ${tempFiles.length} orphaned files...\n`);

    // OPTIMIZED: Extract all IDs first, then bulk query
    console.log('🔍 Extracting IDs from filenames...');
    const responseIds = new Set();
    const sessionIds = new Set();
    const fileMetadata = [];

    for (const filename of tempFiles) {
      const responseIdMatch = filename.match(/interview_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})_/);
      const sessionIdMatch = filename.match(/interview_([a-f0-9-]{36}|offline_[a-zA-Z0-9_]+)_/);

      if (responseIdMatch) responseIds.add(responseIdMatch[1]);
      if (sessionIdMatch) sessionIds.add(sessionIdMatch[1]);

      fileMetadata.push({
        filename,
        responseId: responseIdMatch ? responseIdMatch[1] : null,
        sessionId: sessionIdMatch ? sessionIdMatch[1] : null
      });
    }

    console.log(`  Extracted ${responseIds.size} unique responseIds and ${sessionIds.size} unique sessionIds`);

    // Bulk fetch all responses by responseId
    console.log('🔍 Bulk fetching responses from database...');
    const responsesById = new Map();
    if (responseIds.size > 0) {
      const responseIdArray = Array.from(responseIds);
      for (let i = 0; i < responseIdArray.length; i += DB_BATCH_SIZE) {
        const batch = responseIdArray.slice(i, i + DB_BATCH_SIZE);
        const responses = await SurveyResponse.find({ responseId: { $in: batch } })
          .select('responseId audioRecording _id')
          .lean();
        responses.forEach(r => responsesById.set(r.responseId, r));
        if ((i + DB_BATCH_SIZE) % 5000 === 0 || i + DB_BATCH_SIZE >= responseIdArray.length) {
          console.log(`  Fetched ${Math.min(i + DB_BATCH_SIZE, responseIdArray.length)}/${responseIdArray.length} responses by responseId...`);
        }
      }
    }

    // Bulk fetch all responses by sessionId
    const responsesBySessionId = new Map();
    if (sessionIds.size > 0) {
      const sessionIdArray = Array.from(sessionIds);
      for (let i = 0; i < sessionIdArray.length; i += DB_BATCH_SIZE) {
        const batch = sessionIdArray.slice(i, i + DB_BATCH_SIZE);
        const responses = await SurveyResponse.find({
          $or: [
            { 'metadata.sessionId': { $in: batch } },
            { sessionId: { $in: batch } }
          ]
        })
          .select('responseId audioRecording _id metadata.sessionId sessionId')
          .lean();
        responses.forEach(r => {
          const sessionId = r.metadata?.sessionId || r.sessionId;
          if (sessionId) responsesBySessionId.set(sessionId, r);
        });
        if ((i + DB_BATCH_SIZE) % 5000 === 0 || i + DB_BATCH_SIZE >= sessionIdArray.length) {
          console.log(`  Fetched ${Math.min(i + DB_BATCH_SIZE, sessionIdArray.length)}/${sessionIdArray.length} responses by sessionId...`);
        }
      }
    }

    console.log(`  Total responses found: ${responsesById.size} by responseId, ${responsesBySessionId.size} by sessionId\n`);

    // Categorize files using pre-fetched data
    console.log('🔍 Categorizing files...');
    const filesToRecover = [];
    const filesToDelete = [];

    for (const file of fileMetadata) {
      let response = null;
      let matchType = null;

      if (file.responseId && responsesById.has(file.responseId)) {
        response = responsesById.get(file.responseId);
        matchType = 'responseId';
      } else if (file.sessionId && responsesBySessionId.has(file.sessionId)) {
        response = responsesBySessionId.get(file.sessionId);
        matchType = 'sessionId';
      }

      if (response) {
        if (response.audioRecording && response.audioRecording.hasAudio && response.audioRecording.audioUrl) {
          filesToDelete.push({ filename: file.filename, reason: 'duplicate', responseId: response.responseId });
        } else {
          filesToRecover.push({ filename: file.filename, response, matchType });
        }
      } else {
        filesToDelete.push({ filename: file.filename, reason: 'orphaned' });
      }
    }

    console.log(`\n📊 Categorization complete:`);
    console.log(`  Files to recover: ${filesToRecover.length}`);
    console.log(`  Files to delete: ${filesToDelete.length} (duplicates: ${filesToDelete.filter(f => f.reason === 'duplicate').length}, orphaned: ${filesToDelete.filter(f => f.reason === 'orphaned').length})\n`);

    // Step 1: Recover files - OPTIMIZED: Process in parallel batches
    console.log('📤 Step 1: Recovering files...');
    report.recovery.attempted = filesToRecover.length;

    for (let i = 0; i < filesToRecover.length; i += BATCH_SIZE) {
      const batch = filesToRecover.slice(i, i + BATCH_SIZE);
      
      // Process in parallel (but limit concurrency to avoid overwhelming S3)
      const results = await Promise.allSettled(batch.map(item => 
        recoverFile(item.filename, item.response, item.matchType)
      ));

      // Log any failures
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.error(`  Failed to process ${batch[idx].filename}:`, result.reason);
        }
      });

      if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= filesToRecover.length) {
        console.log(`  Processed ${Math.min(i + BATCH_SIZE, filesToRecover.length)}/${filesToRecover.length} files...`);
      }
    }

    console.log(`\n✅ Recovery complete: ${report.recovery.successful} successful, ${report.recovery.failed} failed, ${report.recovery.skipped} skipped\n`);

    // Step 2: Delete duplicates and orphaned files - OPTIMIZED: Parallel deletion
    console.log('🗑️  Step 2: Deleting duplicates and orphaned files...');

    for (let i = 0; i < filesToDelete.length; i += BATCH_SIZE) {
      const batch = filesToDelete.slice(i, i + BATCH_SIZE);
      
      // Delete in parallel
      const results = await Promise.allSettled(batch.map(item => 
        Promise.resolve(deleteFileSafely(item.filename, item.reason))
      ));

      // Process results
      results.forEach((result, idx) => {
        const item = batch[idx];
        const deleteResult = result.status === 'fulfilled' ? result.value : { success: false, error: result.reason?.message || 'Unknown error', filename: item.filename };
        
        if (deleteResult.success) {
          if (item.reason === 'duplicate') {
            report.deletion.duplicates.count++;
            report.deletion.duplicates.size += deleteResult.size;
            // Only store details for first 100 to avoid huge report
            if (report.deletion.duplicates.details.length < 100) {
              report.deletion.duplicates.details.push({
                filename: deleteResult.filename,
                size: deleteResult.size,
                responseId: item.responseId
              });
            }
          } else {
            report.deletion.orphaned.count++;
            report.deletion.orphaned.size += deleteResult.size;
            // Only store details for first 100 to avoid huge report
            if (report.deletion.orphaned.details.length < 100) {
              report.deletion.orphaned.details.push({
                filename: deleteResult.filename,
                size: deleteResult.size
              });
            }
          }
        } else {
          report.errors.push({
            action: 'delete',
            filename: deleteResult.filename,
            error: deleteResult.error,
            reason: item.reason
          });
        }
      });

      if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= filesToDelete.length) {
        console.log(`  Deleted ${Math.min(i + BATCH_SIZE, filesToDelete.length)}/${filesToDelete.length} files...`);
      }
    }

    console.log(`\n✅ Deletion complete: ${report.deletion.duplicates.count} duplicates, ${report.deletion.orphaned.count} orphaned\n`);

    // Finalize report
    report.endTime = new Date().toISOString();
    const duration = new Date(report.endTime) - new Date(report.startTime);
    report.duration = `${(duration / 1000).toFixed(2)} seconds`;
    report.totalFilesProcessed = tempFiles.length;

    // Save report
    fs.writeFileSync(RECOVERY_REPORT_FILE, JSON.stringify(report, null, 2));

    // Print summary
    console.log('===========================================');
    console.log('📊 CLEANUP SUMMARY');
    console.log('===========================================');
    console.log(`Total files processed: ${report.totalFilesProcessed}`);
    console.log(`Duration: ${report.duration}`);
    console.log('');
    console.log('📤 Recovery:');
    console.log(`  Attempted: ${report.recovery.attempted}`);
    console.log(`  Successful: ${report.recovery.successful}`);
    console.log(`  Failed: ${report.recovery.failed}`);
    console.log(`  Skipped: ${report.recovery.skipped}`);
    console.log('');
    console.log('🗑️  Deletion:');
    console.log(`  Duplicates: ${report.deletion.duplicates.count} files (${(report.deletion.duplicates.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
    console.log(`  Orphaned: ${report.deletion.orphaned.count} files (${(report.deletion.orphaned.size / 1024 / 1024 / 1024).toFixed(2)} GB)`);
    console.log(`  Total freed: ${((report.deletion.duplicates.size + report.deletion.orphaned.size) / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log('');
    console.log(`📄 Report saved to: ${RECOVERY_REPORT_FILE}`);
    console.log('===========================================\n');

    await mongoose.disconnect();
    console.log('✅ Process completed successfully');

  } catch (error) {
    console.error('❌ Fatal error:', error);
    report.errors.push({
      action: 'fatal',
      error: error.message,
      stack: error.stack
    });
    report.endTime = new Date().toISOString();
    fs.writeFileSync(RECOVERY_REPORT_FILE, JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

// Run the process
processOrphanedFiles();

