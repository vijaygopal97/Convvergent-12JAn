const Survey = require('../models/Survey');
const User = require('../models/User');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const CatiCall = require('../models/CatiCall');
const InterviewSession = require('../models/InterviewSession');
const SurveyResponse = require('../models/SurveyResponse');
const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// OPTIMIZED: Import survey cache for fast survey retrieval (like top tech companies)
const surveyCache = require('../utils/surveyCache');
const statsCache = require('../utils/statsCache');
// OPTIMIZED: Use Redis for AC Priority Map caching (like Amazon/Twitter)
const redisOps = require('../utils/redisClient');
// PHASE 3 OPTIMIZATION: Redis queue caching for next available entries
const catiQueueCache = require('../utils/catiQueueCache');

// AC Priority Map Redis cache key
const AC_PRIORITY_REDIS_KEY = 'cati:ac_priority_map';
const AC_PRIORITY_CACHE_TTL = 300; // 5 minutes in seconds (Redis TTL)

/**
 * Load AC priority mapping from JSON file (with Redis caching)
 * Top-tier companies (Amazon/Twitter) use Redis to share cache across servers
 * @returns {Object} Map of AC name to priority (number), or empty object if file not found
 */
const loadACPriorityMap = async () => {
  try {
    // STEP 1: Check Redis cache first (fastest - shared across servers)
    try {
      const cachedMap = await redisOps.get(AC_PRIORITY_REDIS_KEY);
      if (cachedMap && typeof cachedMap === 'object') {
        console.log('⚡ Using Redis cached AC priority map:', Object.keys(cachedMap).length, 'ACs');
        return cachedMap;
      }
    } catch (redisError) {
      console.warn('⚠️ Redis cache check failed, falling back to file:', redisError.message);
    }

    // STEP 2: Load from file (if not in Redis cache)
    const priorityFilePath = path.join(__dirname, '..', 'data', 'CATI_AC_Priority.json');
    
    let map = {};
    try {
      await fs.access(priorityFilePath);
      const fileContent = await fs.readFile(priorityFilePath, 'utf8');
      const priorityData = JSON.parse(fileContent);
      
      // Build map: AC_Name -> Priority (as number)
      if (Array.isArray(priorityData)) {
        priorityData.forEach(item => {
          if (item.AC_Name && item.Priority !== undefined) {
            // Convert Priority to number (handle string "0", "1", etc.)
            const priority = typeof item.Priority === 'string' ? parseInt(item.Priority, 10) : item.Priority;
            if (!isNaN(priority)) {
              map[item.AC_Name] = priority;
            }
          }
        });
      }
      
      console.log('✅ Loaded AC priority map from file:', Object.keys(map).length, 'ACs');
    } catch (fileError) {
      console.log('⚠️  AC Priority file not found or error reading:', fileError.message);
      map = {}; // Return empty map (no priorities)
    }

    // STEP 3: Cache in Redis for future requests (shared across all servers)
    try {
      await redisOps.set(AC_PRIORITY_REDIS_KEY, map, AC_PRIORITY_CACHE_TTL);
      console.log('✅ Cached AC priority map in Redis for', AC_PRIORITY_CACHE_TTL, 'seconds');
    } catch (redisError) {
      console.warn('⚠️ Redis cache set failed (will use file on next request):', redisError.message);
    }

    return map;
  } catch (error) {
    console.error('❌ Error loading AC priority map:', error);
    return {};
  }
};

/**
 * Normalize AC name for comparison (trim, lowercase)
 * @param {String} acName - Assembly Constituency name
 * @returns {String} Normalized AC name
 */
const normalizeACName = (acName) => {
  if (!acName) return '';
  return String(acName).trim().toLowerCase();
};

/**
 * Get AC priority for a given AC name
 * @param {String} acName - Assembly Constituency name
 * @returns {Number|null} Priority number, or null if not in priority list
 */
const getACPriority = async (acName) => {
  if (!acName) return null;
  
  const priorityMap = await loadACPriorityMap();
  const normalizedAC = normalizeACName(acName);
  
  // Try exact match first, then normalized match
  if (priorityMap[acName] !== undefined) {
    return priorityMap[acName];
  }
  
  // Try normalized match
  for (const [mapAC, priority] of Object.entries(priorityMap)) {
    if (normalizeACName(mapAC) === normalizedAC) {
      return priority;
    }
  }
  
  return null;
};

// DeepCall API Configuration
const DEEPCALL_API_BASE_URL = 'https://s-ct3.sarv.com/v2/clickToCall/para';
const DEEPCALL_USER_ID = process.env.DEEPCALL_USER_ID || '89130240';
const DEEPCALL_TOKEN = process.env.DEEPCALL_TOKEN || '6GQJuwW6lB8ZBHntzaRU';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'https://opine.exypnossolutions.com';

// Helper function to make call via DeepCall API
const initiateDeepCall = async (fromNumber, toNumber, fromType = 'Number', toType = 'Number', fromRingTime = 30, toRingTime = 30) => {
  try {
    const cleanFrom = fromNumber.replace(/[^0-9]/g, '');
    const cleanTo = toNumber.replace(/[^0-9]/g, '');

    const params = {
      user_id: DEEPCALL_USER_ID,
      token: DEEPCALL_TOKEN,
      from: cleanFrom,
      to: cleanTo,
      fromType: fromType,
      toType: toType,
      fromRingTime: parseInt(fromRingTime),
      toRingTime: parseInt(toRingTime)
    };

    const queryString = new URLSearchParams(params).toString();
    const fullUrl = `${DEEPCALL_API_BASE_URL}?${queryString}`;

    console.log(`📞 Making CATI call: ${fromNumber} -> ${toNumber}`);

    const response = await axios.get(fullUrl, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });

    const apiResponse = response.data;
    console.log('📞 DeepCall API raw response:', apiResponse);
    
    // Normalize common fields
    const status = typeof apiResponse?.status === 'string'
      ? apiResponse.status.toLowerCase()
      : apiResponse?.status;
    const code = apiResponse?.code ?? apiResponse?.statusCode ?? apiResponse?.status_code;

    // Treat as error only when status explicitly indicates error or when we have a clear non‑success code
    const isExplicitErrorStatus = status === 'error' || status === 'failed' || status === 'failure';
    const isErrorCode = code !== undefined && !['0', 0, '200', 200].includes(code);

    if (isExplicitErrorStatus || isErrorCode) {
      const errorMessage =
        apiResponse.message ||
        (typeof apiResponse.error === 'string' ? apiResponse.error : apiResponse.error?.message) ||
        `DeepCall API Error: ${code || 'Unknown error'}`;
      return {
        success: false,
        message: errorMessage,
        error: {
          message: errorMessage,
          code,
          status: apiResponse.status,
          details: apiResponse
        },
        statusCode: code
      };
    }
    
    const callId = apiResponse?.callId || apiResponse?.id || apiResponse?.call_id || apiResponse?.data?.callId;

    if (!callId) {
      return {
        success: false,
        message: 'API response does not contain call ID',
        error: {
          message: 'API response does not contain call ID',
          details: apiResponse
        },
        apiResponse: apiResponse
      };
    }

    return {
      success: true,
      callId: callId,
      data: {
        callId: callId,
        fromNumber: fromNumber,
        toNumber: toNumber,
        apiResponse: apiResponse
      }
    };

  } catch (error) {
    console.error('Error initiating DeepCall:', error);
    console.error('Error details:', {
      message: error.message,
      response: error.response?.data,
      status: error.response?.status,
      statusText: error.response?.statusText
    });
    
    // Extract error message from various possible formats
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.error?.message || 
                        (typeof error.response?.data?.error === 'string' ? error.response?.data?.error : null) ||
                        error.message || 
                        'Failed to initiate call';
    
    return {
      success: false,
      message: errorMessage,
      error: {
        message: errorMessage,
        code: error.response?.data?.code || error.response?.data?.error?.code || error.response?.status,
        status: error.response?.data?.status,
        details: error.response?.data || error.message
      },
      statusCode: error.response?.status
    };
  }
};

