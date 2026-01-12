require('dotenv').config();
const mongoose = require('mongoose');
const SurveyResponse = require('../models/SurveyResponse');
const User = require('../models/User');
const Survey = require('../models/Survey');
const fs = require('fs');
const path = require('path');

// IST timezone offset (UTC+5:30)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// Get today's date in IST
function getTodayIST() {
  const now = new Date();
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  const year = nowIST.getUTCFullYear();
  const month = String(nowIST.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowIST.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Convert IST date string to UTC date range
function getISTDateStartUTC(istDateStr) {
  const [year, month, day] = istDateStr.split('-').map(Number);
  const startDateUTC = new Date(Date.UTC(year, month - 1, day, 18, 30, 0, 0));
  startDateUTC.setUTCDate(startDateUTC.getUTCDate() - 1);
  return startDateUTC;
}

function getISTDateEndUTC(istDateStr) {
  const [year, month, day] = istDateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 18, 29, 59, 999));
}

async function generateTodayReviewsReport() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const todayIST = getTodayIST();
    console.log(`📅 Today's date (IST): ${todayIST}`);

    // Get date range for today in UTC
    const dateStart = getISTDateStartUTC(todayIST);
    const dateEnd = getISTDateEndUTC(todayIST);

    console.log(`   UTC Start: ${dateStart.toISOString()}`);
    console.log(`   UTC End: ${dateEnd.toISOString()}`);

    // Get all reviews done today
    const todayReviews = await SurveyResponse.aggregate([
      {
        $match: {
          'verificationData.reviewer': { $exists: true, $ne: null },
          'verificationData.reviewedAt': {
            $gte: dateStart,
            $lte: dateEnd
          }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'verificationData.reviewer',
          foreignField: '_id',
          as: 'reviewer'
        }
      },
      {
        $lookup: {
          from: 'surveys',
          localField: 'survey',
          foreignField: '_id',
          as: 'survey'
        }
      },
      {
        $project: {
          responseId: 1,
          status: 1,
          reviewedAt: '$verificationData.reviewedAt',
          reviewerId: '$verificationData.reviewer',
          reviewerName: { $arrayElemAt: ['$reviewer.firstName', 0] },
          reviewerLastName: { $arrayElemAt: ['$reviewer.lastName', 0] },
          reviewerEmail: { $arrayElemAt: ['$reviewer.email', 0] },
          reviewerMemberId: { $arrayElemAt: ['$reviewer.memberId', 0] },
          surveyName: { $arrayElemAt: ['$survey.surveyName', 0] },
          surveyId: '$survey'
        }
      },
      {
        $sort: { reviewedAt: -1 }
      }
    ]);

    console.log(`\n📊 Total Reviews Today: ${todayReviews.length}`);

    // Group by reviewer
    const byReviewer = {};
    todayReviews.forEach(review => {
      const reviewerId = review.reviewerId.toString();
      if (!byReviewer[reviewerId]) {
        byReviewer[reviewerId] = {
          reviewerId,
          name: `${review.reviewerName || ''} ${review.reviewerLastName || ''}`.trim() || review.reviewerEmail || 'Unknown',
          email: review.reviewerEmail || 'N/A',
          memberId: review.reviewerMemberId || 'N/A',
          total: 0,
          approved: 0,
          rejected: 0,
          pending: 0
        };
      }
      byReviewer[reviewerId].total++;
      if (review.status === 'Approved') byReviewer[reviewerId].approved++;
      else if (review.status === 'Rejected') byReviewer[reviewerId].rejected++;
      else if (review.status === 'Pending_Approval') byReviewer[reviewerId].pending++;
    });

    // Group by survey
    const bySurvey = {};
    todayReviews.forEach(review => {
      const surveyId = review.surveyId?.toString() || 'Unknown';
      const surveyName = review.surveyName || 'Unknown Survey';
      if (!bySurvey[surveyId]) {
        bySurvey[surveyId] = {
          surveyId,
          surveyName,
          total: 0,
          approved: 0,
          rejected: 0,
          pending: 0
        };
      }
      bySurvey[surveyId].total++;
      if (review.status === 'Approved') bySurvey[surveyId].approved++;
      else if (review.status === 'Rejected') bySurvey[surveyId].rejected++;
      else if (review.status === 'Pending_Approval') bySurvey[surveyId].pending++;
    });

    // Generate report
    const reportLines = [];
    reportLines.push('='.repeat(80));
    reportLines.push('TODAY\'S REVIEWS REPORT');
    reportLines.push('='.repeat(80));
    reportLines.push(`Generated: ${new Date().toISOString()}`);
    reportLines.push(`Date (IST): ${todayIST}`);
    reportLines.push(`Total Reviews: ${todayReviews.length}`);
    reportLines.push('');

    // Summary by Reviewer
    reportLines.push('─'.repeat(80));
    reportLines.push('SUMMARY BY REVIEWER');
    reportLines.push('─'.repeat(80));
    reportLines.push('');
    
    const reviewersArray = Object.values(byReviewer).sort((a, b) => b.total - a.total);
    reportLines.push('Reviewer Name'.padEnd(30) + 'Email'.padEnd(30) + 'Member ID'.padEnd(15) + 'Total'.padEnd(10) + 'Approved'.padEnd(10) + 'Rejected'.padEnd(10) + 'Pending');
    reportLines.push('-'.repeat(80));
    
    reviewersArray.forEach(reviewer => {
      reportLines.push(
        reviewer.name.padEnd(30) +
        reviewer.email.padEnd(30) +
        String(reviewer.memberId).padEnd(15) +
        String(reviewer.total).padEnd(10) +
        String(reviewer.approved).padEnd(10) +
        String(reviewer.rejected).padEnd(10) +
        String(reviewer.pending)
      );
    });

    reportLines.push('');
    reportLines.push('─'.repeat(80));
    reportLines.push('SUMMARY BY SURVEY');
    reportLines.push('─'.repeat(80));
    reportLines.push('');
    
    const surveysArray = Object.values(bySurvey).sort((a, b) => b.total - a.total);
    reportLines.push('Survey Name'.padEnd(50) + 'Total'.padEnd(10) + 'Approved'.padEnd(10) + 'Rejected'.padEnd(10) + 'Pending');
    reportLines.push('-'.repeat(80));
    
    surveysArray.forEach(survey => {
      reportLines.push(
        survey.surveyName.padEnd(50) +
        String(survey.total).padEnd(10) +
        String(survey.approved).padEnd(10) +
        String(survey.rejected).padEnd(10) +
        String(survey.pending)
      );
    });

    reportLines.push('');
    reportLines.push('─'.repeat(80));
    reportLines.push('DETAILED REVIEWS (Last 50)');
    reportLines.push('─'.repeat(80));
    reportLines.push('');
    
    reportLines.push('Response ID'.padEnd(20) + 'Reviewer'.padEnd(30) + 'Survey'.padEnd(30) + 'Status'.padEnd(15) + 'Reviewed At');
    reportLines.push('-'.repeat(80));
    
    todayReviews.slice(0, 50).forEach(review => {
      const reviewerName = `${review.reviewerName || ''} ${review.reviewerLastName || ''}`.trim() || review.reviewerEmail || 'Unknown';
      const reviewedAt = review.reviewedAt ? new Date(review.reviewedAt).toISOString() : 'N/A';
      reportLines.push(
        String(review.responseId || 'N/A').padEnd(20) +
        reviewerName.padEnd(30) +
        (review.surveyName || 'Unknown').padEnd(30) +
        String(review.status || 'N/A').padEnd(15) +
        reviewedAt
      );
    });

    if (todayReviews.length > 50) {
      reportLines.push('');
      reportLines.push(`... and ${todayReviews.length - 50} more reviews`);
    }

    reportLines.push('');
    reportLines.push('='.repeat(80));

    // Save report
    const reportDir = path.join(__dirname, '../../MyLogos');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const reportPath = path.join(reportDir, `today_reviews_report_${todayIST.replace(/-/g, '_')}.txt`);
    fs.writeFileSync(reportPath, reportLines.join('\n'), 'utf8');

    console.log(`\n✅ Report saved to: ${reportPath}`);
    console.log(`\n📋 Summary:`);
    console.log(`   Total Reviews: ${todayReviews.length}`);
    console.log(`   Unique Reviewers: ${reviewersArray.length}`);
    console.log(`   Unique Surveys: ${surveysArray.length}`);
    console.log(`   Total Approved: ${reviewersArray.reduce((sum, r) => sum + r.approved, 0)}`);
    console.log(`   Total Rejected: ${reviewersArray.reduce((sum, r) => sum + r.rejected, 0)}`);
    console.log(`   Total Pending: ${reviewersArray.reduce((sum, r) => sum + r.pending, 0)}`);

    // Print top 10 reviewers
    console.log(`\n🏆 Top 10 Reviewers Today:`);
    reviewersArray.slice(0, 10).forEach((reviewer, index) => {
      console.log(`   ${index + 1}. ${reviewer.name} (${reviewer.email}) - ${reviewer.total} reviews`);
    });

  } catch (error) {
    console.error('❌ Error generating report:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('\n✅ Database connection closed');
  }
}

generateTodayReviewsReport();

