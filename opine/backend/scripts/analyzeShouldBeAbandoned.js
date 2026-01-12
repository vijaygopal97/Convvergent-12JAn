#!/usr/bin/env node

/**
 * Analyze Responses That Should Have Been Abandoned
 * 
 * For survey "68fd1915d41841da463f0d46", finds all CAPI and CATI responses
 * in Pending_Approval, Rejected, or Approved status that are missing:
 * - AC (selectedAC field or extracted from responses)
 * - Gender (extracted from responses)
 * - Age (extracted from responses)
 * 
 * Does NOT mark anything as abandoned - only analyzes and reports
 */

const path = require('path');
const fs = require('fs');

// Set up module resolution to use backend's node_modules
const backendPath = path.join(__dirname, '..');

const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      const backendNodeModules = path.join(backendPath, 'node_modules');
      try {
        return originalRequire.apply(this, [path.join(backendNodeModules, id)]);
      } catch (e) {
        throw err;
      }
    }
    throw err;
  }
};

require('dotenv').config({ path: path.join(backendPath, '.env') });
const mongoose = require('mongoose');
const SurveyResponse = require(path.join(backendPath, 'models/SurveyResponse'));
const Survey = require(path.join(backendPath, 'models/Survey'));
const { extractACFromResponse } = require(path.join(backendPath, 'utils/respondentInfoUtils'));
const { getMainText } = require(path.join(backendPath, 'utils/genderUtils'));

const SURVEY_ID = '68fd1915d41841da463f0d46';

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
 * Extract gender from responses (same logic as markResponsesWithoutGenderOrAge.js)
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
 * Extract age from responses (same logic as markResponsesWithoutGenderOrAge.js)
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
 * Extract AC from responses (same logic as markCATIWithoutACAsAbandoned.js)
 */
function extractAC(responseData, responses) {
  // First check selectedAC field (for CATI)
  if (responseData.selectedAC && responseData.selectedAC !== '' && responseData.selectedAC !== null) {
    return responseData.selectedAC;
  }
  
  // Try to extract from responses using extractACFromResponse
  try {
    const extractedAC = extractACFromResponse(responses, responseData);
    if (extractedAC && extractedAC !== 'N/A' && extractedAC !== '') {
      return extractedAC;
    }
  } catch (error) {
    // Ignore errors
  }
  
  return null;
}