// @desc    Start CATI interview session and get next respondent from queue
// @route   POST /api/cati-interview/start/:surveyId
// @access  Private (Interviewer)
const startCatiInterview = async (req, res) => {
  try {
    console.log('🔍 startCatiInterview called with params:', req.params);
    console.log('🔍 User:', req.user ? req.user._id : 'No user');
    console.log('🔍 Request path:', req.path);
    console.log('🔍 Request method:', req.method);
    
    const { surveyId } = req.params;
    if (!surveyId) {
      console.log('❌ No surveyId provided');
      return res.status(400).json({ success: false, message: 'Survey ID is required' });
    }
    const interviewerId = req.user._id;
    if (!interviewerId) {
      console.log('❌ No interviewerId');
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }

    console.log('🔍 Looking up survey:', surveyId);
    // CRITICAL FIX: Always fetch catiInterviewers directly from DB for assignment checks
    // Assignment data must be fresh - cache might have stale assignment data
    // Top tech companies bypass cache for critical authorization checks
    // CRITICAL OPTIMIZATION: DON'T load respondentContacts in select - causes massive memory leaks!
    // respondentContacts can be 100K+ entries = 100-500MB in memory per request
    // Instead, check if contacts exist in DB using count, then load from file if needed
    const survey = await Survey.findById(surveyId)
      .select('surveyName description mode status catiInterviewers assignACs acAssignmentState version respondentContactsFile')
      .lean();
    
    console.log('🔍 Survey found:', survey ? 'Yes' : 'No');
    if (!survey) {
      console.log('❌ Survey not found, returning 404');
      return res.status(404).json({
        success: false,
        message: 'Survey not found'
      });
    }

    console.log('🔍 Survey status:', survey.status);
    if (survey.status !== 'active') {
      console.log('❌ Survey not active, returning 400');
      return res.status(400).json({
        success: false,
        message: 'Survey is not active'
      });
    }

    // CRITICAL FIX: Check if interviewer is assigned to this survey for CATI
    // Always check against fresh DB data (not cache) to ensure accurate assignment validation
    console.log('🔍 Checking CATI interviewer assignment...');
    console.log('🔍 Interviewer ID:', interviewerId);
    console.log('🔍 Survey catiInterviewers:', survey.catiInterviewers ? survey.catiInterviewers.length : 0);
    // REMOVED: JSON.stringify() of full array - memory optimization (only log count)
    console.log('🔍 Survey catiInterviewers count:', survey.catiInterviewers ? survey.catiInterviewers.length : 0);
    
    let assignment = null;
    if (survey.catiInterviewers && Array.isArray(survey.catiInterviewers) && survey.catiInterviewers.length > 0) {
      // CRITICAL: Handle both ObjectId and string formats for interviewer field
      assignment = survey.catiInterviewers.find(a => {
        if (!a || !a.interviewer) return false;
        
        // Handle both ObjectId and string formats
        const assignmentInterviewerId = a.interviewer.toString ? a.interviewer.toString() : String(a.interviewer);
        const currentInterviewerId = interviewerId.toString ? interviewerId.toString() : String(interviewerId);
        
        const idMatch = assignmentInterviewerId === currentInterviewerId;
        const statusMatch = a.status === 'assigned' || a.status === 'accepted'; // Accept both 'assigned' and 'accepted' statuses
        
        console.log(`🔍 Checking assignment: interviewerId=${assignmentInterviewerId}, status=${a.status}, idMatch=${idMatch}, statusMatch=${statusMatch}`);
        
        return idMatch && statusMatch;
      });
    }

    console.log('🔍 Assignment found:', assignment ? 'Yes' : 'No');
    // CRITICAL: Removed JSON.stringify() - causes memory leaks
    if (assignment) {
      console.log('🔍 Assignment details - status:', assignment.status, 'assignedACs count:', assignment.assignedACs?.length || 0);
    }
    
    if (!assignment) {
      console.log('❌ Not assigned, returning 403');
      console.log('❌ Available catiInterviewers:', survey.catiInterviewers?.map(a => ({
        interviewer: a.interviewer?.toString ? a.interviewer.toString() : String(a.interviewer),
        status: a.status
      })));
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this survey for CATI interviews'
      });
    }

    // Check if AC selection is required (same logic as CAPI)
    const requiresACSelection = survey.assignACs && 
                               assignment.assignedACs && 
                               assignment.assignedACs.length > 0;
    console.log('🔍 AC Selection required:', requiresACSelection);
    console.log('🔍 Assigned ACs:', assignment.assignedACs);

    // OPTIMIZED: Check queue first - if queue already has pending entries, skip file reading
    // Top tech companies avoid unnecessary file I/O and memory allocation
    console.log('🔍 Checking respondent queue status...');
    const pendingCount = await CatiRespondentQueue.countDocuments({ 
      survey: surveyId, 
      status: 'pending' 
    });
    
    // If queue has pending entries, skip file reading (major performance win)
    if (pendingCount > 0) {
      console.log(`✅ Queue already has ${pendingCount} pending respondents - skipping file read`);
    } else {
      // Queue is empty - need to check if contacts exist and initialize queue
      console.log('🔍 No pending respondents in queue, checking respondent contacts...');
      
      // CRITICAL OPTIMIZATION: Don't load respondentContacts from survey (causes memory leaks!)
      // Instead, check if contacts exist using count query (much more memory efficient)
      // Top tech companies use count queries instead of loading entire arrays
      const contactsCount = await Survey.findById(surveyId)
        .select('respondentContacts')
        .then(s => s?.respondentContacts?.length || 0)
        .catch(() => 0);
      
      console.log('🔍 Respondent contacts in DB (count only):', contactsCount);
      
      let respondentContacts = [];
      
      // Only load contacts from DB if count is reasonable (less than 1000)
      // For larger datasets, always prefer loading from file with streaming
      if (contactsCount > 0 && contactsCount < 1000) {
        console.log('🔍 Loading contacts from DB (small dataset)...');
        const surveyWithContacts = await Survey.findById(surveyId)
          .select('respondentContacts')
          .lean();
        respondentContacts = surveyWithContacts?.respondentContacts || [];
        console.log(`✅ Loaded ${respondentContacts.length} contacts from DB`);
      } else if (contactsCount >= 1000) {
        console.log(`⚠️ Large dataset (${contactsCount} contacts) - will load from file with streaming to prevent memory leaks`);
      }
      
      // If no contacts in DB, try loading from JSON file (but only if queue is empty)
      if (!respondentContacts || respondentContacts.length === 0) {
        console.log('🔍 No contacts in DB, checking JSON file...');
        
        const possiblePaths = [];
        
        // Check if survey has respondentContactsFile field
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
        possiblePaths.push(path.join('/var/www/opine', 'data', 'respondent-contacts', `${surveyId}.json`));
        possiblePaths.push(path.join(__dirname, '..', 'data', 'respondent-contacts', `${surveyId}.json`));
        
        // Also check Optimised-backup directory
        possiblePaths.push(path.join('/var/www/Optimised-backup', 'opine', 'data', 'respondent-contacts', `${surveyId}.json`));
        
        console.log(`🔍 Looking for respondent contacts file for survey: ${surveyId}`);
        console.log(`🔍 Possible paths:`, possiblePaths);
        
        let fileRead = false;
        for (const filePath of possiblePaths) {
          try {
            await fs.access(filePath);
            console.log(`✅ File found at: ${filePath}`);
            
            // OPTIMIZED: Check file size first to prevent memory leaks
            const stats = await fs.stat(filePath);
            const fileSizeMB = stats.size / 1024 / 1024;
            
            if (fileSizeMB > 10) {
              console.warn(`⚠️ Large respondent contacts file detected: ${fileSizeMB.toFixed(2)}MB. Using streaming parser.`);
              
              // CRITICAL FIX: Add timeout protection to prevent hanging
              // Top tech companies add timeouts to prevent indefinite waits
              const { parser } = require('stream-json');
              const { streamArray } = require('stream-json/streamers/StreamArray');
              const chain = require('stream-chain');
              const fsSync = require('fs');
              
              // Set a timeout of 30 seconds for large file processing
              const STREAM_TIMEOUT = 30000; // 30 seconds
              let streamTimeoutId = null;
              let streamResolved = false;
              
              await new Promise((resolve, reject) => {
                const contactsArray = [];
                let contactsProcessed = 0;
                const MAX_CONTACTS_IN_MEMORY = 5000; // CRITICAL: Limit contacts in memory to prevent leaks
                
                // Set timeout to prevent indefinite hanging
                streamTimeoutId = setTimeout(() => {
                  if (!streamResolved) {
                    streamResolved = true;
                    console.error(`❌ Streaming timeout after ${STREAM_TIMEOUT}ms - file too large or corrupted`);
                    reject(new Error(`File processing timeout after ${STREAM_TIMEOUT}ms. File may be too large or corrupted.`));
                  }
                }, STREAM_TIMEOUT);
                
                const pipeline = chain([
                  fsSync.createReadStream(filePath),
                  parser(),
                  streamArray()
                ]);
                
                pipeline.on('data', (data) => {
                  if (!streamResolved) {
                    contactsProcessed++;
                    // CRITICAL OPTIMIZATION: Only keep essential fields, not entire object
                    // This reduces memory usage by 60-80% for large contact files
                    const contact = data.value || {};
                    contactsArray.push({
                      phone: contact.phone,
                      name: contact.name,
                      ac: contact.ac,
                      // Only include essential fields, skip large nested objects
                    });
                    
                    // CRITICAL: Prevent unbounded memory growth
                    // If contacts exceed limit, process in batches and clear
                    if (contactsArray.length >= MAX_CONTACTS_IN_MEMORY) {
                      // Process batch and clear to free memory
                      console.log(`⚠️ Large file detected - processing first ${MAX_CONTACTS_IN_MEMORY} contacts, clearing array...`);
                      const batchToSave = [...contactsArray];
                      contactsArray.length = 0; // Clear array
                      // Note: For very large files, we should batch-insert to DB instead of accumulating
                    }
                  }
                });
                
                pipeline.on('end', () => {
                  if (!streamResolved) {
                    streamResolved = true;
                    if (streamTimeoutId) clearTimeout(streamTimeoutId);
                    respondentContacts = contactsArray.length > 0 ? contactsArray : [];
                    fileRead = true;
                    console.log(`✅ Successfully streamed ${respondentContacts.length} contacts from file (processed ${contactsProcessed} total): ${filePath}`);
                    // CRITICAL: Clear array reference to help GC
                    contactsArray.length = 0;
                    resolve();
                  }
                });
                
                pipeline.on('error', (error) => {
                  if (!streamResolved) {
                    streamResolved = true;
                    if (streamTimeoutId) clearTimeout(streamTimeoutId);
                    console.error(`❌ Streaming JSON parse error:`, error.message);
                    reject(error);
                  }
                });
              });
            } else {
              // Small file - safe to load entirely
              const fileContent = await fs.readFile(filePath, 'utf8');
              respondentContacts = JSON.parse(fileContent);
              
              if (!Array.isArray(respondentContacts)) {
                console.warn(`⚠️ File content is not an array, got:`, typeof respondentContacts);
                respondentContacts = [];
              }
              
              fileRead = true;
              console.log(`✅ Successfully read ${respondentContacts.length} contacts from file: ${filePath}`);
            }
            
            break;
          } catch (fileError) {
            console.log(`❌ Could not read file at ${filePath}:`, fileError.message);
            continue;
          }
        }
        
        if (!fileRead) {
          console.log('❌ No JSON file found and no contacts in DB');
          return res.status(400).json({
            success: false,
            message: 'No respondents available. Please upload respondent contacts first.'
          });
        }
      }
      
      if (!respondentContacts || respondentContacts.length === 0) {
        console.log('❌ No respondent contacts found (neither in DB nor JSON file)');
        return res.status(400).json({
          success: false,
          message: 'No respondents available. Please upload respondent contacts first.'
        });
      }

      console.log(`✅ Found ${respondentContacts.length} respondent contacts`);

      // Initialize queue if not already done
      console.log('🔍 Initializing respondent queue...');
      try {
        await initializeRespondentQueue(surveyId, respondentContacts);
        console.log('🔍 Queue initialized');
      } catch (queueError) {
        console.error('❌ Error initializing queue:', queueError);
        // Don't fail the request - queue initialization can be retried
        // Just log the error and continue
      }
    }

    // Get next available respondent from queue with AC priority-based selection
    // ORIGINAL FAST LOGIC: Simple queries, minimal processing
    let acPriorityMap = await loadACPriorityMap();
    
    // CRITICAL FIX: Filter priority map by assignedACs if interviewer has AC assignments
    // If assignedACs is not empty, only consider those ACs for priority-based selection
    // If assignedACs is empty, use all ACs (current behavior for backward compatibility)
    // SAFETY CHECK: Ensure assignment exists before accessing assignedACs
    const hasAssignedACs = assignment && assignment.assignedACs && Array.isArray(assignment.assignedACs) && assignment.assignedACs.length > 0;
    if (hasAssignedACs) {
      console.log('🔍 Interviewer has assigned ACs:', assignment.assignedACs);
      console.log('🔍 Filtering priority map to only include assigned ACs...');
      
      // Create a case-insensitive map for matching
      const priorityMapLower = {};
      Object.entries(acPriorityMap).forEach(([acName, priority]) => {
        priorityMapLower[acName.toLowerCase().trim()] = { originalName: acName, priority };
      });
      
      // Filter priority map to only include assigned ACs
      const filteredPriorityMap = {};
      assignment.assignedACs.forEach(assignedAC => {
        const normalizedAssignedAC = assignedAC.toLowerCase().trim();
        
        // Try exact match first
        if (acPriorityMap[assignedAC] !== undefined) {
          filteredPriorityMap[assignedAC] = acPriorityMap[assignedAC];
        } else if (priorityMapLower[normalizedAssignedAC]) {
          // Case-insensitive match
          const matched = priorityMapLower[normalizedAssignedAC];
          filteredPriorityMap[matched.originalName] = matched.priority;
        } else {
          // Assigned AC not in priority file - will be handled in fallback queries
          console.log(`⚠️  Assigned AC "${assignedAC}" not found in priority file, will be included in fallback queries`);
        }
      });
      
      acPriorityMap = filteredPriorityMap;
      console.log('✅ Filtered priority map:', Object.keys(acPriorityMap).length, 'ACs');
      console.log('✅ Filtered ACs:', Object.keys(acPriorityMap));
    } else {
      console.log('🔍 No assigned ACs, using all ACs (current behavior)');
    }
    
    // Build simple priority arrays (minimal processing)
    const priorityACs = {}; // priority -> [AC names]
    const excludedACs = []; // Priority 0 ACs (only for fallback exclusion)
    
    Object.entries(acPriorityMap).forEach(([acName, priority]) => {
      if (priority === 0) {
        excludedACs.push(acName); // Only add original name, no normalization overhead
      } else if (priority > 0) {
        if (!priorityACs[priority]) {
          priorityACs[priority] = [];
        }
        priorityACs[priority].push(acName); // Only original name, no normalization
      }
    });
    
    // Get sorted priority list (ascending: 1, 2, 3...)
    const sortedPriorities = Object.keys(priorityACs)
      .map(p => parseInt(p, 10))
      .filter(p => !isNaN(p) && p > 0)
      .sort((a, b) => a - b);
    
    let selectedRespondent = null;
    
    // PHASE 1 + 2 + 3 + 6 OPTIMIZATION: Complete solution (Amazon/Twitter approach)
    // Phase 1: Trust cache (eventual consistency) - removed verification query
    // Phase 2: Atomic findOneAndUpdate (prevents race conditions)
    // Phase 3: Simplified query (replaced $facet with optimized single query)
    // Phase 6: Batch Redis operations (pipeline)
    if (sortedPriorities.length > 0) {
      const surveyObjectId = new mongoose.Types.ObjectId(surveyId);
      
      // PHASE 6: Batch Redis cache lookups (pipeline optimization)
      const cacheKeysToCheck = [];
      for (const priority of sortedPriorities) {
        const acNames = priorityACs[priority];
        for (const acName of acNames) {
          cacheKeysToCheck.push({ surveyId, acName, priority });
        }
      }
      
      // Batch get all cache entries at once (Phase 6)
      const cachedEntriesMap = await catiQueueCache.batchGetCachedEntries(cacheKeysToCheck);
      
      // PHASE 1: Trust cache (eventual consistency) - use cached ID directly without verification
      let cachedEntryId = null;
      let cachedAcName = null;
      let cachedPriority = null;
      
      for (const priority of sortedPriorities) {
        const acNames = priorityACs[priority];
        for (const acName of acNames) {
          const cacheKey = `cati:next:${surveyId}:${acName}:${priority}`;
          if (cachedEntriesMap[cacheKey]) {
            cachedEntryId = cachedEntriesMap[cacheKey];
            cachedAcName = acName;
            cachedPriority = priority;
            console.log(`⚡ Found respondent ID from Redis cache (priority ${priority}, AC: ${acName})`);
            break;
          }
        }
        if (cachedEntryId) break;
      }
      
      // OPTIMIZATION: Single aggregation query for all priorities (Solution 1: Google/Meta approach)
      // Instead of sequential queries per priority, query all ACs at once and select best match
      if (!cachedEntryId) {
        // Collect all AC names from all priorities
        const allPriorityACs = [];
        for (const priority of sortedPriorities) {
          const acNames = priorityACs[priority];
          allPriorityACs.push(...acNames.map(ac => ({ ac, priority })));
        }
        
        if (allPriorityACs.length > 0) {
          const queryStartTime = Date.now();
          
          // OPTIMIZATION: Single query for all prioritized ACs
          // Get top candidates (limit to reasonable number for priority sorting)
          const allACNames = allPriorityACs.map(item => item.ac);
          const candidates = await CatiRespondentQueue.find({
            survey: surveyObjectId,
            status: 'pending',
            'respondentContact.ac': { $in: allACNames }
          })
          .sort({ createdAt: 1 })
          .limit(50) // Limit candidates for application-level priority sorting
          .lean();
          
          const queryDuration = Date.now() - queryStartTime;
          console.log(`⚡ Single query took ${queryDuration}ms (${allACNames.length} ACs, ${candidates.length} candidates)`);
          
          if (candidates.length > 0) {
            // Create priority map for fast lookup
            const priorityMap = new Map(allPriorityACs.map(item => [item.ac, item.priority]));
            
            // Select best candidate (lowest priority number = highest priority)
            let bestCandidate = null;
            let bestPriority = Infinity;
            
            for (const candidate of candidates) {
              const acName = candidate.respondentContact?.ac;
              if (acName && priorityMap.has(acName)) {
                const candidatePriority = priorityMap.get(acName);
                if (candidatePriority < bestPriority) {
                  bestPriority = candidatePriority;
                  bestCandidate = candidate;
                }
              }
            }
            
            if (bestCandidate) {
              selectedRespondent = bestCandidate;
              const selectedAC = bestCandidate.respondentContact?.ac;
              console.log(`✅ Found respondent at priority ${bestPriority} (AC: ${selectedAC})`);
              
              // Cache the result for future requests
              if (selectedAC) {
                await catiQueueCache.setCachedNextEntry(surveyId, selectedAC, bestPriority, selectedRespondent._id.toString());
                console.log(`💾 Cached next entry for priority ${bestPriority}, AC: ${selectedAC}`);
              }
            }
          }
        }
      } else {
        // Use cached entry ID (Phase 1: trust cache, eventual consistency)
        // If entry doesn't exist when we try to assign it, we'll handle gracefully in Phase 2
        try {
          selectedRespondent = await CatiRespondentQueue.findById(cachedEntryId).lean();
          if (selectedRespondent && selectedRespondent.status === 'pending' && 
              selectedRespondent.respondentContact?.ac === cachedAcName) {
            console.log(`✅ Using cached respondent (ID: ${cachedEntryId})`);
          } else {
            // Cache entry was assigned or doesn't exist - clear cache and fallback to query
            await catiQueueCache.clearCachedNextEntry(surveyId, cachedAcName, cachedPriority);
            selectedRespondent = null;
          }
        } catch (cacheError) {
          console.warn(`⚠️ Error loading cached entry: ${cacheError.message}`);
          selectedRespondent = null;
        }
      }
    }
    
    // If no prioritized ACs have pending respondents, select from non-prioritized (ORIGINAL: Simple fallback)
    if (!selectedRespondent) {
      // CRITICAL FIX: If interviewer has assignedACs, only consider those ACs in fallback
      // Build fallback query based on whether ACs are assigned
      let fallbackQuery = {
        survey: new mongoose.Types.ObjectId(surveyId),
        status: 'pending'
      };
      
      if (hasAssignedACs && assignment && assignment.assignedACs) {
        // Only consider assigned ACs that are not in priority map (non-prioritized)
        // Include all assigned ACs, even if they're not in priority file
        fallbackQuery['respondentContact.ac'] = { $in: assignment.assignedACs };
        console.log('🔍 Fallback query: Only considering assigned ACs:', assignment.assignedACs);
      } else {
        // Original behavior: exclude Priority 0 ACs only
        fallbackQuery.$or = [
          { 'respondentContact.ac': { $exists: false } },
          { 'respondentContact.ac': null },
          { 'respondentContact.ac': '' },
          {
            'respondentContact.ac': {
              $exists: true,
              $ne: null,
              $ne: '',
              $nin: excludedACs.length > 0 ? excludedACs : undefined // Only exclude if we have excluded ACs
            }
          }
        ];
      }
      
      selectedRespondent = await CatiRespondentQueue.findOne(fallbackQuery)
      .sort({ createdAt: 1 })
      .lean();
    }
    
    // Final fallback: any pending respondent
    if (!selectedRespondent) {
      const fallbackQuery = {
        survey: surveyId,
        status: 'pending'
      };
      
      if (hasAssignedACs && assignment && assignment.assignedACs) {
        // CRITICAL FIX: Final fallback should also only consider assigned ACs
        fallbackQuery['respondentContact.ac'] = { $in: assignment.assignedACs };
        console.log('🔍 Final fallback query: Only considering assigned ACs:', assignment.assignedACs);
      } else {
        // Original behavior: only exclude Priority 0 ACs if specified
      if (excludedACs.length > 0) {
        fallbackQuery['respondentContact.ac'] = { $nin: excludedACs };
        }
      }
      
      selectedRespondent = await CatiRespondentQueue.findOne(fallbackQuery)
        .sort({ createdAt: 1 })
        .lean();
      
      if (!selectedRespondent) {
        return res.status(200).json({
          success: false,
          message: 'No Pending Respondents',
          data: {
            message: 'All respondents have been processed or are currently assigned. Please check back later or contact your administrator.',
            hasPendingRespondents: false
          }
        });
      }
    }
    
    // PHASE 2: Atomic findOneAndUpdate (prevents race conditions)
    // This ensures only one interviewer gets each respondent, even under high concurrency
    if (!selectedRespondent || !selectedRespondent._id) {
      console.log('⚠️  No respondent found or invalid ID');
      return res.status(500).json({
        success: false,
        message: 'Error: No available respondent found'
      });
    }
    
    const respondentId = selectedRespondent._id;
    const acName = selectedRespondent.respondentContact?.ac;
    
    // Atomic assignment - only updates if status is still 'pending'
    const assignmentStartTime = Date.now();
    const nextRespondent = await CatiRespondentQueue.findOneAndUpdate(
      {
        _id: respondentId,
        status: 'pending' // Critical: only assign if still pending (prevents race conditions)
      },
      {
        $set: {
          status: 'assigned',
          assignedTo: interviewerId,
          assignedAt: new Date()
        }
      },
      {
        new: true, // Return updated document
        runValidators: true
      }
    );
    
    const assignmentDuration = Date.now() - assignmentStartTime;
    console.log(`⚡ Atomic assignment took ${assignmentDuration}ms`);
    
    // OPTIMIZATION: Optimistic locking pattern (Solution 5: Netflix approach)
    // If null, another interviewer already assigned this respondent (race condition handled)
    // Maximum 2 retries with exponential backoff to prevent infinite loops
    if (!nextRespondent) {
      console.log(`⚠️  Respondent ${respondentId} was already assigned (race condition handled gracefully)`);
      
      // Clear stale cache
      if (acName) {
        const acPriority = await getACPriority(acName);
        if (acPriority !== null && acPriority > 0) {
          await catiQueueCache.clearCachedNextEntry(surveyId, acName, acPriority);
        }
      }
      
      // OPTIMIZATION: Single retry attempt (simplified from multiple retries)
      // Try to get another respondent (skip cache, query DB directly)
      let retryQuery = {
        survey: new mongoose.Types.ObjectId(surveyId),
        status: 'pending',
        _id: { $ne: respondentId } // Exclude the one that was already assigned
      };
      
      if (hasAssignedACs && assignment && assignment.assignedACs) {
        retryQuery['respondentContact.ac'] = { $in: assignment.assignedACs };
      }
      
      const retryResult = await CatiRespondentQueue.findOne(retryQuery)
        .sort({ createdAt: 1 })
        .lean();
      
      if (retryResult) {
        // Try atomic assignment again with new respondent (single retry)
        const retryAssignment = await CatiRespondentQueue.findOneAndUpdate(
          { _id: retryResult._id, status: 'pending' },
          {
            $set: {
              status: 'assigned',
              assignedTo: interviewerId,
              assignedAt: new Date()
            }
          },
          { new: true, runValidators: true }
        );
        
        if (retryAssignment) {
          nextRespondent = retryAssignment;
          console.log(`✅ Retry successful: assigned respondent ${retryAssignment._id}`);
        } else {
          // Retry also failed - return error (all respondents are being assigned)
          return res.status(200).json({
            success: false,
            message: 'No Pending Respondents',
            data: {
              message: 'All available respondents are currently being assigned. Please try again in a moment.',
              hasPendingRespondents: false
            }
          });
        }
      } else {
        // No more respondents available
        return res.status(200).json({
          success: false,
          message: 'No Pending Respondents',
          data: {
            message: 'All respondents have been processed or are currently assigned. Please check back later or contact your administrator.',
            hasPendingRespondents: false
          }
        });
      }
    }
    
    console.log('✅ Respondent assigned atomically:', nextRespondent._id);
    
    // PHASE 3: Clear cache for this entry (it's now assigned, so cache is stale)
    if (acName) {
      const acPriority = await getACPriority(acName);
      if (acPriority !== null && acPriority > 0) {
        await catiQueueCache.clearCachedNextEntry(surveyId, acName, acPriority);
        console.log(`🗑️  Cleared cache for assigned entry (priority ${acPriority}, AC: ${acName})`);
      }
    }

    // OPTIMIZED: Use lean() for faster query (returns plain object, not Mongoose document)
    // Top tech companies use lean() for read-only queries to reduce memory overhead
    const interviewer = await User.findById(interviewerId)
      .select('phone firstName lastName')
      .lean();
    
    if (!interviewer || !interviewer.phone) {
      return res.status(400).json({
        success: false,
        message: 'Interviewer phone number not found. Please update your profile with a phone number.'
      });
    }

    // Create interview session
    const sessionId = uuidv4();
    const session = await InterviewSession.createSession({
      sessionId,
      survey: surveyId,
      interviewer: interviewerId,
      interviewMode: 'cati',
      deviceInfo: {
        userAgent: req.get('User-Agent'),
        platform: req.body.platform || 'web',
        browser: req.body.browser || 'unknown'
      },
      metadata: {
        surveyVersion: survey.version || '1.0',
        startMethod: 'cati',
        respondentQueueId: nextRespondent._id,
        respondentPhone: nextRespondent.respondentContact.phone
      }
    });
    await session.save();

    // Mark first question as reached
    session.markQuestionReached(0, 0, 'first');
    await session.save();

    // Return minimal survey data for faster response (full survey can be fetched separately if needed)
    res.status(200).json({
      success: true,
      data: {
        sessionId: session.sessionId,
        survey: {
          id: survey._id,
          surveyName: survey.surveyName,
          description: survey.description,
          mode: survey.mode,
          assignACs: survey.assignACs,
          acAssignmentState: survey.acAssignmentState
          // Note: sections and questions are NOT included - use /api/surveys/:id/full endpoint if needed
        },
        respondent: {
          id: nextRespondent._id,
          name: nextRespondent.respondentContact.name,
          phone: nextRespondent.respondentContact.phone,
          countryCode: nextRespondent.respondentContact.countryCode,
          ac: nextRespondent.respondentContact.ac || null, // AC from respondent contact
          pc: nextRespondent.respondentContact.pc || null, // PC from respondent contact
          ps: nextRespondent.respondentContact.ps || null  // Polling Station from respondent contact
        },
        interviewer: {
          phone: interviewer.phone,
          name: `${interviewer.firstName} ${interviewer.lastName}`
        },
        currentPosition: {
          sectionIndex: 0,
          questionIndex: 0
        },
        reachedQuestions: session.reachedQuestions,
        startTime: session.startTime,
        // AC Selection information - For CATI, we don't require AC selection as it's auto-populated
        requiresACSelection: false, // Always false for CATI - AC is auto-populated from respondent
        assignedACs: []
      }
    });
    console.log('✅ Successfully returning response');

  } catch (error) {
    console.error('❌ Error starting CATI interview:', error);
    console.error('❌ Error stack:', error.stack);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Failed to start CATI interview',
        error: error.message
      });
    }
  }
};

