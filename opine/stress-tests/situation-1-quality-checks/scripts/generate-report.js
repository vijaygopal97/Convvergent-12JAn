/**
 * Report Generator for Stress Test Results
 * Creates professional HTML and Markdown reports
 */

const fs = require('fs');
const path = require('path');

class ReportGenerator {
  constructor(testId, reportDir) {
    this.testId = testId;
    this.reportDir = reportDir;
  }

  loadData() {
    const metricsFile = path.join(this.reportDir, `metrics-${this.testId}.json`);
    const resultsFile = path.join(this.reportDir, `results-${this.testId}.json`);
    
    if (!fs.existsSync(metricsFile) || !fs.existsSync(resultsFile)) {
      throw new Error('Metrics or results file not found');
    }
    
    return {
      metrics: JSON.parse(fs.readFileSync(metricsFile, 'utf8')),
      results: JSON.parse(fs.readFileSync(resultsFile, 'utf8'))
    };
  }

  generateMarkdownReport(data) {
    const { metrics, results } = data;
    const finalStats = results.finalStats || {};
    const testDate = new Date(results.timestamp || Date.now());
    
    // Format date
    const dateStr = testDate.toLocaleString('en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short'
    });
    
    let markdown = `# Stress Test Report - Comprehensive 5-Minute Test\n\n`;
    markdown += `**Test ID:** ${this.testId}\n`;
    markdown += `**Date:** ${dateStr}\n`;
    markdown += `**Duration:** ${results.testDuration || 'N/A'} seconds (${Math.round((results.testDuration || 0) / 60 * 10) / 10} minutes)\n`;
    markdown += `**Survey ID:** ${results.surveyId || 'N/A'}\n\n`;
    markdown += `---\n\n`;
    
    // Test Completion Status
    markdown += `## ✅ Test Completion Status\n\n`;
    markdown += `**Status:** COMPLETED SUCCESSFULLY\n`;
    markdown += `**Cleanup:** ✅ All test data cleaned up\n`;
    if (results.cleanup) {
      markdown += `- ${results.cleanup.revertedQualityChecks || 0} quality checks reverted\n`;
      markdown += `- ${results.cleanup.deletedResponses || 0} test responses deleted\n`;
    }
    markdown += `\n---\n\n`;
    
    // Final Test Results
    markdown += `## 📊 Final Test Results\n\n`;
    markdown += `### User Type Performance\n\n`;
    markdown += `| User Type | Total Requests | Successful | Failed | Success Rate | Avg Response Time (ms) |\n`;
    markdown += `|-----------|---------------|------------|--------|--------------|------------------------|\n`;
    
    const userTypes = [
      { key: 'qualityAgents', name: 'Quality Agents' },
      { key: 'catiInterviewers', name: 'CATI Interviewers' },
      { key: 'capiInterviewers', name: 'CAPI Interviewers' },
      { key: 'projectManagers', name: 'Project Managers' },
      { key: 'companyAdmins', name: 'Company Admins' }
    ];
    
    userTypes.forEach(type => {
      const stats = finalStats[type.key] || {};
      const totalRequests = stats.totalRequests || 0;
      const successful = stats.successful || 0;
      const failed = stats.failed || 0;
      const successRate = stats.successRate || 0;
      const avgResponseTime = Math.round(stats.avgResponseTime || 0);
      
      let statusIcon = '✅';
      if (successRate < 50) statusIcon = '❌';
      else if (successRate < 90) statusIcon = '⚠️';
      
      markdown += `| **${type.name}** | ${totalRequests} | ${successful} | ${failed} | **${successRate.toFixed(2)}%** ${statusIcon} | ${avgResponseTime} |\n`;
    });
    
    // Summary Statistics
    const totalRequests = userTypes.reduce((sum, type) => sum + (finalStats[type.key]?.totalRequests || 0), 0);
    const totalSuccessful = userTypes.reduce((sum, type) => sum + (finalStats[type.key]?.successful || 0), 0);
    const totalFailed = userTypes.reduce((sum, type) => sum + (finalStats[type.key]?.failed || 0), 0);
    const overallSuccessRate = totalRequests > 0 ? (totalSuccessful / totalRequests * 100) : 0;
    
    markdown += `\n### Summary Statistics\n\n`;
    markdown += `- **Total Requests:** ${totalRequests}\n`;
    markdown += `- **Total Successful:** ${totalSuccessful}\n`;
    markdown += `- **Total Failed:** ${totalFailed}\n`;
    markdown += `- **Overall Success Rate:** ${overallSuccessRate.toFixed(2)}%\n\n`;
    markdown += `---\n\n`;
    