async function analyzeShouldBeAbandoned() {
  try {
    console.log('='.repeat(80));
    console.log('ANALYZE RESPONSES THAT SHOULD HAVE BEEN ABANDONED');
    console.log('='.repeat(80));
    console.log(`Survey ID: ${SURVEY_ID}`);
    console.log('');
    
    // Connect to database
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to database\n');
    
    // Get survey
    const survey = await Survey.findById(SURVEY_ID).lean();
    if (!survey) {
      throw new Error(`Survey ${SURVEY_ID} not found`);
    }
    console.log(`✅ Found survey: ${survey.surveyName || 'Unknown'}\n`);
    
    // Calculate date ranges for yesterday and today (IST)
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000; // IST is UTC+5:30
    
    // Today IST
    const todayIST = new Date(now.getTime() + istOffset);
    todayIST.setUTCHours(0, 0, 0, 0);
    const todayISTEnd = new Date(todayIST);
    todayISTEnd.setUTCHours(23, 59, 59, 999);
    const todayStartUTC = new Date(todayIST.getTime() - istOffset);
    const todayEndUTC = new Date(todayISTEnd.getTime() - istOffset);
    
    // Yesterday IST
    const yesterdayIST = new Date(todayIST);
    yesterdayIST.setUTCDate(yesterdayIST.getUTCDate() - 1);
    const yesterdayISTEnd = new Date(yesterdayIST);
    yesterdayISTEnd.setUTCHours(23, 59, 59, 999);
    const yesterdayStartUTC = new Date(yesterdayIST.getTime() - istOffset);
    const yesterdayEndUTC = new Date(yesterdayISTEnd.getTime() - istOffset);
    
    console.log('📅 Date Ranges (IST):');
    console.log(`   Today: ${todayIST.toISOString().split('T')[0]}`);
    console.log(`   Yesterday: ${yesterdayIST.toISOString().split('T')[0]}`);
    console.log('');
    
    // Query all CAPI and CATI responses in Pending_Approval, Rejected, or Approved status
    // Exclude already abandoned responses
    const query = {
      survey: SURVEY_ID,
      interviewMode: { $in: ['capi', 'cati'] },
      status: { $in: ['Pending_Approval', 'Rejected', 'Approved'] }
    };
    
    console.log('🔍 Finding responses to check...');
    const allResponses = await SurveyResponse.find(query)
      .select('_id responseId sessionId status responses interviewMode createdAt startTime selectedAC selectedPollingStation metadata')
      .lean();
    
    console.log(`   Found ${allResponses.length} responses to check\n`);
    
    if (allResponses.length === 0) {
      console.log('✅ No responses found to check.');
      await mongoose.disconnect();
      return;
    }
    
    // Check each response for missing AC, Gender, or Age
    const problematicResponses = [];
    let checked = 0;
    
    console.log('🔍 Checking responses for missing AC, Gender, or Age...');
    
    for (const response of allResponses) {
      checked++;
      
      if (checked % 100 === 0) {
        console.log(`   Checked ${checked}/${allResponses.length} responses...`);
      }
      
      const responses = response.responses || [];
      const gender = extractGender(responses, survey);
      const age = extractAge(responses);
      const ac = extractAC(response, responses);
      
      // Check if AC, gender, or age is missing
      const missingAC = !ac || ac === 'N/A' || ac === null || String(ac).trim() === '';
      const missingGender = !gender || gender === 'N/A' || gender === null || String(gender).trim() === '';
      const missingAge = !age || age === 'N/A' || age === null || String(age).trim() === '';
      
      if (missingAC || missingGender || missingAge) {
        // Determine if created today or yesterday
        const createdAt = new Date(response.createdAt);
        const isToday = createdAt >= todayStartUTC && createdAt <= todayEndUTC;
        const isYesterday = createdAt >= yesterdayStartUTC && createdAt <= yesterdayEndUTC;
        const dateLabel = isToday ? 'Today' : (isYesterday ? 'Yesterday' : 'Other');
        
        problematicResponses.push({
          responseId: response.responseId || response._id.toString(),
          mongoId: response._id.toString(),
          sessionId: response.sessionId,
          interviewMode: response.interviewMode,
          status: response.status,
          ac: ac || 'MISSING',
          gender: gender || 'MISSING',
          age: age || 'MISSING',
          selectedAC: response.selectedAC || null,
          missingAC,
          missingGender,
          missingAge,
          createdAt: response.createdAt,
          startTime: response.startTime,
          dateLabel
        });
      }
    }
    
    console.log(`\n   ✅ Checked ${checked} responses`);
    console.log(`   Found ${problematicResponses.length} problematic responses\n`);
    
    // Group by date
    const todayResponses = problematicResponses.filter(r => r.dateLabel === 'Today');
    const yesterdayResponses = problematicResponses.filter(r => r.dateLabel === 'Yesterday');
    const otherResponses = problematicResponses.filter(r => r.dateLabel === 'Other');
    
    // Group by status
    const byStatus = {};
    problematicResponses.forEach(r => {
      if (!byStatus[r.status]) {
        byStatus[r.status] = { total: 0, today: 0, yesterday: 0, other: 0 };
      }
      byStatus[r.status].total++;
      if (r.dateLabel === 'Today') byStatus[r.status].today++;
      else if (r.dateLabel === 'Yesterday') byStatus[r.status].yesterday++;
      else byStatus[r.status].other++;
    });
    
    // Group by missing field
    const missingACCount = problematicResponses.filter(r => r.missingAC).length;
    const missingGenderCount = problematicResponses.filter(r => r.missingGender).length;
    const missingAgeCount = problematicResponses.filter(r => r.missingAge).length;
    const missingAllCount = problematicResponses.filter(r => r.missingAC && r.missingGender && r.missingAge).length;
    
    // Display summary
    console.log('='.repeat(80));
    console.log('ANALYSIS SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total responses checked: ${allResponses.length}`);
    console.log(`Problematic responses found: ${problematicResponses.length}`);
    console.log('');
    console.log('By Date:');
    console.log(`  Today: ${todayResponses.length}`);
    console.log(`  Yesterday: ${yesterdayResponses.length}`);
    console.log(`  Other: ${otherResponses.length}`);
    console.log('');
    console.log('By Status:');
    Object.keys(byStatus).sort().forEach(status => {
      const stats = byStatus[status];
      console.log(`  ${status}: ${stats.total} (Today: ${stats.today}, Yesterday: ${stats.yesterday}, Other: ${stats.other})`);
    });
    console.log('');
    console.log('By Missing Field:');
    console.log(`  Missing AC: ${missingACCount}`);
    console.log(`  Missing Gender: ${missingGenderCount}`);
    console.log(`  Missing Age: ${missingAgeCount}`);
    console.log(`  Missing All: ${missingAllCount}`);
    console.log('');
    
    // Generate report
    const REPORT_DIR = path.join(__dirname, '../../Report-Generation/ImprovedDuplicateRemove');
    if (!fs.existsSync(REPORT_DIR)) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
    }
    
    const TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    
    const report = {
      timestamp: new Date().toISOString(),
      operation: 'Analyze Responses That Should Have Been Abandoned',
      surveyId: SURVEY_ID,
      surveyName: survey.surveyName || 'Unknown',
      dateRanges: {
        today: {
          ist: {
            start: todayIST.toISOString(),
            end: todayISTEnd.toISOString()
          },
          utc: {
            start: todayStartUTC.toISOString(),
            end: todayEndUTC.toISOString()
          }
        },
        yesterday: {
          ist: {
            start: yesterdayIST.toISOString(),
            end: yesterdayISTEnd.toISOString()
          },
          utc: {
            start: yesterdayStartUTC.toISOString(),
            end: yesterdayEndUTC.toISOString()
          }
        }
      },
      summary: {
        totalChecked: allResponses.length,
        totalProblematic: problematicResponses.length,
        byDate: {
          today: todayResponses.length,
          yesterday: yesterdayResponses.length,
          other: otherResponses.length
        },
        byStatus: byStatus,
        byMissingField: {
          missingAC: missingACCount,
          missingGender: missingGenderCount,
          missingAge: missingAgeCount,
          missingAll: missingAllCount
        }
      },
      problematicResponses: problematicResponses.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        startTime: r.startTime ? r.startTime.toISOString() : null
      }))
    };
    
    // Save JSON report
    const jsonPath = path.join(REPORT_DIR, `should_be_abandoned_analysis_${TIMESTAMP}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`✅ JSON report saved: ${jsonPath}`);
    
    // Save CSV report
    const csvRows = [
      'Response ID,Mongo ID,Session ID,Interview Mode,Status,AC,Gender,Age,Selected AC,Missing AC,Missing Gender,Missing Age,Date Label,Created At,Start Time'
    ];
    
    problematicResponses.forEach(r => {
      csvRows.push([
        r.responseId,
        r.mongoId,
        r.sessionId,
        r.interviewMode,
        r.status,
        r.ac,
        r.gender,
        r.age,
        r.selectedAC || '(null)',
        r.missingAC ? 'Yes' : 'No',
        r.missingGender ? 'Yes' : 'No',
        r.missingAge ? 'Yes' : 'No',
        r.dateLabel,
        new Date(r.createdAt).toISOString(),
        r.startTime ? new Date(r.startTime).toISOString() : '(null)'
      ].join(','));
    });
    
    const csvPath = path.join(REPORT_DIR, `should_be_abandoned_analysis_${TIMESTAMP}.csv`);
    fs.writeFileSync(csvPath, csvRows.join('\n'));
    console.log(`✅ CSV report saved: ${csvPath}`);
    
    // Save simple response IDs list
    const responseIdsList = problematicResponses.map(r => r.responseId).join('\n');
    const idsPath = path.join(REPORT_DIR, `should_be_abandoned_response_ids_${TIMESTAMP}.txt`);
    fs.writeFileSync(idsPath, responseIdsList);
    console.log(`✅ Response IDs list saved: ${idsPath}`);
    
    // Display first 20 examples
    console.log('');
    console.log('='.repeat(80));
    console.log('FIRST 20 EXAMPLES');
    console.log('='.repeat(80));
    problematicResponses.slice(0, 20).forEach((r, idx) => {
      console.log(`${idx + 1}. ${r.responseId}`);
      console.log(`   Status: ${r.status} | Mode: ${r.interviewMode} | Date: ${r.dateLabel}`);
      console.log(`   Missing: AC=${r.missingAC ? 'YES' : 'NO'}, Gender=${r.missingGender ? 'YES' : 'NO'}, Age=${r.missingAge ? 'YES' : 'NO'}`);
      console.log(`   Values: AC=${r.ac}, Gender=${r.gender}, Age=${r.age}`);
      console.log(`   Created: ${new Date(r.createdAt).toISOString()}`);
      console.log('');
    });
    
    if (problematicResponses.length > 20) {
      console.log(`... and ${problematicResponses.length - 20} more responses`);
    }
    
    console.log('='.repeat(80));
    console.log('ANALYSIS COMPLETE');
    console.log('='.repeat(80));
    console.log(`Total problematic responses: ${problematicResponses.length}`);
    console.log(`  - Today: ${todayResponses.length}`);
    console.log(`  - Yesterday: ${yesterdayResponses.length}`);
    console.log(`  - Other: ${otherResponses.length}`);
    console.log('');
    console.log('Reports saved to:', REPORT_DIR);
    
    await mongoose.disconnect();
    console.log('\n✅ Script completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  analyzeShouldBeAbandoned();
}

module.exports = { analyzeShouldBeAbandoned };