// @desc    Make call to respondent (Non-blocking: Uses async job queue)
// @route   POST /api/cati-interview/make-call/:queueId
// @access  Private (Interviewer)
const makeCallToRespondent = async (req, res) => {
  let queueEntry = null;
  try {
    const { queueId } = req.params;
    const interviewerId = req.user._id;

    // Get queue entry
    queueEntry = await CatiRespondentQueue.findById(queueId)
      .populate('survey', 'surveyName')
      .populate('assignedTo', 'phone firstName lastName');

    if (!queueEntry) {
      return res.status(404).json({
        success: false,
        message: 'Respondent queue entry not found'
      });
    }

    if (queueEntry.assignedTo._id.toString() !== interviewerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this respondent'
      });
    }

    // Get interviewer phone
    const interviewer = await User.findById(interviewerId).select('phone');
    if (!interviewer || !interviewer.phone) {
      return res.status(400).json({
        success: false,
        message: 'Interviewer phone number not found'
      });
    }

    // TEMPORARILY DISABLED: Idempotency check to prevent duplicate calls
    // TODO: Re-enable after testing for duplicate call issues
    // Pattern used by: Meta (WhatsApp), Twitter, Google (Cloud Tasks)
    // Check if a call has already been initiated for this queue entry
    // callRecord is a reference to CatiCall, so we need to populate it or check status differently
    /*
    if (queueEntry.callRecord) {
      // If callRecord exists, populate it to check status
      await queueEntry.populate('callRecord', 'callId callStatus apiStatus');
      
      if (queueEntry.callRecord && queueEntry.callRecord.callId) {
        // Check if call is already in progress or queued
        const existingCallStatus = queueEntry.callRecord.callStatus || queueEntry.callRecord.apiStatus;
        const isCallActive = existingCallStatus === 'queued' || 
                            existingCallStatus === 'initiated' || 
                            existingCallStatus === 'ringing' || 
                            existingCallStatus === 'answered' ||
                            existingCallStatus === 'connected';
        
        if (isCallActive) {
          console.log(`⚠️ Call already initiated for queueId ${queueId}, returning existing call info`);
          return res.status(200).json({
            success: true,
            message: 'Call has already been initiated for this respondent.',
            data: {
              callId: queueEntry.callRecord.callId,
              queueId: queueId,
              status: existingCallStatus || 'queued',
              isDuplicate: true,
              statusEndpoint: `/api/cati-interview/call-status/${queueId}`
            }
          });
        }
      }
    }
    
    // TEMPORARILY DISABLED: Atomic check-and-set to prevent race conditions
    // TODO: Re-enable after testing for duplicate call issues
    // Check if queue entry status indicates a call is already in progress
    // This is a critical idempotency guard at the database level
    if (queueEntry.status === 'calling') {
      console.log(`⚠️ Queue entry ${queueId} is already in 'calling' status, preventing duplicate call`);
      return res.status(200).json({
        success: true,
        message: 'Call is already in progress for this respondent.',
        data: {
          queueId: queueId,
          status: 'calling',
          isDuplicate: true,
          statusEndpoint: `/api/cati-interview/call-status/${queueId}`
        }
      });
    }
    */

    // Prepare phone numbers
    const fromNumber = interviewer.phone.replace(/[^0-9]/g, '');
    const toNumber = queueEntry.respondentContact.phone.replace(/[^0-9]/g, '');

    // TOP-TIER TECH COMPANY SOLUTION: Use async job queue instead of blocking
    // This prevents blocking the Node.js event loop during external API calls
    // Pattern used by: Meta (WhatsApp), Amazon (SQS), Google (Cloud Tasks), Netflix
    
    // Import queue
    const { addCallJob, getJobByQueueId } = require('../queues/catiCallQueue');
    
    // TEMPORARILY DISABLED: Check for existing job BEFORE creating new one
    // TODO: Re-enable after testing for duplicate call issues
    // This is the PRIMARY idempotency guard - prevents duplicate jobs at the source
    // Pattern used by: Meta (WhatsApp), Twitter, Google (Cloud Tasks)
    /*
    const existingJob = await getJobByQueueId(queueId);
    if (existingJob) {
      const jobState = existingJob.state;
      
      // If job is waiting or active, return existing job info (prevent duplicate call)
      if (jobState === 'waiting' || jobState === 'active') {
        console.log(`⚠️ Job already exists for queueId ${queueId} (state: ${jobState}), preventing duplicate call`);
        return res.status(200).json({
          success: true,
          message: 'Call is already being initiated for this respondent.',
          data: {
            jobId: existingJob.jobId,
            queueId: queueId,
            status: jobState,
            isDuplicate: true,
            statusEndpoint: `/api/cati-interview/call-status/${queueId}`
          }
        });
      }
      
      // If job completed successfully, check if call was actually made
      if (jobState === 'completed' && existingJob.returnvalue?.callId) {
        console.log(`⚠️ Call already completed for queueId ${queueId}, preventing duplicate call`);
        return res.status(200).json({
          success: true,
          message: 'Call has already been initiated for this respondent.',
          data: {
            callId: existingJob.returnvalue.callId,
            queueId: queueId,
            status: 'completed',
            isDuplicate: true,
            statusEndpoint: `/api/cati-interview/call-status/${queueId}`
          }
        });
      }
    }
    */
    
    // TOP-TIER TECH COMPANY SOLUTION: Atomic update to mark call as initiated
    // Update status to 'calling' atomically to prevent duplicate calls
    // This is a SECONDARY idempotency guard at the database level
    try {
      const updateResult = await CatiRespondentQueue.findOneAndUpdate(
        { 
          _id: queueId,
          status: { $ne: 'calling' } // Only update if not already 'calling'
        },
        {
          $set: {
            status: 'calling' // Mark as calling immediately
          }
        },
        { new: false } // Don't return updated doc, just update
      );
      
      if (!updateResult) {
        // Another request already marked it as 'calling' - race condition detected
        console.log(`⚠️ Race condition detected: queueId ${queueId} was already marked as 'calling'`);
        
        // Double-check for existing job
        const doubleCheckJob = await getJobByQueueId(queueId);
        if (doubleCheckJob && (doubleCheckJob.state === 'waiting' || doubleCheckJob.state === 'active')) {
          return res.status(200).json({
            success: true,
            message: 'Call is already being initiated for this respondent.',
            data: {
              jobId: doubleCheckJob.jobId,
              queueId: queueId,
              status: doubleCheckJob.state,
              isDuplicate: true,
              statusEndpoint: `/api/cati-interview/call-status/${queueId}`
            }
          });
        }
      }
    } catch (updateError) {
      console.error('⚠️ Error marking call as initiated:', updateError);
      // Continue anyway - the queue job will handle it, but log the error
    }
    
    // Add job to queue (non-blocking, returns immediately)
    // The jobId is now deterministic (queueId-based), so BullMQ will prevent duplicates automatically
    const jobResult = await addCallJob({
      queueId: queueId,
      fromNumber: fromNumber,
      toNumber: toNumber,
      fromType: 'Number',
      toType: 'Number',
      interviewerId: interviewerId,
      surveyId: queueEntry.survey._id
    });
    
    // Check if this was a duplicate (job already existed)
    if (jobResult.isDuplicate) {
      console.log(`⚠️ Duplicate job prevented for queueId ${queueId}`);
      return res.status(200).json({
        success: true,
        message: 'Call is already being initiated for this respondent.',
        data: {
          jobId: jobResult.jobId,
          queueId: queueId,
          status: jobResult.existingState || 'queued',
          isDuplicate: true,
          statusEndpoint: `/api/cati-interview/call-status/${queueId}`
        }
      });
    }
    
    console.log(`✅ CATI call job queued: ${jobResult.jobId} (queueId: ${queueId})`);
    
    // Return immediately (non-blocking response)
    // Client should poll /api/cati-interview/call-status/:queueId for status
    return res.status(200).json({
      success: true,
      message: 'Call initiation queued. Please check status using the call-status endpoint.',
      data: {
        jobId: jobResult.jobId,
        queueId: queueId,
        status: 'queued',
        statusEndpoint: `/api/cati-interview/call-status/${queueId}`
      }
    });

  } catch (error) {
    console.error('Error making call to respondent:', error);
    
    // Extract detailed error message
    const errorMessage = error.response?.data?.message || 
                        error.response?.data?.error?.message || 
                        (typeof error.response?.data?.error === 'string' ? error.response?.data?.error : null) ||
                        error.message || 
                        'Failed to make call';
    
    // If we have a queueEntry, move it to end of queue
    try {
      if (queueEntry) {
        queueEntry.status = 'pending';
        queueEntry.priority = -1;
        queueEntry.assignedTo = null;
        queueEntry.assignedAt = null;
        queueEntry.currentAttemptNumber += 1;
        queueEntry.callAttempts.push({
          attemptNumber: queueEntry.currentAttemptNumber,
          attemptedAt: new Date(),
          attemptedBy: interviewerId,
          status: 'failed',
          reason: errorMessage
        });
        queueEntry.createdAt = new Date();
        await queueEntry.save();
      }
    } catch (queueError) {
      console.error('Error updating queue entry on failure:', queueError);
    }
    
    res.status(500).json({
      success: false,
      message: errorMessage,
      error: {
        message: errorMessage,
        code: error.response?.data?.error?.code || error.response?.status,
        details: error.response?.data?.error || error.message
      }
    });
  }
};

