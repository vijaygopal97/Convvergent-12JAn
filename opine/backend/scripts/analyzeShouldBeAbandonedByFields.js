#!/usr/bin/env node

/**
 * Analyze Responses That Should Be Abandoned Based on Missing Fields
 * 
 * Analyzes responses in Pending_Approval that should be abandoned because:
 * 1. CATI responses without selectedAC
 * 2. Responses (CAPI/CATI) without Gender
 * 3. Responses (CAPI/CATI) without Age
 * 
 * Generates a detailed report similar to should_be_abandoned_analysis format
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const Survey = require('../models/Survey');
const User = require('../models/User');

// Helper functions from markResponsesWithoutGenderOrAge.js
/**
 * Extract value from response (handle arrays)
 */
function extractValue(response) {
  if (!response || response === null || response === undefined) return null;
  if (Array.isArray(response)) {
    return response.length > 0 ? response[0] : null;
  }
  return response;
}

/**
 * Get main text (remove translations like "Male_{পুরুষ}")
 */
function getMainText(text) {
  if (!text || typeof text !== 'string') return '';
  // Remove translation part (e.g., "Male_{পুরুষ}" -> "Male")
  return text.split('_{')[0].trim();
}

/**
 * Find response by question text
 */
function findResponseByQuestionText(responses, searchTexts) {
  if (!responses || !Array.isArray(responses)) return null;
  return responses.find(r => {
    if (!r.questionText) return false;
    const mainText = getMainText(r.questionText).toLowerCase();
    return searchTexts.some(text => mainText.includes(text.toLowerCase()));
  });
}

/**
 * Extract gender from responses
 */
function extractGender(responses, survey) {
  // Strategy 1: Find by fixed question ID
  let genderResponse = responses.find(r => {
    const questionId = r.questionId || '';
    return questionId.includes('fixed_respondent_gender');
  });
  
  if (genderResponse) {
    const genderValue = extractValue(genderResponse.response);
    if (genderValue && genderValue !== 'N/A' && genderValue !== null && genderValue !== undefined && String(genderValue).trim() !== '') {
      return getMainText(String(genderValue));
    }
  }
  
  // Strategy 2: Find by question text
  genderResponse = findResponseByQuestionText(responses, [
    'what is your gender',
    'please note the respondent\'s gender',
    'note the respondent\'s gender',
    'respondent\'s gender',
    'respondent gender',
    'note the gender',
    'gender'
  ]);
  
  if (genderResponse) {
    const genderValue = extractValue(genderResponse.response);
    if (genderValue && genderValue !== 'N/A' && genderValue !== null && genderValue !== undefined && String(genderValue).trim() !== '') {
      return getMainText(String(genderValue));
    }
  }
  
  // Strategy 3: Find registered voter question (equivalent to gender)
  genderResponse = findResponseByQuestionText(responses, [
    'are you a registered voter',
    'registered voter',
    'নিবন্ধিত ভোটার',
    'বিধানসভা কেন্দ্র'
  ]);
  
  if (genderResponse) {
    const genderValue = extractValue(genderResponse.response);
    if (genderValue && genderValue !== 'N/A' && genderValue !== null && genderValue !== undefined && String(genderValue).trim() !== '') {
      return getMainText(String(genderValue));
    }
  }
  
  return null;
}

/**
 * Extract age from responses
 */
function extractAge(responses) {
  const ageResponse = findResponseByQuestionText(responses, [
    'could you please tell me your age',
    'your age in complete years',
    'age in complete years',
    'age',
    'year'
  ]);
  
  if (ageResponse) {
    const ageValue = extractValue(ageResponse.response);
    if (ageValue !== null && ageValue !== undefined && ageValue !== 'N/A') {
      const ageStr = String(ageValue).trim();
      if (ageStr !== '') {
        const ageNum = parseInt(ageStr);
        if (!isNaN(ageNum) && ageNum > 0 && ageNum < 150) {
          return ageNum;
        }
        return ageStr;
      }
    }
  }
  
  return null;
}

/**
 * Get AC name from selectedAC field or responses
 */
