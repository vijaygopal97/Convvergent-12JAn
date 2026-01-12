/**
 * Delete skipped files by matching via sessionId to recovered responses
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '../../uploads/temp');
const REPORT_FILE = path.join(__dirname, '../../orphaned-files-cleanup-report.json');
const DELETION_REPORT_FILE = path.join(__dirname, '../../skipped-files-deletion-report.json');

async function deleteSkippedViaSessionId() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Load recovery report
    const report = JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8'));
    const successful = report.recovery.details.filter(d => d.status === 'success');
    const successfulFilenames = new Set(successful.map(d => d.filename));
    const successfulResponseIds = new Set(successful.map(d => d.responseId).filter(Boolean));

    console.log(`📊 Loaded recovery report:`);
    console.log(`  Successful recoveries: ${successful.length}`);
    console.log(`  Unique responses recovered: ${successfulResponseIds.size}\n`);

    // Get all responses with audio (including recovered ones)
    console.log('🔍 Fetching all responses with audio...');
    const SurveyResponse = require('../models/SurveyResponse');
    const responsesWithAudio = await SurveyResponse.find({
      'audioRecording.hasAudio': true,
      'audioRecording.audioUrl': { $exists: true, $ne: null, $ne: '' }
    }).select('responseId metadata.sessionId sessionId').lean();

    console.log(`  Found ${responsesWithAudio.length} responses with audio\n`);

    // Build sessionId to responseId mapping
    const sessionIdToResponseId = {};
    responsesWithAudio.forEach(r => {
      const sessionId = r.metadata?.sessionId || r.sessionId;
      if (sessionId && r.responseId) {
        sessionIdToResponseId[sessionId] = r.responseId;
      }
    });

    console.log(`  Built ${Object.keys(sessionIdToResponseId).length} sessionId mappings\n`);

    // Get all temp files
    const tempFiles = fs.readdirSync(TEMP_DIR)
      .filter(f => f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.webm'));

    console.log(`📊 Total temp files: ${tempFiles.length}`);

    // Find files that match responses with audio (via responseId or sessionId)
    console.log('🔍 Finding files matching responses with audio...\n');
    const filesToDelete = [];

    for (const filename of tempFiles) {
      // Skip if this file was successfully recovered
      if (successfulFilenames.has(filename)) {
        continue;
      }

      let shouldDelete = false;
      let reason = '';

      // Check via responseId
      const responseIdMatch = filename.match(/interview_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})_/);
      if (responseIdMatch) {
        const responseId = responseIdMatch[1];
        if (successfulResponseIds.has(responseId)) {
          shouldDelete = true;
          reason = 'matches recovered response via responseId';
        }
      }

      // Check via sessionId
      if (!shouldDelete) {
        const sessionIdMatch = filename.match(/interview_([a-f0-9-]{36}|offline_[a-zA-Z0-9_]+)_/);
        if (sessionIdMatch) {
          const sessionId = sessionIdMatch[1];
          const mappedResponseId = sessionIdToResponseId[sessionId];
          if (mappedResponseId && successfulResponseIds.has(mappedResponseId)) {
            shouldDelete = true;
            reason = 'matches recovered response via sessionId';
          }
        }
      }

      if (shouldDelete) {
        filesToDelete.push({
          filename,
          reason
        });
      }
    }

    console.log(`  Found ${filesToDelete.length} files to delete\n`);

    if (filesToDelete.length === 0) {
      console.log('⚠️  No files found to delete.');
      console.log('   The skipped files may have been deleted already.\n');
      await mongoose.disconnect();
      return;
    }

    // Delete files
    console.log('🗑️  Deleting files...');
    const deletionReport = {
      startTime: new Date().toISOString(),
      totalFiles: filesToDelete.length,
      deleted: 0,
      failed: 0,
      totalSize: 0,
      details: []
    };

    for (let i = 0; i < filesToDelete.length; i += 500) {
      const batch = filesToDelete.slice(i, i + 500);
      
      for (const file of batch) {
        const filePath = path.join(TEMP_DIR, file.filename);
        try {
          if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            const fileSize = stats.size;
            
            fs.unlinkSync(filePath);
            
            deletionReport.deleted++;
            deletionReport.totalSize += fileSize;
            
            if (deletionReport.details.length < 100) {
              deletionReport.details.push({
                filename: file.filename,
                size: fileSize,
                reason: file.reason
              });
            }
          }
        } catch (error) {
          deletionReport.failed++;
          if (deletionReport.failed <= 10) {
            console.error(`  Failed to delete ${file.filename}:`, error.message);
          }
        }
      }

      if ((i + 500) % 1000 === 0 || i + 500 >= filesToDelete.length) {
        console.log(`  Deleted ${Math.min(i + 500, filesToDelete.length)}/${filesToDelete.length} files...`);
      }
    }

    deletionReport.endTime = new Date().toISOString();
    deletionReport.duration = `${((new Date(deletionReport.endTime) - new Date(deletionReport.startTime)) / 1000).toFixed(2)} seconds`;

    // Save deletion report
    fs.writeFileSync(DELETION_REPORT_FILE, JSON.stringify(deletionReport, null, 2));

    console.log(`\n✅ Deletion complete:`);
    console.log(`  Deleted: ${deletionReport.deleted} files`);
    console.log(`  Failed: ${deletionReport.failed} files`);
    console.log(`  Total size freed: ${(deletionReport.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
    console.log(`  Report saved to: ${DELETION_REPORT_FILE}\n`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

deleteSkippedViaSessionId();

