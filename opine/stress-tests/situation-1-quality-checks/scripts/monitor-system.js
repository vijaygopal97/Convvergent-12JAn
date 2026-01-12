/**
 * System Monitor for Stress Tests
 * Monitors system performance during stress tests
 */

class SystemMonitor {
  constructor(testId, reportDir) {
    this.testId = testId;
    this.reportDir = reportDir;
    this.monitoring = false;
    this.intervalId = null;
    this.metrics = [];
  }

  start(intervalMs = 1000) {
    this.monitoring = true;
    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, intervalMs);
  }

  stop() {
    this.monitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  collectMetrics() {
    // Simple metrics collection - can be extended
    const timestamp = Date.now();
    this.metrics.push({
      timestamp,
      memory: process.memoryUsage()
    });
  }

  getMetrics() {
    return this.metrics;
  }

  clear() {
    this.metrics = [];
  }
}

module.exports = SystemMonitor;