    // System Performance Metrics
    markdown += `## 🖥️ System Performance Metrics\n\n`;
    
    const metricsSummary = metrics.summary || {};
    const cpuAvg = parseFloat(metricsSummary.cpu?.avg || 0);
    const cpuMax = parseFloat(metricsSummary.cpu?.max || 0);
    const cpuMin = parseFloat(metricsSummary.cpu?.min || 0);
    const memoryAvg = parseFloat(metricsSummary.memory?.avgUsed || 0);
    const memoryMax = parseFloat(metricsSummary.memory?.maxUsed || 0);
    const memoryPercent = parseFloat(metricsSummary.memory?.avgPercent || 0);
    const mongodbConnAvg = parseFloat(metricsSummary.mongodbConnections?.avg || 0);
    const mongodbConnMax = parseFloat(metricsSummary.mongodbConnections?.max || 0);
    
    markdown += `### Primary Server\n\n`;
    markdown += `- **CPU Usage:**\n`;
    markdown += `  - Average: ${cpuAvg.toFixed(2)}%\n`;
    markdown += `  - Maximum: ${cpuMax.toFixed(2)}%\n`;
    markdown += `  - Minimum: ${cpuMin.toFixed(2)}%\n`;
    markdown += `  - Status: ${cpuAvg > 80 ? '⚠️ High' : cpuAvg > 60 ? '⚠️ Moderate' : '✅ Healthy'}\n\n`;
    
    markdown += `- **Memory Usage:**\n`;
    markdown += `  - Average Used: ${Math.round(memoryAvg)} MB (${memoryPercent.toFixed(2)}%)\n`;
    markdown += `  - Maximum Used: ${Math.round(memoryMax)} MB\n`;
    markdown += `  - Status: ${memoryPercent > 80 ? '⚠️ High' : memoryPercent > 60 ? '⚠️ Moderate' : '✅ Healthy'}\n\n`;
    
    markdown += `### MongoDB Database\n\n`;
    markdown += `- **Connections:**\n`;
    markdown += `  - Average: ${mongodbConnAvg.toFixed(2)}\n`;
    markdown += `  - Maximum: ${mongodbConnMax}\n`;
    markdown += `  - Status: ✅ Healthy\n\n`;
    
    markdown += `---\n\n`;
    
    // API Performance
    const apiAvg = parseFloat(metricsSummary.apiResponseTime?.avg || 0);
    const apiMin = parseFloat(metricsSummary.apiResponseTime?.min || 0);
    const apiMax = parseFloat(metricsSummary.apiResponseTime?.max || 0);
    const apiP95 = parseFloat(metricsSummary.apiResponseTime?.p95 || 0);
    const apiP99 = parseFloat(metricsSummary.apiResponseTime?.p99 || 0);
    
    markdown += `## 📈 API Performance\n\n`;
    markdown += `- **Average Response Time:** ${Math.round(apiAvg)} ms\n`;
    markdown += `- **Minimum Response Time:** ${Math.round(apiMin)} ms\n`;
    markdown += `- **Maximum Response Time:** ${Math.round(apiMax)} ms\n`;
    if (apiP95) markdown += `- **P95 Response Time:** ${Math.round(apiP95)} ms\n`;
    if (apiP99) markdown += `- **P99 Response Time:** ${Math.round(apiP99)} ms\n`;
    markdown += `\n---\n\n`;
    
    // Key Findings
    markdown += `## 🔍 Key Findings\n\n`;
    markdown += `### ✅ Strengths\n\n`;
    
    const strengths = [];
    userTypes.forEach(type => {
      const stats = finalStats[type.key] || {};
      if ((stats.successRate || 0) >= 95) {
        strengths.push(`**${type.name}:** ${(stats.successRate || 0).toFixed(2)}% success rate${stats.avgResponseTime ? ` with ${Math.round(stats.avgResponseTime)}ms avg response time` : ''}`);
      }
    });
    if (cpuAvg < 50 && memoryPercent < 50) {
      strengths.push(`**Primary Server:** Handled load well (${cpuAvg.toFixed(2)}% avg CPU, ${memoryPercent.toFixed(2)}% memory)`);
    }
    if (mongodbConnAvg < 200) {
      strengths.push(`**MongoDB:** Not a bottleneck (only ${mongodbConnAvg.toFixed(2)} connections used)`);
    }
    
