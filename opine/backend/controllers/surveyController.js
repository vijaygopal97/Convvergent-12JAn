const mongoose = require('mongoose');
const Survey = require('../models/Survey');
const User = require('../models/User');
const Company = require('../models/Company');
const SurveyResponse = require('../models/SurveyResponse');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const XLSX = require('xlsx');
const multer = require('multer');
const path = require('path');

// Helper functions for IST (Indian Standard Time) timezone handling
// IST is UTC+5:30

// Get current IST time as a Date object
const getISTNow = () => {
  const now = new Date();
  // Convert UTC to IST: add 5 hours and 30 minutes (5.5 hours)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const utcTime = now.getTime();
  const istTime = new Date(utcTime + istOffset);
  return istTime;
};

// Get current IST date string (YYYY-MM-DD)
const getISTDateString = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = now.getTime();
  const istTime = new Date(utcTime + istOffset);
  
  // Format as YYYY-MM-DD
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Get IST date string from a Date object (adjusting for IST)
const getISTDateStringFromDate = (date) => {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = date.getTime();
  const istTime = new Date(utcTime + istOffset);
  
  const year = istTime.getUTCFullYear();
  const month = String(istTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Convert IST date (YYYY-MM-DD) start of day (00:00:00 IST) to UTC Date
// IST midnight (00:00:00) = UTC previous day 18:30:00
const getISTDateStartUTC = (istDateStr) => {
  // Parse YYYY-MM-DD
  const [year, month, day] = istDateStr.split('-').map(Number);
  // IST midnight (00:00:00) = UTC previous day 18:30:00
  // Create UTC date for the day at 18:30:00, then subtract 1 day
  const startDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 30, 0, 0));
  startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
  return startDateUTC;
};

// Convert IST date (YYYY-MM-DD) end of day (23:59:59.999 IST) to UTC Date
// IST end of day (23:59:59.999) = UTC same day 18:29:59.999
const getISTDateEndUTC = (istDateStr) => {
  // Parse YYYY-MM-DD
  const [year, month, day] = istDateStr.split('-').map(Number);
  // IST end of day (23:59:59.999) = UTC same day 18:29:59.999
  return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
};