function extractAC(response) {
  // First check selectedAC field (primary source)
  if (response.selectedAC && 
      response.selectedAC !== null && 
      response.selectedAC !== undefined && 
      String(response.selectedAC).trim() !== '') {
    return String(response.selectedAC).trim();
  }
  
  // For CAPI: Try to find AC in responses
  if (response.interviewMode === 'capi' || response.interviewMode === 'CAPI') {
    const responses = response.responses || [];
    const acResponse = findResponseByQuestionText(responses, [
      'assembly constituency',
      'assembly constituency name',
      'ac name',
      'constituency',
      'বিধানসভা কেন্দ্র'
    ]);
    
    if (acResponse) {
      const acValue = extractValue(acResponse.response);
      if (acValue && acValue !== 'N/A' && acValue !== null && acValue !== undefined && String(acValue).trim() !== '') {
        const acText = getMainText(String(acValue)).trim();
        // Validate it's not a yes/no answer
        const lower = acText.toLowerCase();
        if (!['yes', 'no', 'y', 'n'].includes(lower) && acText.length > 2) {
          return acText;
        }
      }
    }
  }
  
  return null;
}

async function analyzeShouldBeAbandoned() {
  try {
    console.log('='.repeat(80));
    console.log('ANALYZE RESPONSES THAT SHOULD BE ABANDONED (MISSING FIELDS)');
    console.log('='.repeat(80));
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Calculate date ranges (last 24 hours)
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    console.log('📅 Analyzing responses from last 24 hours...');
    console.log(`   From: ${twentyFourHoursAgo.toISOString()}`);
    console.log(`   To: ${now.toISOString()}\n`);
    
    // Query all responses in Pending_Approval from last 24 hours
    const query = {
      status: 'Pending_Approval',
      createdAt: {
        $gte: twentyFourHoursAgo,
        $lte: now
      }
    };
    
    console.log('🔍 Finding responses in Pending_Approval...');
    const allResponses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status responses interviewMode createdAt startTime selectedAC survey interviewer')
      .populate('survey', 'surveyName mode')
      .populate('interviewer', 'firstName lastName memberId email')
      .lean();
    
    console.log(`   Found ${allResponses.length} responses in Pending_Approval\n`);
    
    if (allResponses.length === 0) {
      console.log('✅ No responses found to analyze.');
      await mongoose.disconnect();
      return;
    }
    
    // Analyze each response
    const problematicResponses = [];
    const stats = {
      totalChecked: allResponses.length,
      totalProblematic: 0,
      byStatus: {
        'Pending_Approval': 0
      },
      byMissingField: {
        missingAC: 0,
        missingGender: 0,
        missingAge: 0,
        missingAll: 0
      },
      byMode: {
        capi: { total: 0, missingAC: 0, missingGender: 0, missingAge: 0 },
        cati: { total: 0, missingAC: 0, missingGender: 0, missingAge: 0 }
      },
      byDate: {
        today: 0,
        yesterday: 0,
        other: 0
      }
    };
    
    console.log('🔍 Analyzing responses for missing fields...');
    
    // Calculate date boundaries for "today" and "yesterday" (IST)
    const todayIST = new Date();
    todayIST.setUTCHours(0, 0, 0, 0);
    todayIST.setUTCHours(todayIST.getUTCHours() - 5); // IST is UTC+5:30, so subtract 5 hours and 30 minutes
    todayIST.setUTCMinutes(todayIST.getUTCMinutes() - 30);
    
    const yesterdayIST = new Date(todayIST);
    yesterdayIST.setDate(yesterdayIST.getDate() - 1);
    
    let checked = 0;
    
    for (const response of allResponses) {
      checked++;
      
      if (checked % 500 === 0) {
        console.log(`   Checked ${checked}/${allResponses.length} responses...`);
      }
      
      const responses = response.responses || [];
      const interviewMode = response.interviewMode || 'unknown';
      
      // Extract fields
      const ac = extractAC(response);
      const gender = extractGender(responses, response.survey);
      const age = extractAge(responses);
      
      // Check for missing fields
      // For AC: Check selectedAC field directly (CATI requirement)
      const missingAC = (interviewMode === 'cati' || interviewMode === 'CATI') && 
                        (!response.selectedAC || 
                         response.selectedAC === null || 
                         response.selectedAC === undefined || 
                         String(response.selectedAC).trim() === '');
      
      // For CAPI: AC is optional, but if we can't extract it from responses, it's missing
      const missingACForCAPI = (interviewMode === 'capi' || interviewMode === 'CAPI') && 
                                (!ac || ac === 'MISSING' || ac.trim() === '');
      
      const missingGender = !gender || gender === 'N/A' || gender === null || String(gender).trim() === '';
      const missingAge = !age || age === 'N/A' || age === null || String(age).trim() === '';
      
      // Determine if this response should be abandoned
      let shouldBeAbandoned = false;
      const reasons = [];
      
      // For CATI: AC is required (check selectedAC field)
      if (missingAC) {
        shouldBeAbandoned = true;
        reasons.push('Missing AC (required for CATI)');
      }
      
      // For CAPI: AC is also important (but not always required)
      // We'll include it in the report but not mark as abandoned solely for missing AC
      // unless it's also missing gender/age
      
      // For both CAPI and CATI: Gender and Age are required
      if (missingGender) {
        shouldBeAbandoned = true;
        reasons.push('Missing Gender');
      }
      
      if (missingAge) {
        shouldBeAbandoned = true;
        reasons.push('Missing Age');
      }
      
      // For CAPI: If missing AC AND (gender or age), mark as problematic
      if (missingACForCAPI && (missingGender || missingAge)) {
        shouldBeAbandoned = true;
        if (!reasons.includes('Missing AC')) {
          reasons.push('Missing AC');
        }
      }
      
      if (shouldBeAbandoned) {
        stats.totalProblematic++;
        stats.byStatus['Pending_Approval']++;
        
        // Count by missing field
        if (missingAC || missingACForCAPI) stats.byMissingField.missingAC++;
        if (missingGender) stats.byMissingField.missingGender++;
        if (missingAge) stats.byMissingField.missingAge++;
        if ((missingAC || missingACForCAPI) && missingGender && missingAge) stats.byMissingField.missingAll++;
        
        // Count by mode
        if (interviewMode === 'capi' || interviewMode === 'CAPI') {
          stats.byMode.capi.total++;
          if (missingACForCAPI) stats.byMode.capi.missingAC++;
          if (missingGender) stats.byMode.capi.missingGender++;
          if (missingAge) stats.byMode.capi.missingAge++;
        } else if (interviewMode === 'cati' || interviewMode === 'CATI') {
          stats.byMode.cati.total++;
          if (missingAC) stats.byMode.cati.missingAC++;
          if (missingGender) stats.byMode.cati.missingGender++;
          if (missingAge) stats.byMode.cati.missingAge++;
        }
        
        // Determine date label
        const createdAt = new Date(response.createdAt);
        let dateLabel = 'Other';
        if (createdAt >= todayIST) {
          dateLabel = 'Today';
          stats.byDate.today++;
        } else if (createdAt >= yesterdayIST && createdAt < todayIST) {
          dateLabel = 'Yesterday';
          stats.byDate.yesterday++;
        } else {
          stats.byDate.other++;
        }
        
        problematicResponses.push({
          responseId: response.responseId || response._id.toString(),
          mongoId: response._id.toString(),
          sessionId: response.sessionId,
          interviewMode: interviewMode,
          status: response.status,
          ac: ac || (response.selectedAC || 'MISSING'),
          gender: gender || 'MISSING',
          age: age || 'MISSING',
          selectedAC: response.selectedAC || null,
          missingAC: missingAC || missingACForCAPI,
          missingGender: missingGender,
          missingAge: missingAge,
          reasons: reasons,
          createdAt: response.createdAt,
          startTime: response.startTime || null,
          dateLabel: dateLabel,
          survey: {
            id: response.survey?._id?.toString() || 'Unknown',
            name: response.survey?.surveyName || 'Unknown',
            mode: response.survey?.mode || 'Unknown'
          },
          interviewer: {
            id: response.interviewer?._id?.toString() || 'Unknown',
            name: response.interviewer 
              ? `${response.interviewer.firstName || ''} ${response.interviewer.lastName || ''}`.trim() || response.interviewer.memberId || response.interviewer.email || 'Unknown'
              : 'Unknown',
            memberId: response.interviewer?.memberId || null,
            email: response.interviewer?.email || null
          }
        });
      }
    }
    
    console.log(`\n   ✅ Analysis complete`);
    console.log(`   Found ${problematicResponses.length} problematic responses\n`);
    
    // Generate report
    const REPORT_DIR = path.join(__dirname, '../../../Report-Generation/ImprovedDuplicateRemove');
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    // Calculate IST date ranges for report
    const todayISTStart = new Date(todayIST);
    const todayISTEnd = new Date(todayIST);
    todayISTEnd.setDate(todayISTEnd.getDate() + 1);
    todayISTEnd.setMilliseconds(todayISTEnd.getMilliseconds() - 1);
    
    const yesterdayISTStart = new Date(yesterdayIST);
    const yesterdayISTEnd = new Date(todayIST);
    yesterdayISTEnd.setMilliseconds(yesterdayISTEnd.getMilliseconds() - 1);
    
    const report = {
      timestamp: new Date().toISOString(),
      operation: 'Analyze Responses That Should Have Been Abandoned (Missing Fields)',
      dateRanges: {
        last24Hours: {
          from: twentyFourHoursAgo.toISOString(),
          to: now.toISOString()
        },
        today: {
          ist: {
            start: todayISTStart.toISOString(),
            end: todayISTEnd.toISOString()
          },
          utc: {
            start: todayISTStart.toISOString(),
            end: todayISTEnd.toISOString()
          }
        },
        yesterday: {
          ist: {
            start: yesterdayISTStart.toISOString(),
            end: yesterdayISTEnd.toISOString()
          },
          utc: {
            start: yesterdayISTStart.toISOString(),
            end: yesterdayISTEnd.toISOString()
          }
        }
      },
      summary: stats,
      problematicResponses: problematicResponses
    };
    
    // Ensure report directory exists
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    // Save JSON report
    const jsonPath = path.join(REPORT_DIR, `should_be_abandoned_analysis_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`✅ JSON report saved: ${jsonPath}`);
    console.log(`   File size: ${(fs.statSync(jsonPath).size / 1024 / 1024).toFixed(2)} MB`);
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total responses checked: ${stats.totalChecked}`);
    console.log(`Problematic responses found: ${stats.totalProblematic}`);
    console.log('');
    console.log('By Missing Field:');
    console.log(`  Missing AC: ${stats.byMissingField.missingAC}`);
    console.log(`  Missing Gender: ${stats.byMissingField.missingGender}`);
    console.log(`  Missing Age: ${stats.byMissingField.missingAge}`);
    console.log(`  Missing All: ${stats.byMissingField.missingAll}`);
    console.log('');
    console.log('By Interview Mode:');
    console.log(`  CAPI: ${stats.byMode.capi.total} (AC: ${stats.byMode.capi.missingAC}, Gender: ${stats.byMode.capi.missingGender}, Age: ${stats.byMode.capi.missingAge})`);
    console.log(`  CATI: ${stats.byMode.cati.total} (AC: ${stats.byMode.cati.missingAC}, Gender: ${stats.byMode.cati.missingGender}, Age: ${stats.byMode.cati.missingAge})`);
    console.log('');
    console.log('By Date:');
    console.log(`  Today: ${stats.byDate.today}`);
    console.log(`  Yesterday: ${stats.byDate.yesterday}`);
    console.log(`  Other: ${stats.byDate.other}`);
    console.log('='.repeat(80));
    
    await mongoose.disconnect();
    console.log('\n✅ Analysis completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Run the analysis
if (require.main === module) {
  analyzeShouldBeAbandoned();
}

module.exports = { analyzeShouldBeAbandoned };

