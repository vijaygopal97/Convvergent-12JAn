# MongoDB Replica Set Fix - Critical Issue

## 🔍 Problem

MongoDB server at `13.202.181.167:27017` is still configured as a replica set (`rs0`) but:
- Other replica members (13.233.231.180, 13.127.22.11) are **DELETED**
- Server cannot elect itself as primary without other members
- This causes "not primary" errors on write operations

## ✅ Solution: Reconfigure MongoDB to Standalone

You need to **SSH into the MongoDB server** (`13.202.181.167`) and reconfigure it.

### Step 1: Connect to MongoDB Server

```bash
ssh ubuntu@13.202.181.167
```

### Step 2: Connect to MongoDB Shell

```bash
mongosh "mongodb://localhost:27017/Opine?authSource=admin"
# Or if you have credentials:
mongosh -u opine_user -p OpineApp2024Secure --authenticationDatabase admin
```

### Step 3: Check Current Replica Set Status

```javascript
rs.status()
```

### Step 4: Remove Replica Set Configuration

**Option A: If you have admin access and want to keep data:**

```javascript
// Step 1: Remove all members except this one
rs.remove("13.233.231.180:27017")
rs.remove("13.127.22.11:27017")

// Step 2: Force this server to be primary (if possible)
rs.stepDown(0)  // Step down if currently primary
// Then restart MongoDB and it should become primary

// Step 3: If that doesn't work, reconfigure to standalone
```

**Option B: Reconfigure to Standalone (Recommended if you don't need replica set):**

1. **Stop MongoDB:**
```bash
sudo systemctl stop mongod
# Or
sudo service mongod stop
```

2. **Edit MongoDB config file:**
```bash
sudo nano /etc/mongod.conf
# Or
sudo nano /etc/mongodb.conf
```

3. **Remove or comment out replica set configuration:**
```yaml
# Comment out or remove:
# replication:
#   replSetName: rs0
```

4. **Start MongoDB:**
```bash
sudo systemctl start mongod
# Or
sudo service mongod start
```

5. **Verify it's standalone:**
```bash
mongosh "mongodb://localhost:27017/Opine?authSource=admin"
```
```javascript
rs.status()  // Should error saying "not running with --replSet"
db.adminCommand({isMaster: 1})  // Should show "ismaster: true"
```

### Step 5: Update Connection String (Already Done)

The connection string is already updated to:
```
mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin&directConnection=true&maxPoolSize=100
```

### Step 6: Restart Backend

```bash
pm2 restart opine-backend --update-env
```

## ⚠️ Important Notes

- **Data Safety:** This process does NOT delete any data
- **Backup Recommended:** Always backup before making MongoDB config changes
- **Downtime:** MongoDB will need to restart (brief downtime)
- **After Fix:** All write operations will work normally

## 🔧 Alternative: Temporary Workaround

If you cannot access MongoDB server right now, we can use MongoDB's `runCommand` with write concern, but this is not recommended long-term.


