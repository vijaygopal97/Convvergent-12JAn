# MongoDB Connection Issue - Fix Required

## 🔍 Current Situation

### ✅ Report Generated Successfully
- **Report File:** `/var/www/opine/reports/Rejected_Interviews_Report_Dulal_Ch Roy_2026-01-09.xlsx`
- **Status:** Report generated with 780 unique rejected responses
- **MongoDB:** Currently working but with connection delays

### ⚠️ MongoDB Connection Issue

**Problem:**
Your MongoDB connection string is configured for a replica set with 3 servers:
```
mongodb://...@13.202.181.167:27017,13.233.231.180:27017,13.127.22.11:27017/Opine?replicaSet=rs0&...
```

**Deleted Servers:**
- ❌ `13.233.231.180:27017` - DELETED
- ❌ `13.127.22.11:27017` - DELETED
- ✅ `13.202.181.167:27017` - PRIMARY (Still Active)

**Symptoms:**
- MongoDB connection works but with long timeouts
- Application tries to connect to deleted servers before timing out
- Replica set status checks fail
- Connection delays on application startup

## 🔧 Solution Options

### Option 1: Use Direct Connection to Primary (Recommended)

Update `.env` file to connect directly to primary server:

```bash
# Backup current .env first
cp /var/www/opine/backend/.env /var/www/opine/backend/.env.backup.$(date +%Y%m%d_%H%M%S)

# Update MONGODB_URI to:
MONGODB_URI=mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin&directConnection=true&maxPoolSize=100
```

**Benefits:**
- ✅ Fast connections (no timeout delays)
- ✅ No replica set discovery overhead
- ✅ Works immediately

**Note:** This assumes you're using a standalone MongoDB instance now, not a replica set.

### Option 2: Keep Replica Set but Remove Deleted Members

If you want to maintain replica set configuration for future scaling:

1. Update MongoDB connection string to only include the primary:
```
MONGODB_URI=mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?replicaSet=rs0&authSource=admin&readPreference=primary&maxPoolSize=100
```

2. Reconfigure replica set on MongoDB server to remove deleted members (if you have access):
```javascript
// Connect to MongoDB shell
rs.remove("13.233.231.180:27017")
rs.remove("13.127.22.11:27017")
rs.status()
```

### Option 3: Set Up New Replica Set (Future)

If you want high availability, set up a new replica set with new servers.

## 📝 Recommended Action

**I recommend Option 1** since:
1. You've deleted the replica set members
2. You likely want fast, reliable connections
3. You can always add replica set later if needed

### Steps to Apply Fix:

```bash
cd /var/www/opine/backend

# 1. Backup current .env
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# 2. Update MONGODB_URI in .env
# Edit .env and replace MONGODB_URI line with:
# MONGODB_URI=mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin&directConnection=true&maxPoolSize=100

# 3. Restart backend
pm2 restart opine-backend

# 4. Test connection
curl http://localhost:5000/health
```

## 📊 Report Summary

**Rejected Interviews Report Generated:**
- **Project Manager:** Dulal Ch Roy (dulal.roy@convergent.com)
- **Assigned Interviewers:** 100
- **Date Range:** From 2025-01-02 to 2026-01-09
- **Total Rejected Responses:** 780
- **Unique Responses:** 780 (0 duplicates excluded)
- **Report Location:** `/var/www/opine/reports/Rejected_Interviews_Report_Dulal_Ch Roy_2026-01-09.xlsx`

**Report Contains:**
- All rejected interview details
- Interviewer information
- Survey information
- Response data
- Timestamps
- Content hashes
- Full response data


