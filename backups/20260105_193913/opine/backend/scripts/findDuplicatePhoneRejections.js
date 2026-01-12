#!/usr/bin/env node

/**
 * Find all responses rejected due to duplicate phone numbers
 * Groups them by phone number and identifies original vs duplicates
 */

require('dotenv').config();
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Load models
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const Survey = require('../models/Survey');

const MONGODB_URI = process.env.MONGODB_URI;
const TARGET_SURVEY_ID = '68fd1915d41841da463f0d46';
const PHONE_QUESTION_TEXT = 'Would you like to share your mobile number with us? We assure you we shall keep it confidential and shall use only for quality control purposes.';

const REPORT_DIR = '/var/www/Report-Generation/ImprovedDuplicateRemove';
const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

/**
 * Extract phone number from response
 */
function extractPhoneNumber(responses) {
  if (!responses || !Array.isArray(responses)) return null;
  
  const phoneResponse = responses.find(r => {
    const questionText = r.questionText || r.question?.text || '';
    return questionText.includes('mobile number') || 
           questionText.includes('phone number') ||
           questionText.toLowerCase().includes('share your mobile') ||
           questionText === PHONE_QUESTION_TEXT;
  });
  
  if (!phoneResponse || !phoneResponse.response) return null;
  
  let phoneValue = phoneResponse.response;
  
  if (Array.isArray(phoneValue)) {
    phoneValue = phoneValue[0];
  } else if (typeof phoneValue === 'object' && phoneValue !== null) {
    phoneValue = phoneValue.phone || phoneValue.value || phoneValue.text || phoneValue;
  }
  
  // Clean phone number
  if (typeof phoneValue === 'string') {
    return phoneValue.replace(/\s+/g, '').replace(/-/g, '').replace(/\(/g, '').replace(/\)/g, '').trim();
  } else if (typeof phoneValue === 'number') {
    return phoneValue.toString().trim();
  }
  
  return null;
}

/**
 * Normalize phone number for comparison
 */
function normalizePhone(phone) {
  if (!phone) return null;
  return String(phone).toLowerCase().trim();
}

/**
 * Format response details similar to findAndMarkDuplicates.js
 */
function formatResponseDetails(response, interviewer, survey) {
  return {
    responseId: response.responseId,
    mongoId: response._id.toString(),
    status: response.status,
    interviewMode: response.interviewMode,
    startTime: response.startTime,
    endTime: response.endTime,
    totalTimeSpent: response.totalTimeSpent,
    createdAt: response.createdAt,
    interviewer: {
      id: interviewer?._id?.toString() || 'N/A',
      name: interviewer?.name || 'N/A',
      memberId: interviewer?.memberId || interviewer?.memberID || 'N/A',
      email: interviewer?.email || 'N/A'
    },
    survey: {
      id: survey?._id?.toString() || 'N/A',
      name: survey?.surveyName || 'N/A'
    },
    selectedAC: response.selectedAC || 'N/A',
    selectedPC: response.selectedPC || 'N/A',
    selectedPS: response.selectedPS || 'N/A',
    audioRecording: response.audioRecording ? {
      audioUrl: response.audioRecording.audioUrl || 'N/A',
      recordingDuration: response.audioRecording.recordingDuration || 'N/A',
      fileSize: response.audioRecording.fileSize || 'N/A',
      format: response.audioRecording.format || 'N/A'
    } : null,
    location: response.location ? {
      latitude: response.location.latitude || 'N/A',
      longitude: response.location.longitude || 'N/A'
    } : null,
    gpsLocation: response.gpsLocation ? {
      latitude: response.gpsLocation.latitude || 'N/A',
      longitude: response.gpsLocation.longitude || 'N/A'
    } : null,
    call_id: response.call_id || 'N/A',
    verificationData: response.verificationData ? {
      feedback: response.verificationData.feedback || 'N/A',
      autoRejected: response.verificationData.autoRejected || false,
      reviewedAt: response.verificationData.reviewedAt || 'N/A'
    } : null,
    responsesCount: response.responses?.length || 0
  };
}

