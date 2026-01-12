# Load Balancer Status Report
**Generated:** $(date)
**Primary Server:** 172.31.43.71 (Current Server)

## 🔧 Load Balancer Configuration

### Nginx Upstream Configuration
```
upstream opine_backend {
    # Primary server (this server) - weight 3 (receives 50% of traffic)
    server 172.31.43.71:5000 weight=3 max_fails=3 fail_timeout=30s;
    
    # Secondary Server 1 - weight 2 (receives 33% of traffic)
    server 13.233.231.180:5000 weight=2 max_fails=3 fail_timeout=30s;
    
    # Secondary Server 2 - weight 1 (receives 17% of traffic)
    server 13.127.22.11:5000 weight=1 max_fails=3 fail_timeout=30s;
    
    # Load balancing method
    least_conn;
    
    # Keep connections alive
    keepalive 32;
}
```

**Status:** ✅ Configured and Active

## 🖥️ Server Status

### PRIMARY SERVER (172.31.43.71) - Current Server
- **Backend Status:** ✅ Running (2 PM2 instances)
- **Health Check:** ✅ Healthy
- **System Load:** 3.34, 3.70, 4.21
- **Memory:** 2.2Gi / 30Gi used
- **CPU:** High (52.3% user)
- **Uptime:** 17h 24m
- **Restarts:** 47 (frequent restarts - needs attention)

### SECONDARY SERVER 1 (13.233.231.180)
- **Backend Status:** ✅ Running (5 PM2 instances)
- **Health Check:** ❌ Failed (needs investigation)
- **System Load:** 0.01, 0.09, 0.08 (Very Low)
- **Memory:** 6.9Gi / 30Gi used
- **Uptime:** 12h+
- **Restarts:** 2200+ (very high - needs attention)
- **MongoDB Role:** PRIMARY (This server is MongoDB primary!)

### SECONDARY SERVER 2 (13.127.22.11)
- **Backend Status:** ✅ Running (5 PM2 instances)
- **Health Check:** ❌ Failed (needs investigation)
- **System Load:** 2.06, 1.70, 1.50
- **Memory:** 3.0Gi / 3.7Gi used (High usage - 81%)
- **Uptime:** 12h+
- **Restarts:** 18 (normal)
- **MongoDB Role:** SECONDARY

## 🗄️ MongoDB Replica Set Status

| Server | Role | Health | Status |
|--------|------|--------|--------|
| 13.202.181.167:27017 | (not reachable) | 0 | ❌ Not Reachable |
| 13.233.231.180:27017 | PRIMARY | 1 | ✅ Healthy |
| 13.127.22.11:27017 | SECONDARY | 1 | ✅ Healthy |

**Note:** The MongoDB PRIMARY is on Secondary Server 1 (13.233.231.180), not on the current primary backend server.

## ⚠️ Issues Identified

1. **Load Balancing Not Working:**
   - All traffic is going to primary server (0 connections to secondary servers)
   - Secondary servers' health checks are failing
   - Nginx is likely marking secondary servers as down

2. **Secondary Server Health Checks Failing:**
   - Both secondary servers return errors on `/health` endpoint
   - Need to check if port 5000 is accessible from primary server
   - Need to verify firewall rules

3. **High Restart Count:**
   - Primary server: 47 restarts (frequent crashes)
   - Secondary Server 1: 2200+ restarts (critical issue)
   - Secondary Server 2: 18 restarts (normal)

4. **Memory Usage:**
   - Secondary Server 2: 81% memory usage (high)
   - Primary server: High CPU usage (52.3%)

5. **MongoDB Configuration:**
   - Old primary (13.202.181.167) is not reachable
   - Current primary is on Secondary Server 1 (13.233.231.180)

## 🔍 Recommendations

1. **Fix Secondary Server Health Checks:**
   - Check if port 5000 is open on secondary servers
   - Verify firewall rules allow connections from primary server
   - Test health endpoint directly: `curl http://13.233.231.180:5000/health`

2. **Investigate High Restart Counts:**
   - Check PM2 logs on Secondary Server 1 (2200+ restarts)
   - Review error logs for crash patterns
   - Check memory limits and resource constraints

3. **Optimize Resource Usage:**
   - Reduce PM2 instances on Secondary Server 1 (5 instances may be too many)
   - Monitor memory usage on Secondary Server 2
   - Consider adjusting PM2 memory limits

4. **MongoDB Connection:**
   - Update MongoDB connection string if needed
   - Verify all servers can connect to replica set
   - Check if old primary (13.202.181.167) should be removed from replica set

5. **Load Balancer Testing:**
   - Once health checks pass, test traffic distribution
   - Monitor Nginx access logs for backend server distribution
   - Verify `least_conn` method is working correctly

## 📊 Current Traffic Distribution

**All traffic is currently going to PRIMARY SERVER only:**
- Primary Server: 100% of traffic
- Secondary Server 1: 0% (marked as down)
- Secondary Server 2: 0% (marked as down)

**Expected Distribution (once working):**
- Primary Server: 50% (weight=3)
- Secondary Server 1: 33% (weight=2)
- Secondary Server 2: 17% (weight=1)