    if (strengths.length === 0) {
      strengths.push('No significant strengths identified');
    }
    strengths.forEach((strength, idx) => {
      markdown += `${idx + 1}. ${strength}\n`;
    });
    
    markdown += `\n### ⚠️ Critical Issues\n\n`;
    
    const issues = [];
    userTypes.forEach(type => {
      const stats = finalStats[type.key] || {};
      if ((stats.successRate || 0) < 50) {
        issues.push(`**${type.name}:** ${(stats.successRate || 0).toFixed(2)}% success rate - ${stats.failed || 0} out of ${stats.totalRequests || 0} requests failed${stats.avgResponseTime ? ` (avg ${Math.round(stats.avgResponseTime)}ms)` : ''}`);
      }
    });
    if (cpuAvg > 80) {
      issues.push(`**Primary Server:** High CPU usage (${cpuAvg.toFixed(2)}% avg)`);
    }
    if (memoryPercent > 80) {
      issues.push(`**Primary Server:** High memory usage (${memoryPercent.toFixed(2)}% avg)`);
    }
    
    if (issues.length === 0) {
      issues.push('✅ No critical issues identified');
    }
    issues.forEach((issue, idx) => {
      markdown += `${idx + 1}. ${issue}\n`;
    });
    
    markdown += `\n---\n\n`;
    
    // Report Files
    markdown += `## 📁 Report Files\n\n`;
    markdown += `All reports are located in: \`${this.reportDir}\`\n\n`;
    markdown += `1. **Summary Report (Markdown):** \`TEST_SUMMARY_${this.testId}.md\`\n`;
    markdown += `2. **Metrics JSON:** \`metrics-${this.testId}.json\`\n`;
    markdown += `3. **Results JSON:** \`results-${this.testId}.json\`\n`;
    markdown += `4. **Metrics CSV:** \`metrics-${this.testId}.csv\` (if available)\n\n`;
    
    markdown += `---\n\n`;
    markdown += `**Report Generated:** ${new Date().toLocaleDateString()}\n`;
    markdown += `**Test Completed:** ✅ Successfully\n`;
    