// @desc    Create a new survey
// @route   POST /api/surveys
// @access  Private (Company Admin, Project Manager)
exports.createSurvey = async (req, res) => {
  try {
    const {
      surveyName,
      description,
      category,
      purpose,
      mode,
      includeGigWorkers,
      startDate,
      deadline,
      sampleSize,
      targetAudience,
      thresholdInterviewsPerDay,
      maxInterviewsPerInterviewer,
      onlineContactMode,
      contactList,
      assignedInterviewers,
      sections,
      templateUsed,
      settings,
      notifications,
      status,
      assignACs,
      acAssignmentCountry,
      acAssignmentState,
      modes,
      modeAllocation,
      modeQuotas,
      modeGigWorkers,
      respondentContacts,
      sets
    } = req.body;

    console.log('🔍 Backend received mode:', mode, 'type:', typeof mode);
    console.log('🔍 Backend received modes:', modes, 'type:', typeof modes);
    console.log('🔍 Backend received modeAllocation:', modeAllocation, 'type:', typeof modeAllocation);

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Validate required fields
    if (!surveyName || !description || !category || !purpose || !mode || !startDate || !deadline || !sampleSize) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(deadline);
    if (start >= end) {
      return res.status(400).json({
        success: false,
        message: 'Deadline must be after start date'
      });
    }

    // Clean targetAudience data to handle new structure
    const cleanTargetAudience = (targetAudience) => {
      console.log('🔍 Backend received targetAudience:', JSON.stringify(targetAudience, null, 2));
      
      if (!targetAudience) {
        return {
          demographics: {},
          geographic: {},
          behavioral: {},
          psychographic: {},
          custom: '',
          quotaManagement: false
        };
      }

      // Handle the new structure where each category is an object with boolean flags and requirements
      const cleaned = {
        demographics: targetAudience.demographics || {},
        geographic: targetAudience.geographic || {},
        behavioral: targetAudience.behavioral || {},
        psychographic: targetAudience.psychographic || {},
        custom: targetAudience.custom || '',
        quotaManagement: targetAudience.quotaManagement || false
      };
      
      console.log('🔍 Backend cleaned targetAudience:', JSON.stringify(cleaned, null, 2));
      return cleaned;
    };

    // Create survey data object
    const surveyData = {
      surveyName,
      description,
      category,
      purpose,
      mode,
      modes: modes || [],
      modeAllocation: modeAllocation || {},
      modeQuotas: modeQuotas || {},
      modeGigWorkers: modeGigWorkers || {},
      includeGigWorkers: includeGigWorkers || false,
      startDate: start,
      deadline: end,
      sampleSize: parseInt(sampleSize),
      targetAudience: cleanTargetAudience(targetAudience),
      thresholdInterviewsPerDay: thresholdInterviewsPerDay ? parseInt(thresholdInterviewsPerDay) : undefined,
      maxInterviewsPerInterviewer: maxInterviewsPerInterviewer ? parseInt(maxInterviewsPerInterviewer) : undefined,
      onlineContactMode: onlineContactMode || [],
      contactList: contactList || [],
      sections: (() => {
        // Debug: Log sections with settings when receiving
        if (sections && Array.isArray(sections)) {
          sections.forEach((section, sectionIdx) => {
            if (section.questions && Array.isArray(section.questions)) {
              section.questions.forEach((question, questionIdx) => {
                if (question.type === 'multiple_choice' && question.settings) {
                  console.log('🔍 Backend received question with settings:', {
                    sectionIndex: sectionIdx,
                    questionIndex: questionIdx,
                    questionId: question.id,
                    questionText: question.text,
                    settings: question.settings
                  });
                }
              });
            }
          });
        }
        return sections || [];
      })(),
      templateUsed: templateUsed || {},
      settings: settings || {},
      notifications: notifications || {},
      company: currentUser.company._id,
      createdBy: currentUser._id,
      lastModifiedBy: currentUser._id,
      status: status || 'draft', // Use provided status or default to draft
      assignACs: assignACs || false,
      acAssignmentCountry: acAssignmentCountry || '',
      acAssignmentState: acAssignmentState || '',
      respondentContacts: respondentContacts || [],
      sets: sets || []
    };

    // Create the survey
    const survey = new Survey(surveyData);
    await survey.save();

    // Populate the created survey
    const populatedSurvey = await Survey.findById(survey._id)
      .populate('company', 'companyName companyCode')
      .populate('createdBy', 'firstName lastName email')
      .populate('assignedInterviewers.interviewer', 'firstName lastName email userType')
      .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email userType');

    // Invalidate cache for this survey and stats cache
    const surveyCache = require('../utils/surveyCache');
    const statsCache = require('../utils/statsCache');
    surveyCache.invalidateSurveyCache(populatedSurvey._id).catch(err => {
      console.warn('Cache invalidation error (non-blocking):', err.message);
    });
    statsCache.invalidateStatsCache(currentUser.company._id.toString()).catch(err => {
      console.warn('Stats cache invalidation error (non-blocking):', err.message);
    });

    res.status(201).json({
      success: true,
      message: 'Survey created successfully',
      data: { survey: populatedSurvey }
    });

  } catch (error) {
    console.error('Create survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get all surveys for a company
// @route   GET /api/surveys
// @access  Private (Company Admin, Project Manager)
exports.getSurveys = async (req, res) => {
  try {
    console.log('🚀 getSurveys function called');
    const { status, mode, search, category, page = 1, limit = 10 } = req.query;
    
    console.log('getSurveys - Query parameters:', { status, mode, search, category, page, limit });

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Build query
    const query = { company: currentUser.company._id };
    if (status) query.status = status;
    if (mode) query.mode = mode;
    if (category) query.category = category;
    
    // Add search functionality
    if (search) {
      query.$and = [
        { company: currentUser.company._id },
        {
          $or: [
            { surveyName: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
          ]
        }
      ];
      // Remove the company filter from the main query since it's now in $and
      delete query.company;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    console.log('getSurveys - Final query:', JSON.stringify(query, null, 2));
    console.log('getSurveys - Pagination:', { skip, limit: parseInt(limit) });

    // CRITICAL FIX: Use lean() to get plain JavaScript objects (not Mongoose documents)
    // This reduces memory usage by ~70% and improves performance
    // Get surveys with pagination
    // Exclude respondentContacts field to avoid loading large arrays (50K+ contacts)
    const surveys = await Survey.find(query)
      .select('-respondentContacts') // Exclude large respondentContacts array
      .populate('createdBy', 'firstName lastName email')
      .populate('assignedInterviewers.interviewer', 'firstName lastName email userType')
      .populate('capiInterviewers.interviewer', 'firstName lastName email userType')
      .populate('catiInterviewers.interviewer', 'firstName lastName email userType')
      .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email userType')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean(); // CRITICAL: Use lean() to get plain objects, not Mongoose documents

    // Get total count
    const total = await Survey.countDocuments(query);

    console.log(`🔍 Found ${surveys.length} surveys to process`);

    // CRITICAL FIX: Batch all analytics queries into a single aggregation
    // Instead of N+1 queries (3 queries per survey), use ONE aggregation for all surveys
    // This is how top tech companies handle this (Meta, Google, Twitter approach)
    const surveyIds = surveys.map(s => s._id);
    
    // Single aggregation to get all analytics for all surveys at once
    const analyticsData = await SurveyResponse.aggregate([
      { 
        $match: { 
          survey: { $in: surveyIds } 
        } 
      },
      {
        $group: {
          _id: {
            survey: '$survey',
            status: '$status'
          },
          count: { $sum: 1 }
        }
      }
    ]);

    // Process analytics data into a map for O(1) lookup
    const analyticsMap = {};
    analyticsData.forEach(item => {
      const surveyId = item._id.survey.toString();
      if (!analyticsMap[surveyId]) {
        analyticsMap[surveyId] = {
          approved: 0,
          all: 0,
          statusCounts: {}
        };
      }
      analyticsMap[surveyId].all += item.count;
      analyticsMap[surveyId].statusCounts[item._id.status] = item.count;
      if (item._id.status === 'Approved') {
        analyticsMap[surveyId].approved = item.count;
      }
    });

    // Calculate analytics for each survey (now using pre-fetched data)
    const surveysWithAnalytics = surveys.map((survey) => {
      const surveyId = survey._id.toString();
      const analytics = analyticsMap[surveyId] || { approved: 0, all: 0, statusCounts: {} };
      
      // Calculate completion percentage
      const sampleSize = survey.sampleSize || 0;
      const completionRate = sampleSize > 0 ? Math.round((analytics.approved / sampleSize) * 100) : 0;

      // Count assigned interviewers (handle both single-mode and multi-mode)
      let assignedInterviewersCount = 0;
      if (survey.assignedInterviewers && survey.assignedInterviewers.length > 0) {
        assignedInterviewersCount = survey.assignedInterviewers.length;
      } else if (survey.capiInterviewers && survey.catiInterviewers) {
        // For multi-mode surveys, count unique interviewers from both arrays
        // Filter out null interviewers (deleted users)
        const capiInterviewerIds = (survey.capiInterviewers || [])
          .filter(a => a.interviewer && a.interviewer._id)
          .map(a => a.interviewer._id.toString());
        const catiInterviewerIds = (survey.catiInterviewers || [])
          .filter(a => a.interviewer && a.interviewer._id)
          .map(a => a.interviewer._id.toString());
        const uniqueInterviewerIds = new Set([...capiInterviewerIds, ...catiInterviewerIds]);
        assignedInterviewersCount = uniqueInterviewerIds.size;
      }

      return {
        ...survey, // Already a plain object (from lean()), no need for toObject()
        analytics: {
          totalResponses: analytics.approved,
          allResponsesCount: analytics.all,
          completionRate: completionRate,
          assignedInterviewersCount: assignedInterviewersCount
        }
      };
    });

    // Debug: Log the analytics data being sent
    console.log('📊 Analytics data being sent to frontend:');
    surveysWithAnalytics.forEach(survey => {
      console.log(`  ${survey.surveyName} (${survey._id}):`, {
        approvedResponses: survey.analytics?.totalResponses,
        allResponsesCount: survey.analytics?.allResponsesCount,
        completionRate: survey.analytics?.completionRate,
        assignedInterviewersCount: survey.analytics?.assignedInterviewersCount
      });
    });

    res.status(200).json({
      success: true,
      message: 'Surveys retrieved successfully',
      data: {
        surveys: surveysWithAnalytics,
        pagination: {
          current: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
          total
        }
      }
    });

  } catch (error) {
    console.error('Get surveys error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get a single survey
// @route   GET /api/surveys/:id
// @access  Private (Company Admin, Project Manager, Interviewer)
// Get full survey data (with sections and questions) - optimized endpoint for interview interface
exports.getSurveyFull = async (req, res) => {
  try {
    const { id } = req.params;

    // CRITICAL OPTIMIZATION: Use Redis caching for getSurveyFull
    // This endpoint loads 5-10MB per request (sections + questions) and is called repeatedly
    // Top tech companies cache frequently accessed large datasets
    const surveyCache = require('../utils/surveyCache');
    const cacheKey = `survey:full:${id}`;
    
    // Try to get from cache first
    let survey = await surveyCache.getSurvey(id);
    
    // If not in cache or cache doesn't have full data or missing targetAudience, fetch from DB
    // CRITICAL: Check for targetAudience to ensure age/gender validation works (cache might be old)
    if (!survey || !survey.sections || !survey.questions || !survey.targetAudience) {
      // CRITICAL FIX: Use lean() to get plain JavaScript objects (not Mongoose documents)
      // This reduces memory usage by ~70% and improves performance
      // Find survey with full data (sections, questions, and targetAudience for age/gender validation)
      // CRITICAL: Include targetAudience for age validation in interview interface
      survey = await Survey.findById(id)
        .select('surveyName description mode sections questions assignACs acAssignmentState status version targetAudience')
        .lean(); // CRITICAL: Use lean() to get plain objects, not Mongoose documents

      if (!survey) {
        return res.status(404).json({
          success: false,
          message: 'Survey not found'
        });
      }

      // Cache the full survey for 1 hour (surveys rarely change during active use)
      // Top tech companies use longer cache times for read-heavy, rarely-changing data
      // CRITICAL: Re-cache even if survey was in cache but missing targetAudience
      await surveyCache.setSurvey(id, survey, 3600); // 1 hour cache
      if (!survey.sections || !survey.questions) {
        console.log(`✅ getSurveyFull - Cached survey ${id} for 1 hour (fetched from DB)`);
      } else {
        console.log(`✅ getSurveyFull - Re-cached survey ${id} (added targetAudience)`);
      }
    } else {
      console.log(`✅ getSurveyFull - Using cached survey ${id} (with targetAudience)`);
    }

    res.status(200).json({
      success: true,
      data: {
        survey: {
          id: survey._id,
          surveyName: survey.surveyName,
          description: survey.description,
          mode: survey.mode,
          sections: survey.sections,
          questions: survey.questions,
          assignACs: survey.assignACs,
          acAssignmentState: survey.acAssignmentState,
          status: survey.status,
          version: survey.version,
          targetAudience: survey.targetAudience // CRITICAL: Include for age/gender validation
        }
      }
    });

  } catch (error) {
    console.error('Get survey full error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch survey',
      error: error.message
    });
  }
};

exports.getSurvey = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id)
      .populate('company', 'companyName companyCode')
      .populate('createdBy', 'firstName lastName email')
      .populate('lastModifiedBy', 'firstName lastName email')
      .populate('assignedInterviewers.interviewer', 'firstName lastName email userType phone')
      .populate('assignedInterviewers.assignedBy', 'firstName lastName email')
      .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email userType phone')
      .populate('assignedQualityAgents.assignedBy', 'firstName lastName email');

    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has access to this survey
    if (survey.company._id.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view surveys from your company.'
      });
    }

    // Special handling for survey 68fd1915d41841da463f0d46: Reorder question 13 for CATI mode
    // Question 13 should appear after "Please note the respondent's gender" question
    const TARGET_SURVEY_ID = '68fd1915d41841da463f0d46';
    if (survey._id.toString() === TARGET_SURVEY_ID && survey.sections && Array.isArray(survey.sections)) {
      // Check if request is for CATI mode (from query parameter or user's interview mode)
      const isCatiMode = req.query.mode === 'cati' || req.query.mode === 'CATI' || 
                        (currentUser.interviewModes && currentUser.interviewModes.includes('CATI'));
      
      // Find the section containing the questions (sectionIndex 1 based on database query)
      const targetSection = survey.sections.find((section, idx) => {
        if (!section.questions || !Array.isArray(section.questions)) return false;
        // Look for section that has both gender question and question 13
        const hasGenderQ = section.questions.some(q => 
          q.id && q.id.includes('fixed_respondent_gender') || 
          (q.text && q.text.toLowerCase().includes('gender') && q.text.toLowerCase().includes('respondent'))
        );
        const hasQ13 = section.questions.some(q => 
          q.questionNumber === '13' || 
          (q.text && (q.text.includes('three most pressing') || q.text.includes('পশ্চিমবঙ্গের সবচেয়ে জরুরি')))
        );
        return hasGenderQ && hasQ13;
      });

      if (targetSection && targetSection.questions && Array.isArray(targetSection.questions)) {
        // Find gender question and question 13
        let genderQIndex = -1;
        let q13Index = -1;
        let genderQuestion = null;
        let q13Question = null;

        targetSection.questions.forEach((q, idx) => {
          if (q.id && q.id.includes('fixed_respondent_gender') || 
              (q.text && q.text.toLowerCase().includes('gender') && q.text.toLowerCase().includes('respondent'))) {
            genderQIndex = idx;
            genderQuestion = q;
          }
          if (q.questionNumber === '13' || 
              (q.text && (q.text.includes('three most pressing') || q.text.includes('পশ্চিমবঙ্গের সবচেয়ে জরুরি')))) {
            q13Index = idx;
            q13Question = q;
          }
        });

        // Reorder: Move question 13 to appear right after gender question
        if (genderQIndex >= 0 && q13Index >= 0 && genderQuestion && q13Question && q13Index > genderQIndex) {
          // Remove question 13 from its current position
          targetSection.questions.splice(q13Index, 1);
          
          // Insert question 13 right after gender question
          const newQ13Index = genderQIndex + 1;
          targetSection.questions.splice(newQ13Index, 0, q13Question);
          
          console.log(`✅ Reordered question 13 to appear after gender question for survey ${TARGET_SURVEY_ID}`);
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Survey retrieved successfully',
      data: { survey }
    });

  } catch (error) {
    console.error('Get survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};


// @desc    Delete a survey
// @route   DELETE /api/surveys/:id
// @access  Private (Company Admin, Project Manager)
exports.deleteSurvey = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has access to this survey
    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only delete surveys from your company.'
      });
    }

    // Check if survey can be deleted (only draft and active surveys)
    if (survey.status !== 'draft' && survey.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: 'Only draft and active surveys can be deleted'
      });
    }

    // Delete the survey
    // Invalidate cache before deleting
    const surveyCache = require('../utils/surveyCache');
    const statsCache = require('../utils/statsCache');
    surveyCache.invalidateSurveyCache(id).catch(err => {
      console.warn('Cache invalidation error (non-blocking):', err.message);
    });
    statsCache.invalidateStatsCache(currentUser.company._id.toString()).catch(err => {
      console.warn('Stats cache invalidation error (non-blocking):', err.message);
    });

    await Survey.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Survey deleted successfully'
    });

  } catch (error) {
    console.error('Delete survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Publish a survey
// @route   POST /api/surveys/:id/publish
// @access  Private (Company Admin, Project Manager)
exports.publishSurvey = async (req, res) => {
  try {
    const { id } = req.params;

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has access to this survey
    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only publish surveys from your company.'
      });
    }

    // Check if survey can be published
    if (survey.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft surveys can be published'
      });
    }

    // Validate required fields for publishing
    if (!survey.sections || survey.sections.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Survey must have at least one section with questions to be published'
      });
    }

    // Update survey status and publish date
    survey.status = 'active';
    survey.publishedAt = new Date();
    survey.lastModifiedBy = currentUser._id;
    await survey.save();

    // Populate the updated survey
    const publishedSurvey = await Survey.findById(survey._id)
      .populate('company', 'companyName companyCode')
      .populate('createdBy', 'firstName lastName email')
      .populate('assignedInterviewers.interviewer', 'firstName lastName email userType');

    res.status(200).json({
      success: true,
      message: 'Survey published successfully',
      data: { survey: publishedSurvey }
    });

  } catch (error) {
    console.error('Publish survey error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Assign interviewers to survey
// @route   POST /api/surveys/:id/assign-interviewers
// @access  Private (Company Admin, Project Manager)
exports.assignInterviewers = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      interviewerIds, 
      maxInterviews, 
      interviewerACAssignments, 
      interviewerStateAssignments, 
      interviewerCountryAssignments,
      capiInterviewerIds,
      catiInterviewerIds,
      capiACAssignments,
      catiACAssignments,
      capiStateAssignments,
      catiStateAssignments,
      capiCountryAssignments,
      catiCountryAssignments
    } = req.body;

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has access to this survey
    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only assign interviewers to surveys from your company.'
      });
    }

    // Check if this is a multi-mode survey
    const isMultiMode = survey.mode === 'multi_mode' || (survey.modes && survey.modes.length > 1);
    
    // Validate interviewer IDs based on survey mode
    if (isMultiMode) {
      // For multi-mode surveys, check if we have any interviewers to assign
      const hasCapiInterviewers = capiInterviewerIds && Array.isArray(capiInterviewerIds) && capiInterviewerIds.length > 0;
      const hasCatiInterviewers = catiInterviewerIds && Array.isArray(catiInterviewerIds) && catiInterviewerIds.length > 0;
      
      // If no interviewers are provided (both are undefined, null, or empty arrays), 
      // this is valid - it means we're not updating interviewer assignments
      // This can happen when uploading respondent contacts or updating other survey data
      if (!hasCapiInterviewers && !hasCatiInterviewers) {
        // No interviewers to assign - return success without updating interviewer assignments
        const updatedSurvey = await Survey.findById(survey._id)
          .populate('capiInterviewers.interviewer', 'firstName lastName email userType phone')
          .populate('capiInterviewers.assignedBy', 'firstName lastName email')
          .populate('catiInterviewers.interviewer', 'firstName lastName email userType phone')
          .populate('catiInterviewers.assignedBy', 'firstName lastName email');
        
        return res.status(200).json({
          success: true,
          message: 'Survey updated successfully',
          data: { survey: updatedSurvey }
        });
      }
    } else {
      // For single-mode surveys, use the original logic
      if (!interviewerIds || !Array.isArray(interviewerIds) || interviewerIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Interviewer IDs are required'
        });
      }
    }

    if (isMultiMode) {
      // Handle multi-mode assignments
      const capiAssignments = [];
      const catiAssignments = [];
      
      // Process CAPI interviewers
      if (capiInterviewerIds && capiInterviewerIds.length > 0) {
        const capiInterviewers = await User.find({
          _id: { $in: capiInterviewerIds },
          company: currentUser.company._id,
          userType: 'interviewer',
          status: 'active'
        });

        if (capiInterviewers.length !== capiInterviewerIds.length) {
          return res.status(400).json({
            success: false,
            message: 'Some CAPI interviewers not found or not available'
          });
        }

        capiAssignments.push(...capiInterviewerIds.map(interviewerId => {
          const assignment = {
            interviewer: interviewerId,
            assignedBy: currentUser._id,
            maxInterviews: maxInterviews || 0,
            status: 'assigned'
          };
          
          // Add AC assignments only if assignACs is true and AC assignments are provided
          if (survey.assignACs && capiACAssignments && capiACAssignments[interviewerId]) {
            assignment.assignedACs = capiACAssignments[interviewerId];
          }
          
          // Add state assignment if provided
          if (capiStateAssignments && capiStateAssignments[interviewerId]) {
            assignment.selectedState = capiStateAssignments[interviewerId];
          }
          
          // Add country assignment if provided
          if (capiCountryAssignments && capiCountryAssignments[interviewerId]) {
            assignment.selectedCountry = capiCountryAssignments[interviewerId];
          }
          
          return assignment;
        }));
      }
      
      // Process CATI interviewers
      if (catiInterviewerIds && catiInterviewerIds.length > 0) {
        const catiInterviewers = await User.find({
          _id: { $in: catiInterviewerIds },
          company: currentUser.company._id,
          userType: 'interviewer',
          status: 'active'
        });

        if (catiInterviewers.length !== catiInterviewerIds.length) {
          return res.status(400).json({
            success: false,
            message: 'Some CATI interviewers not found or not available'
          });
        }

        catiAssignments.push(...catiInterviewerIds.map(interviewerId => {
          const assignment = {
            interviewer: interviewerId,
            assignedBy: currentUser._id,
            maxInterviews: maxInterviews || 0,
            status: 'assigned'
          };
          
          // Add AC assignments only if assignACs is true and AC assignments are provided
          if (survey.assignACs && catiACAssignments && catiACAssignments[interviewerId]) {
            assignment.assignedACs = catiACAssignments[interviewerId];
          }
          
          // Add state assignment if provided
          if (catiStateAssignments && catiStateAssignments[interviewerId]) {
            assignment.selectedState = catiStateAssignments[interviewerId];
          }
          
          // Add country assignment if provided
          if (catiCountryAssignments && catiCountryAssignments[interviewerId]) {
            assignment.selectedCountry = catiCountryAssignments[interviewerId];
          }
          
          return assignment;
        }));
      }
      
      // Update survey with mode-specific assignments
      survey.capiInterviewers = capiAssignments;
      survey.catiInterviewers = catiAssignments;
      survey.lastModifiedBy = currentUser._id;
      await survey.save();
      
    } else {
      // Handle single-mode assignments (original logic)
      const interviewers = await User.find({
        _id: { $in: interviewerIds },
        company: currentUser.company._id,
        userType: 'interviewer',
        status: 'active'
      });

      if (interviewers.length !== interviewerIds.length) {
        return res.status(400).json({
          success: false,
          message: 'Some interviewers not found or not available'
        });
      }

      // Assign interviewers
      const assignments = interviewerIds.map(interviewerId => {
        const assignment = {
          interviewer: interviewerId,
          assignedBy: currentUser._id,
          maxInterviews: maxInterviews || 0,
          status: 'assigned'
        };
        
        // Add mode assignment if provided (for multi-mode surveys)
        if (req.body.interviewerModeAssignments && req.body.interviewerModeAssignments[interviewerId]) {
          assignment.assignedMode = req.body.interviewerModeAssignments[interviewerId];
        }
        
        // Add AC assignments only if assignACs is true and AC assignments are provided
        if (survey.assignACs && interviewerACAssignments && interviewerACAssignments[interviewerId]) {
          assignment.assignedACs = interviewerACAssignments[interviewerId];
        }
        
        // Add state assignment if provided
        if (interviewerStateAssignments && interviewerStateAssignments[interviewerId]) {
          assignment.selectedState = interviewerStateAssignments[interviewerId];
        }
        
        // Add country assignment if provided
        if (interviewerCountryAssignments && interviewerCountryAssignments[interviewerId]) {
          assignment.selectedCountry = interviewerCountryAssignments[interviewerId];
        }
        
        return assignment;
      });

      survey.assignedInterviewers = assignments;
      survey.lastModifiedBy = currentUser._id;
      await survey.save();
    }

    // Populate the updated survey based on mode
    let updatedSurvey;
    if (isMultiMode) {
      updatedSurvey = await Survey.findById(survey._id)
        .populate('capiInterviewers.interviewer', 'firstName lastName email userType phone')
        .populate('capiInterviewers.assignedBy', 'firstName lastName email')
        .populate('catiInterviewers.interviewer', 'firstName lastName email userType phone')
        .populate('catiInterviewers.assignedBy', 'firstName lastName email');
    } else {
      updatedSurvey = await Survey.findById(survey._id)
        .populate('assignedInterviewers.interviewer', 'firstName lastName email userType phone')
        .populate('assignedInterviewers.assignedBy', 'firstName lastName email');
    }

    res.status(200).json({
      success: true,
      message: 'Interviewers assigned successfully',
      data: { survey: updatedSurvey }
    });

  } catch (error) {
    console.error('Assign interviewers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Assign quality agents to a survey
// @route   POST /api/surveys/:id/assign-quality-agents
// @access  Private (Company Admin, Project Manager)
exports.assignQualityAgents = async (req, res) => {
  try {
    const { id } = req.params;
    const { qualityAgentIds, qualityAgentACAssignments, qualityAgentStateAssignments, qualityAgentCountryAssignments } = req.body;

    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has access to this survey
    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only assign quality agents to surveys from your company.'
      });
    }

    // Validate quality agent IDs
    if (!qualityAgentIds || !Array.isArray(qualityAgentIds) || qualityAgentIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Quality agent IDs are required'
      });
    }

    // Check if quality agents exist and belong to the same company
    const qualityAgents = await User.find({
      _id: { $in: qualityAgentIds },
      company: currentUser.company._id,
      userType: 'quality_agent',
      status: 'active'
    });

    if (qualityAgents.length !== qualityAgentIds.length) {
      return res.status(400).json({
        success: false,
        message: 'Some quality agents not found or not available'
      });
    }

    // Assign quality agents
    const assignments = qualityAgentIds.map(agentId => {
      const assignment = {
        qualityAgent: agentId,
        assignedBy: currentUser._id,
        status: 'assigned'
      };
      
      // Add AC assignments only if assignACs is true and AC assignments are provided
      if (survey.assignACs && qualityAgentACAssignments && qualityAgentACAssignments[agentId]) {
        assignment.assignedACs = qualityAgentACAssignments[agentId];
      }
      
      // Add state assignment if provided
      if (qualityAgentStateAssignments && qualityAgentStateAssignments[agentId]) {
        assignment.selectedState = qualityAgentStateAssignments[agentId];
      }
      
      // Add country assignment if provided
      if (qualityAgentCountryAssignments && qualityAgentCountryAssignments[agentId]) {
        assignment.selectedCountry = qualityAgentCountryAssignments[agentId];
      }
      
      return assignment;
    });

    survey.assignedQualityAgents = assignments;
    survey.lastModifiedBy = currentUser._id;
    await survey.save();

    // TOP-TIER TECH COMPANY SOLUTION: Invalidate cache for all affected Quality Agents
    // This ensures cache consistency when survey assignments change (Meta, Google, Amazon pattern)
    const surveyAssignmentCache = require('../utils/surveyAssignmentCache');
    const companyId = currentUser.company._id.toString();
    
    // Invalidate cache for all assigned Quality Agents (non-blocking)
    // Use Promise.allSettled to avoid blocking the response if cache invalidation fails
    Promise.allSettled(
      qualityAgentIds.map(async (agentId) => {
        try {
          await surveyAssignmentCache.invalidate(agentId.toString(), companyId);
        } catch (error) {
          // Non-critical error - log but don't fail the request
          console.warn(`⚠️ Failed to invalidate cache for Quality Agent ${agentId}:`, error.message);
        }
      })
    ).catch(() => {
      // Ignore errors - cache invalidation failures shouldn't block the response
    });

    // Populate the updated survey
    const updatedSurvey = await Survey.findById(survey._id)
      .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email userType phone')
      .populate('assignedQualityAgents.assignedBy', 'firstName lastName email');

    res.status(200).json({
      success: true,
      message: 'Quality agents assigned successfully',
      data: { survey: updatedSurvey }
    });

  } catch (error) {
    console.error('Assign quality agents error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get survey statistics
// @route   GET /api/surveys/stats
// @access  Private (Company Admin, Project Manager)
exports.getSurveyStats = async (req, res) => {
  try {
    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Get statistics
    const stats = await Survey.getStats(currentUser.company._id);

    res.status(200).json({
      success: true,
      message: 'Survey statistics retrieved successfully',
      data: { stats }
    });

  } catch (error) {
    console.error('Get survey stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get overall statistics for dashboard (optimized with aggregation + caching)
// @route   GET /api/surveys/overall-stats
// @access  Private (Company Admin, Project Manager)
exports.getOverallStats = async (req, res) => {
  try {
    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    const companyId = currentUser.company._id;
    
    // Convert to ObjectId if it's not already
    const companyObjectId = mongoose.Types.ObjectId.isValid(companyId) 
      ? (typeof companyId === 'string' ? new mongoose.Types.ObjectId(companyId) : companyId)
      : companyId;

    // CRITICAL FIX: Use Redis caching for fast stats retrieval
    // Top tech companies (Meta, Twitter, Instagram) cache dashboard stats
    // This prevents slow database queries on every page load
    const statsCache = require('../utils/statsCache');
    
    const stats = await statsCache.getOverallStats(companyObjectId.toString(), async () => {
      // Calculate stats (only called on cache miss)
      // CRITICAL OPTIMIZATION: Combine all aggregations into a single pipeline
      // This is much faster than running 3 separate aggregations
      
      // Get survey IDs first (lightweight, just IDs)
      const surveyIds = await Survey.find({ company: companyObjectId }).select('_id').lean();
      const surveyIdArray = surveyIds.map(s => s._id);
      
      // Single aggregation pipeline for all stats
      const [surveyStatsResult, responseStatsResult] = await Promise.all([
        // Survey stats (total, active, cost)
        Survey.aggregate([
          { $match: { company: companyObjectId } },
          {
            $group: {
              _id: null,
              totalSurveys: { $sum: 1 },
              activeSurveys: {
                $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
              },
              totalCost: { $sum: { $ifNull: ['$cost', 0] } }
            }
          }
        ]),
        // Response stats (only if we have surveys)
        surveyIdArray.length > 0
          ? SurveyResponse.aggregate([
              {
                $match: {
                  survey: { $in: surveyIdArray }
                }
              },
              {
                $group: {
                  _id: null,
                  totalResponses: { $sum: 1 }
                }
              }
            ])
          : Promise.resolve([{ totalResponses: 0 }])
      ]);

      // Combine results
      return {
        totalSurveys: surveyStatsResult[0]?.totalSurveys || 0,
        activeSurveys: surveyStatsResult[0]?.activeSurveys || 0,
        totalResponses: responseStatsResult[0]?.totalResponses || 0,
        totalCost: surveyStatsResult[0]?.totalCost || 0
      };
    });

    res.status(200).json({
      success: true,
      message: 'Overall statistics retrieved successfully',
      data: { stats }
    });

  } catch (error) {
    console.error('Get overall stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Update an existing survey
// @route   PUT /api/surveys/:id
// @access  Private (Company Admin, Project Manager)
exports.updateSurvey = async (req, res) => {
  try {
    const surveyId = req.params.id;
    const {
      surveyName,
      description,
      category,
      purpose,
      mode,
      includeGigWorkers,
      startDate,
      deadline,
      sampleSize,
      targetAudience,
      thresholdInterviewsPerDay,
      maxInterviewsPerInterviewer,
      onlineContactMode,
      contactList,
      assignedInterviewers,
      assignedQualityAgents,
      sections,
      templateUsed,
      settings,
      notifications,
      status,
      assignACs,
      acAssignmentCountry,
      acAssignmentState,
      modes,
      modeAllocation,
      modeQuotas,
      modeGigWorkers,
      respondentContacts,
      sets
    } = req.body;

    // Find the survey
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has permission to update this survey
    const user = req.user;
    if (user.userType === 'company_admin' && survey.company.toString() !== user.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this survey'
      });
    }

    // Clean targetAudience data for update
    const cleanTargetAudience = (targetAudience) => {
      console.log('🔍 Backend received targetAudience for update:', JSON.stringify(targetAudience, null, 2));
      
      if (!targetAudience) {
        return {
          demographics: {},
          geographic: {},
          behavioral: {},
          psychographic: {},
          custom: '',
          quotaManagement: false
        };
      }

      // Handle the new structure where each category is an object with boolean flags and requirements
      const cleaned = {
        demographics: targetAudience.demographics || {},
        geographic: targetAudience.geographic || {},
        behavioral: targetAudience.behavioral || {},
        psychographic: targetAudience.psychographic || {},
        custom: targetAudience.custom || '',
        quotaManagement: targetAudience.quotaManagement || false
      };
      
      console.log('🔍 Backend cleaned targetAudience for update:', JSON.stringify(cleaned, null, 2));
      return cleaned;
    };

    // Process assignedInterviewers to handle status updates
    let processedAssignedInterviewers = assignedInterviewers;
    if (assignedInterviewers && Array.isArray(assignedInterviewers)) {
      processedAssignedInterviewers = assignedInterviewers.map(assignment => {
        const processedAssignment = { ...assignment };
        
        // If Company Admin is reassigning an interviewer, reset status to 'assigned'
        if (assignment.status === 'rejected' && assignment.interviewer) {
          processedAssignment.status = 'assigned';
          processedAssignment.assignedAt = new Date(); // Update assignment time
        }
        
        // If assignACs is false, explicitly set assignedACs to empty array to ensure it's removed
        // Using empty array instead of delete to ensure Mongoose properly updates the field
        if (assignACs === false) {
          processedAssignment.assignedACs = [];
        }
        
        return processedAssignment;
      });
    }

    // Process assignedQualityAgents to remove ACs if assignACs is false
    let processedAssignedQualityAgents = assignedQualityAgents || survey.assignedQualityAgents;
    if (processedAssignedQualityAgents && Array.isArray(processedAssignedQualityAgents)) {
      processedAssignedQualityAgents = processedAssignedQualityAgents.map(assignment => {
        const processedAssignment = { ...assignment };
        
        // If assignACs is false, explicitly set assignedACs to empty array to ensure it's removed
        // Using empty array instead of delete to ensure Mongoose properly updates the field
        if (assignACs === false) {
          processedAssignment.assignedACs = [];
        }
        
        return processedAssignment;
      });
    }

    // Prepare update data
    const updateData = {
      surveyName,
      description,
      category,
      purpose,
      mode,
      modes: modes || [],
      modeAllocation: modeAllocation || {},
      modeQuotas: modeQuotas || {},
      modeGigWorkers: modeGigWorkers || {},
      includeGigWorkers: includeGigWorkers || false,
      startDate,
      deadline,
      sampleSize,
      targetAudience: cleanTargetAudience(targetAudience),
      thresholdInterviewsPerDay,
      maxInterviewsPerInterviewer,
      onlineContactMode,
      contactList,
      assignedInterviewers: processedAssignedInterviewers,
      assignedQualityAgents: processedAssignedQualityAgents,
      sections: (() => {
        // Debug: Log sections with settings when updating
        if (sections && Array.isArray(sections)) {
          sections.forEach((section, sectionIdx) => {
            if (section.questions && Array.isArray(section.questions)) {
              section.questions.forEach((question, questionIdx) => {
                if (question.type === 'multiple_choice' && question.settings) {
                  console.log('🔍 Backend updating question with settings:', {
                    sectionIndex: sectionIdx,
                    questionIndex: questionIdx,
                    questionId: question.id,
                    questionText: question.text,
                    settings: question.settings
                  });
                }
              });
            }
          });
        }
        return sections;
      })(),
      templateUsed,
      settings,
      notifications,
      status,
      assignACs,
      acAssignmentCountry: assignACs ? acAssignmentCountry : '',
      acAssignmentState: assignACs ? acAssignmentState : '',
      respondentContacts: respondentContacts !== undefined ? respondentContacts : survey.respondentContacts,
      sets: sets !== undefined ? sets : survey.sets,
      updatedAt: new Date()
    };

    // Update the survey
    // Note: MongoDB handles large arrays efficiently, but we ensure proper indexing
    const updatedSurvey = await Survey.findByIdAndUpdate(
      surveyId,
      updateData,
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName email')
     .populate('company', 'companyName companyCode')
     .populate('assignedInterviewers.interviewer', 'firstName lastName email phone')
     .populate('assignedQualityAgents.qualityAgent', 'firstName lastName email phone');

    // CRITICAL: Invalidate cache when survey is updated
    // This ensures interviewers get the latest survey data
    const surveyCache = require('../utils/surveyCache');
    const statsCache = require('../utils/statsCache');
    surveyCache.invalidateSurveyCache(surveyId).catch(err => {
      console.warn('Cache invalidation error (non-blocking):', err.message);
    });
    statsCache.invalidateStatsCache(survey.company.toString()).catch(err => {
      console.warn('Stats cache invalidation error (non-blocking):', err.message);
    });

    // TOP-TIER TECH COMPANY SOLUTION: Invalidate Quality Agent assignment cache if assignedQualityAgents changed
    // This ensures cache consistency when survey assignments are updated (Meta, Google, Amazon pattern)
    if (assignedQualityAgents !== undefined && Array.isArray(processedAssignedQualityAgents)) {
      const surveyAssignmentCache = require('../utils/surveyAssignmentCache');
      const companyId = survey.company.toString();
      
      // Collect all Quality Agent IDs from both old and new assignments
      const oldAgentIds = (survey.assignedQualityAgents || []).map(a => {
        const agentId = a.qualityAgent?._id || a.qualityAgent;
        return agentId?.toString();
      }).filter(Boolean);
      
      const newAgentIds = processedAssignedQualityAgents.map(a => {
        const agentId = a.qualityAgent?._id || a.qualityAgent;
        return agentId?.toString();
      }).filter(Boolean);
      
      // Combine and deduplicate
      const allAgentIds = [...new Set([...oldAgentIds, ...newAgentIds])];
      
      // Invalidate cache for all affected Quality Agents (non-blocking)
      Promise.allSettled(
        allAgentIds.map(async (agentId) => {
          try {
            await surveyAssignmentCache.invalidate(agentId, companyId);
          } catch (error) {
            console.warn(`⚠️ Failed to invalidate cache for Quality Agent ${agentId}:`, error.message);
          }
        })
      ).catch(() => {
        // Ignore errors - cache invalidation failures shouldn't block the response
      });
    }

    res.status(200).json({
      success: true,
      message: 'Survey updated successfully',
      data: {
        survey: updatedSurvey
      }
    });

  } catch (error) {
    console.error('Error updating survey:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get available surveys for interviewer or quality agent
// @route   GET /api/surveys/available
// @access  Private (Interviewer, Quality Agent)
exports.getAvailableSurveys = async (req, res) => {
  try {
    // OPTIMIZED: Use lean() for faster query (returns plain object, not Mongoose document)
    // Top tech companies use lean() for read-only queries to reduce memory overhead
    const currentUser = await User.findById(req.user.id)
      .select('_id userType')
      .lean();
    
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const { search, status, category, sortBy = 'assignedAt', sortOrder = 'desc' } = req.query;

    console.log('🔍 getAvailableSurveys - Current user ID:', currentUser._id);
    console.log('🔍 getAvailableSurveys - User type:', currentUser.userType);
    console.log('🔍 getAvailableSurveys - Query params:', { search, status, category, sortBy, sortOrder });

    // Build query based on user type
    let query = {};
    
    if (currentUser.userType === 'quality_agent') {
      // For quality agents, find surveys where they are assigned as quality agents
      query = {
        'assignedQualityAgents.qualityAgent': currentUser._id,
        status: { $in: ['active', 'draft'] } // Only show active or draft surveys
      };
    } else {
      // For interviewers, find surveys where they are assigned as interviewers
      // Handle both single-mode (assignedInterviewers) and multi-mode (capiInterviewers, catiInterviewers) surveys
      query = {
        $or: [
          { 'assignedInterviewers.interviewer': currentUser._id },
          { 'capiInterviewers.interviewer': currentUser._id },
          { 'catiInterviewers.interviewer': currentUser._id }
        ],
        status: { $in: ['active', 'draft'] } // Only show active or draft surveys
      };
    }

    // Add search filter
    if (search) {
      if (currentUser.userType === 'quality_agent') {
        // For quality agents, add search to existing query
        query.$and = [
          { 'assignedQualityAgents.qualityAgent': currentUser._id },
          {
            $or: [
              { surveyName: { $regex: search, $options: 'i' } },
              { description: { $regex: search, $options: 'i' } },
              { category: { $regex: search, $options: 'i' } }
            ]
          }
        ];
      } else {
        // For interviewers, add search to existing query
        query.$and = [
          {
            $or: [
              { 'assignedInterviewers.interviewer': currentUser._id },
              { 'capiInterviewers.interviewer': currentUser._id },
              { 'catiInterviewers.interviewer': currentUser._id }
            ]
          },
          {
            $or: [
              { surveyName: { $regex: search, $options: 'i' } },
              { description: { $regex: search, $options: 'i' } },
              { category: { $regex: search, $options: 'i' } }
            ]
          }
        ];
        delete query.$or; // Remove the original $or since we're using $and now
      }
    }

    // Add category filter
    if (category) {
      query.category = category;
    }

    // Build sort object
    let sort = {};
    if (sortBy === 'assignedAt') {
      // For assignedAt sorting, we'll handle this in the transformation since we have multiple possible assignment arrays
      sort.createdAt = sortOrder === 'asc' ? 1 : -1; // Fallback to createdAt
    } else if (sortBy === 'deadline') {
      sort.deadline = sortOrder === 'asc' ? 1 : -1;
    } else if (sortBy === 'surveyName') {
      sort.surveyName = sortOrder === 'asc' ? 1 : -1;
    } else {
      sort.createdAt = -1; // Default sort
    }

    console.log('🔍 getAvailableSurveys - Final query:', JSON.stringify(query, null, 2));

    // CRITICAL OPTIMIZATION: Use Redis cache AND remove sections/questions from list view
    // Top tech companies (Meta, Google) cache list endpoints and load detail data on-demand only
    // Loading sections/questions (100+ questions per survey) in list view causes massive memory leaks
    const redisOps = require('../utils/redisClient');
    const cacheKey = `available-surveys:${currentUser._id}:${JSON.stringify(req.query)}`;
    
    // Check Redis cache first (1 minute TTL)
    try {
      const cached = await redisOps.get(cacheKey);
      if (cached) {
        console.log('✅ getAvailableSurveys - Redis cache HIT');
        return res.json({
          success: true,
          data: cached
        });
      }
    } catch (cacheError) {
      console.warn('⚠️ Redis cache check failed, continuing with DB query:', cacheError.message);
    }

    // OPTIMIZED: Use lean() and minimal populate to reduce memory overhead
    // CRITICAL FIX: REMOVED sections/questions from select - these are HUGE and not needed for list view
    // Top tech companies minimize data loaded into memory for list endpoints
    // CRITICAL: Include full assignment data (assignedInterviewers, capiInterviewers, catiInterviewers) for offline sync
    // This ensures mobile apps can check assignments offline without internet connection
    const surveys = await Survey.find(query)
      .select('surveyName description status mode category createdAt deadline assignedInterviewers capiInterviewers catiInterviewers assignedQualityAgents assignACs acAssignmentState') // REMOVED sections questions - huge memory waste
      .populate('createdBy', 'firstName lastName') // Removed email to reduce data
      .sort(sort)
      .lean();

    console.log('🔍 getAvailableSurveys - Found surveys:', surveys.length);
    if (surveys.length > 0) {
      console.log('🔍 getAvailableSurveys - First survey ID:', surveys[0]._id);
      console.log('🔍 getAvailableSurveys - First survey mode:', surveys[0].mode);
    }

    // Transform the data to include assignment-specific information
    const transformedSurveys = surveys.map(survey => {
      console.log(`🔍 Processing survey ${survey._id} (mode: ${survey.mode})`);
      let assignment = null;
      let assignedMode = null;

      // Check for single-mode assignment
      if (survey.assignedInterviewers && survey.assignedInterviewers.length > 0) {
        assignment = survey.assignedInterviewers.find(
          assignment => assignment.interviewer.toString() === currentUser._id.toString()
        );
        if (assignment) {
          assignedMode = assignment.assignedMode || 'single';
        }
      }

      // Check for multi-mode CAPI assignment
      if (!assignment && survey.capiInterviewers && survey.capiInterviewers.length > 0) {
        console.log(`🔍 Checking CAPI interviewers for survey ${survey._id}:`, survey.capiInterviewers.length);
        assignment = survey.capiInterviewers.find(
          assignment => assignment.interviewer.toString() === currentUser._id.toString()
        );
        if (assignment) {
          assignedMode = 'capi';
          console.log(`🔍 Found CAPI assignment for user ${currentUser._id}`);
        }
      }

      // Check for multi-mode CATI assignment
      if (!assignment && survey.catiInterviewers && survey.catiInterviewers.length > 0) {
        assignment = survey.catiInterviewers.find(
          assignment => assignment.interviewer.toString() === currentUser._id.toString()
        );
        if (assignment) {
          assignedMode = 'cati';
        }
      }

      return {
        ...survey,
        assignmentStatus: assignment ? assignment.status : 'assigned',
        assignedAt: assignment ? assignment.assignedAt : survey.createdAt,
        assignedACs: assignment ? assignment.assignedACs : [],
        selectedState: assignment ? assignment.selectedState : null,
        selectedCountry: assignment ? assignment.selectedCountry : null,
        maxInterviews: assignment ? assignment.maxInterviews : 0,
        completedInterviews: assignment ? assignment.completedInterviews : 0,
        assignedMode: assignedMode // Add the assigned mode for multi-mode surveys
      };
    });

    // Filter out surveys where the interviewer has rejected the assignment
    let filteredSurveys = transformedSurveys.filter(survey => 
      survey.assignmentStatus !== 'rejected'
    );
    
    if (status) {
      filteredSurveys = filteredSurveys.filter(survey => survey.assignmentStatus === status);
    }

    // Handle assignedAt sorting after transformation
    if (sortBy === 'assignedAt') {
      filteredSurveys.sort((a, b) => {
        const aDate = new Date(a.assignedAt);
        const bDate = new Date(b.assignedAt);
        return sortOrder === 'asc' ? aDate - bDate : bDate - aDate;
      });
    }

    const responseData = {
      surveys: filteredSurveys,
      total: filteredSurveys.length
    };

    // Store in Redis cache (1 minute TTL - list data changes frequently)
    try {
      await redisOps.set(cacheKey, responseData, 60); // 1 minute TTL
      console.log('✅ getAvailableSurveys - Stored in Redis cache');
    } catch (cacheError) {
      console.warn('⚠️ Redis cache store failed (non-blocking):', cacheError.message);
    }

    res.json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Error fetching available surveys:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Reject an interview assignment
// @route   POST /api/surveys/:id/reject-interview
// @access  Private (Interviewer)
exports.rejectInterview = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user.id);
    if (!currentUser) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const survey = await Survey.findById(req.params.id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Find the assignment for this interviewer
    const assignment = survey.assignedInterviewers.find(
      assignment => assignment.interviewer.toString() === currentUser._id.toString()
    );

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Interview assignment not found'
      });
    }

    // Check if already rejected or completed
    if (assignment.status === 'rejected') {
      return res.status(400).json({
        success: false,
        message: 'Interview has already been rejected'
      });
    }

    if (assignment.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot reject a completed interview'
      });
    }

    // Update the assignment status to rejected
    assignment.status = 'rejected';
    await survey.save();

    res.json({
      success: true,
      message: 'Interview rejected successfully',
      data: {
        surveyId: survey._id,
        assignmentStatus: 'rejected'
      }
    });

  } catch (error) {
    console.error('Error rejecting interview:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// Debug endpoint to check survey responses
exports.debugSurveyResponses = async (req, res) => {
  try {
    const { surveyId } = req.params;
    
    // Get all responses for this survey
    const allResponses = await SurveyResponse.find({ survey: surveyId });
    
    // Group by status
    const statusCounts = {};
    allResponses.forEach(response => {
      statusCounts[response.status] = (statusCounts[response.status] || 0) + 1;
    });
    
    res.json({
      success: true,
      data: {
        surveyId,
        totalResponses: allResponses.length,
        statusCounts,
        responses: allResponses.map(r => ({
          id: r._id,
          status: r.status,
          interviewer: r.interviewer,
          createdAt: r.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Debug survey responses error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: error.message
    });
  }
};

// Configure multer for Excel file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel', // .xls
      'application/vnd.ms-excel.sheet.macroEnabled.12' // .xlsm
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed.'));
    }
  }
});

// @desc    Download Excel template for respondent contacts
// @route   GET /api/surveys/respondent-contacts/template
// @access  Private (Company Admin, Project Manager)
exports.downloadRespondentTemplate = async (req, res) => {
  try {
    // Create workbook and worksheet
    const workbook = XLSX.utils.book_new();
    
    // Define column headers - Country Code is optional and comes before Phone
    const headers = ['Name', 'Country Code', 'Phone', 'Email', 'Address', 'City', 'AC', 'PC', 'PS'];
    
    // Create worksheet with headers
    const worksheet = XLSX.utils.aoa_to_sheet([headers]);
    
    // Set column widths
    worksheet['!cols'] = [
      { wch: 20 }, // Name
      { wch: 12 }, // Country Code
      { wch: 15 }, // Phone
      { wch: 30 }, // Email
      { wch: 40 }, // Address
      { wch: 20 }, // City
      { wch: 15 }, // AC
      { wch: 15 }, // PC
      { wch: 15 }  // PS
    ];
    
    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Respondents');
    
    // Generate Excel file buffer
    const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="CATI_Respondent_Template.xlsx"');
    
    // Send file
    res.send(excelBuffer);
  } catch (error) {
    console.error('Error generating Excel template:', error);
    res.status(500).json({
      success: false,
      message: 'Error generating template',
      error: error.message
    });
  }
};

// @desc    Upload and parse Excel file with respondent contacts
// @route   POST /api/surveys/respondent-contacts/upload
// @access  Private (Company Admin, Project Manager)
exports.uploadRespondentContacts = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // CRITICAL FIX: Check file size first to prevent memory leaks
    // For large files (50K+ contacts), loading entire file causes 200-500MB memory leak
    const fileSizeMB = req.file.buffer.length / 1024 / 1024;
    console.log(`📊 Uploaded file size: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > 10) {
      console.warn(`⚠️ Large Excel file detected: ${fileSizeMB.toFixed(2)}MB. Processing in batches to prevent memory leak.`);
    }

    // Parse Excel file
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // CRITICAL FIX: Process in batches to prevent memory leaks
    // Top tech companies (Amazon, Facebook) use batch processing for large files
    // XLSX library still needs to read entire sheet, but we process in batches and clear memory
    
    // Convert to JSON - use raw: true to preserve phone numbers as they are
    // NOTE: XLSX library reads entire sheet, but we'll process in batches
    const data = XLSX.utils.sheet_to_json(worksheet, { 
      header: ['name', 'countryCode', 'phone', 'email', 'address', 'city', 'ac', 'pc', 'ps'],
      defval: '',
      raw: true  // Get raw values to preserve phone numbers exactly as entered
    });
    
    console.log(`📊 Total rows from Excel: ${data.length}`);
    
    // CRITICAL: Process in batches to prevent memory leaks
    // Only keep current batch in memory, process and discard
    const BATCH_SIZE = 1000; // Process 1000 rows at a time
    const headerValues = ['name', 'country code', 'phone', 'email', 'address', 'city', 'ac', 'pc', 'ps'];
    
    // Validate and process contacts (batch processing)
    const contacts = [];
    const errors = [];
    let processedRows = 0;
    
    // Process data in batches to prevent memory leak
    for (let startIdx = 0; startIdx < data.length; startIdx += BATCH_SIZE) {
      const endIdx = Math.min(startIdx + BATCH_SIZE, data.length);
      const batch = data.slice(startIdx, endIdx); // Get current batch
      
      // Filter out header rows for this batch
      const filteredBatch = batch.filter(row => {
        const nameStr = row.name ? row.name.toString().toLowerCase().trim() : '';
        const phoneStr = row.phone ? row.phone.toString().toLowerCase().trim() : '';
        
        if (headerValues.includes(nameStr) || headerValues.includes(phoneStr)) {
          return false;
        }
        
        if (nameStr === 'name' || phoneStr === 'phone') {
          return false;
        }
        
        return true;
      });
      
      // Process current batch
      filteredBatch.forEach((row, batchIndex) => {
        const actualIndex = startIdx + batchIndex; // Actual row number in Excel
        
        // Skip empty rows
        if (!row.name && !row.phone && !row.countryCode) {
          return;
        }

        // Validate required fields
        if (!row.name || (typeof row.name === 'string' && row.name.trim() === '')) {
          errors.push(`Row ${actualIndex + 2}: Name is required`);
          return;
        }
      
      // Check if phone is provided (handle 0, empty string, null, undefined, and dash)
      const phoneValue = row.phone;
      if (phoneValue === null || phoneValue === undefined || phoneValue === '' || 
          (typeof phoneValue === 'string' && phoneValue.trim() === '') ||
          (typeof phoneValue === 'string' && phoneValue.trim() === '-')) {
        errors.push(`Row ${actualIndex + 2}: Phone number is required (received: ${JSON.stringify(phoneValue)})`);
        return;
      }

        // Convert phone to string and handle various formats
        let phoneStr = '';
        
        // Debug logging for phone number (only for first 10 rows to reduce log spam)
        if (actualIndex < 10) {
          console.log(`📱 Row ${actualIndex + 2} - Phone raw value:`, row.phone, 'Type:', typeof row.phone);
        }
        
        if (row.phone === null || row.phone === undefined) {
          errors.push(`Row ${actualIndex + 2}: Phone number is required`);
          return;
        }
        
        // Handle different phone number formats
        if (typeof row.phone === 'number') {
          // If it's a number, convert to string without scientific notation
          // Handle large numbers that might be in scientific notation
          const numStr = row.phone.toString();
          if (numStr.includes('e') || numStr.includes('E')) {
            // Convert from scientific notation (e.g., 9.958011332e+9 -> 9958011332)
            phoneStr = row.phone.toFixed(0);
          } else {
            // Regular number, convert to string
            phoneStr = numStr;
          }
        } else if (typeof row.phone === 'string') {
          phoneStr = row.phone;
        } else if (row.phone !== null && row.phone !== undefined) {
          // Try to convert to string
          phoneStr = String(row.phone);
        } else {
          errors.push(`Row ${actualIndex + 2}: Phone number is empty or invalid (type: ${typeof row.phone})`);
          return;
        }
        
        // Clean phone number (remove spaces, dashes, parentheses, plus signs, dots, etc.)
        let cleanPhone = phoneStr.trim();
        
        // Remove leading + if present (we'll validate length separately)
        if (cleanPhone.startsWith('+')) {
          cleanPhone = cleanPhone.substring(1);
        }
        
        // Remove all non-digit characters
        cleanPhone = cleanPhone.replace(/[^\d]/g, '');
        
        // Debug logging (only for first 10 rows to reduce log spam and memory usage)
        if (actualIndex < 10) {
          console.log(`📱 Row ${actualIndex + 2} - Phone after cleaning:`, cleanPhone, 'Length:', cleanPhone.length);
        }

        // Validate phone number format (should be numeric and 10-15 digits)
        // Also check if it's not empty after cleaning
        if (!cleanPhone || cleanPhone.length === 0) {
          errors.push(`Row ${actualIndex + 2}: Phone number is empty or invalid (original: "${phoneStr}", cleaned: "${cleanPhone}")`);
          return;
        }
        
        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
          errors.push(`Row ${actualIndex + 2}: Invalid phone number format. Phone must be 10-15 digits (got ${cleanPhone.length} digits: "${cleanPhone}")`);
          return;
        }
        
        if (!/^\d+$/.test(cleanPhone)) {
          errors.push(`Row ${actualIndex + 2}: Phone number contains non-numeric characters`);
          return;
        }

        // Handle country code (optional)
        let countryCode = '';
        if (row.countryCode !== null && row.countryCode !== undefined && row.countryCode !== '') {
          const countryCodeStr = String(row.countryCode).trim();
          // Remove + if present
          countryCode = countryCodeStr.startsWith('+') ? countryCodeStr.substring(1) : countryCodeStr;
          // Remove non-digit characters
          countryCode = countryCode.replace(/[^\d]/g, '');
        }

        // Create contact object
        const contact = {
          name: row.name.toString().trim(),
          countryCode: countryCode || undefined, // Store only if provided
          phone: cleanPhone,
          email: row.email ? row.email.toString().trim() : '',
          address: row.address ? row.address.toString().trim() : '',
          city: row.city ? row.city.toString().trim() : '',
          ac: row.ac ? row.ac.toString().trim() : '',
          pc: row.pc ? row.pc.toString().trim() : '',
          ps: row.ps ? row.ps.toString().trim() : '',
          addedAt: new Date(),
          addedBy: req.user.id
        };

        contacts.push(contact);
      });
      
      processedRows += filteredBatch.length;
      
      // CRITICAL: Clear batch data from memory immediately after processing
      // This prevents memory accumulation across batches
      batch.length = 0;
      filteredBatch.length = 0;
      
      // Log progress for large files
      if (data.length > 5000 && processedRows % 5000 === 0) {
        console.log(`📊 Processed ${processedRows}/${data.length} rows (${Math.round(processedRows/data.length*100)}%)`);
      }
    }
    
    // CRITICAL: Clear large data array from memory after processing all batches
    // This helps garbage collector free memory immediately
    data.length = 0;
    
    // Clear workbook from memory after processing
    workbook.SheetNames = [];
    workbook.Sheets = {};

    if (errors.length > 0 && contacts.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No valid contacts found in file',
        errors: errors.slice(0, 100) // Limit errors too
      });
    }

    // CRITICAL FIX: Don't return ALL contacts in response for large files
    // Top tech companies return summary + sample, not entire dataset
    // This prevents sending 50K+ contacts over the network and into frontend memory
    const MAX_CONTACTS_IN_RESPONSE = 100; // Only return first 100 contacts as sample
    const MAX_ERRORS_IN_RESPONSE = 100; // Limit errors too

    res.status(200).json({
      success: true,
      message: `Successfully parsed ${contacts.length} contact(s)`,
      data: {
        contacts: contacts.slice(0, MAX_CONTACTS_IN_RESPONSE), // Only return sample, not all
        totalContacts: contacts.length, // Total count for reference
        errors: errors.length > 0 ? errors.slice(0, MAX_ERRORS_IN_RESPONSE) : undefined, // Limit errors
        totalRows: processedRows,
        validContacts: contacts.length,
        invalidRows: errors.length,
        // CRITICAL: Indicate if more contacts exist (for large files)
        hasMoreContacts: contacts.length > MAX_CONTACTS_IN_RESPONSE,
        sampleSize: Math.min(contacts.length, MAX_CONTACTS_IN_RESPONSE)
      }
    });
    
    // CRITICAL: Clear contacts and errors arrays from memory after response
    // Help garbage collector by explicitly clearing large arrays
    contacts.length = 0;
    errors.length = 0;

  } catch (error) {
    console.error('Error parsing Excel file:', error);
    res.status(500).json({
      success: false,
      message: 'Error parsing Excel file',
      error: error.message
    });
  }
};

// @desc    Get respondent contacts for a survey (from JSON file or database)
// @route   GET /api/surveys/:id/respondent-contacts
// @access  Private (Company Admin, Project Manager)
exports.getRespondentContacts = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    // Find the survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has permission
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only view contacts from your company surveys.'
      });
    }

    const fs = require('fs').promises;
    const fsSync = require('fs');
    const path = require('path');
    const { chain } = require('stream-chain');
    const { parser } = require('stream-json');
    const { streamArray } = require('stream-json/streamers/StreamArray');
    const contactsCache = require('../utils/respondentContactsCache');
    
    // CRITICAL FIX: Try Redis cache first (fast, no memory)
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const cached = await contactsCache.getRespondentContacts(id, pageNum, limitNum);
    if (cached) {
      return res.status(200).json({
        success: true,
        message: 'Respondent contacts retrieved successfully (cached)',
        data: {
          contacts: cached.contacts,
          pagination: {
            current: pageNum,
            pages: Math.ceil(cached.total / limitNum),
            total: cached.total,
            limit: limitNum,
            hasNext: (pageNum - 1) * limitNum + cached.contacts.length < cached.total,
            hasPrev: pageNum > 1
          }
        }
      });
    }
    
    let contacts = [];
    let total = 0;

    // Check if contacts are stored in JSON file
    const possiblePaths = [];
    
    if (survey.respondentContactsFile) {
      if (path.isAbsolute(survey.respondentContactsFile)) {
        possiblePaths.push(survey.respondentContactsFile);
      } else {
        // Try relative to backend directory
        possiblePaths.push(path.join(__dirname, '..', survey.respondentContactsFile));
        // Try relative to project root
        possiblePaths.push(path.join('/var/www/opine', survey.respondentContactsFile));
      }
    }
    
    // Also try default paths
    possiblePaths.push(path.join('/var/www/opine', 'data', 'respondent-contacts', `${id}.json`));
    possiblePaths.push(path.join(__dirname, '..', 'data', 'respondent-contacts', `${id}.json`));
    
    // Also check Optimised-backup directory
    possiblePaths.push(path.join('/var/www/Optimised-backup', 'opine', 'data', 'respondent-contacts', `${id}.json`));
    
    let fileRead = false;
    console.log(`🔍 Looking for respondent contacts file for survey: ${id}`);
    console.log(`🔍 Possible paths:`, possiblePaths);
    
    for (const filePath of possiblePaths) {
      try {
        await fs.access(filePath);
        console.log(`✅ File found at: ${filePath}`);
        
        // CRITICAL FIX: Check file size first to prevent memory leaks
        // For large files (50K+ contacts), loading entire file causes 50-200MB memory leak
        const stats = await fs.stat(filePath);
        const fileSizeMB = stats.size / 1024 / 1024;
        
        // If file is large (>10MB), we need to use streaming or limit what we load
        // For now, we'll still load it but with a warning and optimization
        if (fileSizeMB > 10) {
          console.warn(`⚠️ Large respondent contacts file detected: ${fileSizeMB.toFixed(2)}MB. This may cause memory issues.`);
        }
        
        // CRITICAL FIX: Use streaming JSON parser for large files
        // Top tech companies (Meta, Amazon, Twitter) use streaming to avoid memory leaks
        // This processes JSON file in chunks, only keeping needed items in memory
        const skip = (pageNum - 1) * limitNum;
        const endIdx = skip + limitNum;
        
        // Use streaming JSON parser - processes file in chunks
        await new Promise((resolve, reject) => {
          let currentIndex = 0;
          let itemsCollected = 0;
          
          const pipeline = chain([
            fsSync.createReadStream(filePath),
            parser(),
            streamArray()
          ]);
          
          pipeline.on('data', (data) => {
            // data.value contains the array item
            // We need to count all items for total, but only collect the needed page
            if (currentIndex >= skip && currentIndex < endIdx) {
              contacts.push({ ...data.value }); // Create new object, don't reference original
              itemsCollected++;
            }
            currentIndex++;
            
            // Note: We can't stop early because we need total count for pagination
            // But we're only keeping the needed page in memory, which is the key optimization
          });
          
          pipeline.on('end', async () => {
            total = currentIndex; // Total count
            
            // Cache the result for future requests
            const fileMetadata = {
              size: stats.size,
              mtime: stats.mtime.getTime()
            };
            
            await contactsCache.setRespondentContacts(
              id, 
              pageNum, 
              limitNum, 
              contacts, 
              total, 
              fileMetadata
            );
            
            fileRead = true;
            console.log(`✅ Successfully streamed ${total} contacts from file (showing page ${pageNum}, ${contacts.length} contacts): ${filePath}`);
            resolve();
          });
          
          pipeline.on('error', (error) => {
            console.error(`❌ Streaming JSON parse error for file ${filePath}:`, error.message);
            contacts = [];
            total = 0;
            fileRead = false; // Don't mark as read on error
            resolve(); // Continue to next path or fallback
          });
        });
        
        if (fileRead) {
          break; // Exit loop if file was successfully read
        }
      } catch (fileError) {
        console.log(`❌ Could not read file at ${filePath}:`, fileError.message);
        continue;
      }
    }
    
    if (!fileRead) {
      console.log(`⚠️ No JSON file found, will check database array`);
    }
    
    if (fileRead) {
      // Pagination already applied during streaming (optimized to prevent memory leak)
      return res.status(200).json({
        success: true,
        message: 'Respondent contacts retrieved successfully',
        data: {
          contacts: contacts, // Already paginated from streaming
          pagination: {
            current: pageNum,
            pages: Math.ceil(total / limitNum),
            total: total,
            limit: limitNum,
            hasNext: (pageNum - 1) * limitNum + contacts.length < total,
            hasPrev: pageNum > 1
          }
        }
      });
    }

    // Fallback: Check if contacts are in database array
    if (survey.respondentContacts && Array.isArray(survey.respondentContacts) && survey.respondentContacts.length > 0) {
      contacts = survey.respondentContacts;
      total = contacts.length;
      
      // Apply pagination
      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const skip = (pageNum - 1) * limitNum;
      const paginatedContacts = contacts.slice(skip, skip + limitNum);
      
      return res.status(200).json({
        success: true,
        message: 'Respondent contacts retrieved successfully',
        data: {
          contacts: paginatedContacts,
          pagination: {
            current: pageNum,
            pages: Math.ceil(total / limitNum),
            total: total,
            limit: limitNum,
            hasNext: skip + limitNum < total,
            hasPrev: pageNum > 1
          }
        }
      });
    }

    // No contacts found
    return res.status(200).json({
      success: true,
      message: 'No respondent contacts found',
      data: {
        contacts: [],
        pagination: {
          current: parseInt(page),
          pages: 0,
          total: 0,
          limit: parseInt(limit),
          hasNext: false,
          hasPrev: false
        }
      }
    });

  } catch (error) {
    console.error('Error fetching respondent contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Save respondent contacts modifications (added/deleted)
// @route   PUT /api/surveys/:id/respondent-contacts
// @access  Private (Company Admin, Project Manager)
exports.saveRespondentContacts = async (req, res) => {
  try {
    const { id } = req.params;
    const { added = [], deleted = [] } = req.body;
    
    // Find the survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check if user has permission
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only modify contacts from your company surveys.'
      });
    }

    const fs = require('fs').promises;
    const path = require('path');
    
    // Determine file path
    let filePath = path.join('/var/www/opine', 'data', 'respondent-contacts', `${id}.json`);
    
    // Ensure directory exists
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
    
    // CRITICAL FIX: Read existing contacts efficiently
    // For large files (50K+ contacts), loading entire file causes memory leaks
    // We'll load it, but immediately process and clear memory
    let allContacts = [];
    try {
      const fileContent = await fs.readFile(filePath, 'utf8');
      const fileSizeMB = fileContent.length / 1024 / 1024;
      
      if (fileSizeMB > 10) {
        console.warn(`⚠️ Large respondent contacts file detected: ${fileSizeMB.toFixed(2)}MB. Processing with memory optimization.`);
      }
      
      allContacts = JSON.parse(fileContent);
      
      // Clear fileContent from memory immediately after parsing
      // Note: In JavaScript, strings are immutable, but this is a hint to GC
      
      if (!Array.isArray(allContacts)) {
        allContacts = [];
      }
    } catch (fileError) {
      // File doesn't exist, try database array
      if (survey.respondentContacts && Array.isArray(survey.respondentContacts)) {
        allContacts = survey.respondentContacts;
      }
    }
    
    // Get phone numbers for deleted contacts BEFORE applying deletions
    const deletedPhones = [];
    if (deleted && deleted.length > 0) {
      const deletedIds = new Set(deleted);
      allContacts.forEach(contact => {
        const contactId = contact._id || contact.id || `${contact.phone}_${contact.name}`;
        if (deletedIds.has(contactId) && contact.phone) {
          deletedPhones.push(contact.phone);
        }
      });
      
      // Apply deletions
      allContacts = allContacts.filter(contact => {
        const contactId = contact._id || contact.id || `${contact.phone}_${contact.name}`;
        return !deletedIds.has(contactId);
      });
    }
    
    // Apply additions
    if (added && added.length > 0) {
      const newContacts = added.map(contact => ({
        name: contact.name || '',
        phone: contact.phone || '',
        countryCode: contact.countryCode || '',
        email: contact.email || '',
        address: contact.address || '',
        city: contact.city || '',
        ac: contact.ac || '',
        pc: contact.pc || '',
        ps: contact.ps || '',
        addedAt: contact.addedAt || new Date().toISOString(),
        addedBy: req.user.id
      }));
      
      allContacts = [...newContacts, ...allContacts];
    }
    
    // CRITICAL FIX: Save updated contacts efficiently
    // For large arrays, JSON.stringify can be memory-intensive
    const jsonString = JSON.stringify(allContacts, null, 2);
    
    // Save to file
    await fs.writeFile(filePath, jsonString, 'utf8');
    
    // CRITICAL: Invalidate cache when contacts are updated
    const contactsCache = require('../utils/respondentContactsCache');
    await contactsCache.invalidateContactsCache(id);
    
    // Update survey to reference the JSON file if not already set
    if (!survey.respondentContactsFile) {
      await Survey.findByIdAndUpdate(id, {
        respondentContactsFile: `data/respondent-contacts/${id}.json`
      });
    }
    
    // Update CATI respondent queue entries
    const CatiRespondentQueue = require('../models/CatiRespondentQueue');
    
    // Delete queue entries for deleted contacts
    if (deletedPhones.length > 0) {
      const deleteResult = await CatiRespondentQueue.deleteMany({
        survey: id,
        'respondentContact.phone': { $in: deletedPhones },
        status: { $in: ['pending', 'call_failed', 'busy', 'no_answer', 'switched_off', 'not_reachable', 'does_not_exist', 'rejected'] }
      });
    }
    
    // Create queue entries for added contacts
    if (added && added.length > 0) {
      // Solution 2: Optimize duplicate checking - use distinct() instead of fetching all entries
      // This is much more memory-efficient for large datasets
      console.log(`🔍 Checking for duplicate phones in queue for survey ${id}...`);
      const existingPhones = await CatiRespondentQueue.distinct(
        'respondentContact.phone',
        { survey: id }
      );
      const existingPhonesSet = new Set(existingPhones.filter(Boolean));
      console.log(`✅ Found ${existingPhonesSet.size} existing phone numbers in queue`);
      
      const newContactsForQueue = added.filter(contact => {
        const phone = contact.phone || '';
        return phone && !existingPhonesSet.has(phone);
      });
      
      console.log(`📊 Filtered ${added.length} added contacts to ${newContactsForQueue.length} new contacts for queue`);
      
      if (newContactsForQueue.length > 0) {
        // Solution 1: Batch processing for queue creation
        // Process in chunks to avoid memory issues and MongoDB limits
        const BATCH_SIZE = 5000; // Process 5000 contacts at a time
        const queueEntries = newContactsForQueue.map(contact => ({
          survey: id,
          respondentContact: {
            name: contact.name || '',
            countryCode: contact.countryCode || '',
            phone: contact.phone || '',
            email: contact.email || '',
            address: contact.address || '',
            city: contact.city || '',
            ac: contact.ac || '',
            pc: contact.pc || '',
            ps: contact.ps || ''
          },
          status: 'pending',
          currentAttemptNumber: 0
        }));
        
        // Process in batches
        let totalInserted = 0;
        let totalBatches = Math.ceil(queueEntries.length / BATCH_SIZE);
        console.log(`📦 Processing ${queueEntries.length} queue entries in ${totalBatches} batches of ${BATCH_SIZE}...`);
        
        for (let i = 0; i < queueEntries.length; i += BATCH_SIZE) {
          const batch = queueEntries.slice(i, i + BATCH_SIZE);
          const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
          
          try {
            // Use ordered: false to continue inserting even if some documents fail validation
            await CatiRespondentQueue.insertMany(batch, { 
              ordered: false,
              lean: false 
            });
            totalInserted += batch.length;
            console.log(`✅ Batch ${batchNumber}/${totalBatches} completed: ${batch.length} entries inserted (Total: ${totalInserted}/${queueEntries.length})`);
            
            // Small delay between batches to prevent overwhelming MongoDB
            if (i + BATCH_SIZE < queueEntries.length) {
              await new Promise(resolve => setTimeout(resolve, 50));
            }
          } catch (batchError) {
            // If batch fails, log error but continue with next batch
            // This prevents one bad batch from stopping the entire process
            console.error(`⚠️ Error inserting batch ${batchNumber}:`, batchError.message);
            // Try to insert individually to identify problematic entries
            if (batchError.writeErrors && batchError.writeErrors.length > 0) {
              console.error(`⚠️ ${batchError.writeErrors.length} entries failed in batch ${batchNumber}`);
            }
            // Continue with next batch
          }
        }
        
        console.log(`✅ Queue creation completed: ${totalInserted}/${queueEntries.length} entries inserted successfully`);
      } else {
        console.log(`ℹ️ No new contacts to add to queue (all ${added.length} contacts already exist)`);
      }
    }
    
    return res.status(200).json({
      success: true,
      message: 'Respondent contacts saved successfully',
      data: {
        total: allContacts.length,
        added: added?.length || 0,
        deleted: deleted?.length || 0
      }
    });

  } catch (error) {
    console.error('Error saving respondent contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get CATI performance stats for a survey
// @route   GET /api/surveys/:id/cati-stats
// @access  Private (Company Admin, Project Manager)
exports.getCatiStats = async (req, res) => {
  // Set a timeout for this operation (5 minutes)
  const timeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error('❌ getCatiStats - TIMEOUT after 5 minutes');
      res.status(504).json({
        success: false,
        message: 'Request timeout - The operation is taking too long. Please try with more specific filters.',
        error: 'Timeout'
      });
    }
  }, 300000); // 5 minutes

  try {
    const { id } = req.params;
    const { startDate, endDate, interviewerIds, interviewerMode, ac } = req.query;
    
    console.log(`⚡ getCatiStats - OPTIMIZED VERSION - Request for survey ID: ${id}`);
    console.log(`⚡ getCatiStats - Filters:`, { startDate, endDate, interviewerIds, interviewerMode, ac });
    
    // Get current user and their company
    const currentUser = await User.findById(req.user.id).populate('company');
    if (!currentUser || !currentUser.company) {
      return res.status(400).json({
        success: false,
        message: 'User not associated with any company'
      });
    }

    // Find survey
    const survey = await Survey.findById(id);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Check access
    if (survey.company.toString() !== currentUser.company._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const mongoose = require('mongoose');
    const surveyObjectId = mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id;
    
    // MEMORY-OPTIMIZED: Use aggregation-based helper instead of loading all data
    const { getCatiStatsOptimized } = require('./catiStatsHelper');
    
    // REDIS CACHE: Use Redis cache for fast retrieval (like top tech companies)
    const catiStatsCache = require('../utils/catiStatsCache');
    
    // Build filter object for cache key
    const filterParams = {
      startDate: startDate || '',
      endDate: endDate || '',
      interviewerIds: interviewerIds || '',
      interviewerMode: interviewerMode || 'include',
      ac: ac || ''
    };
    
    // Build project manager interviewer filter
    let projectManagerInterviewerIds = [];
    if (req.user.userType === 'project_manager' && !interviewerIds) {
      try {
        const pmUser = await User.findById(req.user.id);
        if (pmUser && pmUser.assignedTeamMembers && pmUser.assignedTeamMembers.length > 0) {
          const assignedInterviewers = pmUser.assignedTeamMembers
            .filter(tm => tm.userType === 'interviewer' && tm.user)
            .map(tm => {
              const userId = tm.user._id ? tm.user._id : tm.user;
              return userId.toString();
            })
            .filter(id => mongoose.Types.ObjectId.isValid(id));
          
          if (assignedInterviewers.length > 0) {
            projectManagerInterviewerIds = assignedInterviewers.map(id => new mongoose.Types.ObjectId(id));
          }
        }
      } catch (error) {
        console.error('❌ Error fetching project manager assigned interviewers:', error);
      }
    }
    
    // Parse interviewer IDs if provided
    let parsedInterviewerIds = [];
    if (interviewerIds) {
      const interviewerIdArray = typeof interviewerIds === 'string' 
        ? interviewerIds.split(',').filter(id => id.trim())
        : Array.isArray(interviewerIds) ? interviewerIds : [];
      
      parsedInterviewerIds = interviewerIdArray
        .filter(id => mongoose.Types.ObjectId.isValid(id.trim()))
        .map(id => new mongoose.Types.ObjectId(id.trim()));
    }
    
    // For project managers with no assigned interviewers, return empty results
    if (req.user.userType === 'project_manager' && projectManagerInterviewerIds.length === 0 && parsedInterviewerIds.length === 0) {
      clearTimeout(timeout);
      return res.json({
        success: true,
        data: {
          callerPerformance: {
            callsMade: 0,
            callsAttended: 0,
            callsConnected: 0,
            totalTalkDuration: '0:00:00'
          },
          numberStats: {
            callNotReceived: 0,
            ringing: 0,
            notRinging: 0
          },
          callNotRingStatus: {
            switchOff: 0,
            numberNotReachable: 0,
            numberDoesNotExist: 0
          },
          callRingStatus: {
            callsConnected: 0,
            callsNotConnected: 0
          },
          interviewerStats: [],
          callRecords: []
        }
      });
    }
    
    // Use Redis cache with aggregation-based stats calculation
    filterParams.projectManagerInterviewerIds = projectManagerInterviewerIds;
    filterParams.interviewerIds = parsedInterviewerIds;
    
    const statsResult = await catiStatsCache.getCatiStats(
      id,
      filterParams,
      async () => {
        // Calculate stats (only called on cache miss)
        return await getCatiStatsOptimized({
          surveyId: id,
          startDate,
          endDate,
          interviewerIds: parsedInterviewerIds,
          interviewerMode: interviewerMode || 'include',
          ac,
          projectManagerInterviewerIds
        });
      }
    );
    
    clearTimeout(timeout);
    if (!res.headersSent) {
      res.status(200).json({
        success: true,
        data: statsResult
      });
      console.log(`⚡ getCatiStats - OPTIMIZED (with Redis cache) - Response sent successfully`);
    }

  } catch (error) {
    clearTimeout(timeout);
    console.error('❌ Get CATI stats error:', error);
    console.error('❌ Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Server error while fetching CATI stats',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
      });
    }
  }
};


// @desc    Get survey analytics (optimized with aggregation)
// @route   GET /api/surveys/:surveyId/analytics
// @access  Private (Company Admin, Project Manager)
exports.getSurveyAnalytics = async (req, res) => {
  try {
    const surveyId = req.params.id || req.params.surveyId; // Support both :id and :surveyId routes
    const {
      dateRange,
      startDate,
      endDate,
      status,
      interviewMode,
      ac,
      district,
      lokSabha,
      interviewerIds,
      interviewerMode = 'include'
    } = req.query;

    // Verify survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Build match filter
    const matchFilter = { survey: mongoose.Types.ObjectId(surveyId) };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = status;
      }
    } else {
      // Default: Approved, Rejected, and Pending_Approval (matching frontend default)
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }

    // Interview mode filter
    if (interviewMode) {
      matchFilter.interviewMode = interviewMode.toLowerCase();
    }

    // Date range filter (using IST timezone)
    // If dateRange is 'custom', ignore it and use startDate/endDate instead
    if (dateRange && dateRange !== 'all' && dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000; // IST offset: 5.5 hours
      let dateStart, dateEnd;

      switch (dateRange) {
        case 'today':
          // Get today's date in IST, convert to UTC
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          // Get yesterday's date in IST
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateStringFromDate(new Date(istTime.getTime() - istOffset));
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          // Get date 7 days ago in IST
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateStringFromDate(new Date(istTimeWeek.getTime() - istOffset));
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          // Get date 30 days ago in IST
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateStringFromDate(new Date(istTimeMonth.getTime() - istOffset));
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }

      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range - parse as IST dates (check this separately to allow override)
    if (startDate || endDate) {
      let dateStart, dateEnd;
      // Handle single day selection (startDate === endDate) or date range
      if (startDate && endDate) {
        // Both dates provided - date range
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(endDate);
      } else if (startDate && !endDate) {
        // Only start date provided - from start date to end of that day
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(startDate);
      } else if (!startDate && endDate) {
        // Only end date provided - from beginning of that day to end date
        dateStart = getISTDateStartUTC(endDate);
        dateEnd = getISTDateEndUTC(endDate);
      }
      
      if (dateStart && dateEnd) {
        // Override any dateRange filter with custom dates
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }

    // Interviewer filter
    if (interviewerIds && Array.isArray(interviewerIds) && interviewerIds.length > 0) {
      const interviewerObjectIds = interviewerIds
        .filter(id => id)
        .map(id => mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id);

      if (interviewerMode === 'exclude') {
        matchFilter.interviewer = { $nin: interviewerObjectIds };
      } else {
        matchFilter.interviewer = { $in: interviewerObjectIds };
      }
    }

    // For project managers: filter by assigned interviewers
    if (req.user.userType === 'project_manager') {
      const currentUser = await User.findById(req.user.id);
      if (currentUser && currentUser.assignedTeamMembers && currentUser.assignedTeamMembers.length > 0) {
        const assignedIds = currentUser.assignedTeamMembers.map(id => 
          mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id
        );
        if (!matchFilter.interviewer) {
          matchFilter.interviewer = { $in: assignedIds };
        } else if (matchFilter.interviewer.$in) {
          // Intersect with assigned interviewers
          matchFilter.interviewer.$in = matchFilter.interviewer.$in.filter(id => 
            assignedIds.some(assignedId => assignedId.toString() === id.toString())
          );
        }
      }
    }

    // Import respondent info utilities (mirrors frontend logic)
    const { getRespondentInfo, findQuestionResponse, getMainTextValue } = require('../utils/respondentInfoUtils');
    const { getMainText } = require('../utils/genderUtils');

    // Stage 1: Match filtered responses
    const matchStage = { $match: matchFilter };

    // Stage 2: Add computed fields for demographics extraction
    const addFieldsStage = {
      $addFields: {
        // Extract AC (priority: selectedAC > selectedPollingStation.acName > responses array)
        extractedAC: {
          $cond: {
            if: { $and: [{ $ne: ['$selectedAC', null] }, { $ne: ['$selectedAC', ''] }] },
            then: '$selectedAC',
            else: {
              $cond: {
                if: { $and: [{ $ne: ['$selectedPollingStation.acName', null] }, { $ne: ['$selectedPollingStation.acName', ''] }] },
                then: '$selectedPollingStation.acName',
                else: null
              }
            }
          }
        },
        // Extract gender from responses array
        genderResponse: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$responses',
                as: 'resp',
                cond: {
                  $or: [
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'gender' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'sex' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionId', ''] } }, regex: 'gender' } }
                  ]
                }
              }
            },
            0
          ]
        },
        // Extract age from responses array
        ageResponse: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$responses',
                as: 'resp',
                cond: {
                  $or: [
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'age' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'year' } }
                  ]
                }
              }
            },
            0
          ]
        },
        // Extract phone from responses array
        phoneResponse: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$responses',
                as: 'resp',
                cond: {
                  $or: [
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'phone' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'mobile' } }
                  ]
                }
              }
            },
            0
          ]
        },
        // Extract caste from responses array (for specific survey)
        casteResponse: surveyId === '68fd1915d41841da463f0d46' ? {
          $arrayElemAt: [
            {
              $filter: {
                input: '$responses',
                as: 'resp',
                cond: {
                  $or: [
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'caste' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'scheduled cast' } },
                    { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'category' } }
                  ]
                }
              }
            },
            0
          ]
        } : null,
        // Extract religion from responses array
        religionResponse: {
          $arrayElemAt: [
            {
              $filter: {
                input: '$responses',
                as: 'resp',
                cond: {
                  $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'religion' }
                }
              }
            },
            0
          ]
        },
        // Extract polling station info
        pollingStationKey: {
          $cond: {
            if: { $and: [{ $ne: ['$selectedPollingStation.stationName', null] }] },
            then: {
              $concat: [
                { $ifNull: ['$selectedPollingStation.stationName', ''] },
                { $ifNull: [{ $concat: ['-', '$selectedPollingStation.groupName'] }, ''] }
              ]
            },
            else: null
          }
        }
      }
    };

    // Stage 3: Group by AC for AC stats
    const acGroupStage = {
      $group: {
        _id: {
          $ifNull: ['$extractedAC', 'N/A']
        },
        total: { $sum: 1 },
        capi: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CAPI'] }, 1, 0]
          }
        },
        cati: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CATI'] }, 1, 0]
          }
        },
        approved: {
          $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] }
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] }
        },
        autoRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $or: [
                      { $eq: ['$verificationData.autoRejected', true] },
                      { $gt: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        manualRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $or: [
                      { $ne: ['$verificationData.autoRejected', true] },
                      { $eq: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        underQC: {
          $sum: { $cond: [{ $eq: ['$status', 'Pending_Approval'] }, 1, 0] }
        },
        femaleCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$genderResponse', null] },
                  {
                    $or: [
                      { $regexMatch: { input: { $toLower: { $toString: { $ifNull: ['$genderResponse.response', ''] } } }, regex: 'female' } },
                      { $eq: [{ $toLower: { $toString: { $ifNull: ['$genderResponse.response', ''] } } }, 'f'] },
                      { $eq: [{ $toLower: { $toString: { $ifNull: ['$genderResponse.response', ''] } } }, '2'] }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        withoutPhoneCount: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$phoneResponse', null] },
                  { $eq: [{ $toString: { $ifNull: ['$phoneResponse.response', ''] } }, ''] },
                  { $eq: [{ $toLower: { $toString: { $ifNull: ['$phoneResponse.response', ''] } } }, 'n/a'] },
                  { $eq: [{ $toString: { $ifNull: ['$phoneResponse.response', ''] } }, '0'] }
                ]
              },
              1,
              0
            ]
          }
        },
        scCount: surveyId === '68fd1915d41841da463f0d46' ? {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$casteResponse', null] },
                  {
                    $regexMatch: {
                      input: { $toLower: { $toString: { $ifNull: ['$casteResponse.response', ''] } } },
                      regex: '(scheduled cast|sc|scheduled caste)'
                    }
                  }
                ]
              },
              1,
              0
            ]
          }
        } : { $literal: 0 },
        muslimCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$religionResponse', null] },
                  {
                    $regexMatch: {
                      input: { $toLower: { $toString: { $ifNull: ['$religionResponse.response', ''] } } },
                      regex: '(muslim|islam)'
                    }
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        age18to24Count: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$ageResponse', null] },
                  {
                    $let: {
                      vars: {
                        age: {
                          $toInt: {
                            $arrayElemAt: [
                              {
                                $regexFind: {
                                  input: { $toString: { $ifNull: ['$ageResponse.response', ''] } },
                                  regex: /(\d+)/
                                }
                              },
                              1
                            ]
                          }
                        }
                      },
                      in: {
                        $and: [
                          { $gte: ['$$age', 18] },
                          { $lte: ['$$age', 24] }
                        ]
                      }
                    }
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        age50PlusCount: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $ne: ['$ageResponse', null] },
                  {
                    $let: {
                      vars: {
                        age: {
                          $toInt: {
                            $arrayElemAt: [
                              {
                                $regexFind: {
                                  input: { $toString: { $ifNull: ['$ageResponse.response', ''] } },
                                  regex: /(\d+)/
                                }
                              },
                              1
                            ]
                          }
                        }
                      },
                      in: { $gte: ['$$age', 50] }
                    }
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        pollingStations: { $addToSet: '$pollingStationKey' },
        interviewers: { $addToSet: '$interviewer' },
        totalResponseTime: {
          $sum: {
            $reduce: {
              input: { $ifNull: ['$responses', []] },
              initialValue: 0,
              in: { $add: ['$$value', { $ifNull: ['$$this.responseTime', 0] }] }
            }
          }
        }
      }
    };

    // Run aggregation for AC stats
    const acStatsPipeline = [
      matchStage,
      addFieldsStage,
      acGroupStage,
      {
        $project: {
          _id: 0,
          ac: '$_id',
          count: '$total',
          capi: '$capi',
          cati: '$cati',
          approved: '$approved',
          rejected: '$rejected',
          autoRejected: '$autoRejected',
          manualRejected: '$manualRejected',
          underQC: '$underQC',
          interviewersCount: { $size: { $ifNull: ['$interviewers', []] } },
          psCovered: { $size: { $filter: { input: { $ifNull: ['$pollingStations', []] }, cond: { $ne: ['$$this', null] } } } },
          femaleCount: '$femaleCount',
          withoutPhoneCount: '$withoutPhoneCount',
          scCount: '$scCount',
          muslimCount: '$muslimCount',
          age18to24Count: '$age18to24Count',
          age50PlusCount: '$age50PlusCount',
          totalResponseTime: '$totalResponseTime'
        }
      }
    ];

    // For accurate AC extraction, we need to use JavaScript processing
    // Fetch minimal data: responses array, selectedAC, selectedPollingStation, interviewer, status, interviewMode, createdAt, verificationData
    // This is still much faster than fetching full documents
    let minimalResponses = await SurveyResponse.find(matchFilter)
      .select('responses selectedAC selectedPollingStation interviewer status interviewMode createdAt verificationData')
      .populate('interviewer', 'firstName lastName memberId')
      .lean();

    // Apply AC, district, lokSabha filters after extraction (since they're in responses array)
    // These filters need to be applied after extracting from responses
    if (ac || district || lokSabha) {
      const { getRespondentInfo } = require('../utils/respondentInfoUtils');
      minimalResponses = minimalResponses.filter(response => {
        const respondentInfo = getRespondentInfo(response.responses || [], response, survey);
        
        // AC filter
        if (ac && ac.trim()) {
          const responseAC = respondentInfo.ac;
          if (!responseAC || responseAC === 'N/A' || responseAC.toLowerCase() !== ac.toLowerCase()) {
            return false;
          }
        }
        
        // District filter
        if (district && district.trim()) {
          const responseDistrict = respondentInfo.district;
          if (!responseDistrict || responseDistrict === 'N/A' || responseDistrict.toLowerCase() !== district.toLowerCase()) {
            return false;
          }
        }
        
        // Lok Sabha filter
        if (lokSabha && lokSabha.trim()) {
          const responseLokSabha = respondentInfo.lokSabha;
          if (!responseLokSabha || responseLokSabha === 'N/A' || responseLokSabha.toLowerCase() !== lokSabha.toLowerCase()) {
            return false;
          }
        }
        
        return true;
      });
    }

    // Process responses using same logic as frontend
    const acMap = new Map();
    const districtMap = new Map();
    const lokSabhaMap = new Map();
    const interviewerMap = new Map();
    const genderMap = new Map();
    const ageMap = new Map();
    const dailyMap = new Map(); // Format: { date: { total: count, capi: count, cati: count } }
    let totalResponseTime = 0;

    minimalResponses.forEach(response => {
      const respondentInfo = getRespondentInfo(response.responses || [], response, survey);
      const responseData = response.responses || [];
      
      // Extract AC
      const ac = respondentInfo.ac;
      if (ac && ac !== 'N/A') {
        const currentCount = acMap.get(ac) || {
          total: 0,
          capi: 0,
          cati: 0,
          interviewers: new Set(),
          approved: 0,
          rejected: 0,
          autoRejected: 0,
          manualRejected: 0,
          underQC: 0,
          femaleCount: 0,
          withoutPhoneCount: 0,
          scCount: 0,
          muslimCount: 0,
          age18to24Count: 0,
          age50PlusCount: 0,
          pollingStations: new Set()
        };
        
        currentCount.total += 1;
        
        // Polling station
        if (response.selectedPollingStation?.stationName) {
          const psKey = `${response.selectedPollingStation.stationName}${response.selectedPollingStation.groupName ? `-${response.selectedPollingStation.groupName}` : ''}`;
          currentCount.pollingStations.add(psKey);
        }
        
        // Interview mode
        const interviewMode = response.interviewMode?.toUpperCase();
        if (interviewMode === 'CAPI') {
          currentCount.capi += 1;
        } else if (interviewMode === 'CATI') {
          currentCount.cati += 1;
        }
        
        // Interviewers
        if (response.interviewer?._id) {
          currentCount.interviewers.add(response.interviewer._id.toString());
        }
        
        // Status
        if (response.status === 'Approved') {
          currentCount.approved += 1;
        } else if (response.status === 'Rejected') {
          const isAutoRejected = response.verificationData?.autoRejected === true ||
                                (response.verificationData?.autoRejectionReasons && response.verificationData.autoRejectionReasons.length > 0) ||
                                (response.verificationData?.feedback && (
                                  response.verificationData.feedback.includes('Interview Too Short') ||
                                  response.verificationData.feedback.includes('Not Voter') ||
                                  response.verificationData.feedback.includes('Not a Registered Voter') ||
                                  response.verificationData.feedback.includes('Duplicate Response')
                                ));
          if (isAutoRejected) {
            currentCount.autoRejected += 1;
          } else {
            currentCount.manualRejected += 1;
          }
          currentCount.rejected += 1;
        } else if (response.status === 'Pending_Approval') {
          currentCount.underQC += 1;
        }
        
        // Demographics
        const genderResponse = require('../utils/genderUtils').findGenderResponse(responseData, survey) || findQuestionResponse(responseData, ['gender', 'sex']);
        if (genderResponse?.response) {
          const normalizedGender = require('../utils/genderUtils').normalizeGenderResponse(genderResponse.response);
          if (normalizedGender === 'female') {
            currentCount.femaleCount += 1;
          }
        }
        
        // Phone
        let phoneResponse = responseData.find(r => {
          const questionText = getMainText(r.questionText || r.question?.text || '').toLowerCase();
          return questionText.includes('mobile number') ||
                 questionText.includes('phone number') ||
                 questionText.includes('share your mobile') ||
                 questionText.includes('would you like to share your mobile');
        });
        if (!phoneResponse) {
          phoneResponse = findQuestionResponse(responseData, ['phone', 'mobile', 'contact', 'number']);
        }
        if (!phoneResponse?.response ||
            String(phoneResponse.response).trim() === '' ||
            String(phoneResponse.response).trim() === 'N/A' ||
            String(phoneResponse.response).trim() === '0') {
          currentCount.withoutPhoneCount += 1;
        }
        
        // SC (for specific survey)
        if (surveyId === '68fd1915d41841da463f0d46') {
          const casteResponse = findQuestionResponse(responseData, ['caste', 'scheduled cast', 'sc', 'category']);
          if (casteResponse?.response) {
            const casteValue = getMainTextValue(String(casteResponse.response)).toLowerCase();
            if (casteValue.includes('scheduled cast') ||
                casteValue.includes('sc') ||
                casteValue.includes('scheduled caste')) {
              currentCount.scCount += 1;
            }
          }
        }
        
        // Muslim
        const religionResponse = findQuestionResponse(responseData, ['religion', 'muslim', 'hindu', 'christian']);
        if (religionResponse?.response) {
          const religionValue = getMainTextValue(String(religionResponse.response)).toLowerCase();
          if (religionValue.includes('muslim') || religionValue.includes('islam')) {
            currentCount.muslimCount += 1;
          }
        }
        
        // Age groups
        const ageResponse = findQuestionResponse(responseData, ['age', 'year']);
        if (ageResponse?.response) {
          const age = parseInt(ageResponse.response);
          if (!isNaN(age) && age > 0 && age < 150) {
            if (age >= 18 && age <= 24) {
              currentCount.age18to24Count += 1;
            }
            if (age >= 50) {
              currentCount.age50PlusCount += 1;
            }
          }
        }
        
        acMap.set(ac, currentCount);
      }
      
      // District
      const district = respondentInfo.district;
      if (district && district !== 'N/A') {
        districtMap.set(district, (districtMap.get(district) || 0) + 1);
      }
      
      // Lok Sabha
      const lokSabha = respondentInfo.lokSabha;
      if (lokSabha && lokSabha !== 'N/A') {
        lokSabhaMap.set(lokSabha, (lokSabhaMap.get(lokSabha) || 0) + 1);
      }
      
      // Interviewer stats
      if (response.interviewer) {
        const interviewerName = `${response.interviewer.firstName} ${response.interviewer.lastName}`;
        const interviewerMemberId = response.interviewer.memberId || '';
        const interviewerId = response.interviewer._id || response.interviewer.id || null;
        const currentCount = interviewerMap.get(interviewerName) || {
          total: 0,
          capi: 0,
          cati: 0,
          approved: 0,
          rejected: 0,
          autoRejected: 0,
          manualRejected: 0,
          pending: 0,
          pollingStations: new Set(),
          femaleCount: 0,
          withoutPhoneCount: 0,
          scCount: 0,
          muslimCount: 0,
          age18to24Count: 0,
          age50PlusCount: 0,
          memberId: interviewerMemberId,
          interviewerId: interviewerId
        };
        
        if (!currentCount.memberId && interviewerMemberId) {
          currentCount.memberId = interviewerMemberId;
        }
        if (!currentCount.interviewerId && interviewerId) {
          currentCount.interviewerId = interviewerId;
        }
        currentCount.total += 1;
        
        // Polling station
        if (response.selectedPollingStation?.stationName) {
          const psKey = `${response.selectedPollingStation.stationName}${response.selectedPollingStation.groupName ? `-${response.selectedPollingStation.groupName}` : ''}`;
          currentCount.pollingStations.add(psKey);
        }
        
        // Interview mode
        if (interviewMode === 'CAPI') {
          currentCount.capi += 1;
        } else if (interviewMode === 'CATI') {
          currentCount.cati += 1;
        }
        
        // Status
        if (response.status === 'Approved') {
          currentCount.approved += 1;
        } else if (response.status === 'Rejected') {
          const isAutoRejected = response.verificationData?.autoRejected === true ||
                                (response.verificationData?.autoRejectionReasons && response.verificationData.autoRejectionReasons.length > 0) ||
                                (response.verificationData?.feedback && (
                                  response.verificationData.feedback.includes('Interview Too Short') ||
                                  response.verificationData.feedback.includes('Not Voter') ||
                                  response.verificationData.feedback.includes('Not a Registered Voter') ||
                                  response.verificationData.feedback.includes('Duplicate Response')
                                ));
          if (isAutoRejected) {
            currentCount.autoRejected += 1;
          } else {
            currentCount.manualRejected += 1;
          }
          currentCount.rejected += 1;
        } else if (response.status === 'Pending_Approval') {
          currentCount.pending += 1;
        }
        
        // Demographics for interviewer
        const genderResponseForInterviewer = require('../utils/genderUtils').findGenderResponse(responseData, survey) || findQuestionResponse(responseData, ['gender', 'sex']);
        if (genderResponseForInterviewer?.response) {
          const normalizedGender = require('../utils/genderUtils').normalizeGenderResponse(genderResponseForInterviewer.response);
          if (normalizedGender === 'female') {
            currentCount.femaleCount += 1;
          }
        }
        
        // Phone for interviewer
        let phoneResponseForInterviewer = responseData.find(r => {
          const questionText = getMainText(r.questionText || r.question?.text || '').toLowerCase();
          return questionText.includes('mobile number') ||
                 questionText.includes('phone number') ||
                 questionText.includes('share your mobile') ||
                 questionText.includes('would you like to share your mobile');
        });
        if (!phoneResponseForInterviewer) {
          phoneResponseForInterviewer = findQuestionResponse(responseData, ['phone', 'mobile', 'contact', 'number']);
        }
        if (!phoneResponseForInterviewer?.response ||
            String(phoneResponseForInterviewer.response).trim() === '' ||
            String(phoneResponseForInterviewer.response).trim() === 'N/A' ||
            String(phoneResponseForInterviewer.response).trim() === '0') {
          currentCount.withoutPhoneCount += 1;
        }
        
        // SC for interviewer
        if (surveyId === '68fd1915d41841da463f0d46') {
          const casteResponseForInterviewer = findQuestionResponse(responseData, ['caste', 'scheduled cast', 'sc', 'category']);
          if (casteResponseForInterviewer?.response) {
            const casteValue = getMainTextValue(String(casteResponseForInterviewer.response)).toLowerCase();
            if (casteValue.includes('scheduled cast') ||
                casteValue.includes('sc') ||
                casteValue.includes('scheduled caste')) {
              currentCount.scCount += 1;
            }
          }
        }
        
        // Muslim for interviewer
        const religionResponseForInterviewer = findQuestionResponse(responseData, ['religion', 'muslim', 'hindu', 'christian']);
        if (religionResponseForInterviewer?.response) {
          const religionValue = getMainTextValue(String(religionResponseForInterviewer.response)).toLowerCase();
          if (religionValue.includes('muslim') || religionValue.includes('islam')) {
            currentCount.muslimCount += 1;
          }
        }
        
        // Age for interviewer
        const ageResponseForInterviewer = findQuestionResponse(responseData, ['age', 'year']);
        if (ageResponseForInterviewer?.response) {
          const age = parseInt(ageResponseForInterviewer.response);
          if (!isNaN(age) && age > 0 && age < 150) {
            if (age >= 18 && age <= 24) {
              currentCount.age18to24Count += 1;
            }
            if (age >= 50) {
              currentCount.age50PlusCount += 1;
            }
          }
        }
        
        interviewerMap.set(interviewerName, currentCount);
      }
      
      // Gender stats
      const gender = respondentInfo.gender;
      if (gender && gender !== 'N/A') {
        const genderText = getMainText(gender);
        genderMap.set(genderText, (genderMap.get(genderText) || 0) + 1);
      }
      
      // Age stats
      const age = parseInt(respondentInfo.age);
      if (!isNaN(age)) {
        const ageGroup = Math.floor(age / 10) * 10;
        ageMap.set(ageGroup, (ageMap.get(ageGroup) || 0) + 1);
      }
      
      // Daily stats with CAPI/CATI breakdown
      const date = new Date(response.createdAt).toDateString();
      const currentDaily = dailyMap.get(date) || { total: 0, capi: 0, cati: 0 };
      currentDaily.total += 1;
      if (interviewMode === 'CAPI') {
        currentDaily.capi += 1;
      } else if (interviewMode === 'CATI') {
        currentDaily.cati += 1;
      }
      dailyMap.set(date, currentDaily);
      
      // Response time
      totalResponseTime += (response.responses?.reduce((sum, resp) => sum + (resp.responseTime || 0), 0) || 0);
    });

    // Calculate total responses and basic stats
    const totalResponses = minimalResponses.length;
    const capiResponses = minimalResponses.filter(r => r.interviewMode?.toUpperCase() === 'CAPI').length;
    const catiResponses = minimalResponses.filter(r => r.interviewMode?.toUpperCase() === 'CATI').length;
    const capiApproved = minimalResponses.filter(r => r.interviewMode?.toUpperCase() === 'CAPI' && r.status === 'Approved').length;
    const capiRejected = minimalResponses.filter(r => r.interviewMode?.toUpperCase() === 'CAPI' && r.status === 'Rejected').length;

    // Format AC stats
    const acStats = Array.from(acMap.entries()).map(([ac, data]) => ({
      ac: ac,
      count: data.total,
      capi: data.capi,
      cati: data.cati,
      percentage: totalResponses > 0 ? (data.total / totalResponses) * 100 : 0,
      interviewersCount: data.interviewers ? data.interviewers.size : 0,
      approved: data.approved,
      rejected: data.rejected,
      autoRejected: data.autoRejected,
      manualRejected: data.manualRejected,
      underQC: data.underQC,
      psCovered: data.pollingStations ? data.pollingStations.size : 0,
      femalePercentage: data.total > 0 ? (data.femaleCount / data.total) * 100 : 0,
      withoutPhonePercentage: data.total > 0 ? (data.withoutPhoneCount / data.total) * 100 : 0,
      scPercentage: data.total > 0 ? (data.scCount / data.total) * 100 : 0,
      muslimPercentage: data.total > 0 ? (data.muslimCount / data.total) * 100 : 0,
      age18to24Percentage: data.total > 0 ? (data.age18to24Count / data.total) * 100 : 0,
      age50PlusPercentage: data.total > 0 ? (data.age50PlusCount / data.total) * 100 : 0
    })).sort((a, b) => b.count - a.count);

    // District and Lok Sabha stats are already calculated from minimalResponses processing above
    const districtStats = Array.from(districtMap.entries())
      .map(([district, count]) => ({
        district,
        count: count,
        percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count);

    const lokSabhaStats = Array.from(lokSabhaMap.entries())
      .map(([lokSabha, count]) => ({
        lokSabha,
        count: count,
        percentage: totalResponses > 0 ? (count / totalResponses) * 100 : 0
      }))
      .sort((a, b) => b.count - a.count);

    // Format interviewer stats
    const interviewerStats = Array.from(interviewerMap.entries()).map(([interviewer, data]) => ({
      interviewer: interviewer,
      interviewerId: data.interviewerId || null,
      memberId: data.memberId || '',
      count: data.total,
      capi: data.capi,
      cati: data.cati,
      approved: data.approved,
      rejected: data.rejected,
      autoRejected: data.autoRejected,
      manualRejected: data.manualRejected,
      pending: data.pending,
      underQC: data.pending,
      percentage: totalResponses > 0 ? (data.total / totalResponses) * 100 : 0,
      psCovered: data.pollingStations ? data.pollingStations.size : 0,
      femalePercentage: data.total > 0 ? (data.femaleCount / data.total) * 100 : 0,
      withoutPhonePercentage: data.total > 0 ? (data.withoutPhoneCount / data.total) * 100 : 0,
      scPercentage: data.total > 0 ? (data.scCount / data.total) * 100 : 0,
      muslimPercentage: data.total > 0 ? (data.muslimCount / data.total) * 100 : 0,
      age18to24Percentage: data.total > 0 ? (data.age18to24Count / data.total) * 100 : 0,
      age50PlusPercentage: data.total > 0 ? (data.age50PlusCount / data.total) * 100 : 0
    })).sort((a, b) => b.count - a.count);

    // Basic stats are already calculated from minimalResponses

    // Gender and Age stats are already calculated from minimalResponses
    const genderStats = Object.fromEntries(genderMap);
    const ageStats = Object.fromEntries(ageMap);

    // Daily stats are already calculated from minimalResponses (with CAPI/CATI breakdown)
    const dailyStats = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ 
        date, 
        count: data.total || data, // Support both old format (number) and new format (object)
        capi: data.capi || 0,
        cati: data.cati || 0
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate completion rate and average response time
    const completionRate = survey?.sampleSize ? (totalResponses / survey.sampleSize) * 100 : 0;
    const averageResponseTime = totalResponses > 0 
      ? (totalResponseTime / totalResponses) 
      : 0;

    // Return analytics data
    res.status(200).json({
      success: true,
      data: {
        totalResponses,
        capiResponses,
        catiResponses,
        completionRate,
        averageResponseTime,
        acStats,
        districtStats,
        lokSabhaStats,
        interviewerStats,
        genderStats: Object.fromEntries(genderMap),
        ageStats: Object.fromEntries(ageMap),
        dailyStats,
        capiPerformance: {
          approved: capiApproved,
          rejected: capiRejected,
          total: capiResponses
        }
      }
    });

  } catch (error) {
    console.error('Get survey analytics error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get optimized analytics for reports V2 (using MongoDB aggregation only, no limits)
// @route   GET /api/surveys/:id/analytics-v2
// @access  Private (Company Admin, Project Manager)
exports.getSurveyAnalyticsV2 = async (req, res) => {
  try {
    const surveyId = req.params.id || req.params.surveyId;
    const {
      dateRange,
      startDate,
      endDate,
      status,
      interviewMode,
      ac,
      district,
      lokSabha,
      interviewerIds,
      interviewerMode = 'include'
    } = req.query;

    // Debug: Log received query params
    console.log('🔍 getSurveyAnalyticsV2 - Query params:', {
      surveyId,
      interviewerIds,
      interviewerIdsType: typeof interviewerIds,
      isArray: Array.isArray(interviewerIds),
      interviewerMode
    });

    // Verify survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Build match filter for MongoDB aggregation (NO LIMITS - handles millions of records)
    const matchFilter = { survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = status;
      }
    } else {
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }

    // Interview mode filter
    if (interviewMode) {
      matchFilter.interviewMode = interviewMode.toLowerCase();
    }

    // Date range filter (using IST timezone)
    // If dateRange is 'custom', ignore it and use startDate/endDate instead
    if (dateRange && dateRange !== 'all' && dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000; // IST offset: 5.5 hours
      let dateStart, dateEnd;

      switch (dateRange) {
        case 'today':
          // Get today's date in IST, convert to UTC
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          // Get yesterday's date in IST
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateStringFromDate(new Date(istTime.getTime() - istOffset));
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          // Get date 7 days ago in IST
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateStringFromDate(new Date(istTimeWeek.getTime() - istOffset));
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          // Get date 30 days ago in IST
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateStringFromDate(new Date(istTimeMonth.getTime() - istOffset));
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }

      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range - parse as IST dates (check this separately to allow override)
    if (startDate || endDate) {
      let dateStart, dateEnd;
      // Handle single day selection (startDate === endDate) or date range
      if (startDate && endDate) {
        // Both dates provided - date range
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(endDate);
      } else if (startDate && !endDate) {
        // Only start date provided - from start date to end of that day
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(startDate);
      } else if (!startDate && endDate) {
        // Only end date provided - from beginning of that day to end date
        dateStart = getISTDateStartUTC(endDate);
        dateEnd = getISTDateEndUTC(endDate);
      }
      
      if (dateStart && dateEnd) {
        // Override any dateRange filter with custom dates
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }

    // Interviewer filter - Handle both array and single value from query params
    let interviewerIdsArray = [];
    if (interviewerIds) {
      if (Array.isArray(interviewerIds)) {
        interviewerIdsArray = interviewerIds;
      } else if (typeof interviewerIds === 'string') {
        // If it's a string, it might be comma-separated or a single ID
        interviewerIdsArray = interviewerIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    if (interviewerIdsArray.length > 0) {
      const interviewerObjectIds = interviewerIdsArray
        .filter(id => id && id !== 'undefined' && id !== 'null')
        .map(id => {
          // Handle both string IDs and ObjectIds
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        })
        .filter(id => id); // Remove any invalid IDs

      if (interviewerObjectIds.length > 0) {
        if (interviewerMode === 'exclude') {
          matchFilter.interviewer = { $nin: interviewerObjectIds };
        } else {
          matchFilter.interviewer = { $in: interviewerObjectIds };
        }
        
        console.log(`🔍 getSurveyAnalyticsV2 - Filtering by ${interviewerObjectIds.length} interviewer(s):`, interviewerObjectIds.map(id => id.toString()));
      }
    }

    // For project managers: filter by assigned interviewers
    if (req.user.userType === 'project_manager') {
      const currentUser = await User.findById(req.user.id).populate('assignedTeamMembers.user', '_id userType');
      if (currentUser && currentUser.assignedTeamMembers && currentUser.assignedTeamMembers.length > 0) {
        // Extract interviewer IDs from assignedTeamMembers structure
        // assignedTeamMembers is an array of objects: [{ userType: 'interviewer', user: ObjectId or User object }, ...]
        const assignedIds = currentUser.assignedTeamMembers
          .filter(tm => tm.userType === 'interviewer' && tm.user)
          .map(tm => {
            // Handle both ObjectId and populated user object
            const userId = tm.user._id ? tm.user._id : tm.user;
            return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
          })
          .filter(id => id && mongoose.Types.ObjectId.isValid(id));
        
        if (assignedIds.length > 0) {
          if (!matchFilter.interviewer) {
            // No interviewer filter yet, apply assigned interviewers filter
            matchFilter.interviewer = { $in: assignedIds };
            console.log(`🔍 getSurveyAnalyticsV2 - Project Manager: Filtering by ${assignedIds.length} assigned interviewer(s)`);
          } else if (matchFilter.interviewer.$in) {
            // Intersect with assigned interviewers (only show selected interviewers that are assigned)
            const originalIds = matchFilter.interviewer.$in;
            matchFilter.interviewer.$in = originalIds.filter(id => {
              const idStr = id.toString();
              return assignedIds.some(assignedId => assignedId.toString() === idStr);
            });
            console.log(`🔍 getSurveyAnalyticsV2 - Project Manager: Intersected ${originalIds.length} selected with ${assignedIds.length} assigned, result: ${matchFilter.interviewer.$in.length} interviewer(s)`);
          } else if (matchFilter.interviewer.$nin) {
            // For exclude mode, ensure we're only excluding from assigned interviewers
            const excludedIds = matchFilter.interviewer.$nin;
            const assignedIdsStr = assignedIds.map(id => id.toString());
            matchFilter.interviewer.$nin = excludedIds.filter(id => assignedIdsStr.includes(id.toString()));
            console.log(`🔍 getSurveyAnalyticsV2 - Project Manager: Excluding ${matchFilter.interviewer.$nin.length} interviewer(s) from assigned list`);
          }
        } else {
          // No assigned interviewers found, return empty results
          console.log(`⚠️ getSurveyAnalyticsV2 - Project Manager: No valid assigned interviewers found`);
          matchFilter.interviewer = { $in: [] }; // Empty array will return no results
        }
      } else {
        // No assigned team members, return empty results
        console.log(`⚠️ getSurveyAnalyticsV2 - Project Manager: No assigned team members`);
        matchFilter.interviewer = { $in: [] }; // Empty array will return no results
      }
    }

    // Build aggregation pipeline - pure MongoDB aggregation (no JavaScript processing)
    const pipeline = [];

    // Debug: Log the match filter before applying
    console.log('🔍 getSurveyAnalyticsV2 - Final matchFilter:', JSON.stringify(matchFilter, null, 2));

    // Stage 1: Match filtered responses
    pipeline.push({ $match: matchFilter });

    // Stage 2: Filter by AC if provided (using indexed fields)
    if (ac && ac.trim()) {
      const acPattern = ac.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push({
        $match: {
          $or: [
            { selectedAC: { $regex: acPattern, $options: 'i' } },
            { 'selectedPollingStation.acName': { $regex: acPattern, $options: 'i' } }
          ]
        }
      });
    }

    // Stage 3: For district/lokSabha, we need to extract from responses array
    // This is less efficient but necessary since they're in nested responses
    // We'll use aggregation to extract and filter
    if ((district && district.trim()) || (lokSabha && lokSabha.trim())) {
      // Add fields to extract district/lokSabha from responses
      pipeline.push({
        $addFields: {
          // Extract district from responses array
          extractedDistrict: {
            $let: {
              vars: {
                districtResponse: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ['$responses', []] },
                        as: 'resp',
                        cond: {
                          $or: [
                            { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'district' } },
                            { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionId', ''] } }, regex: 'district' } }
                          ]
                        }
                      }
                    },
                    0
                  ]
                }
              },
              in: {
                $ifNull: ['$$districtResponse.response', null]
              }
            }
          },
          // Extract lokSabha from responses array
          extractedLokSabha: {
            $let: {
              vars: {
                lokSabhaResponse: {
                  $arrayElemAt: [
                    {
                      $filter: {
                        input: { $ifNull: ['$responses', []] },
                        as: 'resp',
                        cond: {
                          $or: [
                            { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionText', ''] } }, regex: 'lok sabha|parliamentary' } },
                            { $regexMatch: { input: { $toLower: { $ifNull: ['$$resp.questionId', ''] } }, regex: 'lok.*sabha|parliamentary' } }
                          ]
                        }
                      }
                    },
                    0
                  ]
                }
              },
              in: {
                $ifNull: ['$$lokSabhaResponse.response', null]
              }
            }
          }
        }
      });

      // Filter by district/lokSabha
      const districtLokSabhaFilter = {};
      if (district && district.trim()) {
        const districtPattern = district.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        districtLokSabhaFilter.$or = [
          { extractedDistrict: { $regex: districtPattern, $options: 'i' } },
          { 'responses.response': { $regex: districtPattern, $options: 'i' } }
        ];
      }
      if (lokSabha && lokSabha.trim()) {
        const lokSabhaPattern = lokSabha.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (districtLokSabhaFilter.$or) {
          districtLokSabhaFilter.$and = [
            districtLokSabhaFilter,
            {
              $or: [
                { extractedLokSabha: { $regex: lokSabhaPattern, $options: 'i' } },
                { 'responses.response': { $regex: lokSabhaPattern, $options: 'i' } }
              ]
            }
          ];
          delete districtLokSabhaFilter.$or;
        } else {
          districtLokSabhaFilter.$or = [
            { extractedLokSabha: { $regex: lokSabhaPattern, $options: 'i' } },
            { 'responses.response': { $regex: lokSabhaPattern, $options: 'i' } }
          ];
        }
      }
      
      if (Object.keys(districtLokSabhaFilter).length > 0) {
        pipeline.push({ $match: districtLokSabhaFilter });
      }
    }

    // Stage 4: Group and count (final aggregation stage)
    pipeline.push({
      $group: {
        _id: null,
        totalResponses: { $sum: 1 },
        capiResponses: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CAPI'] }, 1, 0]
          }
        },
        catiResponses: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CATI'] }, 1, 0]
          }
        }
      }
    });

    // Execute aggregation (handles millions of records efficiently)
    const result = await SurveyResponse.aggregate(pipeline);

    // Get sample size from survey
    const sampleSize = survey.sampleSize || 0;

    // Extract counts from aggregation result
    const stats = result[0] || {
      totalResponses: 0,
      capiResponses: 0,
      catiResponses: 0
    };

    // Return only the 4 required stats
    res.status(200).json({
      success: true,
      data: {
        totalResponses: stats.totalResponses,
        sampleSize: sampleSize,
        capiResponses: stats.capiResponses,
        catiResponses: stats.catiResponses
      }
    });

  } catch (error) {
    console.error('Get survey analytics V2 error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
};

// @desc    Get AC-wise stats (optimized for big data)
// @route   GET /api/surveys/:id/ac-wise-stats-v2
// @access  Private (Company Admin, Project Manager)
exports.getACWiseStatsV2 = async (req, res) => {
  try {
    const surveyId = req.params.id || req.params.surveyId;
    const {
      dateRange,
      startDate,
      endDate,
      status,
      interviewMode,
      ac,
      district,
      lokSabha,
      interviewerIds,
      interviewerMode = 'include'
    } = req.query;

    // TOP-TIER TECH COMPANY SOLUTION: Analytics caching (Meta, Google, Amazon pattern)
    // Cache expensive aggregation queries to reduce database load (10 minute TTL for survey stats)
    const analyticsCache = require('../utils/analyticsCache');
    const cacheParams = { dateRange, startDate, endDate, status, interviewMode, ac, district, lokSabha, interviewerIds, interviewerMode };
    
    // Check cache first
    const cachedResult = await analyticsCache.get('ac_stats', surveyId, cacheParams);
    if (cachedResult) {
      console.log(`⚡ Using cached AC-wise stats for survey ${surveyId}`);
      return res.status(200).json(cachedResult);
    }

    // Verify survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Build match filter for MongoDB aggregation (NO LIMITS - handles millions of records)
    const matchFilter = { survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = status;
      }
    } else {
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }

    // Interview mode filter
    if (interviewMode) {
      matchFilter.interviewMode = interviewMode.toLowerCase();
    }

    // Date range filter (using IST timezone)
    // If dateRange is 'custom', ignore it and use startDate/endDate instead
    if (dateRange && dateRange !== 'all' && dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000; // IST offset: 5.5 hours
      let dateStart, dateEnd;

      switch (dateRange) {
        case 'today':
          // Get today's date in IST, convert to UTC
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          // Get yesterday's date in IST
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateStringFromDate(new Date(istTime.getTime() - istOffset));
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          // Get date 7 days ago in IST
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateStringFromDate(new Date(istTimeWeek.getTime() - istOffset));
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          // Get date 30 days ago in IST
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateStringFromDate(new Date(istTimeMonth.getTime() - istOffset));
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }

      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range - parse as IST dates (check this separately to allow override)
    if (startDate || endDate) {
      let dateStart, dateEnd;
      // Handle single day selection (startDate === endDate) or date range
      if (startDate && endDate) {
        // Both dates provided - date range
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(endDate);
      } else if (startDate && !endDate) {
        // Only start date provided - from start date to end of that day
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(startDate);
      } else if (!startDate && endDate) {
        // Only end date provided - from beginning of that day to end date
        dateStart = getISTDateStartUTC(endDate);
        dateEnd = getISTDateEndUTC(endDate);
      }
      
      if (dateStart && dateEnd) {
        // Override any dateRange filter with custom dates
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }

    // Interviewer filter - Handle both array and single value from query params
    let interviewerIdsArray = [];
    if (interviewerIds) {
      if (Array.isArray(interviewerIds)) {
        interviewerIdsArray = interviewerIds;
      } else if (typeof interviewerIds === 'string') {
        interviewerIdsArray = interviewerIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    if (interviewerIdsArray.length > 0) {
      const interviewerObjectIds = interviewerIdsArray
        .filter(id => id && id !== 'undefined' && id !== 'null')
        .map(id => {
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        })
        .filter(id => id);

      if (interviewerObjectIds.length > 0) {
        if (interviewerMode === 'exclude') {
          matchFilter.interviewer = { $nin: interviewerObjectIds };
        } else {
          matchFilter.interviewer = { $in: interviewerObjectIds };
        }
      }
    }

    // For project managers: filter by assigned interviewers
    if (req.user.userType === 'project_manager') {
      const currentUser = await User.findById(req.user.id).populate('assignedTeamMembers.user', '_id userType');
      if (currentUser && currentUser.assignedTeamMembers && currentUser.assignedTeamMembers.length > 0) {
        // Extract interviewer IDs from assignedTeamMembers structure
        // assignedTeamMembers is an array of objects: [{ userType: 'interviewer', user: ObjectId or User object }, ...]
        const assignedIds = currentUser.assignedTeamMembers
          .filter(tm => tm.userType === 'interviewer' && tm.user)
          .map(tm => {
            // Handle both ObjectId and populated user object
            const userId = tm.user._id ? tm.user._id : tm.user;
            return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
          })
          .filter(id => id && mongoose.Types.ObjectId.isValid(id));
        
        if (assignedIds.length > 0) {
          if (!matchFilter.interviewer) {
            matchFilter.interviewer = { $in: assignedIds };
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Filtering by ${assignedIds.length} assigned interviewer(s)`);
          } else if (matchFilter.interviewer.$in) {
            const originalIds = matchFilter.interviewer.$in;
            matchFilter.interviewer.$in = originalIds.filter(id => {
              const idStr = id.toString();
              return assignedIds.some(assignedId => assignedId.toString() === idStr);
            });
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Intersected ${originalIds.length} selected with ${assignedIds.length} assigned, result: ${matchFilter.interviewer.$in.length} interviewer(s)`);
          } else if (matchFilter.interviewer.$nin) {
            const excludedIds = matchFilter.interviewer.$nin;
            const assignedIdsStr = assignedIds.map(id => id.toString());
            matchFilter.interviewer.$nin = excludedIds.filter(id => assignedIdsStr.includes(id.toString()));
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Excluding ${matchFilter.interviewer.$nin.length} interviewer(s) from assigned list`);
          }
        } else {
          // No assigned interviewers found, return empty results
          console.log(`⚠️ getACWiseStatsV2 - Project Manager: No valid assigned interviewers found`);
          matchFilter.interviewer = { $in: [] }; // Empty array will return no results
        }
      } else {
        // No assigned team members, return empty results
        console.log(`⚠️ getACWiseStatsV2 - Project Manager: No assigned team members`);
        matchFilter.interviewer = { $in: [] }; // Empty array will return no results
      }
    }

    // Build aggregation pipeline - pure MongoDB aggregation
    const pipeline = [];

    // Stage 1: Match filtered responses
    pipeline.push({ $match: matchFilter });

    // Stage 2: Add fields for AC extraction and polling station key
    pipeline.push({
      $addFields: {
        // Extract AC from selectedAC or selectedPollingStation (simple and fast)
        extractedAC: {
          $ifNull: [
            '$selectedAC',
            '$selectedPollingStation.acName'
          ]
        },
        // Create polling station key for PS Covered calculation
        pollingStationKey: {
          $concat: [
            { $ifNull: ['$selectedPollingStation.stationName', ''] },
            '-',
            { $ifNull: ['$selectedPollingStation.groupName', ''] }
          ]
        },
        // Extract AC code from selectedPollingStation
        extractedACCode: {
          $ifNull: [
            '$selectedPollingStation.acNo',
            null
          ]
        },
        // Extract PC code and name from selectedPollingStation
        extractedPCCode: {
          $ifNull: [
            '$selectedPollingStation.pcNo',
            null
          ]
        },
        extractedPCName: {
          $ifNull: [
            '$selectedPollingStation.pcName',
            null
          ]
        }
      }
    });

    // Stage 3: Filter by AC if provided
    if (ac && ac.trim()) {
      const acPattern = ac.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push({
        $match: {
          $or: [
            { extractedAC: { $regex: acPattern, $options: 'i' } },
            { 'selectedPollingStation.acName': { $regex: acPattern, $options: 'i' } }
          ]
        }
      });
    }

    // Stage 4: Group by AC for AC stats
    pipeline.push({
      $group: {
        _id: {
          $ifNull: ['$extractedAC', 'N/A']
        },
        total: { $sum: 1 },
        capi: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CAPI'] }, 1, 0]
          }
        },
        cati: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CATI'] }, 1, 0]
          }
        },
        approved: {
          $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] }
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] }
        },
        autoRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $or: [
                      { $eq: ['$verificationData.autoRejected', true] },
                      { $gt: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] },
                      // Also check feedback field for auto-rejection patterns (matches current reports page logic)
                      {
                        $and: [
                          { $ne: ['$verificationData.feedback', null] },
                          {
                            $or: [
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Interview Too Short', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not Voter', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not a Registered Voter', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Duplicate Response', options: 'i' } }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        manualRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $and: [
                      { $ne: ['$verificationData.autoRejected', true] },
                      { $eq: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] },
                      // Not matching auto-rejection feedback patterns
                      {
                        $or: [
                          { $eq: ['$verificationData.feedback', null] },
                          {
                            $and: [
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Interview Too Short', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not Voter', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not a Registered Voter', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Duplicate Response', options: 'i' } } }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        underQC: {
          $sum: { $cond: [{ $eq: ['$status', 'Pending_Approval'] }, 1, 0] }
        },
        pollingStations: { $addToSet: '$pollingStationKey' },
        interviewers: { $addToSet: '$interviewer' },
        acCodes: { $addToSet: '$extractedACCode' },
        pcCodes: { $addToSet: '$extractedPCCode' },
        pcNames: { $addToSet: '$extractedPCName' }
      }
    });

    // Stage 5: Project final fields
    pipeline.push({
      $project: {
        _id: 0,
        ac: '$_id',
        completedInterviews: '$total',
        capi: '$capi',
        cati: '$cati',
        approved: '$approved',
        rejected: '$manualRejected',
        autoRejected: '$autoRejected',
        underQC: '$underQC',
        interviewersCount: { $size: { $filter: { input: { $ifNull: ['$interviewers', []] }, cond: { $ne: ['$$this', null] } } } },
        psCovered: { $size: { $filter: { input: { $ifNull: ['$pollingStations', []] }, cond: { $ne: ['$$this', null] } } } },
        acCode: { $arrayElemAt: [{ $filter: { input: '$acCodes', cond: { $ne: ['$$this', null] } } }, 0] },
        pcCode: { $arrayElemAt: [{ $filter: { input: '$pcCodes', cond: { $ne: ['$$this', null] } } }, 0] },
        pcName: { $arrayElemAt: [{ $filter: { input: '$pcNames', cond: { $ne: ['$$this', null] } } }, 0] }
      }
    });

    // Stage 6: Sort by completed interviews (descending)
    pipeline.push({
      $sort: { completedInterviews: -1 }
    });

    // Execute aggregation with performance optimizations
    const acStats = await SurveyResponse.aggregate(pipeline, {
      allowDiskUse: true,
      maxTimeMS: 300000 // 5 minutes timeout
    });

    // Calculate countsAfterRejection for each AC
    const acStatsWithCalculations = acStats.map(stat => ({
      ...stat,
      countsAfterRejection: Math.max(0, stat.completedInterviews - stat.autoRejected),
      gpsPending: 0, // Not calculated yet
      gpsFail: 0 // Not calculated yet
    }));

    const result = {
      success: true,
      data: acStatsWithCalculations
    };
    
    // Cache the result (10 minute TTL for survey statistics)
    await analyticsCache.set('ac_stats', surveyId, cacheParams, result, 10 * 60);
    
    res.status(200).json(result);
  } catch (error) {
    console.error('Get AC-wise stats V2 error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get Interviewer-wise stats (optimized for big data)
// @route   GET /api/surveys/:id/interviewer-wise-stats-v2
// @access  Private (Company Admin, Project Manager)
exports.getInterviewerWiseStatsV2 = async (req, res) => {
  try {
    const surveyId = req.params.id || req.params.surveyId;
    const {
      dateRange,
      startDate,
      endDate,
      status,
      interviewMode,
      ac,
      district,
      lokSabha,
      interviewerIds,
      interviewerMode = 'include'
    } = req.query;

    // Verify survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Build match filter for MongoDB aggregation (NO LIMITS - handles millions of records)
    const matchFilter = { survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = status;
      }
    } else {
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }

    // Interview mode filter
    if (interviewMode) {
      matchFilter.interviewMode = interviewMode.toLowerCase();
    }

    // Date range filter (using IST timezone)
    // If dateRange is 'custom', ignore it and use startDate/endDate instead
    if (dateRange && dateRange !== 'all' && dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000; // IST offset: 5.5 hours
      let dateStart, dateEnd;

      switch (dateRange) {
        case 'today':
          // Get today's date in IST, convert to UTC
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          // Get yesterday's date in IST
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateStringFromDate(new Date(istTime.getTime() - istOffset));
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          // Get date 7 days ago in IST
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateStringFromDate(new Date(istTimeWeek.getTime() - istOffset));
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          // Get date 30 days ago in IST
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateStringFromDate(new Date(istTimeMonth.getTime() - istOffset));
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }

      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range - parse as IST dates (check this separately to allow override)
    if (startDate || endDate) {
      let dateStart, dateEnd;
      // Handle single day selection (startDate === endDate) or date range
      if (startDate && endDate) {
        // Both dates provided - date range
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(endDate);
      } else if (startDate && !endDate) {
        // Only start date provided - from start date to end of that day
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(startDate);
      } else if (!startDate && endDate) {
        // Only end date provided - from beginning of that day to end date
        dateStart = getISTDateStartUTC(endDate);
        dateEnd = getISTDateEndUTC(endDate);
      }
      
      if (dateStart && dateEnd) {
        // Override any dateRange filter with custom dates
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }

    // Interviewer filter - Handle both array and single value from query params
    let interviewerIdsArray = [];
    if (interviewerIds) {
      if (Array.isArray(interviewerIds)) {
        interviewerIdsArray = interviewerIds;
      } else if (typeof interviewerIds === 'string') {
        interviewerIdsArray = interviewerIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    if (interviewerIdsArray.length > 0) {
      const interviewerObjectIds = interviewerIdsArray
        .filter(id => id && id !== 'undefined' && id !== 'null')
        .map(id => {
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        })
        .filter(id => id);

      if (interviewerObjectIds.length > 0) {
        if (interviewerMode === 'exclude') {
          matchFilter.interviewer = { $nin: interviewerObjectIds };
        } else {
          matchFilter.interviewer = { $in: interviewerObjectIds };
        }
      }
    }

    // For project managers: filter by assigned interviewers
    if (req.user.userType === 'project_manager') {
      const currentUser = await User.findById(req.user.id).populate('assignedTeamMembers.user', '_id userType');
      if (currentUser && currentUser.assignedTeamMembers && currentUser.assignedTeamMembers.length > 0) {
        // Extract interviewer IDs from assignedTeamMembers structure
        // assignedTeamMembers is an array of objects: [{ userType: 'interviewer', user: ObjectId or User object }, ...]
        const assignedIds = currentUser.assignedTeamMembers
          .filter(tm => tm.userType === 'interviewer' && tm.user)
          .map(tm => {
            // Handle both ObjectId and populated user object
            const userId = tm.user._id ? tm.user._id : tm.user;
            return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
          })
          .filter(id => id && mongoose.Types.ObjectId.isValid(id));
        
        if (assignedIds.length > 0) {
          if (!matchFilter.interviewer) {
            matchFilter.interviewer = { $in: assignedIds };
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Filtering by ${assignedIds.length} assigned interviewer(s)`);
          } else if (matchFilter.interviewer.$in) {
            const originalIds = matchFilter.interviewer.$in;
            matchFilter.interviewer.$in = originalIds.filter(id => {
              const idStr = id.toString();
              return assignedIds.some(assignedId => assignedId.toString() === idStr);
            });
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Intersected ${originalIds.length} selected with ${assignedIds.length} assigned, result: ${matchFilter.interviewer.$in.length} interviewer(s)`);
          } else if (matchFilter.interviewer.$nin) {
            const excludedIds = matchFilter.interviewer.$nin;
            const assignedIdsStr = assignedIds.map(id => id.toString());
            matchFilter.interviewer.$nin = excludedIds.filter(id => assignedIdsStr.includes(id.toString()));
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Excluding ${matchFilter.interviewer.$nin.length} interviewer(s) from assigned list`);
          }
        } else {
          // No assigned interviewers found, return empty results
          console.log(`⚠️ getACWiseStatsV2 - Project Manager: No valid assigned interviewers found`);
          matchFilter.interviewer = { $in: [] }; // Empty array will return no results
        }
      } else {
        // No assigned team members, return empty results
        console.log(`⚠️ getACWiseStatsV2 - Project Manager: No assigned team members`);
        matchFilter.interviewer = { $in: [] }; // Empty array will return no results
      }
    }

    // Build aggregation pipeline - pure MongoDB aggregation
    const pipeline = [];

    // Stage 1: Match filtered responses
    pipeline.push({ $match: matchFilter });

    // Stage 2: Add fields for polling station key
    pipeline.push({
      $addFields: {
        // Create polling station key for PS Covered calculation
        pollingStationKey: {
          $concat: [
            { $ifNull: ['$selectedPollingStation.stationName', ''] },
            '-',
            { $ifNull: ['$selectedPollingStation.groupName', ''] }
          ]
        }
      }
    });

    // Stage 3: Filter by AC if provided
    if (ac && ac.trim()) {
      const acPattern = ac.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pipeline.push({
        $match: {
          $or: [
            { selectedAC: { $regex: acPattern, $options: 'i' } },
            { 'selectedPollingStation.acName': { $regex: acPattern, $options: 'i' } }
          ]
        }
      });
    }

    // Stage 4: Lookup interviewer details
    pipeline.push({
      $lookup: {
        from: 'users',
        localField: 'interviewer',
        foreignField: '_id',
        as: 'interviewerDetails'
      }
    });

    // Stage 5: Unwind interviewer details
    pipeline.push({
      $unwind: {
        path: '$interviewerDetails',
        preserveNullAndEmptyArrays: true
      }
    });

    // Stage 6: Group by interviewer for interviewer stats
    pipeline.push({
      $group: {
        _id: '$interviewer',
        total: { $sum: 1 },
        capi: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CAPI'] }, 1, 0]
          }
        },
        cati: {
          $sum: {
            $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CATI'] }, 1, 0]
          }
        },
        approved: {
          $sum: { $cond: [{ $eq: ['$status', 'Approved'] }, 1, 0] }
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$status', 'Rejected'] }, 1, 0] }
        },
        autoRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $or: [
                      { $eq: ['$verificationData.autoRejected', true] },
                      { $gt: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] },
                      // Also check feedback field for auto-rejection patterns
                      {
                        $and: [
                          { $ne: ['$verificationData.feedback', null] },
                          {
                            $or: [
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Interview Too Short', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not Voter', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not a Registered Voter', options: 'i' } },
                              { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Duplicate Response', options: 'i' } }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        manualRejected: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'Rejected'] },
                  {
                    $and: [
                      { $ne: ['$verificationData.autoRejected', true] },
                      { $eq: [{ $size: { $ifNull: ['$verificationData.autoRejectionReasons', []] } }, 0] },
                      // Not matching auto-rejection feedback patterns
                      {
                        $or: [
                          { $eq: ['$verificationData.feedback', null] },
                          {
                            $and: [
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Interview Too Short', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not Voter', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Not a Registered Voter', options: 'i' } } },
                              { $not: { $regexMatch: { input: { $ifNull: ['$verificationData.feedback', ''] }, regex: 'Duplicate Response', options: 'i' } } }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              1,
              0
            ]
          }
        },
        underQC: {
          $sum: { $cond: [{ $eq: ['$status', 'Pending_Approval'] }, 1, 0] }
        },
        pollingStations: { $addToSet: '$pollingStationKey' },
        interviewerName: { $first: { $concat: ['$interviewerDetails.firstName', ' ', '$interviewerDetails.lastName'] } },
        interviewerMemberId: { $first: '$interviewerDetails.memberId' }
      }
    });

    // Stage 7: Project final fields
    pipeline.push({
      $project: {
        _id: 0,
        interviewerId: '$_id',
        interviewer: '$interviewerName',
        memberId: '$interviewerMemberId',
        completedInterviews: '$total',
        capi: '$capi',
        cati: '$cati',
        approved: '$approved',
        rejected: '$manualRejected',
        autoRejected: '$autoRejected',
        underQC: '$underQC',
        psCovered: { $size: { $filter: { input: { $ifNull: ['$pollingStations', []] }, cond: { $ne: ['$$this', null] } } } }
      }
    });

    // Stage 8: Sort by completed interviews (descending)
    pipeline.push({
      $sort: { completedInterviews: -1 }
    });

    // Execute aggregation
    const interviewerStats = await SurveyResponse.aggregate(pipeline);

    // Calculate countsAfterRejection for each interviewer
    const interviewerStatsWithCalculations = interviewerStats.map(stat => ({
      ...stat,
      countsAfterRejection: Math.max(0, stat.completedInterviews - stat.autoRejected),
      gpsPending: 0, // Not calculated yet
      gpsFail: 0 // Not calculated yet
    }));

    res.status(200).json({
      success: true,
      data: interviewerStatsWithCalculations
    });
  } catch (error) {
    console.error('Get Interviewer-wise stats V2 error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// @desc    Get Chart Data (optimized for big data - daily stats only for performance)
// @route   GET /api/surveys/:id/chart-data-v2
// @access  Private (Company Admin, Project Manager)
exports.getChartDataV2 = async (req, res) => {
  try {
    const surveyId = req.params.id || req.params.surveyId;
    const {
      dateRange,
      startDate,
      endDate,
      status,
      interviewMode,
      ac,
      district,
      lokSabha,
      interviewerIds,
      interviewerMode = 'include'
    } = req.query;

    // Verify survey exists
    const survey = await Survey.findById(surveyId);
    if (!survey) {
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    // Build match filter for MongoDB aggregation (NO LIMITS - handles millions of records)
    const matchFilter = { survey: mongoose.Types.ObjectId.isValid(surveyId) ? new mongoose.Types.ObjectId(surveyId) : surveyId };

    // Status filter
    if (status && status !== 'all') {
      if (status === 'approved_rejected_pending') {
        matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
      } else if (status === 'approved_pending') {
        matchFilter.status = { $in: ['Approved', 'Pending_Approval'] };
      } else if (status === 'pending') {
        matchFilter.status = 'Pending_Approval';
      } else {
        matchFilter.status = status;
      }
    } else {
      matchFilter.status = { $in: ['Approved', 'Rejected', 'Pending_Approval'] };
    }

    // Interview mode filter
    if (interviewMode) {
      matchFilter.interviewMode = interviewMode.toLowerCase();
    }

    // Date range filter (using IST timezone)
    // If dateRange is 'custom', ignore it and use startDate/endDate instead
    if (dateRange && dateRange !== 'all' && dateRange !== 'custom') {
      const istOffset = 5.5 * 60 * 60 * 1000; // IST offset: 5.5 hours
      let dateStart, dateEnd;

      switch (dateRange) {
        case 'today':
          // Get today's date in IST, convert to UTC
          const todayIST = getISTDateString();
          dateStart = getISTDateStartUTC(todayIST);
          dateEnd = getISTDateEndUTC(todayIST);
          break;
        case 'yesterday':
          // Get yesterday's date in IST
          const now = new Date();
          const istTime = new Date(now.getTime() + istOffset);
          istTime.setUTCDate(istTime.getUTCDate() - 1);
          const yesterdayISTStr = getISTDateStringFromDate(new Date(istTime.getTime() - istOffset));
          dateStart = getISTDateStartUTC(yesterdayISTStr);
          dateEnd = getISTDateEndUTC(yesterdayISTStr);
          break;
        case 'week':
          // Get date 7 days ago in IST
          const nowWeek = new Date();
          const istTimeWeek = new Date(nowWeek.getTime() + istOffset);
          istTimeWeek.setUTCDate(istTimeWeek.getUTCDate() - 7);
          const weekAgoISTStr = getISTDateStringFromDate(new Date(istTimeWeek.getTime() - istOffset));
          const todayISTStr = getISTDateString();
          dateStart = getISTDateStartUTC(weekAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr);
          break;
        case 'month':
          // Get date 30 days ago in IST
          const nowMonth = new Date();
          const istTimeMonth = new Date(nowMonth.getTime() + istOffset);
          istTimeMonth.setUTCDate(istTimeMonth.getUTCDate() - 30);
          const monthAgoISTStr = getISTDateStringFromDate(new Date(istTimeMonth.getTime() - istOffset));
          const todayISTStr2 = getISTDateString();
          dateStart = getISTDateStartUTC(monthAgoISTStr);
          dateEnd = getISTDateEndUTC(todayISTStr2);
          break;
      }

      if (dateStart && dateEnd) {
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }
    
    // Custom date range - parse as IST dates (check this separately to allow override)
    if (startDate || endDate) {
      let dateStart, dateEnd;
      // Handle single day selection (startDate === endDate) or date range
      if (startDate && endDate) {
        // Both dates provided - date range
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(endDate);
      } else if (startDate && !endDate) {
        // Only start date provided - from start date to end of that day
        dateStart = getISTDateStartUTC(startDate);
        dateEnd = getISTDateEndUTC(startDate);
      } else if (!startDate && endDate) {
        // Only end date provided - from beginning of that day to end date
        dateStart = getISTDateStartUTC(endDate);
        dateEnd = getISTDateEndUTC(endDate);
      }
      
      if (dateStart && dateEnd) {
        // Override any dateRange filter with custom dates
        matchFilter.startTime = { $gte: dateStart, $lte: dateEnd };
      }
    }

    // Interviewer filter
    let interviewerIdsArray = [];
    if (interviewerIds) {
      if (Array.isArray(interviewerIds)) {
        interviewerIdsArray = interviewerIds;
      } else if (typeof interviewerIds === 'string') {
        interviewerIdsArray = interviewerIds.split(',').map(id => id.trim()).filter(id => id);
      }
    }

    if (interviewerIdsArray.length > 0) {
      const interviewerObjectIds = interviewerIdsArray
        .filter(id => id && id !== 'undefined' && id !== 'null')
        .map(id => {
          if (mongoose.Types.ObjectId.isValid(id)) {
            return new mongoose.Types.ObjectId(id);
          }
          return id;
        })
        .filter(id => id);

      if (interviewerObjectIds.length > 0) {
        if (interviewerMode === 'exclude') {
          matchFilter.interviewer = { $nin: interviewerObjectIds };
        } else {
          matchFilter.interviewer = { $in: interviewerObjectIds };
        }
      }
    }

    // For project managers: filter by assigned interviewers
    if (req.user.userType === 'project_manager') {
      const currentUser = await User.findById(req.user.id).populate('assignedTeamMembers.user', '_id userType');
      if (currentUser && currentUser.assignedTeamMembers && currentUser.assignedTeamMembers.length > 0) {
        // Extract interviewer IDs from assignedTeamMembers structure
        // assignedTeamMembers is an array of objects: [{ userType: 'interviewer', user: ObjectId or User object }, ...]
        const assignedIds = currentUser.assignedTeamMembers
          .filter(tm => tm.userType === 'interviewer' && tm.user)
          .map(tm => {
            // Handle both ObjectId and populated user object
            const userId = tm.user._id ? tm.user._id : tm.user;
            return mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId;
          })
          .filter(id => id && mongoose.Types.ObjectId.isValid(id));
        
        if (assignedIds.length > 0) {
          if (!matchFilter.interviewer) {
            matchFilter.interviewer = { $in: assignedIds };
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Filtering by ${assignedIds.length} assigned interviewer(s)`);
          } else if (matchFilter.interviewer.$in) {
            const originalIds = matchFilter.interviewer.$in;
            matchFilter.interviewer.$in = originalIds.filter(id => {
              const idStr = id.toString();
              return assignedIds.some(assignedId => assignedId.toString() === idStr);
            });
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Intersected ${originalIds.length} selected with ${assignedIds.length} assigned, result: ${matchFilter.interviewer.$in.length} interviewer(s)`);
          } else if (matchFilter.interviewer.$nin) {
            const excludedIds = matchFilter.interviewer.$nin;
            const assignedIdsStr = assignedIds.map(id => id.toString());
            matchFilter.interviewer.$nin = excludedIds.filter(id => assignedIdsStr.includes(id.toString()));
            console.log(`🔍 getACWiseStatsV2 - Project Manager: Excluding ${matchFilter.interviewer.$nin.length} interviewer(s) from assigned list`);
          }
        } else {
          // No assigned interviewers found, return empty results
          console.log(`⚠️ getACWiseStatsV2 - Project Manager: No valid assigned interviewers found`);
          matchFilter.interviewer = { $in: [] }; // Empty array will return no results
        }
      } else {
        // No assigned team members, return empty results
        console.log(`⚠️ getACWiseStatsV2 - Project Manager: No assigned team members`);
        matchFilter.interviewer = { $in: [] }; // Empty array will return no results
      }
    }

    // Daily Stats Pipeline (optimized - only daily stats, no gender/age for performance)
    // Use startTime (interview date) instead of createdAt (sync date) for grouping
    const dailyStatsPipeline = [
      { $match: matchFilter },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$startTime' // Use startTime (interview date) instead of createdAt
            }
          },
          count: { $sum: 1 },
          capi: {
            $sum: {
              $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CAPI'] }, 1, 0]
            }
          },
          cati: {
            $sum: {
              $cond: [{ $eq: [{ $toUpper: { $ifNull: ['$interviewMode', ''] } }, 'CATI'] }, 1, 0]
            }
          }
        }
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          count: 1,
          capi: 1,
          cati: 1
        }
      }
    ];

    // Execute daily stats pipeline only (removed gender/age for performance)
    const dailyStats = await SurveyResponse.aggregate(dailyStatsPipeline);

    res.status(200).json({
      success: true,
      data: {
        dailyStats
      }
    });
  } catch (error) {
    console.error('Get Chart Data V2 error:', error);
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

// Export multer middleware for use in routes
exports.uploadRespondentContactsMiddleware = upload.single('file');
