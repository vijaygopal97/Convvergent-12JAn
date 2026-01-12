/**
 * MEMORY-OPTIMIZED CATI Stats Helper
 * Uses MongoDB aggregations to calculate stats without loading all data into memory
 * Inspired by getSurveyAnalytics pattern - like top tech companies (Meta, Google, Amazon)
 */

const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const CatiCall = require('../models/CatiCall');
const CatiRespondentQueue = require('../models/CatiRespondentQueue');
const QCBatch = require('../models/QCBatch');
const User = require('../models/User');

/**
 * Get call status from various fields (helper function)
 */
const getCallStatusFromResponse = (response) => {
  // Priority 1: knownCallStatus field
  if (response.knownCallStatus) {
    return response.knownCallStatus.toLowerCase().trim();
  }
  // Priority 2: metadata.callStatus
  if (response.metadata?.callStatus) {
    return String(response.metadata.callStatus).toLowerCase().trim();
  }
  // Priority 3: responses array
  if (response.responses && Array.isArray(response.responses)) {
    const callStatusResponse = response.responses.find(r => 
      r.questionId === 'call-status' || r.questionId === 'call_status'
    );
    if (callStatusResponse?.response) {
      return String(callStatusResponse.response).toLowerCase().trim();
    }
  }
  return 'unknown';
};

/**
 * Normalize call status for categorization
 */
const normalizeCallStatus = (status) => {
  const normalized = String(status || '').toLowerCase().trim();
  if (['call_connected', 'success', 'connected'].includes(normalized)) return 'call_connected';
  if (['didnt_get_call', "didn't_get_call", 'did_not_get_call'].includes(normalized)) return 'didnt_get_call';
  if (['not_reachable', 'not_reachable'].includes(normalized)) return 'not_reachable';
  if (['number_does_not_exist', 'number_does_not_exist'].includes(normalized)) return 'number_does_not_exist';
  if (['switched_off', 'switched_off'].includes(normalized)) return 'switched_off';
  if (['busy', 'busy'].includes(normalized)) return 'busy';
  if (['did_not_pick_up', 'did_not_pick_up'].includes(normalized)) return 'did_not_pick_up';
  return normalized;
};

/**
 * MEMORY-OPTIMIZED: Get CATI stats using aggregations
 * This replaces the old approach that loaded all data into memory
 */