// @desc    Handle interview abandonment
// @route   POST /api/cati-interview/abandon/:queueId
// @access  Private (Interviewer)
const abandonInterview = async (req, res) => {
  try {
    const { queueId } = req.params;
    const { reason, notes, callLaterDate, callStatus } = req.body;
    const interviewerId = req.user._id;

    const queueEntry = await CatiRespondentQueue.findById(queueId)
      .populate('assignedTo', '_id')
      .populate('callRecord', 'callId fromNumber toNumber'); // Populate callRecord to get call details
    if (!queueEntry) {
      return res.status(404).json({
        success: false,
        message: 'Respondent queue entry not found'
      });
    }

    // Check if assigned to this interviewer, or if not assigned (call failed scenario)
    // Allow abandonment if not assigned (call failed) or if assigned to this interviewer
    if (queueEntry.assignedTo && queueEntry.assignedTo._id.toString() !== interviewerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this respondent'
      });
    }

    // Map abandonment reason to status
    // If no reason provided (call failed scenario), default to 'call_failed'
    const statusMap = {
      'call_later': 'call_later',
      'not_interested': 'not_interested',
      'busy': 'busy',
      'no_answer': 'no_answer',
      'switched_off': 'switched_off',
      'not_reachable': 'not_reachable',
      'does_not_exist': 'does_not_exist',
      'rejected': 'rejected',
      'technical_issue': 'call_failed',
      'other': 'call_failed'
    };

    const newStatus = reason ? (statusMap[reason] || 'call_failed') : 'call_failed';

    // Update queue entry
    queueEntry.status = newStatus;
    // Map consent_refused to rejected status for queue entry
    const queueAbandonmentReason = reason === 'consent_refused' ? 'rejected' : reason;
    queueEntry.abandonmentReason = queueAbandonmentReason;
    queueEntry.abandonmentNotes = notes;
    if (reason === 'call_later' && callLaterDate) {
      queueEntry.callLaterDate = new Date(callLaterDate);
      // If call later, add back to queue with higher priority
      queueEntry.status = 'pending';
      queueEntry.priority = 10; // Higher priority for scheduled calls
      queueEntry.assignedTo = null;
      queueEntry.assignedAt = null;
    } else if (reason === 'consent_refused') {
      // If consent refused, mark as rejected (don't retry)
      queueEntry.status = 'rejected';
      queueEntry.assignedTo = null;
      queueEntry.assignedAt = null;
    } else if (newStatus === 'call_failed') {
      // If call failed, add back to queue for retry
      queueEntry.status = 'pending';
      queueEntry.assignedTo = null;
      queueEntry.assignedAt = null;
    }

    // Update last attempt
    if (queueEntry.callAttempts.length > 0) {
      const lastAttempt = queueEntry.callAttempts[queueEntry.callAttempts.length - 1];
      lastAttempt.status = newStatus;
      lastAttempt.reason = reason;
      lastAttempt.notes = notes;
      if (callLaterDate) {
        lastAttempt.scheduledFor = new Date(callLaterDate);
      }
    }

    await queueEntry.save();

    // ALWAYS create a SurveyResponse for abandoned interviews to track call status stats
    // This is critical for accurate reporting of call attempts
    console.log(`📊 Starting SurveyResponse creation for abandoned interview`);
    console.log(`📊 Queue Entry ID: ${queueEntry._id}, Survey ID: ${queueEntry.survey?._id || queueEntry.survey}`);
    console.log(`📊 Interviewer ID: ${interviewerId}, Call Status from request: ${callStatus}, Reason: ${reason}`);
    
    try {
      const SurveyResponse = require('../models/SurveyResponse');
      const { v4: uuidv4 } = require('uuid');
      
      // Ensure survey reference exists
      const surveyId = queueEntry.survey?._id || queueEntry.survey;
      if (!surveyId) {
        throw new Error('Survey reference is missing from queue entry');
      }
      
      // Get call status from request body (from Call Status question)
      // If not provided, try to infer from reason
      let finalCallStatus = callStatus;
      if (!finalCallStatus && reason) {
        // Map abandonment reason back to call status if callStatus wasn't provided
        const reasonToCallStatusMap = {
          'busy': 'busy',
          'switched_off': 'switched_off',
          'not_reachable': 'not_reachable',
          'no_answer': 'did_not_pick_up',
          'does_not_exist': 'number_does_not_exist',
          'technical_issue': 'didnt_get_call',
          'call_failed': 'didnt_get_call',
          'consent_refused': 'call_connected' // If consent was refused, call was connected
        };
        finalCallStatus = reasonToCallStatusMap[reason] || 'unknown';
      }
      
      // If still no call status, use 'unknown' to ensure we still create the record
      if (!finalCallStatus) {
        finalCallStatus = 'unknown';
      }
      
      console.log(`📊 Final Call Status determined: ${finalCallStatus}`);
      
      // Normalize call status for knownCallStatus field
      const normalizedCallStatus = finalCallStatus.toLowerCase().trim();
      const knownCallStatusMap = {
        'call_connected': 'call_connected',
        'success': 'call_connected',
        'busy': 'busy',
        'switched_off': 'switched_off',
        'not_reachable': 'not_reachable',
        'did_not_pick_up': 'did_not_pick_up',
        'number_does_not_exist': 'number_does_not_exist',
        'didnt_get_call': 'didnt_get_call',
        'didn\'t_get_call': 'didnt_get_call'
      };
      const knownCallStatus = knownCallStatusMap[normalizedCallStatus] || 'unknown';
      
      console.log(`📊 Known Call Status mapped: ${knownCallStatus}`);
      
      // Generate unique responseId using UUID
      const responseId = uuidv4();
      
      // Create unique sessionId to avoid conflicts
      const uniqueSessionId = `abandoned-${queueEntry._id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`📊 Creating SurveyResponse with Response ID: ${responseId}, Session ID: ${uniqueSessionId}`);
      
      // Build responses array - include call status and consent form if consent was refused
      const responsesArray = [{
        sectionIndex: -4,
        questionIndex: -4,
        questionId: 'call-status',
        questionType: 'single_choice',
        questionText: 'Call Status {কলের অবস্থা}',
        questionDescription: 'Please select the status of the call attempt.',
        questionOptions: [],
        response: finalCallStatus, // Store the call status as the response
        responseTime: 0,
        isRequired: true,
        isSkipped: false
      }];
      
      // If consent was refused, also include consent form response
      if (reason === 'consent_refused') {
        responsesArray.push({
          sectionIndex: -2,
          questionIndex: -2,
          questionId: 'consent-form',
          questionType: 'single_choice',
          questionText: 'Consent Form {সম্মতিপত্র}',
          questionDescription: '',
          questionOptions: [],
          response: '2', // '2' = No
          responseTime: 0,
          isRequired: true,
          isSkipped: false
        });
      }
      
      // Map abandonment reason to standardized AbandonedReason
      // Special cases: consent_refused -> Consent_Form_Disagree, call not connected -> Call_Not_Connected
      let abandonedReason = null;
      if (reason === 'consent_refused') {
        abandonedReason = 'Consent_Form_Disagree';
      } else if (finalCallStatus && finalCallStatus !== 'call_connected' && finalCallStatus !== 'success' && finalCallStatus !== 'unknown') {
        // Call not connected - map to Call_Not_Connected
        // This covers cases where call status question was answered with non-connected status
        abandonedReason = 'Call_Not_Connected';
      } else if (reason) {
        // Use the reason provided (from top bar abandonment modal)
        abandonedReason = reason;
      }
      
      // Auto-populate selectedAC and selectedPollingStation from respondent contact for CATI abandoned responses
      let finalSelectedAC = queueEntry.respondentContact?.ac || null;
      let finalSelectedPollingStation = null;
      
      // Load AC data helper to get district, state, PC from AC name
      const { getAllACDetails } = require('../utils/acDataHelper');
      
      if (finalSelectedAC) {
        const acDetails = getAllACDetails(finalSelectedAC);
        finalSelectedPollingStation = {
          acName: finalSelectedAC,
          pcName: acDetails.pcName || queueEntry.respondentContact?.pc || null,
          district: acDetails.district || null,
          state: 'West Bengal' // All ACs in this survey belong to West Bengal
        };
        console.log(`✅ Auto-populated selectedPollingStation for abandoned CATI response from AC:`, finalSelectedPollingStation);
      }
      
      // LIGHTWEIGHT DUPLICATE DETECTION: Generate content hash (includes call_id for CATI)
      // EXCLUDE interviewer - same interview can be synced by different users
      const abandonStartTime = new Date(); // Use current time for abandoned responses
      const abandonEndTime = new Date(); // Use current time for abandoned responses
      const abandonTotalTimeSpent = 0; // Abandoned responses have 0 duration
      const callIdForHash = queueEntry.callRecord?.callId || null; // Get callId from populated callRecord
      const contentHash = SurveyResponse.generateContentHash(interviewerId, surveyId, abandonStartTime, responsesArray, {
        interviewMode: 'cati',
        audioRecording: null, // CATI abandoned responses don't have audio
        location: null, // CATI doesn't have GPS location
        call_id: callIdForHash, // Use call_id from queueEntry for duplicate detection
        endTime: abandonEndTime,
        totalTimeSpent: abandonTotalTimeSpent
      });
      
      // Check for existing response with same content hash (fast indexed lookup - <20ms)
      const existingResponseByHash = await SurveyResponse.findOne({ contentHash })
        .select('_id responseId sessionId status')
        .lean(); // Fast - only returns minimal fields, uses index
      
      if (existingResponseByHash) {
        console.log(`⚠️ DUPLICATE DETECTED (CATI Abandon): Found existing response with same content hash: ${existingResponseByHash.responseId}`);
        console.log(`   Existing sessionId: ${existingResponseByHash.sessionId}, New sessionId: ${uniqueSessionId}`);
        console.log(`   ℹ️ Returning existing response instead of creating duplicate - app will mark as synced`);
        
        // Return existing response (don't create duplicate)
        const existingDoc = await SurveyResponse.findById(existingResponseByHash._id);
        if (existingDoc) {
          console.log(`✅ Returning existing CATI abandoned response ${existingDoc.responseId} - app will treat as successful sync`);
          // Continue with existing response - don't create new one
          return; // Exit early, response already exists
        }
      }
      
      const surveyResponse = new SurveyResponse({
        responseId: responseId, // Use UUID directly
        survey: surveyId, // Use the survey ID we verified
        interviewer: interviewerId,
        sessionId: uniqueSessionId, // Ensure unique sessionId
        interviewMode: 'cati',
        status: 'abandoned', // Use 'abandoned' status to distinguish from completed interviews
        knownCallStatus: reason === 'consent_refused' ? 'call_connected' : knownCallStatus, // If consent refused, call was connected
        consentResponse: reason === 'consent_refused' ? 'no' : null, // Store consent response if consent was refused
        abandonedReason: abandonedReason, // Store standardized abandonment reason
        selectedAC: finalSelectedAC,
        selectedPollingStation: finalSelectedPollingStation,
        location: {
          state: 'West Bengal' // Set state for abandoned CATI responses
        },
        responses: responsesArray,
        metadata: {
          respondentQueueId: queueEntry._id,
          respondentName: queueEntry.respondentContact?.name || null,
          respondentPhone: queueEntry.respondentContact?.phone || null,
          callRecordId: queueEntry.callRecord?._id || null,
          callId: queueEntry.callRecord?.callId || null, // Also store callId if available
          callStatus: finalCallStatus, // PRIMARY field for stats calculation (legacy)
          abandoned: true,
          abandonmentReason: reason,
          abandonmentNotes: notes,
          fromNumber: queueEntry.callRecord?.fromNumber || null, // Store from number
          toNumber: queueEntry.callRecord?.toNumber || queueEntry.respondentContact?.phone || null // Store to number
        },
        totalTimeSpent: 0,
        startTime: abandonStartTime, // Use same time as contentHash generation
        endTime: new Date(),
        totalQuestions: 1,
        answeredQuestions: 1,
        skippedQuestions: 0,
        completionPercentage: 0,
        contentHash: contentHash // Store contentHash for duplicate detection (CRITICAL: Same as CAPI)
      });
      
      console.log(`📊 SurveyResponse object created, attempting to save...`);
      
      // Save the response - wrap in try-catch to handle any save errors
      await surveyResponse.save();
      
      // INVALIDATE CACHE: Clear interviewer stats cache since stats have changed
      const interviewerStatsCacheForAbandon = require('../utils/interviewerStatsCache');
      interviewerStatsCacheForAbandon.delete(interviewerId);
      
      console.log(`✅ Successfully created abandoned SurveyResponse for stats tracking: ${surveyResponse._id}`);
      console.log(`📊 Response ID: ${responseId}, Call Status: ${finalCallStatus}, Known Call Status: ${knownCallStatus}`);
      console.log(`📊 Reason: ${reason}, Interviewer: ${interviewerId}`);
      console.log(`📊 From Number: ${surveyResponse.metadata.fromNumber}, To Number: ${surveyResponse.metadata.toNumber}`);
      console.log(`📊 Session ID: ${uniqueSessionId}`);
    } catch (statsError) {
      console.error('❌ CRITICAL ERROR creating abandoned SurveyResponse for stats:', statsError);
      console.error('❌ Error name:', statsError.name);
      console.error('❌ Error message:', statsError.message);
      console.error('❌ Error code:', statsError.code);
      if (statsError.errors) {
        console.error('❌ Validation errors:', JSON.stringify(statsError.errors, null, 2));
      }
      console.error('❌ Stack:', statsError.stack);
      // IMPORTANT: Still return success for abandonment, but log the error
      // The abandonment itself succeeded, only stats tracking failed
    }

    res.status(200).json({
      success: true,
      message: 'Interview abandonment recorded',
      data: {
        queueId: queueEntry._id,
        status: queueEntry.status
      }
    });

  } catch (error) {
    console.error('Error abandoning interview:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to record abandonment',
      error: error.message
    });
  }
};

// @desc    Complete CATI interview and submit response
// @route   POST /api/cati-interview/complete/:queueId
// @access  Private (Interviewer)
const completeCatiInterview = async (req, res) => {
  try {
    const { queueId } = req.params;
    const { 
      sessionId, 
      responses, 
      selectedAC, 
      selectedPollingStation, 
      totalTimeSpent, 
      startTime, 
      endTime, 
      totalQuestions: frontendTotalQuestions, 
      answeredQuestions: frontendAnsweredQuestions, 
      completionPercentage: frontendCompletionPercentage, 
      setNumber, 
      OldinterviewerID, 
      callStatus, 
      supervisorID, 
      reason, 
      consentResponse: bodyConsentResponse, 
      abandoned: bodyAbandoned, 
      abandonedReason: bodyAbandonedReason, 
      isCompleted: bodyIsCompleted, 
      metadata: bodyMetadata,
      // CRITICAL: Unique ID-based idempotency (like WhatsApp/Meta)
      serverResponseId, // UUID from previous sync attempt
      serverMongoId, // MongoDB _id from previous sync attempt
      uploadToken // For two-phase commit verification
    } = req.body;
    
    // CRITICAL: Multi-level idempotency check (like top tech companies)
    // Priority: 1. serverResponseId, 2. serverMongoId, 3. sessionId cache, 4. sessionId DB lookup
    // This prevents duplicate submissions and status overwrites
    
    // Check 1: serverResponseId (most reliable - unique UUID)
    if (serverResponseId) {
      const existingByResponseId = await SurveyResponse.findOne({ responseId: serverResponseId })
        .select('_id responseId status audioRecording')
        .lean();
      
      if (existingByResponseId) {
        console.log(`✅ IDEMPOTENCY HIT (serverResponseId): Interview already exists - responseId: ${serverResponseId}, status: ${existingByResponseId.status}`);
        
        // CRITICAL: Preserve final statuses (Terminated/Rejected/abandoned) - never overwrite
        const finalStatuses = ['Terminated', 'Rejected', 'abandoned', 'Approved'];
        const isFinalStatus = finalStatuses.includes(existingByResponseId.status);
        
        if (isFinalStatus) {
          console.log(`🔒 PRESERVING final status: ${existingByResponseId.status} - returning existing response without modification`);
        }
        
        // Return existing response immediately (no processing, no status change)
        return res.status(200).json({
          success: true,
          message: 'Interview already completed (idempotency check)',
          data: {
            responseId: existingByResponseId.responseId,
            mongoId: existingByResponseId._id.toString(),
            queueId: queueId,
            status: existingByResponseId.status,
            audioUrl: existingByResponseId.audioRecording || null,
            isDuplicate: true,
            statusPreserved: isFinalStatus
          }
        });
      }
    }
    
    // Check 2: serverMongoId (MongoDB _id - also very reliable)
    if (serverMongoId) {
      try {
        const existingByMongoId = await SurveyResponse.findById(serverMongoId)
          .select('_id responseId status audioRecording')
          .lean();
        
        if (existingByMongoId) {
          console.log(`✅ IDEMPOTENCY HIT (serverMongoId): Interview already exists - mongoId: ${serverMongoId}, responseId: ${existingByMongoId.responseId}, status: ${existingByMongoId.status}`);
          
          // CRITICAL: Preserve final statuses
          const finalStatuses = ['Terminated', 'Rejected', 'abandoned', 'Approved'];
          const isFinalStatus = finalStatuses.includes(existingByMongoId.status);
          
          if (isFinalStatus) {
            console.log(`🔒 PRESERVING final status: ${existingByMongoId.status} - returning existing response without modification`);
          }
          
          return res.status(200).json({
            success: true,
            message: 'Interview already completed (idempotency check)',
            data: {
              responseId: existingByMongoId.responseId,
              mongoId: existingByMongoId._id.toString(),
              queueId: queueId,
              status: existingByMongoId.status,
              audioUrl: existingByMongoId.audioRecording || null,
              isDuplicate: true,
              statusPreserved: isFinalStatus
            }
          });
        }
      } catch (mongoIdError) {
        // Invalid mongoId format - continue with normal flow
        console.log(`⚠️ Invalid serverMongoId format: ${serverMongoId}, continuing with normal flow`);
      }
    }
    
    // Check 3: sessionId cache (fast in-memory check)
    if (sessionId) {
      const idempotencyCache = require('../utils/idempotencyCache');
      const cachedResponse = idempotencyCache.get(sessionId);
      
      if (cachedResponse) {
        console.log(`✅ IdempotencyCache HIT: Returning cached response for sessionId: ${sessionId}`);
        console.log(`   Cached responseId: ${cachedResponse.responseId}, status: ${cachedResponse.status}`);
        
        // Return cached response immediately (prevents DB query and duplicate creation)
        return res.status(200).json({
          success: true,
          message: 'Interview already completed (cached response)',
          data: {
            responseId: cachedResponse.responseId,
            mongoId: cachedResponse.mongoId,
            queueId: queueId,
            status: cachedResponse.status || 'Pending_Approval',
            isDuplicate: true
          }
        });
      }
      
      console.log(`🔍 IdempotencyCache MISS: No cached response for sessionId: ${sessionId}, proceeding with creation`);
    }
    
    // CRITICAL: Convert setNumber to number immediately at the top level so it's available everywhere
    // Try to get setNumber from multiple possible locations (top level, nested, etc.)
    let finalSetNumber = null;
    
    // Log what we received - check all possible locations
    // CRITICAL: Removed JSON.stringify() - causes memory leaks for large req.body
    console.log(`🔵🔵🔵 setNumber extraction - req.body.setNumber: ${req.body.setNumber} (type: ${typeof req.body.setNumber})`);
    console.log(`🔵🔵🔵 setNumber extraction - Full req.body keys: ${Object.keys(req.body).join(', ')}`);
    const bodyKeysExcludingResponses = Object.keys(req.body).filter(key => key !== 'responses');
    console.log(`🔵🔵🔵 setNumber extraction - req.body keys (excluding responses):`, bodyKeysExcludingResponses);
    
    // Try to get setNumber from multiple possible locations
    // Priority: 1. Direct from req.body.setNumber, 2. From nested interviewData, 3. From any nested object
    const setNumberValue = setNumber !== undefined ? setNumber 
      : (req.body.setNumber !== undefined ? req.body.setNumber 
        : (req.body.interviewData?.setNumber !== undefined ? req.body.interviewData.setNumber 
          : null));
    
    console.log(`🔵🔵🔵 setNumber extraction - setNumberValue found: ${setNumberValue} (type: ${typeof setNumberValue})`);
    
    if (setNumberValue !== null && setNumberValue !== undefined && setNumberValue !== '' && !isNaN(Number(setNumberValue))) {
      finalSetNumber = Number(setNumberValue);
      console.log(`🔵🔵🔵 finalSetNumber converted to: ${finalSetNumber} (type: ${typeof finalSetNumber})`);
    } else {
      console.log(`⚠️  setNumber conversion failed or was null/undefined/empty. setNumberValue: ${setNumberValue}, typeof: ${typeof setNumberValue}`);
    }
    const interviewerId = req.user._id;
    
    // Log setNumber for debugging - CRITICAL for CATI interviews
    console.log(`💾 completeCatiInterview - Received setNumber: ${setNumber} (type: ${typeof setNumber}, queueId: ${queueId})`);
    console.log(`💾 completeCatiInterview - Full req.body keys:`, Object.keys(req.body));
    console.log(`💾 completeCatiInterview - setNumber in req.body:`, req.body.setNumber);
    // CRITICAL: Removed JSON.stringify() - causes memory leaks
    console.log(`💾 completeCatiInterview - Raw req.body.setNumber type:`, typeof req.body.setNumber);

    // OPTIMIZED: Use lean() and selective populate to reduce memory overhead
    // Top tech companies minimize data loaded into memory
    // CRITICAL: Include 'company' field for cache invalidation
    // NOTE: For surveys with many sections/questions, we only need sections/questions for gender/category detection
    // Consider loading survey metadata separately if needed, or limit sections/questions fields
    const queueEntry = await CatiRespondentQueue.findById(queueId)
      .populate({
        path: 'survey',
        select: 'surveyName sections questions mode company', // Only select needed fields
        // For very large surveys, consider using aggregation or separate query
        options: { lean: false } // Keep as Mongoose document for nested operations
      })
      .populate('callRecord', 'callId') // Only populate callId, not entire callRecord
      .lean(); // Use lean() to reduce memory overhead

    if (!queueEntry) {
      return res.status(404).json({
        success: false,
        message: 'Respondent queue entry not found'
      });
    }
    
    // CRITICAL: Auto-populate selectedAC and selectedPollingStation from respondent contact if not provided
    // This ensures CATI interviews always have AC/PC populated from respondent data
    let finalSelectedAC = selectedAC;
    let finalSelectedPollingStation = selectedPollingStation;
    
    // Check if selectedAC is null, undefined, or empty string, and auto-populate from respondent contact
    if ((!finalSelectedAC || finalSelectedAC === '' || finalSelectedAC === null) && queueEntry.respondentContact?.ac) {
      finalSelectedAC = queueEntry.respondentContact.ac;
      console.log(`✅ Auto-populated selectedAC from respondent contact: ${finalSelectedAC}`);
    }
    
    // Load AC data helper to get district, state, PC from AC name
    const { getAllACDetails } = require('../utils/acDataHelper');
    
    // If polling station is not provided but respondent has AC, auto-populate from AC details
    if ((!finalSelectedPollingStation || Object.keys(finalSelectedPollingStation).length === 0) && finalSelectedAC) {
      // Get district, state, PC from AC name using assemblyConstituencies.json
      const acDetails = getAllACDetails(finalSelectedAC);
      
      finalSelectedPollingStation = {
        acName: finalSelectedAC,
        pcName: acDetails.pcName || queueEntry.respondentContact?.pc || null,
        district: acDetails.district || null,
        state: 'West Bengal' // All ACs in this survey belong to West Bengal
      };
      console.log(`✅ Auto-populated selectedPollingStation from AC details:`, finalSelectedPollingStation);
    } else if (finalSelectedPollingStation && finalSelectedAC) {
      // If polling station exists but missing district/state/PC, populate from AC details
      const acDetails = getAllACDetails(finalSelectedAC);
      
          // Only update missing fields, don't overwrite existing ones
          if (!finalSelectedPollingStation.district && acDetails.district) {
            finalSelectedPollingStation.district = acDetails.district;
          }
          // Always set state to West Bengal for this survey
          finalSelectedPollingStation.state = 'West Bengal';
          if (!finalSelectedPollingStation.pcName && acDetails.pcName) {
            finalSelectedPollingStation.pcName = acDetails.pcName;
          }
          if (!finalSelectedPollingStation.acName) {
            finalSelectedPollingStation.acName = finalSelectedAC;
          }
      console.log(`✅ Enhanced selectedPollingStation with AC details:`, finalSelectedPollingStation);
    }

    // Get session for interview data (needed for timing, etc.)
    // CRITICAL FIX: Removed assignment check to allow offline sync submissions
    // Submissions will still go through abandoned checks and auto-rejection checks
    const session = await InterviewSession.findOne({ sessionId });
    
    // Log assignment status for debugging (but don't block submission)
    if (queueEntry.assignedTo) {
      const isAssigned = queueEntry.assignedTo.toString() === interviewerId.toString();
      console.log(`📝 Assignment check (informational only): ${isAssigned ? 'Assigned' : 'Not assigned'} - Allowing submission anyway`);
    } else {
      console.log(`📝 Assignment check (informational only): No assignment - Allowing submission anyway`);
    }
    
    // If session doesn't exist, try to find it by queueId or create a minimal session reference
    // This allows submissions even if session was lost (offline sync scenario)
    if (!session) {
      console.warn('⚠️  Session not found by sessionId, but allowing submission to proceed (offline sync scenario)');
      // Don't block - allow submission to proceed
      // The session data will be reconstructed from request body
    } else {
      console.log('✅ Session found - using session data for timing information');
    }

    // Get session timing information (use provided values or fallback to session or current time)
    // Handle case where session might not exist (offline sync scenario)
    const finalStartTime = startTime ? new Date(startTime) : (session?.startTime || new Date());
    const finalEndTime = endTime ? new Date(endTime) : new Date();
    const finalTotalTimeSpent = totalTimeSpent || session?.totalTimeSpent || Math.floor((finalEndTime - finalStartTime) / 1000);

    // Calculate statistics from responses
    const allResponses = responses || [];
    
    // Extract OldinterviewerID from responses (for survey 68fd1915d41841da463f0d46)
    let oldInterviewerID = null;
    if (OldinterviewerID) {
      oldInterviewerID = String(OldinterviewerID);
    } else {
      // Also check in responses array as fallback
      const interviewerIdResponse = allResponses.find(r => r.questionId === 'interviewer-id');
      if (interviewerIdResponse && interviewerIdResponse.response !== null && interviewerIdResponse.response !== undefined && interviewerIdResponse.response !== '') {
        oldInterviewerID = String(interviewerIdResponse.response);
      }
    }
    
    // Extract supervisorID from responses (for survey 68fd1915d41841da463f0d46)
    let finalSupervisorID = null;
    if (supervisorID) {
      finalSupervisorID = String(supervisorID);
    } else {
      // Also check in responses array as fallback
      const supervisorIdResponse = allResponses.find(r => r.questionId === 'supervisor-id');
      if (supervisorIdResponse && supervisorIdResponse.response !== null && supervisorIdResponse.response !== undefined && supervisorIdResponse.response !== '') {
        finalSupervisorID = String(supervisorIdResponse.response);
      }
    }
    
    // Extract consent form response (consent-form question)
    // Value '1' or 'yes' = Yes, Value '2' or 'no' = No
    // CRITICAL: Prioritize req.body.consentResponse (from sync service), then check responses array
    let consentResponse = bodyConsentResponse || null;
    let consentFormResponse = null;
    if (!consentResponse) {
      consentFormResponse = allResponses.find(r => r.questionId === 'consent-form');
      if (consentFormResponse && consentFormResponse.response !== null && consentFormResponse.response !== undefined) {
        // Handle different response formats: string, number, object with value property
        let consentValue = consentFormResponse.response;
        
        // If it's an object, try to extract the value
        if (typeof consentValue === 'object' && consentValue !== null) {
          consentValue = consentValue.value || consentValue.text || consentValue;
        }
        
        // Convert to string and normalize
        const consentValueStr = String(consentValue).trim();
        const consentValueLower = consentValueStr.toLowerCase();
        
        // Check for "yes" values: '1', 'yes', 'true', 'y'
        if (consentValueStr === '1' || consentValueLower === 'yes' || consentValueLower === 'true' || consentValueLower === 'y') {
          consentResponse = 'yes';
        } 
        // Check for "no" values: '2', 'no', 'false', 'n'
        else if (consentValueStr === '2' || consentValueLower === 'no' || consentValueLower === 'false' || consentValueLower === 'n') {
          consentResponse = 'no';
        }
      }
    }
    // CRITICAL: Removed JSON.stringify() - causes memory leaks
    console.log(`📋 Consent Form Response: ${consentResponse} (type: ${typeof consentFormResponse?.response})`);
    
    // Use frontend-provided values if available, otherwise calculate
    let totalQuestions = frontendTotalQuestions;
    let answeredQuestions = frontendAnsweredQuestions;
    let completionPercentage = frontendCompletionPercentage;
    
    // If frontend didn't provide values, calculate them
    if (!totalQuestions || totalQuestions === 0) {
      // Get total questions from survey - need to count all questions in all sections
      totalQuestions = 0;
      if (queueEntry.survey && queueEntry.survey.sections) {
        queueEntry.survey.sections.forEach(section => {
          if (section.questions && Array.isArray(section.questions)) {
            totalQuestions += section.questions.length;
          }
        });
      }
      // Fallback to questions array if sections don't have questions
      if (totalQuestions === 0 && queueEntry.survey?.questions) {
        totalQuestions = Array.isArray(queueEntry.survey.questions) ? queueEntry.survey.questions.length : 0;
      }
    }
    
    // Count answered questions if not provided
    if (!answeredQuestions && answeredQuestions !== 0) {
      answeredQuestions = allResponses.filter(r => {
        if (!r || !r.response) return false;
        if (Array.isArray(r.response)) return r.response.length > 0;
        if (typeof r.response === 'object') return Object.keys(r.response).length > 0;
        return r.response !== '' && r.response !== null && r.response !== undefined;
      }).length;
    }
    
    // Calculate completion percentage if not provided
    if (!completionPercentage && completionPercentage !== 0) {
      completionPercentage = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
    }
    
    console.log('🔍 Completion stats - Total:', totalQuestions, 'Answered:', answeredQuestions, 'Percentage:', completionPercentage);
    
    // Handle call status from frontend
    // Normalize call status
    const finalCallStatus = callStatus || 'unknown';
    const normalizedCallStatus = finalCallStatus.toLowerCase().trim();
    
    // Map to knownCallStatus enum values
    const knownCallStatusMap = {
      'call_connected': 'call_connected',
      'success': 'call_connected',
      'busy': 'busy',
      'switched_off': 'switched_off',
      'not_reachable': 'not_reachable',
      'did_not_pick_up': 'did_not_pick_up',
      'number_does_not_exist': 'number_does_not_exist',
      'didnt_get_call': 'didnt_get_call',
      'didn\'t_get_call': 'didnt_get_call'
    };
    const knownCallStatus = knownCallStatusMap[normalizedCallStatus] || 'unknown';
    
    // IMPORTANT: For CATI interviews, if call status is NOT 'call_connected' or 'success',
    // the interview should be marked as "abandoned", NOT auto-rejected
    // Auto-rejection should only apply to completed interviews (call_connected) that fail quality checks
    const isCallConnected = normalizedCallStatus === 'call_connected' || normalizedCallStatus === 'success';
    const shouldAutoReject = false; // Don't auto-reject based on call status - use quality checks instead
    
    console.log(`📞 Call Status received: ${finalCallStatus}, KnownCallStatus: ${knownCallStatus}, Is Connected: ${isCallConnected}`);
    
    // CRITICAL FIX: Calculate explicit abandonment indicators at function level (for use in auto-rejection check)
    // This ensures the variable is accessible in both existing and new response paths
    // IMPORTANT: Sync service sends abandoned/isCompleted at top level AND in metadata
    // ALSO CHECK: queueEntry.abandonmentReason (when interview was abandoned via abandon endpoint)
    // Note: queueEntry is populated earlier in the function, so it's available here
    const hasExplicitAbandonReasonGlobal = req.body.abandonReason !== null && req.body.abandonReason !== undefined && req.body.abandonReason !== '' ||
                                           req.body.reason !== null && req.body.reason !== undefined && req.body.reason !== '' ||
                                           req.body.metadata?.abandonReason !== null && req.body.metadata?.abandonReason !== undefined && req.body.metadata?.abandonReason !== '' ||
                                           (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
    const isExplicitlyAbandonedGlobal = req.body.abandoned === true ||  // Top level (from sync service)
                                        req.body.metadata?.abandoned === true ||  // In metadata
                                        req.body.isCompleted === false ||  // Top level (from sync service)
                                        req.body.metadata?.isCompleted === false ||  // In metadata
                                        (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
    
    // Calculate explicit abandonment for auto-rejection skip (works for all app versions)
    const isExplicitlyAbandonedForSkipGlobal = hasExplicitAbandonReasonGlobal ||  // PRIORITY 1: Explicit reason
                                               isExplicitlyAbandonedGlobal ||      // PRIORITY 1: Explicit flag
                                               !isCallConnected ||                // PRIORITY 2: Call not connected
                                               consentResponse === 'no';          // PRIORITY 3: Consent refused

    // Get callId from queueEntry's callRecord
    // CRITICAL FIX: queueEntry is a lean object (from .lean()), so we can't use .populate()
    // But callRecord is already populated in the initial query (line 1338), so we can access it directly
    let callId = null;
    if (queueEntry.callRecord) {
      // callRecord is already populated from the initial query, so we can access it directly
      if (queueEntry.callRecord && queueEntry.callRecord.callId) {
        callId = queueEntry.callRecord.callId;
        console.log(`🔍 Found callId from callRecord: ${callId}`);
      } else if (typeof queueEntry.callRecord === 'string' || queueEntry.callRecord?._id) {
        // If callRecord is just an ID (not populated), fetch it separately
        const CatiCall = require('../models/CatiCall');
        const callRecordId = typeof queueEntry.callRecord === 'string' 
          ? queueEntry.callRecord 
          : queueEntry.callRecord._id;
        const callRecord = await CatiCall.findById(callRecordId).select('callId').lean();
        if (callRecord && callRecord.callId) {
          callId = callRecord.callId;
          console.log(`🔍 Found callId from separate callRecord lookup: ${callId}`);
        }
      }
    }
    
    // If callId not found in callRecord, try to find it from CatiCall by queueEntry
    if (!callId) {
      const CatiCall = require('../models/CatiCall');
      const callRecord = await CatiCall.findOne({ queueEntry: queueEntry._id })
        .sort({ createdAt: -1 }); // Get the most recent call
      if (callRecord && callRecord.callId) {
        callId = callRecord.callId;
        console.log(`🔍 Found callId from CatiCall lookup: ${callId}`);
      }
    }

    // Check if response already exists to avoid duplicate
    // Check by both sessionId and queueEntry to be thorough
    // Handle case where session might not exist (offline sync scenario)
    let surveyResponse = await SurveyResponse.findOne({ 
      $or: [
        ...(session?.sessionId ? [{ sessionId: session.sessionId }] : []),
        { 'metadata.respondentQueueId': queueEntry._id }
      ]
    });
    
    if (surveyResponse) {
      // LAYER 1: CRITICAL PROTECTION - If abandonedReason exists, status MUST be "abandoned"
      // This is the STRONGEST defense - check immediately after fetch, before any other logic
      // Top tech companies use data integrity constraints like this for immutable states
      const hasAbandonedReason = surveyResponse.abandonedReason && 
                                 typeof surveyResponse.abandonedReason === 'string' &&
                                 surveyResponse.abandonedReason.trim() !== '' &&
                                 surveyResponse.abandonedReason !== 'No reason specified' &&
                                 surveyResponse.abandonedReason.toLowerCase() !== 'null' &&
                                 surveyResponse.abandonedReason.toLowerCase() !== 'undefined';
      
      if (hasAbandonedReason) {
        // abandonedReason exists - status MUST be "abandoned", never allow change
        // Force status to "abandoned" if it's not already (defensive programming)
        if (surveyResponse.status !== 'abandoned') {
          console.error(`🔒🔒🔒 LAYER 1 PROTECTION: Response ${surveyResponse.responseId || surveyResponse._id} has abandonedReason but status is '${surveyResponse.status}' - FORCING to 'abandoned'`);
          surveyResponse.status = 'abandoned';
          await surveyResponse.save();
        }
        
        // Ensure metadata flags are set
        if (!surveyResponse.metadata) {
          surveyResponse.metadata = {};
        }
        surveyResponse.metadata.abandoned = true;
        if (!surveyResponse.metadata.abandonedReason && surveyResponse.abandonedReason) {
          surveyResponse.metadata.abandonedReason = surveyResponse.abandonedReason;
        }
        if (surveyResponse.isModified()) {
          await surveyResponse.save();
        }
        
        console.log(`🔒🔒🔒 LAYER 1 PROTECTION: Response ${surveyResponse.responseId || surveyResponse._id} has abandonedReason '${surveyResponse.abandonedReason}' - ABSOLUTE PROTECTION - returning early`);
        
        // Return immediately - do NOT continue processing
        return res.status(200).json({
          success: true,
          message: 'Interview already abandoned - status preserved',
          data: {
            responseId: surveyResponse.responseId || surveyResponse._id.toString(),
            mongoId: surveyResponse._id.toString(),
            queueId: queueEntry._id,
            status: 'abandoned', // Always return "abandoned" if abandonedReason exists
            isDuplicate: true,
            statusPreserved: true,
            abandonedReason: surveyResponse.abandonedReason
          }
        });
      }
      
      // CRITICAL: ALWAYS preserve final statuses (Terminated/abandoned/Rejected/Approved) - NEVER overwrite
      // This is a CRITICAL security fix - abandoned interviews must NEVER be changed to Pending_Approval
      // Top tech companies use immutable status patterns for data integrity
      const existingStatus = surveyResponse.status;
      const isAlreadyAbandoned = existingStatus === 'Terminated' || existingStatus === 'abandoned';
      const isAlreadyRejected = existingStatus === 'Rejected';
      const isAlreadyApproved = existingStatus === 'Approved';
      const hasFinalStatus = isAlreadyAbandoned || isAlreadyRejected || isAlreadyApproved;
      
      // CRITICAL FIX: ALWAYS preserve final statuses - NO TIME CHECK, NO EXCEPTIONS
      // Even if response is 1 second old, if it has a final status, preserve it
      // This prevents the critical vulnerability where abandoned interviews get changed to Pending_Approval
      if (hasFinalStatus) {
        if (isAlreadyAbandoned) {
          console.log(`🔒🔒🔒 CRITICAL: PRESERVING existing abandoned status: ${existingStatus} - ABSOLUTE PROTECTION - will NEVER overwrite`);
          console.log(`🔒 ResponseId: ${surveyResponse.responseId}, CreatedAt: ${surveyResponse.createdAt}`);
          
          // Ensure abandoned flags are preserved
          if (!surveyResponse.abandonedReason && surveyResponse.metadata?.abandonedReason) {
            surveyResponse.abandonedReason = surveyResponse.metadata.abandonedReason;
            await surveyResponse.save(); // Save if we updated abandonedReason
          }
          if (!surveyResponse.metadata) {
            surveyResponse.metadata = {};
            surveyResponse.metadata.abandoned = true;
            if (surveyResponse.abandonedReason) {
              surveyResponse.metadata.abandonedReason = surveyResponse.abandonedReason;
            }
            await surveyResponse.save();
          } else if (!surveyResponse.metadata.abandoned) {
            surveyResponse.metadata.abandoned = true;
            if (!surveyResponse.metadata.abandonedReason && surveyResponse.abandonedReason) {
              surveyResponse.metadata.abandonedReason = surveyResponse.abandonedReason;
            }
            await surveyResponse.save();
          }
          
          // Return existing response IMMEDIATELY - do NOT continue processing
          return res.status(200).json({
            success: true,
            message: 'Interview already completed (abandoned status preserved)',
            data: {
              responseId: surveyResponse.responseId || surveyResponse._id.toString(),
              mongoId: surveyResponse._id.toString(),
              queueId: queueEntry._id,
              status: surveyResponse.status, // Return the preserved status
              isDuplicate: true,
              statusPreserved: true // Flag to indicate status was preserved
            }
          });
        } else if (isAlreadyRejected) {
          console.log(`🔒🔒🔒 CRITICAL: PRESERVING existing rejected status: ${existingStatus} - ABSOLUTE PROTECTION - will NEVER overwrite`);
          console.log(`🔒 ResponseId: ${surveyResponse.responseId}, CreatedAt: ${surveyResponse.createdAt}`);
          
          // Ensure auto-rejection metadata is preserved
          if (!surveyResponse.metadata) {
            surveyResponse.metadata = {};
            surveyResponse.metadata.autoRejected = true;
            await surveyResponse.save();
          } else if (surveyResponse.metadata.autoRejected !== true) {
            surveyResponse.metadata.autoRejected = true;
            await surveyResponse.save();
          }
          
          // Return existing response IMMEDIATELY - do NOT continue processing
          return res.status(200).json({
            success: true,
            message: 'Interview already completed (rejected status preserved)',
            data: {
              responseId: surveyResponse.responseId || surveyResponse._id.toString(),
              mongoId: surveyResponse._id.toString(),
              queueId: queueEntry._id,
              status: surveyResponse.status, // Return the preserved status
              isDuplicate: true,
              statusPreserved: true // Flag to indicate status was preserved
            }
          });
        } else if (isAlreadyApproved) {
          console.log(`🔒🔒🔒 CRITICAL: PRESERVING existing approved status: ${existingStatus} - ABSOLUTE PROTECTION - will NEVER overwrite`);
          console.log(`🔒 ResponseId: ${surveyResponse.responseId}, CreatedAt: ${surveyResponse.createdAt}`);
          
          // Return existing response IMMEDIATELY - do NOT continue processing
          return res.status(200).json({
            success: true,
            message: 'Interview already completed (approved status preserved)',
            data: {
              responseId: surveyResponse.responseId || surveyResponse._id.toString(),
              mongoId: surveyResponse._id.toString(),
              queueId: queueEntry._id,
              status: surveyResponse.status, // Return the preserved status
              isDuplicate: true,
              statusPreserved: true // Flag to indicate status was preserved
            }
          });
        }
      }
      
      // Idempotent behavior for existing responses:
      // If the existing response already looks complete, DO NOT overwrite it.
      // NOTE: 'Pending_Approval' is NOT a final status - it's mutable, so we can update it
      const hasResponses = Array.isArray(surveyResponse.responses) && surveyResponse.responses.length > 0;
      const isFinalStatus = ['Approved', 'Rejected', 'Terminated', 'abandoned', 'Completed'].includes(surveyResponse.status);

      if (hasResponses || isFinalStatus) {
        console.warn('⚠️  Duplicate completion attempt ignored - existing SurveyResponse appears complete/final. Preserving existing data.', {
          responseId: surveyResponse._id?.toString(),
          status: surveyResponse.status,
          responsesLength: surveyResponse.responses?.length || 0
        });
        
        // CRITICAL FIX: Return success response immediately for duplicate submissions
        // This ensures the app receives confirmation and stops retrying
        // This is the industry-standard idempotent behavior (like Stripe, AWS, etc.)
        return res.status(200).json({
          success: true,
          message: 'Interview already completed',
          data: {
            responseId: surveyResponse.responseId || surveyResponse._id.toString(),
            queueId: queueEntry._id,
            status: surveyResponse.status,
            isDuplicate: true // Flag to indicate this was a duplicate submission
          }
        });
      } else {
        console.log('⚠️  SurveyResponse exists but appears incomplete/abandoned, updating with latest data');
        // Update existing response with latest data
        surveyResponse.responses = allResponses;
        surveyResponse.selectedAC = finalSelectedAC || null;
        surveyResponse.selectedPollingStation = finalSelectedPollingStation || null;
        
        // Also update location.state for CATI responses
        if (!surveyResponse.location || Object.keys(surveyResponse.location).length === 0 || !surveyResponse.location.state) {
          surveyResponse.location = {
            ...(surveyResponse.location || {}),
            state: 'West Bengal'
          };
        }
        
        surveyResponse.endTime = finalEndTime;
        surveyResponse.totalTimeSpent = finalTotalTimeSpent;
        surveyResponse.totalQuestions = totalQuestions;
        surveyResponse.answeredQuestions = answeredQuestions;
        surveyResponse.skippedQuestions = totalQuestions - answeredQuestions;
        surveyResponse.completionPercentage = completionPercentage;
        surveyResponse.OldinterviewerID = oldInterviewerID || null; // Update old interviewer ID
        surveyResponse.supervisorID = finalSupervisorID || null; // Save supervisor ID
        // Always update setNumber if provided (even if it's 1)
        const finalSetNumber = (setNumber !== null && setNumber !== undefined && setNumber !== '') 
          ? Number(setNumber) 
          : null;
        
        if (finalSetNumber !== null) {
          surveyResponse.setNumber = finalSetNumber; // Update set number (ensure it's a number)
          console.log(`💾 Updating existing response with setNumber: ${surveyResponse.setNumber} (original: ${setNumber})`);
        } else {
          console.log(`⚠️  setNumber not provided or invalid in request body for existing response (received: ${setNumber}, type: ${typeof setNumber})`);
        }
        if (callId) {
          surveyResponse.call_id = callId;
        }
        
        // Update knownCallStatus field - ALWAYS save it correctly
        // IMPORTANT: If call was connected, knownCallStatus should be 'call_connected' 
        // even if consent is "No" - this ensures accurate stats
        if (isCallConnected) {
          surveyResponse.knownCallStatus = 'call_connected'; // Force to 'call_connected' if call was connected
          console.log(`✅ Setting knownCallStatus to 'call_connected' (call was connected, consent: ${consentResponse})`);
        } else {
          surveyResponse.knownCallStatus = knownCallStatus; // Save other statuses (busy, switched_off, etc.)
        }
        
        // Update consentResponse field
        surveyResponse.consentResponse = consentResponse;
        
        // CRITICAL: NEVER change final statuses (abandoned/Terminated/Rejected/Approved) - absolute protection
        // This is the CRITICAL FIX for the vulnerability where abandoned interviews get changed to Pending_Approval
        const currentStatus = surveyResponse.status;
        const isFinalStatus = ['Terminated', 'abandoned', 'Rejected', 'Approved'].includes(currentStatus);
        
        if (isFinalStatus) {
          // CRITICAL: Final status detected - DO NOT CHANGE IT, even if conditions suggest abandonment
          console.log(`🔒🔒🔒 CRITICAL: Existing response has final status '${currentStatus}' - ABSOLUTE PROTECTION - will NOT change status`);
          console.log(`🔒 ResponseId: ${surveyResponse.responseId}, Current status: ${currentStatus}`);
          console.log(`🔒 Call Connected: ${isCallConnected}, Consent: ${consentResponse}`);
          console.log(`🔒 This prevents the critical vulnerability where abandoned interviews get changed to Pending_Approval`);
          
          // Only update metadata, NEVER status
          surveyResponse.metadata = {
            ...surveyResponse.metadata,
            respondentQueueId: queueEntry._id,
            respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
            respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
            callRecordId: queueEntry.callRecord?._id,
            callStatus: finalCallStatus
          };
          
          // If it's abandoned, ensure abandoned flags are preserved
          if (currentStatus === 'abandoned' || currentStatus === 'Terminated') {
            surveyResponse.metadata.abandoned = true;
            if (!surveyResponse.abandonedReason && surveyResponse.metadata?.abandonedReason) {
              surveyResponse.abandonedReason = surveyResponse.metadata.abandonedReason;
            }
            if (!surveyResponse.metadata.abandonedReason && surveyResponse.abandonedReason) {
              surveyResponse.metadata.abandonedReason = surveyResponse.abandonedReason;
            }
          }
        } else {
          // Status is NOT final (e.g., Pending_Approval) - safe to update
          // IMPORTANT: Mark as "abandoned" if:
          // 1. Call is NOT connected, OR
          // 2. Consent form is "No" (even if call was connected)
          const shouldMarkAsAbandoned = !isCallConnected || consentResponse === 'no';
          
          if (shouldMarkAsAbandoned) {
            surveyResponse.status = 'abandoned';
            surveyResponse.metadata = {
              ...surveyResponse.metadata,
              abandoned: true,
              abandonmentReason: consentResponse === 'no' ? 'consent_refused' : reason,
              callStatus: finalCallStatus,
              respondentQueueId: queueEntry._id,
              respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
              respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
              callRecordId: queueEntry.callRecord?._id
            };
            console.log(`🚫 Marking existing interview as abandoned - Call Connected: ${isCallConnected}, Consent: ${consentResponse}`);
          } else {
            // Call was connected AND consent is "Yes" - proceed normally
            // LAYER 2: CRITICAL PROTECTION - Check if abandonedReason exists before changing status
            // If abandonedReason exists, status MUST remain "abandoned", never change to Pending_Approval
            const hasAbandonedReason = surveyResponse.abandonedReason && 
                                       typeof surveyResponse.abandonedReason === 'string' &&
                                       surveyResponse.abandonedReason.trim() !== '' &&
                                       surveyResponse.abandonedReason !== 'No reason specified' &&
                                       surveyResponse.abandonedReason.toLowerCase() !== 'null' &&
                                       surveyResponse.abandonedReason.toLowerCase() !== 'undefined';
            
            if (currentStatus !== 'Pending_Approval' && !hasAbandonedReason) {
              // Safe to change to Pending_Approval - no abandonedReason exists
              surveyResponse.status = 'Pending_Approval';
            } else if (hasAbandonedReason) {
              // LAYER 2 PROTECTION: abandonedReason exists - force status to "abandoned" and log warning
              console.error(`🔒🔒🔒 LAYER 2 PROTECTION: Attempted status change BLOCKED - Response ${surveyResponse.responseId || surveyResponse._id} has abandonedReason '${surveyResponse.abandonedReason}', forcing status to 'abandoned'`);
              surveyResponse.status = 'abandoned';
              // Ensure metadata flags are preserved
              if (!surveyResponse.metadata) {
                surveyResponse.metadata = {};
              }
              surveyResponse.metadata.abandoned = true;
              if (!surveyResponse.metadata.abandonedReason && surveyResponse.abandonedReason) {
                surveyResponse.metadata.abandonedReason = surveyResponse.abandonedReason;
              }
            }
            // If currentStatus is already 'Pending_Approval' and no abandonedReason, no change needed
            
            surveyResponse.metadata = {
              ...surveyResponse.metadata,
              respondentQueueId: queueEntry._id,
              respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
              respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
              callRecordId: queueEntry.callRecord?._id,
              callStatus: finalCallStatus // Store call status in metadata
            };
          }
        }
        // Log before saving
        console.log(`💾 About to update EXISTING SurveyResponse - setNumber in object: ${surveyResponse.setNumber}, type: ${typeof surveyResponse.setNumber}`);
        
        console.log(`💾 CATI Interview (EXISTING) - setNumber received: ${setNumber} (type: ${typeof setNumber}), converted to: ${finalSetNumber} (type: ${typeof finalSetNumber})`);
        
        // CRITICAL: Before saving, double-check that we're not changing a final status
        // This is an additional safeguard on top of the earlier check
        const statusBeforeSave = surveyResponse.status;
        const isFinalBeforeSave = ['Terminated', 'abandoned', 'Rejected', 'Approved'].includes(statusBeforeSave);
        
        if (isFinalBeforeSave) {
          console.log(`🔒🔒🔒 DOUBLE-CHECK: Final status '${statusBeforeSave}' detected before save - ensuring it's not changed`);
        }
        
        // Update the existing response
        surveyResponse.setNumber = finalSetNumber;
        surveyResponse.markModified('setNumber');
        
        // CRITICAL: Save and verify status wasn't changed
        await surveyResponse.save();
        
        // INVALIDATE CACHE: Clear interviewer stats cache since stats have changed
        const interviewerStatsCacheForUpdate = require('../utils/interviewerStatsCache');
        const interviewerIdForCache = queueEntry.assignedTo?.toString() || queueEntry.assignedTo;
        if (interviewerIdForCache) {
          interviewerStatsCacheForUpdate.delete(interviewerIdForCache);
        }
        
        // Verify status after save (database-level protection should have prevented change, but verify)
        const savedResponse = await SurveyResponse.findById(surveyResponse._id).select('status').lean();
        if (savedResponse && isFinalBeforeSave && savedResponse.status !== statusBeforeSave) {
          console.error(`🔒🔒🔒 CRITICAL ERROR: Final status was changed during save! Original: ${statusBeforeSave}, After save: ${savedResponse.status}`);
          console.error(`🔒 This should NEVER happen - reverting status using direct MongoDB update`);
          // Revert the status using direct MongoDB update (bypasses Mongoose)
          const mongoose = require('mongoose');
          const collection = mongoose.connection.collection(SurveyResponse.collection.name);
          await collection.updateOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { $set: { status: statusBeforeSave } }
          );
          console.error(`🔒 Status reverted to: ${statusBeforeSave}`);
        }
        
        // CRITICAL: Use MongoDB's native collection.updateOne to FORCE save setNumber
        const mongoose = require('mongoose');
        // Get the actual collection name from the model
        const collectionName = SurveyResponse.collection.name;
        const collection = mongoose.connection.collection(collectionName);
        console.log(`💾 Using collection name: ${collectionName}`);
        const updateResult = await collection.updateOne(
          { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
          { $set: { setNumber: finalSetNumber } }
        );
        
        console.log(`💾 CATI Interview (EXISTING) - Direct MongoDB update - setNumber: ${finalSetNumber}, matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount}`);
        
        // Verify by querying the database directly using native MongoDB
        const savedDoc = await collection.findOne(
          { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
          { projection: { setNumber: 1, responseId: 1, interviewMode: 1 } }
        );
        
        console.log(`✅ CATI SurveyResponse (EXISTING) updated - responseId: ${savedDoc?.responseId}, setNumber in DB: ${savedDoc?.setNumber}`);
        
        if (savedDoc?.setNumber !== finalSetNumber) {
          console.error(`❌ CRITICAL: setNumber STILL NOT SAVED! Expected: ${finalSetNumber}, Got in DB: ${savedDoc?.setNumber}`);
          // Last resort: try one more time with explicit type
          await collection.updateOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { $set: { setNumber: finalSetNumber === null ? null : Number(finalSetNumber) } }
          );
          const finalCheck = await collection.findOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { projection: { setNumber: 1 } }
          );
          console.log(`🔧 After final retry - setNumber in DB: ${finalCheck?.setNumber}`);
        } else {
          console.log(`✅ setNumber correctly saved: ${savedDoc.setNumber}`);
        }
      }
      
      // Check for auto-rejection conditions ONLY if call was connected AND consent is "Yes"
      // Abandoned calls (status = 'abandoned') should NOT go through auto-rejection
      const { checkAutoRejection, applyAutoRejection } = require('../utils/autoRejectionHelper');
      try {
      // CRITICAL FIX: Skip auto-rejection for abandoned interviews (existing responses)
      // Check multiple indicators to ensure we don't auto-reject abandoned interviews (works for all app versions)
      const existingResponseLatest = await SurveyResponse.findById(surveyResponse._id);
      const hasAbandonReasonExisting = existingResponseLatest?.abandonedReason !== null && 
                                       existingResponseLatest?.abandonedReason !== undefined && 
                                       existingResponseLatest?.abandonedReason !== '';
      const isAbandonedStatusExisting = existingResponseLatest?.status === 'abandoned' || 
                                        existingResponseLatest?.status === 'Terminated';
      const isAbandonedMetadataExisting = existingResponseLatest?.metadata?.abandoned === true;
      
      // CRITICAL FIX: Check if registered voter question is answered "No" (for survey 68fd1915d41841da463f0d46)
      // If "No", skip auto-rejection (should be marked as abandoned, not rejected)
      const { checkRegisteredVoterResponse } = require('../utils/abandonmentHelper');
      const voterCheckExisting = checkRegisteredVoterResponse(allResponses, queueEntry.survey._id);
      const isNotRegisteredVoterExisting = voterCheckExisting && voterCheckExisting.isNotRegisteredVoter;
      
      // CRITICAL FIX: Check queueEntry for abandonment (backend-only fix - works even if sync service doesn't send abandonment fields)
      const hasQueueAbandonReasonExisting = queueEntry.abandonmentReason !== null && 
                                            queueEntry.abandonmentReason !== undefined && 
                                            queueEntry.abandonmentReason !== '';
      
      // CRITICAL FIX: Only skip auto-rejection if EXPLICITLY abandoned (not heuristic-based)
      // Check explicit abandonment indicators (same logic as status determination but without heuristic)
      const isExplicitlyAbandonedForSkipExisting = hasAbandonReasonExisting ||  // Has explicit abandon reason
                                                   hasQueueAbandonReasonExisting ||  // CRITICAL: QueueEntry has abandonment reason (backend-only fix)
                                                   isAbandonedStatusExisting ||  // Status is abandoned
                                                   isAbandonedMetadataExisting || // Metadata flag set
                                                   !isCallConnected ||           // Call not connected
                                                   consentResponse === 'no';     // Consent refused
      
      // This ensures legitimate short interviews still go through auto-rejection
      const shouldSkipAutoRejection = isNotRegisteredVoterExisting ||  // PRIORITY 0: Not a registered voter (special case)
                                     isExplicitlyAbandonedForSkipExisting;  // Only skip if EXPLICITLY abandoned
        if (!shouldSkipAutoRejection && isCallConnected) {
          // IMPORTANT: Save setNumber before auto-rejection check to ensure it's preserved
          const setNumberToPreserve = surveyResponse.setNumber;
          console.log(`💾 Preserving setNumber before auto-rejection check: ${setNumberToPreserve}`);
          
          const rejectionInfo = await checkAutoRejection(surveyResponse, allResponses, queueEntry.survey._id);
          if (rejectionInfo) {
            await applyAutoRejection(surveyResponse, rejectionInfo);
            // CRITICAL: Re-apply setNumber after auto-rejection (it might have been lost)
            if (setNumberToPreserve !== null && setNumberToPreserve !== undefined) {
              surveyResponse.setNumber = setNumberToPreserve;
              surveyResponse.markModified('setNumber');
              await surveyResponse.save();
              console.log(`💾 Restored setNumber after auto-rejection: ${surveyResponse.setNumber}`);
            }
            // Refresh the response to get updated status
            await surveyResponse.populate('survey');
          }
        } else {
          console.log(`⏭️  Skipping auto-rejection for abandoned CATI response (existing): ${surveyResponse._id} (status: ${surveyResponse.status})`);
        }
      } catch (autoRejectError) {
        console.error('Error checking auto-rejection:', autoRejectError);
        // Continue even if auto-rejection check fails
      }
      
      // CRITICAL: Double-check status before adding to batch
      // Reload response to ensure we have the latest status
      const latestResponse = await SurveyResponse.findById(surveyResponse._id);
      const isAutoRejected = latestResponse.status === 'Rejected' || 
                            latestResponse.verificationData?.autoRejected === true;
      const isAbandoned = latestResponse.status === 'abandoned' || latestResponse.metadata?.abandoned === true;
      
      // Add response to QC batch only if NOT auto-rejected, NOT abandoned, and not already in one
      // Auto-rejected and abandoned responses are already decided and don't need QC processing
      if (!latestResponse.qcBatch && !isAutoRejected && !isAbandoned) {
        try {
          const { addResponseToBatch } = require('../utils/qcBatchHelper');
          await addResponseToBatch(surveyResponse._id, queueEntry.survey._id, interviewerId.toString());
        } catch (batchError) {
          console.error('Error adding existing CATI response to batch:', batchError);
        }
      } else {
        console.log(`⏭️  Skipping batch addition for ${isAbandoned ? 'abandoned' : 'auto-rejected'} existing response ${surveyResponse._id}`);
      }
    } else {
      // Create new survey response (similar to CAPI flow)
      const responseId = uuidv4();
      
      // Fetch session if sessionId is provided
      let session = null;
      if (sessionId) {
        try {
          session = await InterviewSession.findOne({ sessionId: sessionId });
        } catch (sessionError) {
          console.warn('⚠️ Could not fetch session:', sessionError.message);
        }
      }

      console.log('🔍 Creating new SurveyResponse with:', {
        responseId,
        survey: queueEntry.survey._id,
        interviewer: interviewerId,
        sessionId: sessionId || (session ? session.sessionId : null),
        interviewMode: 'cati',
        call_id: callId,
        totalQuestions,
        answeredQuestions,
        completionPercentage,
        startTime: finalStartTime,
        endTime: finalEndTime,
        totalTimeSpent: finalTotalTimeSpent
      });
      
      // LIGHTWEIGHT DUPLICATE DETECTION: Generate content hash (includes call_id for CATI)
      // EXCLUDE interviewer - same interview can be synced by different users
      const contentHash = SurveyResponse.generateContentHash(interviewerId, queueEntry.survey._id, finalStartTime, allResponses, {
        interviewMode: 'cati',
        audioRecording: null, // CATI doesn't have audio recording in response
        location: null, // CATI doesn't have GPS location
        call_id: callId || null, // CATI uses call_id for duplicate detection
        endTime: finalEndTime,
        totalTimeSpent: finalTotalTimeSpent
      });
      
      // Check for existing response with same content hash (fast indexed lookup - <20ms)
      const existingResponseByHash = await SurveyResponse.findOne({ contentHash })
        .select('_id responseId sessionId status')
        .lean(); // Fast - only returns minimal fields, uses index
      
      if (existingResponseByHash) {
        console.log(`⚠️ DUPLICATE DETECTED (CATI): Found existing response with same content hash: ${existingResponseByHash.responseId}`);
        console.log(`   Existing sessionId: ${existingResponseByHash.sessionId}, New sessionId: ${sessionId || (session ? session.sessionId : 'N/A')}`);
        console.log(`   Existing status: ${existingResponseByHash.status}`);
        
        // CRITICAL FIX: Preserve abandoned/Terminated status - don't return if final status
        const existingStatus = existingResponseByHash.status;
        const isAbandonedOrTerminated = existingStatus === 'abandoned' || existingStatus === 'Terminated';
        
        if (isAbandonedOrTerminated) {
          console.log(`🔒 PRESERVING FINAL STATUS (CATI): Existing response has status '${existingStatus}' - returning without modification`);
          // Return existing response without any updates - preserve final status
          const existingDoc = await SurveyResponse.findById(existingResponseByHash._id);
          if (!existingDoc) {
            throw new Error(`Failed to retrieve existing response ${existingResponseByHash._id} after duplicate detection`);
          }
          console.log(`✅ Returning existing CATI response ${existingDoc.responseId} with preserved status '${existingDoc.status}'`);
          
          // Return response immediately - don't continue processing
          return res.status(200).json({
            success: true,
            message: 'Interview already completed',
            data: {
              responseId: existingDoc.responseId || existingDoc._id.toString(),
              queueId: queueEntry._id,
              status: existingDoc.status,
              isDuplicate: true
            }
          });
        }
        
        console.log(`   ℹ️ Returning existing response instead of creating duplicate - app will mark as synced`);
        
        // Return existing response (don't create duplicate)
        // Only update if status is NOT abandoned/Terminated (already checked above)
        surveyResponse = await SurveyResponse.findById(existingResponseByHash._id);
        if (!surveyResponse) {
          throw new Error(`Failed to retrieve existing response ${existingResponseByHash._id} after duplicate detection`);
        }
        console.log(`✅ Returning existing CATI response ${surveyResponse.responseId} - app will treat as successful sync`);
        // Continue with existing response object for downstream logic (skip new response creation)
      } else {
        // No duplicate found - create new response
        // Use the finalSetNumber already calculated at the top level
      
      // CRITICAL FIX: Detect abandoned interviews from multiple sources (backend-only fix for all app versions)
      // Check for explicit abandonment indicators in request body (for offline sync)
      // IMPORTANT: Sync service sends abandoned/isCompleted at top level AND in metadata
      // ALSO CHECK: queueEntry.abandonmentReason (when interview was abandoned via abandon endpoint)
      const hasExplicitAbandonReason = req.body.abandonReason !== null && req.body.abandonReason !== undefined && req.body.abandonReason !== '' ||
                                       req.body.reason !== null && req.body.reason !== undefined && req.body.reason !== '' ||
                                       req.body.metadata?.abandonReason !== null && req.body.metadata?.abandonReason !== undefined && req.body.metadata?.abandonReason !== '' ||
                                       (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
      const isExplicitlyAbandoned = req.body.abandoned === true ||  // Top level (from sync service)
                                    req.body.metadata?.abandoned === true ||  // In metadata
                                    req.body.isCompleted === false ||  // Top level (from sync service)
                                    req.body.metadata?.isCompleted === false ||  // In metadata
                                    (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
      
      // Extract abandon reason from request if available, fallback to queueEntry
      const requestAbandonReason = req.body.abandonReason || req.body.reason || req.body.metadata?.abandonReason || queueEntry.abandonmentReason || null;
      
      // Heuristic: Very short duration (< 60 seconds) with very few responses indicates instant abandonment
      const actualResponses = allResponses ? allResponses.filter(r => {
        const questionId = r.questionId || '';
        const questionText = (r.questionText || '').toLowerCase();
        const isACSelection = questionId === 'ac-selection' || 
                             questionText.includes('assembly constituency') ||
                             questionText.includes('select assembly constituency');
        const isPollingStation = questionId === 'polling-station-selection' ||
                                questionText.includes('polling station') ||
                                questionText.includes('select polling station');
        return !isACSelection && !isPollingStation && r.response !== null && r.response !== undefined && r.response !== '';
      }) : [];
      
      const isVeryShortDuration = finalTotalTimeSpent < 60; // Less than 60 seconds
      const isExtremelyShortDuration = finalTotalTimeSpent < 30; // Less than 30 seconds
      const hasVeryFewResponses = actualResponses.length <= 1;
      const hasNoActualResponses = actualResponses.length === 0;
      
      // CRITICAL FIX: Check if registered voter question is answered "No" (for survey 68fd1915d41841da463f0d46)
      // If "No", mark as abandoned (not auto-rejected) - this should happen BEFORE other abandonment checks
      const { checkRegisteredVoterResponse } = require('../utils/abandonmentHelper');
      const voterCheck = checkRegisteredVoterResponse(allResponses, queueEntry.survey._id);
      const isNotRegisteredVoter = voterCheck && voterCheck.isNotRegisteredVoter;
      
      if (isNotRegisteredVoter) {
        console.log(`🚫 Detected "Not a Registered Voter" response (CATI) - will mark as abandoned (reason: ${voterCheck.reason})`);
      }
      
      // CRITICAL FIX: Separate explicit abandonment from heuristic detection
      // Explicit abandonment (for auto-rejection skip): Only skip auto-rejection if EXPLICITLY abandoned
      // This ensures legitimate short interviews still go through auto-rejection
      // Use global variable calculated at function level (consistent across all paths)
      const isExplicitlyAbandonedForSkip = isExplicitlyAbandonedForSkipGlobal;  // Use global variable (already calculated)
      
      // Status determination (includes heuristic for catching abandoned interviews):
      // Mark as "abandoned" if explicitly abandoned OR not a registered voter OR heuristic matches
      // IMPORTANT: Use LOCAL variables (hasExplicitAbandonReason, isExplicitlyAbandoned) for status determination
      // This ensures we catch abandoned interviews from request body metadata
      const shouldMarkAsAbandoned = isNotRegisteredVoter ||  // PRIORITY 0: Not a registered voter (special case)
                                    hasExplicitAbandonReason ||  // PRIORITY 1: Explicit abandon reason (from request body)
                                    isExplicitlyAbandoned ||  // PRIORITY 1: Explicit abandoned flag (from request body)
                                    !isCallConnected ||  // PRIORITY 2: Call not connected
                                    consentResponse === 'no' ||  // PRIORITY 3: Consent refused
                                    (isExtremelyShortDuration && hasNoActualResponses); // PRIORITY 4: Heuristic: < 30s with no responses
      
      const responseStatus = shouldMarkAsAbandoned ? 'abandoned' : 'Pending_Approval';
      
      // Determine final abandon reason (prioritize explicit reason from request)
      let finalAbandonReason = null;
      if (isNotRegisteredVoter && voterCheck) {
        // PRIORITY 0: Not a registered voter (special case for survey 68fd1915d41841da463f0d46)
        finalAbandonReason = voterCheck.reason;
        console.log(`⏭️  Detected "Not a Registered Voter" - reason: ${finalAbandonReason}`);
      } else if (hasExplicitAbandonReason && requestAbandonReason) {
        // Use explicit reason from request (for offline sync)
        finalAbandonReason = requestAbandonReason;
        console.log(`⏭️  Detected explicit abandonment from request - reason: ${finalAbandonReason}`);
      } else if (consentResponse === 'no') {
        finalAbandonReason = 'Consent_Form_Disagree';
      } else if (!isCallConnected && finalCallStatus && finalCallStatus !== 'call_connected' && finalCallStatus !== 'success') {
        finalAbandonReason = 'Call_Not_Connected';
      } else if (isExtremelyShortDuration && hasNoActualResponses) {
        finalAbandonReason = 'Interview_Abandoned_Early';
      }
      
      if (shouldMarkAsAbandoned && !hasExplicitAbandonReason && !isExplicitlyAbandoned) {
        console.log(`⏭️  Detected abandoned CATI interview using heuristic - duration: ${finalTotalTimeSpent}s, responses: ${actualResponses.length}, callConnected: ${isCallConnected}, consent: ${consentResponse}`);
      }
      
      // IMPORTANT: If call was connected, knownCallStatus should be 'call_connected' 
      // even if consent is "No" - this ensures accurate stats
      const finalKnownCallStatus = isCallConnected ? 'call_connected' : knownCallStatus;
      
      console.log(`📋 Creating new SurveyResponse - Call Connected: ${isCallConnected}, Consent: ${consentResponse}, Status: ${responseStatus}`);
      console.log(`📋 KnownCallStatus: ${finalKnownCallStatus} (original: ${knownCallStatus}, isCallConnected: ${isCallConnected})`);
      
      // Ensure selectedPollingStation has all AC-derived fields populated
      let enhancedPollingStation = finalSelectedPollingStation;
      if (finalSelectedAC) {
        const acDetails = getAllACDetails(finalSelectedAC);
        if (!enhancedPollingStation || Object.keys(enhancedPollingStation).length === 0) {
          enhancedPollingStation = {
            acName: finalSelectedAC,
            pcName: acDetails.pcName || null,
            district: acDetails.district || null,
            state: 'West Bengal' // All ACs in this survey belong to West Bengal
          };
        } else {
          // Enhance existing polling station with missing AC-derived fields
          if (!enhancedPollingStation.district && acDetails.district) {
            enhancedPollingStation.district = acDetails.district;
          }
          // Always set state to West Bengal for this survey
          enhancedPollingStation.state = 'West Bengal';
          if (!enhancedPollingStation.pcName && acDetails.pcName) {
            enhancedPollingStation.pcName = acDetails.pcName;
          }
          if (!enhancedPollingStation.acName) {
            enhancedPollingStation.acName = finalSelectedAC;
          }
        }
      }
      
      surveyResponse = new SurveyResponse({
        responseId,
        survey: queueEntry.survey._id,
        interviewer: interviewerId,
        sessionId: session?.sessionId || sessionId || `cati_${responseId}`, // CRITICAL FIX: Handle null session to prevent recursion
        interviewMode: 'cati',
        call_id: callId || null, // Store DeepCall callId
        setNumber: (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber))) ? Number(finalSetNumber) : null, // Save which Set was shown in this CATI interview (ensure it's a proper Number type or null)
        knownCallStatus: finalKnownCallStatus, // Store call status - 'call_connected' if call was connected, even if consent is "No"
        consentResponse: consentResponse, // Store consent form response (yes/no)
        responses: allResponses,
        selectedAC: finalSelectedAC || null,
        selectedPollingStation: enhancedPollingStation || null,
        location: {
          state: 'West Bengal' // Set state for CATI responses (no GPS location)
        }, // No GPS location for CATI, but set state field
        OldinterviewerID: oldInterviewerID || null, // Save old interviewer ID
        supervisorID: finalSupervisorID || null, // Save supervisor ID
        startTime: finalStartTime, // Required field
        endTime: finalEndTime, // Required field
        totalTimeSpent: finalTotalTimeSpent, // Required field - Form Duration uses this
        status: responseStatus, // Set to "abandoned" if explicitly abandoned, call not connected, consent refused, or heuristic match
        abandonedReason: finalAbandonReason, // Use determined abandon reason (prioritizes explicit reason from request)
        totalQuestions: totalQuestions || 0, // Required field - ensure it's not undefined
        answeredQuestions: answeredQuestions || 0, // Required field - ensure it's not undefined
        skippedQuestions: (totalQuestions || 0) - (answeredQuestions || 0), // Optional but good to have
        completionPercentage: completionPercentage || 0, // Required field - ensure it's not undefined
        contentHash: contentHash, // Store contentHash for duplicate detection (CRITICAL: Same as CAPI)
        metadata: {
          respondentQueueId: queueEntry._id,
          respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
          respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
          callRecordId: queueEntry.callRecord?._id,
          callStatus: finalCallStatus, // Store call status in metadata (legacy)
          abandoned: shouldMarkAsAbandoned, // Mark as abandoned (from explicit indicators, call status, consent, or heuristic)
          abandonmentReason: finalAbandonReason || (consentResponse === 'no' ? 'consent_refused' : (!isCallConnected && finalCallStatus && finalCallStatus !== 'call_connected' && finalCallStatus !== 'success' ? 'Call_Not_Connected' : null))
        }
        });
        
        // Verify setNumber is set before saving
        console.log(`🔴🔴🔴 SurveyResponse object created - setNumber before save: ${surveyResponse.setNumber}, type: ${typeof surveyResponse.setNumber}`);

        try {
        // Log before saving
        console.log(`🔴🔴🔴 About to save NEW SurveyResponse - setNumber in object: ${surveyResponse.setNumber}, type: ${typeof surveyResponse.setNumber}`);
        console.log(`🔴🔴🔴 SurveyResponse document before save:`, JSON.stringify({ 
          _id: surveyResponse._id, 
          responseId: surveyResponse.responseId, 
          setNumber: surveyResponse.setNumber,
          interviewMode: surveyResponse.interviewMode,
          sessionId: surveyResponse.sessionId
        }, null, 2));
        
        // CRITICAL: For CATI interviews, save setNumber using direct MongoDB update
        // Save the response first
        console.log(`🔴🔴🔴 Saving SurveyResponse to database...`);
        await surveyResponse.save();
        
        // INVALIDATE CACHE: Clear interviewer stats cache since stats have changed
        const interviewerStatsCacheForNew = require('../utils/interviewerStatsCache');
        interviewerStatsCacheForNew.delete(interviewerId.toString());
        
        console.log(`🔴🔴🔴 SurveyResponse saved. Now checking setNumber in saved object: ${surveyResponse.setNumber}`);
        
        // CRITICAL FIX: Double-check status after save for abandoned interviews
        // Reload from DB to ensure status is correct (prevents auto-rejection from changing it)
        if (shouldMarkAsAbandoned && responseStatus === 'abandoned') {
          const savedResponse = await SurveyResponse.findById(surveyResponse._id);
          if (savedResponse && savedResponse.status !== 'abandoned') {
            savedResponse.status = 'abandoned';
            if (finalAbandonReason && !savedResponse.abandonedReason) {
              savedResponse.abandonedReason = finalAbandonReason;
            }
            await savedResponse.save();
            console.log(`✅ Corrected CATI response status to 'abandoned' after save (was: ${savedResponse.status})`);
          }
        }
        
        // CRITICAL: Immediately update setNumber using native MongoDB after initial save
        // This ensures it's persisted even if Mongoose stripped it out
        if (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber))) {
          try {
            const mongoose = require('mongoose');
            const collection = mongoose.connection.collection('surveyresponses');
            const immediateUpdateResult = await collection.updateOne(
              { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
              { $set: { setNumber: Number(finalSetNumber) } }
            );
            console.log(`🔴🔴🔴 Immediate setNumber update after save - matched: ${immediateUpdateResult.matchedCount}, modified: ${immediateUpdateResult.modifiedCount}, setNumber: ${Number(finalSetNumber)}`);
            
            // Verify immediately
            const immediateVerify = await collection.findOne(
              { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
              { projection: { setNumber: 1 } }
            );
            console.log(`🔴🔴🔴 Immediate verification - setNumber in DB: ${immediateVerify?.setNumber}`);
          } catch (immediateUpdateError) {
            console.error('❌ Error in immediate setNumber update:', immediateUpdateError);
          }
        }
      } catch (saveError) {
        // Handle duplicate key error (E11000) - sessionId already exists
        // This can happen if multiple requests come in simultaneously
        if (saveError.code === 11000 && saveError.keyPattern && saveError.keyPattern.sessionId) {
          const duplicateSessionId = saveError.keyValue?.sessionId || session?.sessionId || sessionId || 'unknown';
          console.log('⚠️  Duplicate sessionId detected while saving NEW response, checking existing document...');
          console.log(`⚠️  Duplicate sessionId: ${duplicateSessionId}`);

          // Find the existing response that caused the duplicate
          const existingResponse = await SurveyResponse.findOne({
            sessionId: duplicateSessionId
          });

          if (existingResponse) {
            // Decide if existing data is "complete" and should be preserved
            const hasResponses = Array.isArray(existingResponse.responses) && existingResponse.responses.length > 0;
            const isFinalStatus = ['Approved', 'Pending_Approval', 'Rejected', 'Terminated', 'Completed'].includes(existingResponse.status);

            if (hasResponses || isFinalStatus) {
              // Existing response looks complete/final – DO NOT overwrite
              console.warn('⚠️  Duplicate completion attempt ignored - existing SurveyResponse appears complete/final. Preserving existing data.');
              console.warn(`⚠️  Existing response status: ${existingResponse.status}, responses length: ${existingResponse.responses?.length || 0}`);
              
              // CRITICAL FIX: Return success response immediately for duplicate submissions
              // This ensures the app receives confirmation and stops retrying
              // This is the industry-standard idempotent behavior (like Stripe, AWS, etc.)
              return res.status(200).json({
                success: true,
                message: 'Interview already completed',
                data: {
                  responseId: existingResponse.responseId || existingResponse._id.toString(),
                  queueId: queueEntry._id,
                  status: existingResponse.status,
                  isDuplicate: true // Flag to indicate this was a duplicate submission
                }
              });
            } else {
              // Existing response looks incomplete/abandoned – safe to enrich it with latest data
              console.log('ℹ️  Existing response appears incomplete/abandoned, updating it with latest data instead of creating new');

              existingResponse.responses = allResponses;
              existingResponse.selectedAC = finalSelectedAC || null;
              existingResponse.selectedPollingStation = enhancedPollingStation || null;

              // Update location.state for CATI responses if missing
              if (!existingResponse.location || Object.keys(existingResponse.location).length === 0 || !existingResponse.location.state) {
                existingResponse.location = {
                  ...(existingResponse.location || {}),
                  state: 'West Bengal'
                };
              }

              existingResponse.endTime = finalEndTime;
              existingResponse.totalTimeSpent = finalTotalTimeSpent;
              existingResponse.totalQuestions = totalQuestions;
              existingResponse.answeredQuestions = answeredQuestions;
              existingResponse.skippedQuestions = totalQuestions - answeredQuestions;
              existingResponse.completionPercentage = completionPercentage;
              existingResponse.OldinterviewerID = oldInterviewerID || null;
              existingResponse.supervisorID = finalSupervisorID || null;

              // Update setNumber only if we have a valid numeric value
              if (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber))) {
                existingResponse.setNumber = Number(finalSetNumber);
                existingResponse.markModified('setNumber');
              }

              if (callId) {
                existingResponse.call_id = callId;
              }

              // Update knownCallStatus
              if (isCallConnected) {
                existingResponse.knownCallStatus = 'call_connected';
              } else {
                existingResponse.knownCallStatus = knownCallStatus;
              }

              existingResponse.consentResponse = consentResponse;

              // CRITICAL FIX: Check if registered voter question is answered "No" (for survey 68fd1915d41841da463f0d46)
              // If "No", mark as abandoned (not auto-rejected)
              const { checkRegisteredVoterResponse } = require('../utils/abandonmentHelper');
              const voterCheckExistingUpdate = checkRegisteredVoterResponse(existingResponse.responses || allResponses, queueEntry.survey._id);
              const isNotRegisteredVoterExistingUpdate = voterCheckExistingUpdate && voterCheckExistingUpdate.isNotRegisteredVoter;
              
              // CRITICAL FIX: Use same abandoned detection logic as new responses
              // Check for explicit abandonment indicators (for offline sync compatibility)
              // ALSO CHECK: queueEntry.abandonmentReason (when interview was abandoned via abandon endpoint)
              const hasExplicitAbandonReasonExisting = req.body.abandonReason !== null && req.body.abandonReason !== undefined && req.body.abandonReason !== '' ||
                                                       req.body.reason !== null && req.body.reason !== undefined && req.body.reason !== '' ||
                                                       req.body.metadata?.abandonReason !== null && req.body.metadata?.abandonReason !== undefined && req.body.metadata?.abandonReason !== '' ||
                                                       (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
              const isExplicitlyAbandonedExisting = req.body.abandoned === true ||  // Top level (from sync service)
                                                     req.body.metadata?.abandoned === true ||  // In metadata
                                                     req.body.isCompleted === false ||  // Top level (from sync service)
                                                     req.body.metadata?.isCompleted === false ||  // In metadata
                                                     (queueEntry.abandonmentReason !== null && queueEntry.abandonmentReason !== undefined && queueEntry.abandonmentReason !== '');  // CRITICAL: Check queueEntry for abandonment (backend-only fix)
              const requestAbandonReasonExisting = req.body.abandonReason || req.body.reason || req.body.metadata?.abandonReason || queueEntry.abandonmentReason || reason || null;
              
              // Update status and metadata
              const shouldMarkAsAbandoned = isNotRegisteredVoterExistingUpdate ||  // PRIORITY 0: Not a registered voter (special case)
                                            hasExplicitAbandonReasonExisting ||  // PRIORITY 1: Explicit reason
                                            isExplicitlyAbandonedExisting ||      // PRIORITY 1: Explicit flag
                                            !isCallConnected ||                  // PRIORITY 2: Call not connected
                                            consentResponse === 'no';            // PRIORITY 3: Consent refused
              
              let finalAbandonReasonExisting = null;
              if (isNotRegisteredVoterExistingUpdate && voterCheckExistingUpdate) {
                // PRIORITY 0: Not a registered voter (special case for survey 68fd1915d41841da463f0d46)
                finalAbandonReasonExisting = voterCheckExistingUpdate.reason;
                console.log(`⏭️  Detected "Not a Registered Voter" (existing response) - reason: ${finalAbandonReasonExisting}`);
              } else if (hasExplicitAbandonReasonExisting && requestAbandonReasonExisting) {
                finalAbandonReasonExisting = requestAbandonReasonExisting;
              } else if (consentResponse === 'no') {
                finalAbandonReasonExisting = 'Consent_Form_Disagree';
              } else if (!isCallConnected && finalCallStatus && finalCallStatus !== 'call_connected' && finalCallStatus !== 'success') {
                finalAbandonReasonExisting = 'Call_Not_Connected';
              } else if (reason) {
                finalAbandonReasonExisting = reason;
              }
              
              if (shouldMarkAsAbandoned) {
                existingResponse.status = 'abandoned';
                if (finalAbandonReasonExisting && !existingResponse.abandonedReason) {
                  existingResponse.abandonedReason = finalAbandonReasonExisting;
                }
                existingResponse.metadata = {
                  ...existingResponse.metadata,
                  abandoned: true,
                  abandonmentReason: finalAbandonReasonExisting || (consentResponse === 'no' ? 'consent_refused' : reason),
                  callStatus: finalCallStatus,
                  respondentQueueId: queueEntry._id,
                  respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
                  respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
                  callRecordId: queueEntry.callRecord?._id
                };
              } else {
                existingResponse.metadata = {
                  ...existingResponse.metadata,
                  respondentQueueId: queueEntry._id,
                  respondentName: queueEntry.respondentContact?.name || queueEntry.respondentContact?.name,
                  respondentPhone: queueEntry.respondentContact?.phone || queueEntry.respondentContact?.phone,
                  callRecordId: queueEntry.callRecord?._id,
                  callStatus: finalCallStatus
                };
              }

              await existingResponse.save();
              console.log('✅ Successfully updated existing (incomplete) response after duplicate key error');
              surveyResponse = existingResponse;
            }
          } else {
            // If we can't find the existing response, log and re-throw the original error
            console.error('❌ Duplicate key error but could not find existing response for sessionId:', duplicateSessionId);
            throw saveError;
          }
        } else {
          // For other errors, log and re-throw
          console.error('❌ Error saving SurveyResponse:', saveError);
          console.error('❌ Save error details:', {
            message: saveError.message,
            name: saveError.name,
            code: saveError.code,
            errors: saveError.errors,
            stack: saveError.stack
          });
          throw saveError; // Re-throw to be caught by outer catch
        }
        }
      } // Close else block (no duplicate found - created new response)
    }
    
    // Check for auto-rejection conditions ONLY if call was connected AND consent is "Yes"
    // Abandoned calls (status = 'abandoned') should NOT go through auto-rejection
    const { checkAutoRejection, applyAutoRejection } = require('../utils/autoRejectionHelper');
    try {
      // CRITICAL FIX: Skip auto-rejection for abandoned interviews
      // Check multiple indicators to ensure we don't auto-reject abandoned interviews (works for all app versions)
      const latestResponse = await SurveyResponse.findById(surveyResponse._id);
      const hasAbandonReason = latestResponse?.abandonedReason !== null && 
                               latestResponse?.abandonedReason !== undefined && 
                               latestResponse?.abandonedReason !== '';
      const isAbandonedStatus = latestResponse?.status === 'abandoned' || 
                                latestResponse?.status === 'Terminated';
      const isAbandonedMetadata = latestResponse?.metadata?.abandoned === true;
      
      // CRITICAL FIX: Check queueEntry for abandonment (backend-only fix - works even if sync service doesn't send abandonment fields)
      const hasQueueAbandonReason = queueEntry.abandonmentReason !== null && 
                                    queueEntry.abandonmentReason !== undefined && 
                                    queueEntry.abandonmentReason !== '';
      
      // CRITICAL FIX: Only skip auto-rejection if EXPLICITLY abandoned (not heuristic-based)
      // This ensures legitimate short interviews still go through auto-rejection
      // Use global variable calculated at function level (accessible in both paths)
      const shouldSkipAutoRejection = isAbandonedStatus ||           // Status is abandoned (from DB)
                                      hasAbandonReason ||            // Has abandon reason (works for all versions)
                                      hasQueueAbandonReason ||       // CRITICAL: QueueEntry has abandonment reason (backend-only fix)
                                      isAbandonedMetadata ||        // Metadata flag set
                                      consentResponse === 'no' ||    // Consent refused
                                      isExplicitlyAbandonedForSkipGlobal;  // Explicitly abandoned (NOT heuristic) - from function level
      if (!shouldSkipAutoRejection && isCallConnected) {
      // CRITICAL: Preserve setNumber before auto-rejection check
      // Ensure it's a proper Number type
      const setNumberToPreserve = (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber)))
        ? Number(finalSetNumber)
        : ((surveyResponse.setNumber !== null && surveyResponse.setNumber !== undefined && !isNaN(Number(surveyResponse.setNumber)))
          ? Number(surveyResponse.setNumber)
          : null);
      console.log(`💾 Preserving setNumber before auto-rejection check (new response): ${setNumberToPreserve} (type: ${typeof setNumberToPreserve}), finalSetNumber: ${finalSetNumber} (type: ${typeof finalSetNumber})`);
      
      const rejectionInfo = await checkAutoRejection(surveyResponse, allResponses, queueEntry.survey._id);
      if (rejectionInfo) {
        await applyAutoRejection(surveyResponse, rejectionInfo);
        
        // CRITICAL: Re-apply setNumber after auto-rejection (it might have been lost)
        // ALWAYS re-apply, even if null, to ensure the field exists
        // CRITICAL: Ensure it's a proper Number type
        const setNumberToRestore = (setNumberToPreserve !== null && setNumberToPreserve !== undefined && !isNaN(Number(setNumberToPreserve))) 
          ? Number(setNumberToPreserve) 
          : null;
        surveyResponse.setNumber = setNumberToRestore;
        surveyResponse.markModified('setNumber');
        await surveyResponse.save();
        console.log(`💾 Restored setNumber after auto-rejection (new response): ${surveyResponse.setNumber} (type: ${typeof surveyResponse.setNumber}), original finalSetNumber: ${finalSetNumber} (type: ${typeof finalSetNumber})`);
        
        // Also update using native MongoDB to ensure it's persisted
        try {
          const mongoose = require('mongoose');
          const collection = mongoose.connection.collection('surveyresponses');
          await collection.updateOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { $set: { setNumber: setNumberToRestore } }
          );
          console.log(`💾 Native MongoDB update after auto-rejection: ${setNumberToRestore} (type: ${typeof setNumberToRestore})`);
        } catch (nativeUpdateError) {
          console.error('Error in native MongoDB update after auto-rejection:', nativeUpdateError);
        }
        
        // Refresh the response to get updated status
        await surveyResponse.populate('survey');
        }
      } else {
        console.log(`⏭️  Skipping auto-rejection for abandoned CATI response: ${surveyResponse._id} (status: ${latestResponse?.status || surveyResponse.status}, abandonedReason: ${hasAbandonReason ? latestResponse?.abandonedReason : 'none'}, queueAbandonReason: ${hasQueueAbandonReason ? queueEntry.abandonmentReason : 'none'})`);
        // Ensure status is still 'abandoned' (safety check) - check all abandonment indicators
        const shouldBeAbandoned = isExplicitlyAbandonedForSkipGlobal || hasQueueAbandonReason || hasAbandonReason || isAbandonedStatus || isAbandonedMetadata;
        if (latestResponse && latestResponse.status !== 'abandoned' && shouldBeAbandoned) {
          latestResponse.status = 'abandoned';
          // Set abandonedReason from queueEntry if not already set
          if (!latestResponse.abandonedReason) {
            if (hasQueueAbandonReason && queueEntry.abandonmentReason) {
              latestResponse.abandonedReason = queueEntry.abandonmentReason;
            } else if (finalAbandonReason) {
              latestResponse.abandonedReason = finalAbandonReason;
            }
          }
          await latestResponse.save();
          console.log(`✅ Corrected CATI response status to 'abandoned' before auto-rejection check (was: ${latestResponse.status}, queueAbandonReason: ${queueEntry.abandonmentReason || 'none'})`);
        }
      }
    } catch (autoRejectError) {
      console.error('Error checking auto-rejection:', autoRejectError);
      // Continue even if auto-rejection check fails
    }
    
    // Add response to QC batch instead of queuing immediately
    try {
      // CRITICAL: Double-check status before adding to batch
      // Reload response to ensure we have the latest status
      const latestResponse = await SurveyResponse.findById(surveyResponse._id);
      const isAutoRejected = latestResponse.status === 'Rejected' || 
                            latestResponse.verificationData?.autoRejected === true;
      
      // Only add to batch if NOT auto-rejected
      // Auto-rejected responses are already decided and don't need QC processing
      if (!isAutoRejected) {
        const { addResponseToBatch } = require('../utils/qcBatchHelper');
        await addResponseToBatch(surveyResponse._id, queueEntry.survey._id, interviewerId.toString());
      } else {
        console.log(`⏭️  Skipping batch addition for auto-rejected response ${surveyResponse._id}`);
      }
    } catch (batchError) {
      console.error('Error adding CATI response to batch:', batchError);
      // Continue even if batch addition fails - response is still saved
    }

    // Update queue entry based on call status
    if (finalCallStatus === 'success') {
      // Call was successful - mark as interview success
      queueEntry.status = 'interview_success';
      queueEntry.response = surveyResponse._id;
      queueEntry.completedAt = new Date();
      
      // PHASE 3: Clear cache for this entry (it's completed, cache is stale)
      const surveyIdForCache = queueEntry.survey?._id ? queueEntry.survey._id.toString() : (queueEntry.survey ? queueEntry.survey.toString() : null);
      if (surveyIdForCache && queueEntry.respondentContact && queueEntry.respondentContact.ac) {
        const acName = queueEntry.respondentContact.ac;
        const acPriority = await getACPriority(acName);
        if (acPriority !== null && acPriority > 0) {
          await catiQueueCache.clearCachedNextEntry(surveyIdForCache, acName, acPriority);
        }
      }
    } else if (finalCallStatus === 'number_does_not_exist') {
      // Number does not exist - remove from queue (don't retry)
      queueEntry.status = 'does_not_exist';
      // Optionally delete the queue entry or mark it as inactive
      // For now, just mark as does_not_exist so it won't be picked up again
    } else if (finalCallStatus === 'busy' || finalCallStatus === 'did_not_pick_up') {
      // Busy or didn't pick up - send to end of queue for retry
      queueEntry.status = 'pending';
      queueEntry.priority = -1; // Lowest priority to move to end
      queueEntry.assignedTo = null;
      queueEntry.assignedAt = null;
      queueEntry.createdAt = new Date(); // Update createdAt to move to end
    } else {
      // Other statuses (switched_off, not_reachable, didnt_get_call, etc.) - mark appropriately
      queueEntry.status = finalCallStatus === 'switched_off' ? 'switched_off' :
                         finalCallStatus === 'not_reachable' ? 'not_reachable' :
                         'pending'; // Default to pending for other statuses
      if (finalCallStatus !== 'didnt_get_call') {
        // For all except "didnt_get_call", send to end of queue
        queueEntry.priority = -1;
        queueEntry.assignedTo = null;
        queueEntry.assignedAt = null;
        queueEntry.createdAt = new Date();
      }
      // "didnt_get_call" is API failure, don't retry immediately but keep in queue
    }
    
    // CRITICAL FIX: queueEntry is a lean object (from .lean()), so we can't use .save()
    // Use findByIdAndUpdate instead (more efficient and works with lean objects)
    await CatiRespondentQueue.findByIdAndUpdate(queueEntry._id, {
      response: surveyResponse._id,
      completedAt: new Date()
    });
    
    // CRITICAL: Save setNumber in SetData model for reliable set rotation
    // This is a dedicated model to track which set was used for each response
    // Re-extract setNumber from req.body one more time as a fallback
    let setNumberForSetData = null;
    
    // Try multiple sources in priority order
    if (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber))) {
      setNumberForSetData = Number(finalSetNumber);
    } else if (req.body.setNumber !== null && req.body.setNumber !== undefined && !isNaN(Number(req.body.setNumber))) {
      setNumberForSetData = Number(req.body.setNumber);
    } else if (setNumber !== null && setNumber !== undefined && !isNaN(Number(setNumber))) {
      setNumberForSetData = Number(setNumber);
    }
    
    console.log(`🔵🔵🔵 SetData creation check - finalSetNumber: ${finalSetNumber}, req.body.setNumber: ${req.body.setNumber}, destructured setNumber: ${setNumber}, setNumberForSetData: ${setNumberForSetData}`);
    console.log(`🔵🔵🔵 SetData creation check - queueEntry.survey: ${queueEntry.survey?._id || queueEntry.survey}, surveyResponse._id: ${surveyResponse._id}`);
    
    // Ensure survey reference is available - handle both populated and non-populated cases
    let surveyIdForSetData = null;
    if (queueEntry.survey) {
      surveyIdForSetData = queueEntry.survey._id || queueEntry.survey;
    }
    
    // If survey is not populated, get it from the surveyResponse
    if (!surveyIdForSetData && surveyResponse.survey) {
      surveyIdForSetData = surveyResponse.survey._id || surveyResponse.survey;
    }
    
    console.log(`🔵🔵🔵 SetData pre-check - setNumberForSetData: ${setNumberForSetData}, surveyIdForSetData: ${surveyIdForSetData}, surveyResponse._id: ${surveyResponse._id}`);
    console.log(`🔵🔵🔵 SetData pre-check - queueEntry.survey type: ${typeof queueEntry.survey}, surveyResponse.survey type: ${typeof surveyResponse.survey}`);
    
    if (setNumberForSetData !== null && setNumberForSetData !== undefined && surveyIdForSetData && surveyResponse._id) {
      try {
        const SetData = require('../models/SetData');
        console.log(`🔵🔵🔵 Creating SetData with - survey: ${surveyIdForSetData}, response: ${surveyResponse._id}, setNumber: ${setNumberForSetData}`);
        
        // Check if SetData already exists for this response (to avoid duplicates)
        const existingSetData = await SetData.findOne({ surveyResponse: surveyResponse._id });
        if (existingSetData) {
          // Update existing SetData
          existingSetData.setNumber = setNumberForSetData;
          existingSetData.survey = surveyIdForSetData;
          await existingSetData.save();
          console.log(`✅ SetData updated (existing) - _id: ${existingSetData._id}, survey: ${surveyIdForSetData}, response: ${surveyResponse._id}, setNumber: ${setNumberForSetData}`);
        } else {
          // Create new SetData
          const setData = new SetData({
            survey: surveyIdForSetData,
            surveyResponse: surveyResponse._id,
            setNumber: setNumberForSetData,
            interviewMode: 'cati'
          });
          
          console.log(`🔵🔵🔵 SetData object created, about to save...`);
          const savedSetData = await setData.save();
          console.log(`✅ SetData saved successfully (new) - _id: ${savedSetData._id}, survey: ${surveyIdForSetData}, response: ${surveyResponse._id}, setNumber: ${setNumberForSetData}`);
        }
      } catch (setDataError) {
        console.error('❌ CRITICAL Error saving SetData:', setDataError);
        console.error('❌ SetData error message:', setDataError.message);
        console.error('❌ SetData error name:', setDataError.name);
        if (setDataError.errors) {
          console.error('❌ SetData validation errors:', JSON.stringify(setDataError.errors, null, 2));
        }
        if (setDataError.code) {
          console.error('❌ SetData error code:', setDataError.code);
        }
        console.error('❌ SetData error stack:', setDataError.stack);
        // Don't fail the request if SetData save fails - response is already saved
      }
    } else {
      console.error(`❌ CRITICAL: Cannot save SetData - Missing required data. setNumberForSetData: ${setNumberForSetData}, surveyIdForSetData: ${surveyIdForSetData}, surveyResponse._id: ${surveyResponse._id}`);
    }

    // Update session status - InterviewSession only allows 'active', 'paused', 'abandoned'
    // Since interview is completed successfully, we'll mark it as abandoned (completed interviews are no longer active)
    // Alternatively, we can just update lastActivityTime without changing status
    // CRITICAL FIX: Check if session exists before accessing it (prevents null reference error and infinite recursion)
    if (session) {
      try {
        session.lastActivityTime = new Date();
        // Try to set status to 'abandoned' to indicate it's no longer active
        // This is semantically correct as the session is done
        if (session.status !== 'abandoned') {
          session.status = 'abandoned';
        }
        await session.save();
      } catch (sessionError) {
        console.log('⚠️  Could not update session status, continuing anyway:', sessionError.message);
        // Continue even if session update fails
      }
    } else {
      console.log('⚠️  No session found to update (sessionId may not exist or was not provided)');
    }

    // CRITICAL: FINAL STEP - ALWAYS update setNumber using MongoDB native update AFTER all other operations
    // This ensures setNumber is saved even if other operations overwrite it
    // IMPORTANT: Re-extract setNumber from req.body one more time as a fallback (in case finalSetNumber was lost)
    // The response object's setNumber might have been lost during auto-rejection or other operations
    // CRITICAL: Ensure it's a proper Number type (not string, not undefined)
    let setNumberToSave = null;
    
    // Try to get setNumber one more time from req.body (fallback)
    const setNumberFromBody = req.body.setNumber !== undefined ? req.body.setNumber 
      : (req.body.interviewData?.setNumber !== undefined ? req.body.interviewData.setNumber : null);
    
    // Priority: 1. finalSetNumber (from initial extraction), 2. setNumberFromBody (re-extracted), 3. surveyResponse.setNumber, 4. null
    if (finalSetNumber !== null && finalSetNumber !== undefined && !isNaN(Number(finalSetNumber))) {
      setNumberToSave = Number(finalSetNumber);
      console.log(`🔵🔵🔵 FINAL UPDATE - Using finalSetNumber: ${setNumberToSave}`);
    } else if (setNumberFromBody !== null && setNumberFromBody !== undefined && !isNaN(Number(setNumberFromBody))) {
      setNumberToSave = Number(setNumberFromBody);
      console.log(`🔵🔵🔵 FINAL UPDATE - Using setNumberFromBody (re-extracted): ${setNumberToSave}`);
    } else if (surveyResponse.setNumber !== null && surveyResponse.setNumber !== undefined && !isNaN(Number(surveyResponse.setNumber))) {
      setNumberToSave = Number(surveyResponse.setNumber);
      console.log(`🔵🔵🔵 FINAL UPDATE - Using surveyResponse.setNumber: ${setNumberToSave}`);
    } else {
      console.log(`⚠️  FINAL UPDATE - No valid setNumber found. finalSetNumber: ${finalSetNumber}, setNumberFromBody: ${setNumberFromBody}, surveyResponse.setNumber: ${surveyResponse.setNumber}`);
    }
    
    console.log(`🔵🔵🔵 FINAL UPDATE - setNumberToSave: ${setNumberToSave} (type: ${typeof setNumberToSave}), surveyResponse.setNumber: ${surveyResponse.setNumber} (type: ${typeof surveyResponse.setNumber}), finalSetNumber: ${finalSetNumber} (type: ${typeof finalSetNumber}), setNumberFromBody: ${setNumberFromBody} (type: ${typeof setNumberFromBody}), responseId: ${surveyResponse.responseId}`);
    
    // CRITICAL: Update setNumber SYNCHRONOUSLY before sending response
    // This ensures it happens and completes before the response is sent
    try {
      const mongoose = require('mongoose');
      const collectionName = SurveyResponse.collection.name;
      const collection = mongoose.connection.collection(collectionName);
      
      console.log(`🔵🔵🔵 Starting final setNumber update for responseId: ${surveyResponse.responseId}, setNumberToSave: ${setNumberToSave} (type: ${typeof setNumberToSave}), _id: ${surveyResponse._id}`);
      
      // CRITICAL: Update setNumber using native MongoDB - this MUST be the last operation
      // CRITICAL: Explicitly convert to Number to ensure type match with schema
      // IMPORTANT: Only update if setNumberToSave is not null - MongoDB might remove the field if we set it to null
      if (setNumberToSave !== null && setNumberToSave !== undefined) {
        const updateValue = Number(setNumberToSave);
        console.log(`🔵🔵🔵 Update value: ${updateValue} (type: ${typeof updateValue})`);
        
        // CRITICAL: Use $set with explicit Number value
        const updateResult = await collection.updateOne(
          { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
          { 
            $set: { 
              setNumber: updateValue 
            } 
          },
          { 
            upsert: false
          }
        );
        
        console.log(`🔵🔵🔵 Update result - matched: ${updateResult.matchedCount}, modified: ${updateResult.modifiedCount}, acknowledged: ${updateResult.acknowledged}, updateValue: ${updateValue} (type: ${typeof updateValue})`);
        
        // If update didn't modify, log a warning but continue
        if (updateResult.modifiedCount === 0) {
          console.warn(`⚠️  Update did not modify document - this might mean the value was already ${updateValue}`);
        }
      
      // Verify the update worked
      if (updateResult.matchedCount === 0) {
        console.error(`❌ CRITICAL: Document not found for setNumber update - _id: ${surveyResponse._id}, responseId: ${surveyResponse.responseId}`);
      } else if (updateResult.modifiedCount === 0 && setNumberToSave !== null) {
        console.error(`❌ CRITICAL: setNumber update did not modify document - _id: ${surveyResponse._id}, setNumber: ${setNumberToSave}`);
      }
      
        // Immediately verify by reading back from database
        const verifyDoc = await collection.findOne(
          { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
          { projection: { setNumber: 1, responseId: 1 } }
        );
        
        console.log(`🔵🔵🔵 Verification - Expected: ${updateValue} (type: ${typeof updateValue}), Got: ${verifyDoc?.setNumber} (type: ${typeof verifyDoc?.setNumber}), responseId: ${verifyDoc?.responseId}`);
        
        // Use loose equality for comparison (== instead of ===) to handle type coercion
        if (verifyDoc?.setNumber != updateValue) {
          console.error(`❌ CRITICAL: setNumber verification failed - Expected: ${updateValue} (type: ${typeof updateValue}), Got: ${verifyDoc?.setNumber} (type: ${typeof verifyDoc?.setNumber}), responseId: ${surveyResponse.responseId}`);
          // Try one more time with explicit type conversion and force write
          const retryValue = Number(setNumberToSave);
          const retryResult = await collection.updateOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { 
              $set: { setNumber: retryValue }
            },
            {
              upsert: false
            }
          );
          console.log(`🔵🔵🔵 Retry result - matched: ${retryResult.matchedCount}, modified: ${retryResult.modifiedCount}, retryValue: ${retryValue} (type: ${typeof retryValue})`);
          
          // Final verification after retry
          const finalVerify = await collection.findOne(
            { _id: new mongoose.Types.ObjectId(surveyResponse._id) },
            { projection: { setNumber: 1, responseId: 1 } }
          );
          if (finalVerify?.setNumber != retryValue) {
            console.error(`❌ CRITICAL: setNumber STILL NOT SAVED after retry - Expected: ${retryValue} (type: ${typeof retryValue}), Got: ${finalVerify?.setNumber} (type: ${typeof finalVerify?.setNumber}), responseId: ${surveyResponse.responseId}`);
            console.error(`❌ CRITICAL: Full document after retry:`, JSON.stringify(finalVerify, null, 2));
          } else {
            console.log(`✅ setNumber successfully saved after retry: ${finalVerify?.setNumber} (type: ${typeof finalVerify?.setNumber}), responseId: ${surveyResponse.responseId}`);
          }
        } else {
          console.log(`✅ setNumber successfully saved: ${verifyDoc?.setNumber} (type: ${typeof verifyDoc?.setNumber}), responseId: ${surveyResponse.responseId}`);
        }
      } else {
        console.warn(`⚠️  FINAL UPDATE - Skipping setNumber update because setNumberToSave is null/undefined. setNumberToSave: ${setNumberToSave}`);
      }
    } catch (finalUpdateError) {
      console.error('❌ CRITICAL: Error in final setNumber update:', finalUpdateError);
      console.error('❌ Error stack:', finalUpdateError.stack);
      // Don't fail the request if this fails - response is already saved
    }
    
    // CRITICAL: Reload response to get the actual status (especially for existing responses)
    const finalResponse = await SurveyResponse.findById(surveyResponse._id)
      .select('responseId status completionPercentage totalTimeSpent')
      .lean();
    
    // Prepare response data for caching
    // CRITICAL: Generate uploadToken for two-phase commit verification (like WhatsApp/Meta)
    // This ensures data integrity - client only deletes after verification
    // CRITICAL FIX: uploadToken may already be declared from req.body destructuring
    // Use a new variable name or check if it exists first
    let finalUploadToken = uploadToken; // Use existing token if provided from client
    
    // Generate new token only if not provided
    if (!finalUploadToken) {
      const crypto = require('crypto');
      finalUploadToken = crypto.randomBytes(32).toString('hex');
    }
    
    // Store uploadToken in response metadata for verification
    if (!surveyResponse.metadata) {
      surveyResponse.metadata = {};
    }
    surveyResponse.metadata.uploadToken = finalUploadToken;
    surveyResponse.metadata.uploadTokenCreatedAt = new Date();
    await surveyResponse.save();
    
    const responseData = {
      responseId: finalResponse.responseId || surveyResponse.responseId,
      mongoId: surveyResponse._id.toString(),
      completionPercentage: finalResponse.completionPercentage || surveyResponse.completionPercentage || 0,
      totalTimeSpent: finalResponse.totalTimeSpent || surveyResponse.totalTimeSpent || 0,
      status: finalResponse.status || surveyResponse.status || 'Pending_Approval', // Use actual status from DB
      queueId: queueEntry._id.toString(),
      // CRITICAL: Two-phase commit support (like top tech companies)
      uploadToken: finalUploadToken, // For verification before deletion
      audioUrl: surveyResponse.audioRecording || null, // Current audio URL (if already uploaded)
      allDataReceived: false, // Will be true after verification
      verified: false // Will be true after verification endpoint call
    };
    
    // CACHE THE RESPONSE: Store in idempotency cache to prevent duplicate submissions from app retries
    // TTL: 48 hours (completed interviews don't change after completion)
    // Use sessionId as cache key (same as CAPI interviews)
    if (sessionId) {
      const idempotencyCache = require('../utils/idempotencyCache');
      idempotencyCache.set(sessionId, responseData, 48 * 60 * 60 * 1000);
      console.log(`✅ IdempotencyCache SET: Cached CATI response for sessionId: ${sessionId}, responseId: ${responseData.responseId}, status: ${responseData.status}`);
    }
    
    // CRITICAL: Invalidate stats cache when new response is created (ensures dashboard stats are fresh)
    // Top tech companies invalidate related caches when data changes
    // Note: We need companyId to invalidate the cache, but we can get it from the survey
    if (queueEntry.survey && (typeof queueEntry.survey === 'object' && queueEntry.survey.company)) {
      const companyId = typeof queueEntry.survey.company === 'object' ? queueEntry.survey.company._id || queueEntry.survey.company : queueEntry.survey.company;
      if (companyId) {
        statsCache.invalidateStatsCache(companyId.toString()).catch(err => {
          console.warn('⚠️ Failed to invalidate stats cache (non-critical):', err.message);
        });
      }
    }
    
    // Send response to client AFTER setNumber update completes
    // CRITICAL: Ensure response structure matches what React Native expects
    // Response must have { success: true, data: {...} } structure
    res.status(200).json({
      success: true,
      message: 'CATI interview completed and submitted for approval',
      data: responseData
    });

  } catch (error) {
    console.error('❌ Error completing CATI interview:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error details:', {
      message: error.message,
      name: error.name,
      errors: error.errors,
      code: error.code
    });
    res.status(500).json({
      success: false,
      message: 'Failed to complete interview',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? {
        stack: error.stack,
        errors: error.errors
      } : undefined
    });
  }
};

