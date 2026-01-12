# MongoDB Primary Setup Guide

## Current Situation
- Backend is connecting to remote MongoDB replica set
- Replica set has no primary (ReplicaSetNoPrimary error)
- This causes queries to hang indefinitely

## Solution Options

### Option 1: Make Current Server Primary (If MongoDB is running here)
If MongoDB is running on this server (13.202.181.167):
1. Connect to MongoDB: `mongosh`
2. Check replica set status: `rs.status()`
3. If this server is a secondary, force it to primary:
   ```javascript
   cfg = rs.conf()
   cfg.members[0].priority = 10  // Set high priority
   rs.reconfig(cfg)
   ```

### Option 2: Fix Remote Primary
If MongoDB is on a different server:
1. SSH to the MongoDB primary server
2. Check replica set status
3. Ensure primary is healthy
4. If needed, force election

### Option 3: Connect Directly to Primary
Temporarily modify MONGODB_URI to connect directly to primary server (bypass replica set)

## Next Steps
1. Identify which server has MongoDB running
2. Check replica set configuration
3. Make this server (or correct server) primary
4. Verify connection works