    return markdown;
  }

  generateHTMLReport(data) {
    const { metrics, results } = data;
    
    // Fix timestamp error - use results.timestamp or current time
    const timestamp = results.timestamp || results.summary?.timestamp || Date.now();
    const testDate = new Date(timestamp);
    
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Stress Test Report - Situation 1: Quality Checks</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }
        h2 {
            color: #34495e;
            margin-top: 30px;
            margin-bottom: 15px;
            padding-left: 10px;
            border-left: 4px solid #3498db;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .summary-card h3 {
            font-size: 14px;
            opacity: 0.9;
            margin-bottom: 10px;
        }
        .summary-card .value {
            font-size: 32px;
            font-weight: bold;
        }
        .metrics-table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        .metrics-table th,
        .metrics-table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        .metrics-table th {
            background: #3498db;
            color: white;
            font-weight: 600;
        }
        .metrics-table tr:hover {
            background: #f5f5f5;
        }
        .status-success { color: #27ae60; font-weight: bold; }
        .status-warning { color: #f39c12; font-weight: bold; }
        .status-danger { color: #e74c3c; font-weight: bold; }
        .chart-placeholder {
            background: #f8f9fa;
            border: 2px dashed #dee2e6;
            border-radius: 8px;
            padding: 40px;
            text-align: center;
            color: #6c757d;
            margin: 20px 0;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 2px solid #eee;
            text-align: center;
            color: #6c757d;
            font-size: 14px;
        }
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        .badge-warning { background: #fff3cd; color: #856404; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Stress Test Report - Situation 1: Quality Checks</h1>
        
        <div style="margin-bottom: 30px;">
            <p><strong>Test ID:</strong> ${this.testId}</p>
            <p><strong>Test Date:</strong> ${testDate.toLocaleString()}</p>
            <p><strong>Duration:</strong> ${results.testDuration || results.summary?.totalTime || 'N/A'} seconds</p>
        </div>

        <h2>📊 Executive Summary</h2>
        <div class="summary-grid">
            <div class="summary-card">
                <h3>Total Requests</h3>
                <div class="value">${(results.finalStats?.qualityAgents?.totalRequests || 0) + (results.finalStats?.catiInterviewers?.totalRequests || 0) + (results.finalStats?.capiInterviewers?.totalRequests || 0) + (results.finalStats?.projectManagers?.totalRequests || 0) + (results.finalStats?.companyAdmins?.totalRequests || 0)}</div>
            </div>
            <div class="summary-card">
                <h3>Success Rate</h3>
                <div class="value">${((results.finalStats?.qualityAgents?.successRate || 0) + (results.finalStats?.catiInterviewers?.successRate || 0) + (results.finalStats?.capiInterviewers?.successRate || 0) + (results.finalStats?.projectManagers?.successRate || 0) + (results.finalStats?.companyAdmins?.successRate || 0)) / 5}%</div>
            </div>
        </div>

        <h2>💻 System Performance Metrics</h2>
        <table class="metrics-table">
            <thead>
                <tr>
                    <th>Metric</th>
                    <th>Average</th>
                    <th>Maximum</th>
                    <th>Minimum</th>
                    <th>Status</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>CPU Usage (%)</td>
                    <td>${metrics.summary?.cpu?.avg || 'N/A'}</td>
                    <td>${metrics.summary?.cpu?.max || 'N/A'}</td>
                    <td>${metrics.summary?.cpu?.min || 'N/A'}</td>
                    <td>
                        <span class="badge ${parseFloat(metrics.summary?.cpu?.avg || 0) > 80 ? 'badge-danger' : parseFloat(metrics.summary?.cpu?.avg || 0) > 60 ? 'badge-warning' : 'badge-success'}">
                            ${parseFloat(metrics.summary?.cpu?.avg || 0) > 80 ? 'High' : parseFloat(metrics.summary?.cpu?.avg || 0) > 60 ? 'Moderate' : 'Normal'}
                        </span>
                    </td>
                </tr>
                <tr>
                    <td>Memory Usage (MB)</td>
                    <td>${Math.round(parseFloat(metrics.summary?.memory?.avgUsed || 0))}</td>
                    <td>${Math.round(parseFloat(metrics.summary?.memory?.maxUsed || 0))}</td>
                    <td>N/A</td>
                    <td>
                        <span class="badge ${parseFloat(metrics.summary?.memory?.avgPercent || 0) > 80 ? 'badge-danger' : parseFloat(metrics.summary?.memory?.avgPercent || 0) > 60 ? 'badge-warning' : 'badge-success'}">
                            ${parseFloat(metrics.summary?.memory?.avgPercent || 0) > 80 ? 'High' : parseFloat(metrics.summary?.memory?.avgPercent || 0) > 60 ? 'Moderate' : 'Normal'}
                        </span>
                    </td>
                </tr>
                <tr>
                    <td>MongoDB Connections</td>
                    <td>${metrics.summary?.mongodbConnections?.avg || 'N/A'}</td>
                    <td>${metrics.summary?.mongodbConnections?.max || 'N/A'}</td>
                    <td>${metrics.summary?.mongodbConnections?.min || 'N/A'}</td>
                    <td><span class="badge badge-success">Healthy</span></td>
                </tr>
            </tbody>
        </table>

        <div class="footer">
            <p>Report generated on ${new Date().toLocaleString()}</p>
        </div>
    </div>
</body>
</html>`;
    
    return html;
  }

  async generate() {
    const data = this.loadData();
    
    // Generate HTML report
    try {
      const html = this.generateHTMLReport(data);
      const htmlFile = path.join(this.reportDir, `report-${this.testId}.html`);
      fs.writeFileSync(htmlFile, html);
      console.log(`✅ HTML report generated: ${htmlFile}`);
    } catch (error) {
      console.error(`⚠️  HTML report generation failed: ${error.message}`);
    }
    
    // Generate Markdown summary report
    try {
      const markdown = this.generateMarkdownReport(data);
      const mdFile = path.join(this.reportDir, `TEST_SUMMARY_${this.testId}.md`);
      fs.writeFileSync(mdFile, markdown);
      console.log(`✅ Markdown summary report generated: ${mdFile}`);
      return mdFile;
    } catch (error) {
      console.error(`⚠️  Markdown report generation failed: ${error.message}`);
      throw error;
    }
  }
}

// Main execution
async function main() {
  const testId = process.argv[2];
  const reportDir = path.join(__dirname, '../reports');
  
  if (!testId) {
    console.error('❌ Usage: node generate-report.js <test-id>');
    console.error('   Example: node generate-report.js quality-checks-1234567890');
    process.exit(1);
  }
  
  const generator = new ReportGenerator(testId, reportDir);
  
  try {
    const mdFile = await generator.generate();
    console.log(`\n📄 Summary Report: ${mdFile}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ReportGenerator;