exports.getCatiStatsOptimized = async (params) => {
  const {
    surveyId,
    startDate,
    endDate,
    interviewerIds,
    interviewerMode,
    ac,
    projectManagerInterviewerIds = []
  } = params;

  const surveyObjectId = mongoose.Types.ObjectId.isValid(surveyId) 
    ? new mongoose.Types.ObjectId(surveyId) 
    : surveyId;

  // Build date filter
  const dateFilter = {};
  if (startDate) {
    const [year, month, day] = startDate.split('-').map(Number);
    const startDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 30, 0, 0));
    startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
    dateFilter.createdAt = { $gte: startDateUTC };
  }
  if (endDate) {
    const [year, month, day] = endDate.split('-').map(Number);
    const endDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
    dateFilter.createdAt = { 
      ...dateFilter.createdAt, 
      $lte: endDateUTC
    };
  }

  // Build interviewer filter
  let interviewerFilter = {};
  if (projectManagerInterviewerIds.length > 0) {
    interviewerFilter.interviewer = { $in: projectManagerInterviewerIds };
  } else if (interviewerIds && interviewerIds.length > 0) {
    const validIds = interviewerIds
      .filter(id => mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id));
    if (validIds.length > 0) {
      if (interviewerMode === 'exclude') {
        interviewerFilter.interviewer = { $nin: validIds };
      } else {
        interviewerFilter.interviewer = { $in: validIds };
      }
    }
  }

  // Build AC filter
  let acFilter = {};
  if (ac && ac.trim()) {
    acFilter.$or = [
      { 'metadata.respondentContact.ac': ac },
      { 'metadata.respondentContact.assemblyConstituency': ac },
      { 'metadata.respondentContact.acName': ac },
      { 'metadata.respondentContact.assemblyConstituencyName': ac },
      { selectedAC: ac }
    ];
  }

  // ============================================
  // AGGREGATION 1: Response-based stats (Primary source)
  // ============================================
  const responseMatchFilter = {
    survey: surveyObjectId,
    interviewMode: 'cati',
    ...dateFilter,
    ...interviewerFilter,
    ...acFilter
  };

  // Stage 1: Match CATI responses
  const responsePipeline = [
    { $match: responseMatchFilter },
    // Stage 2: Add computed fields for call status extraction
    {
      $addFields: {
        // Extract call status (priority: knownCallStatus > metadata.callStatus > responses array)
        computedCallStatus: {
          $cond: {
            if: { $ne: ['$knownCallStatus', null] },
            then: { $toLower: { $trim: { input: '$knownCallStatus' } } },
            else: {
              $cond: {
                if: { $ne: ['$metadata.callStatus', null] },
                then: { $toLower: { $trim: { input: '$metadata.callStatus' } } },
                else: {
                  $let: {
                    vars: {
                      callStatusResponse: {
                        $arrayElemAt: [
                          {
                            $filter: {
                              input: { $ifNull: ['$responses', []] },
                              as: 'resp',
                              cond: {
                                $or: [
                                  { $eq: ['$$resp.questionId', 'call-status'] },
                                  { $eq: ['$$resp.questionId', 'call_status'] }
                                ]
                              }
                            }
                          },
                          0
                        ]
                      }
                    },
                    in: {
                      $cond: {
                        if: { $ne: ['$$callStatusResponse.response', null] },
                        then: { $toLower: { $trim: { input: '$$callStatusResponse.response' } } },
                        else: 'unknown'
                      }
                    }
                  }
                }
              }
            }
          }
        },
        // Extract AC from responses if needed
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
        }
      }
    },
    // Apply AC filter if needed (after extraction)
    ...(ac && ac.trim() ? [{
      $match: {
        $expr: {
          $eq: [{ $toLower: { $ifNull: ['$extractedAC', ''] } }, ac.toLowerCase()]
        }
      }
    }] : []),
    // Stage 3: Group by interviewer and calculate stats
    {
      $group: {
        _id: '$interviewer',
        // Basic counts
        numberOfDials: { $sum: 1 },
        totalTimeSpent: { $sum: { $ifNull: ['$totalTimeSpent', 0] } },
        // Call status breakdown
        callsConnected: {
          $sum: {
            $cond: {
              if: {
                $in: ['$computedCallStatus', ['call_connected', 'success', 'connected']]
              },
              then: 1,
              else: 0
            }
          }
        },
        ringing: {
          $sum: {
            $cond: {
              if: {
                $not: {
                  $in: ['$computedCallStatus', ['didnt_get_call', 'not_reachable', 'number_does_not_exist']]
                }
              },
              then: 1,
              else: 0
            }
          }
        },
        notRinging: {
          $sum: {
            $cond: {
              if: {
                $in: ['$computedCallStatus', ['switched_off', 'not_reachable', 'number_does_not_exist']]
              },
              then: 1,
              else: 0
            }
          }
        },
        callNotReceivedToTelecaller: {
          $sum: {
            $cond: {
              if: {
                $in: ['$computedCallStatus', ['didnt_get_call', "didn't_get_call"]]
              },
              then: 1,
              else: 0
            }
          }
        },
        switchOff: {
          $sum: {
            $cond: {
              if: { $eq: ['$computedCallStatus', 'switched_off'] },
              then: 1,
              else: 0
            }
          }
        },
        numberNotReachable: {
          $sum: {
            $cond: {
              if: { $eq: ['$computedCallStatus', 'not_reachable'] },
              then: 1,
              else: 0
            }
          }
        },
        numberDoesNotExist: {
          $sum: {
            $cond: {
              if: { $eq: ['$computedCallStatus', 'number_does_not_exist'] },
              then: 1,
              else: 0
            }
          }
        },
        // Response status breakdown
        approved: {
          $sum: {
            $cond: {
              if: { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'approved'] },
              then: 1,
              else: 0
            }
          }
        },
        rejected: {
          $sum: {
            $cond: {
              if: { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'rejected'] },
              then: 1,
              else: 0
            }
          }
        },
        pendingApproval: {
          $sum: {
            $cond: {
              if: { $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'pending_approval'] },
              then: 1,
              else: 0
            }
          }
        },
        completed: {
          $sum: {
            $cond: {
              if: {
                $in: [
                  { $toLower: { $ifNull: ['$status', ''] } },
                  ['approved', 'rejected', 'pending_approval']
                ]
              },
              then: 1,
              else: 0
            }
          }
        },
        incomplete: {
          $sum: {
            $cond: {
              if: {
                $and: [
                  {
                    $in: ['$computedCallStatus', ['call_connected', 'success']]
                  },
                  {
                    $not: {
                      $in: [
                        { $toLower: { $ifNull: ['$status', ''] } },
                        ['approved', 'rejected', 'pending_approval']
                      ]
                    }
                  }
                ]
              },
              then: 1,
              else: 0
            }
          }
        },
        // Store qcBatch IDs for later lookup
        qcBatchIds: { $addToSet: '$qcBatch' }
      }
    },
    // Stage 4: Lookup interviewer details
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'interviewerDetails'
      }
    },
    {
      $unwind: {
        path: '$interviewerDetails',
        preserveNullAndEmptyArrays: true
      }
    },
    // Stage 5: Project final structure
    {
      $project: {
        interviewerId: '$_id',
        interviewerName: {
          $concat: [
            { $ifNull: ['$interviewerDetails.firstName', ''] },
            ' ',
            { $ifNull: ['$interviewerDetails.lastName', ''] }
          ]
        },
        interviewerPhone: { $ifNull: ['$interviewerDetails.phone', ''] },
        memberID: { $ifNull: ['$interviewerDetails.memberId', ''] },
        numberOfDials: 1,
        callsConnected: 1,
        completed: 1,
        approved: 1,
        rejected: 1,
        pendingApproval: 1,
        incomplete: 1,
        totalTimeSpent: 1,
        ringing: 1,
        notRinging: 1,
        callNotReceivedToTelecaller: 1,
        switchOff: 1,
        numberNotReachable: 1,
        numberDoesNotExist: 1,
        qcBatchIds: 1
      }
    }
  ];

  // Execute response aggregation
  const interviewerStats = await SurveyResponse.aggregate(responsePipeline, {
    allowDiskUse: true,
    maxTimeMS: 300000 // 5 minutes
  });

  // ============================================
  // AGGREGATION 2: Call records stats (for callsMade)
  // ============================================
  const callRecordsMatchFilter = {
    survey: surveyObjectId,
    ...dateFilter
  };

  if (projectManagerInterviewerIds.length > 0 || (interviewerIds && interviewerIds.length > 0)) {
    const interviewerFilterForCalls = projectManagerInterviewerIds.length > 0
      ? projectManagerInterviewerIds
      : interviewerIds.filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
    
    if (interviewerFilterForCalls.length > 0) {
      callRecordsMatchFilter.createdBy = { $in: interviewerFilterForCalls };
    }
  }

  // Count total calls made (using aggregation for efficiency)
  const callRecordsStats = await CatiCall.aggregate([
    { $match: callRecordsMatchFilter },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalTalkDuration: { $sum: { $ifNull: ['$talkDuration', 0] } },
        callsAttended: {
          $sum: {
            $cond: {
              if: {
                $or: [
                  { $eq: ['$originalStatusCode', 3] }, // Both Answered
                  { $eq: ['$originalStatusCode', 6] }, // To Unans - From Ans
                  { $eq: ['$originalStatusCode', 10] }, // From Ans
                  { $eq: ['$originalStatusCode', 14] }, // To Failed - From Ans
                  { $eq: ['$originalStatusCode', 16] }, // To Ans - From Failed
                  { $eq: ['$hangupBySource', 1] }
                ]
              },
              then: 1,
              else: 0
            }
          }
        }
      }
    }
  ], {
    allowDiskUse: true,
    maxTimeMS: 300000
  });

  const totalCallsMade = callRecordsStats[0]?.totalCalls || 0;
  const callsAttended = callRecordsStats[0]?.callsAttended || 0;
  const totalTalkDurationFromCalls = callRecordsStats[0]?.totalTalkDuration || 0;

  // ============================================
  // AGGREGATION 3: QC Batch status lookup (for underQCQueue/processingInBatch)
  // ============================================
  // Get all unique qcBatch IDs from interviewer stats
  const allQcBatchIds = [...new Set(
    interviewerStats
      .flatMap(stat => stat.qcBatchIds || [])
      .filter(id => id && mongoose.Types.ObjectId.isValid(id))
      .map(id => new mongoose.Types.ObjectId(id))
  )];

  const qcBatchMap = new Map();
  if (allQcBatchIds.length > 0) {
    const batches = await QCBatch.find({ _id: { $in: allQcBatchIds } })
      .select('_id status remainingDecision')
      .lean();
    
    batches.forEach(batch => {
      qcBatchMap.set(batch._id.toString(), batch);
    });
  }

  // ============================================
  // AGGREGATION 4: Get responses with QC batch info for categorization
  // ============================================
  const qcStatusPipeline = [
    { $match: responseMatchFilter },
    {
      $match: {
        status: 'Pending_Approval'
      }
    },
    {
      $group: {
        _id: {
          interviewer: '$interviewer',
          qcBatch: '$qcBatch',
          isSampleResponse: { $ifNull: ['$isSampleResponse', false] }
        },
        count: { $sum: 1 }
      }
    }
  ];

  const qcStatusStats = await SurveyResponse.aggregate(qcStatusPipeline, {
    allowDiskUse: true,
    maxTimeMS: 300000
  });

  // Build QC status map
  const qcStatusMap = new Map();
  qcStatusStats.forEach(stat => {
    const interviewerId = stat._id.interviewer?.toString();
    if (!interviewerId) return;

    if (!qcStatusMap.has(interviewerId)) {
      qcStatusMap.set(interviewerId, {
        underQCQueue: 0,
        processingInBatch: 0
      });
    }

    const qcStatus = qcStatusMap.get(interviewerId);
    const batchId = stat._id.qcBatch?.toString();
    const batch = batchId ? qcBatchMap.get(batchId) : null;
    const isSampleResponse = stat._id.isSampleResponse;

    if (batch) {
      const batchStatus = batch.status;
      const remainingDecision = batch.remainingDecision?.decision;

      if (batchStatus === 'queued_for_qc' ||
          (isSampleResponse && (batchStatus === 'qc_in_progress' || batchStatus === 'completed')) ||
          (!isSampleResponse && remainingDecision === 'queued_for_qc')) {
        qcStatus.underQCQueue += stat.count;
      } else if (batchStatus === 'collecting' ||
                 (batchStatus === 'processing' && !isSampleResponse)) {
        qcStatus.processingInBatch += stat.count;
      } else {
        qcStatus.processingInBatch += stat.count;
      }
    } else {
      qcStatus.processingInBatch += stat.count;
    }
  });

  // ============================================
  // Aggregate final stats from interviewer stats
  // ============================================
  const formatDuration = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Calculate totals
  const totalCallsMadeFromStats = interviewerStats.reduce((sum, stat) => sum + (stat.numberOfDials || 0), 0);
  const totalCallsAttendedFromStats = interviewerStats.reduce((sum, stat) => sum + (stat.ringing || 0), 0);
  const totalCallsConnected = interviewerStats.reduce((sum, stat) => sum + (stat.callsConnected || 0), 0);
  const totalCallNotReceived = interviewerStats.reduce((sum, stat) => sum + (stat.callNotReceivedToTelecaller || 0), 0);
  const totalNotRinging = interviewerStats.reduce((sum, stat) => sum + (stat.notRinging || 0), 0);
  const totalSwitchOff = interviewerStats.reduce((sum, stat) => sum + (stat.switchOff || 0), 0);
  const totalNumberNotReachable = interviewerStats.reduce((sum, stat) => sum + (stat.numberNotReachable || 0), 0);
  const totalNumberDoesNotExist = interviewerStats.reduce((sum, stat) => sum + (stat.numberDoesNotExist || 0), 0);
  const totalTalkDurationFromResponses = interviewerStats.reduce((sum, stat) => sum + (stat.totalTimeSpent || 0), 0);

  // Combine interviewer stats with QC status
  const interviewerStatsWithQC = interviewerStats.map((stat, index) => {
    const interviewerId = stat.interviewerId?.toString();
    const qcStatus = qcStatusMap.get(interviewerId) || { underQCQueue: 0, processingInBatch: 0 };

    return {
      sNo: index + 1,
      interviewerId: stat.interviewerId,
      interviewerName: stat.interviewerName?.trim() || 'Unknown',
      interviewerPhone: stat.interviewerPhone || '',
      memberID: stat.memberID || stat.interviewerId?.toString() || 'N/A',
      numberOfDials: stat.numberOfDials || 0,
      callsConnected: stat.callsConnected || 0,
      completed: stat.completed || 0,
      approved: stat.approved || 0,
      underQCQueue: qcStatus.underQCQueue || 0,
      processingInBatch: qcStatus.processingInBatch || 0,
      rejected: stat.rejected || 0,
      incomplete: stat.incomplete || 0,
      formDuration: formatDuration(stat.totalTimeSpent || 0),
      callNotReceivedToTelecaller: stat.callNotReceivedToTelecaller || 0,
      ringing: stat.ringing || 0,
      notRinging: stat.notRinging || 0,
      switchOff: stat.switchOff || 0,
      numberNotReachable: stat.numberNotReachable || 0,
      numberDoesNotExist: stat.numberDoesNotExist || 0,
      noResponseByTelecaller: 0 // Calculate from call records if needed
    };
  });

  // Return optimized result
  return {
    callerPerformance: {
      callsMade: totalCallsMadeFromStats || totalCallsMade,
      callsAttended: totalCallsAttendedFromStats || callsAttended,
      callsConnected: totalCallsConnected,
      totalTalkDuration: formatDuration(totalTalkDurationFromResponses || totalTalkDurationFromCalls)
    },
    numberStats: {
      callNotReceived: totalCallNotReceived,
      ringing: totalCallsAttendedFromStats - totalNotRinging, // Respondent Ph. Ringing
      notRinging: totalNotRinging
    },
    callNotRingStatus: {
      switchOff: totalSwitchOff,
      numberNotReachable: totalNumberNotReachable,
      numberDoesNotExist: totalNumberDoesNotExist
    },
    callRingStatus: {
      callsConnected: totalCallsConnected,
      callsNotConnected: totalCallsAttendedFromStats - totalCallsConnected
    },
    interviewerStats: interviewerStatsWithQC,
    callRecords: [] // Not needed for stats, empty array to maintain API compatibility
  };
};