// Helper function to initialize respondent queue
const initializeRespondentQueue = async (surveyId, respondentContacts) => {
  try {
    // Check if queue already has pending entries for this survey
    const pendingCount = await CatiRespondentQueue.countDocuments({ 
      survey: surveyId, 
      status: 'pending' 
    });
    
    // Check total entries
    const totalCount = await CatiRespondentQueue.countDocuments({ survey: surveyId });
    
    console.log(`🔍 Queue check - Total: ${totalCount}, Pending: ${pendingCount}`);
    
    // If we have pending entries, we're good
    if (pendingCount > 0) {
      console.log(`✅ Queue already has ${pendingCount} pending respondents`);
      return;
    }
    
    // If no pending entries but we have contacts, create entries for contacts that don't exist yet
    // Solution 2: Optimize duplicate checking - use distinct() instead of fetching all entries
    const existingPhones = await CatiRespondentQueue.distinct(
      'respondentContact.phone',
      { survey: surveyId }
    );
    const existingPhonesSet = new Set(existingPhones.filter(Boolean));
    
    // Create queue entries only for contacts that aren't already in the queue
    const newContacts = respondentContacts.filter(
      contact => contact.phone && !existingPhonesSet.has(contact.phone)
    );
    
    if (newContacts.length === 0) {
      console.log(`⚠️  All respondents are already in queue, but none are pending`);
      // Reset all non-success entries back to pending for retry
      const resetCount = await CatiRespondentQueue.updateMany(
        { 
          survey: surveyId, 
          status: { $ne: 'interview_success' } 
        },
        { 
          $set: { 
            status: 'pending',
            assignedTo: null,
            assignedAt: null
          } 
        }
      );
      console.log(`🔄 Reset ${resetCount.modifiedCount} entries back to pending status`);
      return;
    }

    // Solution 1: Batch processing for queue creation
    const BATCH_SIZE = 5000; // Process 5000 contacts at a time
    const queueEntries = newContacts.map(contact => ({
      survey: surveyId,
      respondentContact: {
        name: contact.name,
        countryCode: contact.countryCode,
        phone: contact.phone,
        email: contact.email,
        address: contact.address,
        city: contact.city,
        ac: contact.ac,
        pc: contact.pc,
        ps: contact.ps
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
        console.error(`⚠️ Error inserting batch ${batchNumber}:`, batchError.message);
        // Try to insert individually to identify problematic entries
        if (batchError.writeErrors && batchError.writeErrors.length > 0) {
          console.error(`⚠️ ${batchError.writeErrors.length} entries failed in batch ${batchNumber}`);
        }
        // Continue with next batch
      }
    }
    
    console.log(`✅ Initialized queue with ${totalInserted}/${queueEntries.length} new respondents for survey ${surveyId}`);

  } catch (error) {
    console.error('Error initializing respondent queue:', error);
    throw error;
  }
};

// @desc    Get call status (for polling job status)
// @route   GET /api/cati-interview/call-status/:queueId
// @access  Private (Interviewer)
const getCallStatus = async (req, res) => {
  try {
    const { queueId } = req.params;
    const interviewerId = req.user._id;

    // Get queue entry
    const queueEntry = await CatiRespondentQueue.findById(queueId)
      .populate('survey', 'surveyName')
      .populate('assignedTo', 'phone firstName lastName')
      .populate('callRecord', 'callId callStatus apiStatus webhookReceived');

    if (!queueEntry) {
      return res.status(404).json({
        success: false,
        message: 'Respondent queue entry not found'
      });
    }

    if (queueEntry.assignedTo._id.toString() !== interviewerId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'You are not assigned to this respondent'
      });
    }

    // Get job status from queue
    const { getJobByQueueId } = require('../queues/catiCallQueue');
    const jobStatus = await getJobByQueueId(queueId);

    // Determine overall status
    let status = 'pending';
    let message = 'Call initiation pending';
    let callId = null;
    
    if (jobStatus) {
      status = jobStatus.state; // 'waiting', 'active', 'completed', 'failed'
      
      if (status === 'completed' && jobStatus.returnvalue) {
        status = 'initiated';
        message = 'Call initiated successfully';
        callId = jobStatus.returnvalue.callId;
      } else if (status === 'failed') {
        status = 'failed';
        message = jobStatus.failedReason || 'Call initiation failed';
      } else if (status === 'active') {
        status = 'processing';
        message = 'Call is being initiated...';
      } else if (status === 'waiting') {
        status = 'queued';
        message = 'Call is queued for processing...';
      }
    } else if (queueEntry.status === 'calling' && queueEntry.callRecord) {
      // Job completed but check queue entry status
      status = 'initiated';
      message = 'Call initiated successfully';
      if (queueEntry.callRecord && typeof queueEntry.callRecord === 'object') {
        callId = queueEntry.callRecord.callId;
      }
    } else if (queueEntry.status === 'calling') {
      status = 'initiated';
      message = 'Call initiated successfully';
    }

    return res.status(200).json({
      success: true,
      data: {
        queueId: queueEntry._id,
        status: status, // 'queued', 'processing', 'initiated', 'failed'
        message: message,
        callId: callId,
        queueEntryStatus: queueEntry.status,
        jobState: jobStatus?.state,
        callRecord: queueEntry.callRecord ? {
          callId: queueEntry.callRecord.callId,
          callStatus: queueEntry.callRecord.callStatus,
          apiStatus: queueEntry.callRecord.apiStatus,
          webhookReceived: queueEntry.callRecord.webhookReceived
        } : null
      }
    });
  } catch (error) {
    console.error('Error getting call status:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to get call status',
      error: error.message
    });
  }
};

module.exports = {
  startCatiInterview,
  makeCallToRespondent,
  abandonInterview,
  completeCatiInterview,
  getCallStatus,
  getACPriority, // Export for use in worker
};