async function findDuplicatePhoneRejections() {
  try {
    console.log('='.repeat(80));
    console.log('FINDING DUPLICATE PHONE NUMBER REJECTIONS');
    console.log('='.repeat(80));
    console.log('');
    
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    console.log('');
    
    // Find all responses with "Duplicate Phone Number" in feedback (for reference)
    console.log('🔍 Finding responses rejected due to duplicate phone numbers...');
    const duplicatePhoneRejections = await SurveyResponse.find({
      survey: TARGET_SURVEY_ID,
      $or: [
        { 'verificationData.feedback': { $regex: /duplicate.*phone|phone.*duplicate/i } },
        { 'verificationData.autoRejectionReasons': 'duplicate_phone' },
        { 'metadata.rejectionReason': { $regex: /duplicate.*phone|phone.*duplicate/i } }
      ]
    })
      .select('_id responseId')
      .lean();
    
    const rejectedResponseIds = new Set(duplicatePhoneRejections.map(r => r._id.toString()));
    console.log(`✅ Found ${duplicatePhoneRejections.length} responses with duplicate phone rejection`);
    console.log('');
    
    if (duplicatePhoneRejections.length === 0) {
      console.log('❌ No duplicate phone rejections found');
      await mongoose.disconnect();
      return;
    }
    
    // Now find ALL responses (not just rejected) for these phone numbers to identify originals
    console.log('🔍 Finding all responses (including originals) for these phone numbers...');
    const allResponses = await SurveyResponse.find({
      survey: TARGET_SURVEY_ID
    })
      .populate('interviewer', 'name email memberId memberID')
      .populate('survey', 'surveyName')
      .lean();
    
    // Group all responses by phone number (optimized)
    console.log('📱 Extracting and grouping phone numbers...');
    const allPhoneGroups = new Map();
    let processedCount = 0;
    
    for (const response of allResponses) {
      processedCount++;
      if (processedCount % 5000 === 0) {
        console.log(`   Processed ${processedCount}/${allResponses.length} responses...`);
      }
      
      const phoneNumber = extractPhoneNumber(response.responses);
      if (!phoneNumber || phoneNumber === '0') continue;
      
      const normalizedPhone = normalizePhone(phoneNumber);
      if (!allPhoneGroups.has(normalizedPhone)) {
        allPhoneGroups.set(normalizedPhone, []);
      }
      
      allPhoneGroups.get(normalizedPhone).push(response);
    }
    
    // Filter to only phone numbers that have duplicates
    const duplicatePhoneNumbers = Array.from(allPhoneGroups.entries())
      .filter(([phone, responses]) => responses.length > 1);
    
    console.log(`✅ Found ${duplicatePhoneNumbers.length} phone numbers with multiple responses`);
    console.log('');
    
    // Count how many of these have rejected duplicates
    let groupsWithRejected = 0;
    for (const [phone, responses] of duplicatePhoneNumbers) {
      const hasRejected = responses.some(r => rejectedResponseIds.has(r._id.toString()));
      if (hasRejected) groupsWithRejected++;
    }
    console.log(`✅ Found ${groupsWithRejected} phone number groups with rejected duplicates`);
    console.log('');
    
    // Build report
    console.log('📊 Building report...');
    const report = {
      timestamp: new Date().toISOString(),
      surveyId: TARGET_SURVEY_ID,
      summary: {
        totalDuplicatePhoneNumbers: duplicatePhoneNumbers.length,
        totalResponsesWithDuplicatePhone: duplicatePhoneRejections.length,
        totalResponsesInDuplicateGroups: duplicatePhoneNumbers.reduce((sum, [, responses]) => sum + responses.length, 0)
      },
      groups: []
    };
    
    // Process each phone number group (only those with rejected duplicates)
    console.log('📊 Processing duplicate phone groups...');
    let processedGroups = 0;
    
    for (const [normalizedPhone, responses] of duplicatePhoneNumbers) {
      processedGroups++;
      if (processedGroups % 200 === 0) {
        console.log(`   Processed ${processedGroups}/${duplicatePhoneNumbers.length} groups...`);
      }
      
      // Sort by createdAt to find original (first one)
      const sortedResponses = responses.sort((a, b) => {
        const dateA = new Date(a.createdAt || a.startTime || 0);
        const dateB = new Date(b.createdAt || b.startTime || 0);
        return dateA - dateB;
      });
      
      const original = sortedResponses[0];
      const duplicates = sortedResponses.slice(1);
      
      // Check which duplicates were rejected (using the rejectedResponseIds set for efficiency)
      const rejectedDuplicates = duplicates.filter(r => rejectedResponseIds.has(r._id.toString()));
      
      // Only include groups that have at least one rejected duplicate
      if (rejectedDuplicates.length === 0) continue;
      
      // Check if original was also rejected (shouldn't happen, but check anyway)
      const originalIsRejected = rejectedResponseIds.has(original._id.toString());
      
      const group = {
        phoneNumber: responses[0] ? extractPhoneNumber(responses[0].responses) : normalizedPhone,
        normalizedPhone,
        totalResponses: responses.length,
        original: {
          ...formatResponseDetails(original, original.interviewer, original.survey),
          isRejected: originalIsRejected,
          rejectionReason: originalIsRejected ? (original.verificationData?.feedback || original.metadata?.rejectionReason || 'N/A') : 'N/A'
        },
        duplicates: duplicates.map(dup => {
          const isRejected = rejectedResponseIds.has(dup._id.toString());
          return {
            ...formatResponseDetails(dup, dup.interviewer, dup.survey),
            isRejected,
            rejectionReason: isRejected ? (dup.verificationData?.feedback || dup.metadata?.rejectionReason || 'N/A') : 'N/A'
          };
        }),
        rejectedCount: rejectedDuplicates.length,
        nonRejectedCount: duplicates.length - rejectedDuplicates.length
      };
      
      report.groups.push(group);
    }
    
    // Sort groups by phone number
    report.groups.sort((a, b) => a.phoneNumber.localeCompare(b.phoneNumber));
    
    // Save report
    const reportPath = path.join(REPORT_DIR, `duplicate_phone_rejections_${TIMESTAMP}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log('✅ Report saved:', reportPath);
    console.log('');
    
    // Print summary
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log('');
    console.log(`Total Phone Numbers with Duplicates: ${report.summary.totalDuplicatePhoneNumbers}`);
    console.log(`Total Responses in Duplicate Groups: ${report.summary.totalResponsesInDuplicateGroups}`);
    console.log(`Total Responses Rejected for Duplicate Phone: ${report.summary.totalResponsesWithDuplicatePhone}`);
    console.log('');
    console.log(`Top 10 Phone Numbers with Most Duplicates:`);
    report.groups
      .sort((a, b) => b.totalResponses - a.totalResponses)
      .slice(0, 10)
      .forEach((group, i) => {
        console.log(`  ${i + 1}. Phone: ${group.phoneNumber} - ${group.totalResponses} responses (${group.rejectedCount} rejected)`);
      });
    console.log('');
    console.log('📄 Full report:', reportPath);
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

// Run the script
findDuplicatePhoneRejections();

