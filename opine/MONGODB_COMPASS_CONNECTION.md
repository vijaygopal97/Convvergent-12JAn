# MongoDB Compass Connection Guide

## 🔍 Problem Analysis

**Issue:** MongoDB Compass connection timing out from your local machine.

**Root Cause:** AWS Security Group on MongoDB server (`13.202.181.167`) is likely blocking external connections on port 27017.

**Status:**
- ✅ MongoDB is running and accessible from server itself
- ✅ Backend can connect (internal AWS network)
- ❌ External connections (your local machine) are blocked

## 🔧 Solution Options

### Option 1: SSH Tunnel (Recommended - Secure & Immediate)

Use SSH tunnel to connect through your server to MongoDB.

**Step 1: Create SSH Tunnel**
```bash
# On your local machine, run:
ssh -L 27018:13.202.181.167:27017 ubuntu@YOUR_SERVER_IP -N

# Replace YOUR_SERVER_IP with your server IP
# This creates a tunnel: localhost:27018 -> server -> 13.202.181.167:27017
```

**Step 2: Connect MongoDB Compass**
Use this connection string in MongoDB Compass:
```
mongodb://opine_user:OpineApp2024Secure@localhost:27018/Opine?authSource=admin
```

**Step 3: Keep tunnel open**
- Keep the SSH tunnel terminal window open while using Compass
- Press `Ctrl+C` to close tunnel when done

---

### Option 2: Update AWS Security Group (If you have AWS access)

**Requirements:**
- AWS Console access
- Security Group ID for MongoDB server

**Steps:**
1. Go to AWS EC2 Console
2. Find MongoDB server: `13.202.181.167`
3. Check Security Group
4. Add Inbound Rule:
   - Type: Custom TCP
   - Port: 27017
   - Source: Your IP address (or `0.0.0.0/0` for any IP - less secure)
   - Description: MongoDB Compass Access

**Note:** This exposes MongoDB to the internet. Only do this if you trust your network.

---

### Option 3: Use Server-Based Connection

Connect to MongoDB directly from the server using mongosh or Compass installed on server.

---

## ✅ Recommended: SSH Tunnel Method

**Why SSH Tunnel is Best:**
- ✅ No need to modify AWS security groups
- ✅ Secure (encrypted through SSH)
- ✅ Works immediately
- ✅ No exposure of MongoDB to internet

**Quick Command:**
```bash
# Replace YOUR_SERVER_IP with actual server IP
ssh -L 27018:13.202.181.167:27017 ubuntu@YOUR_SERVER_IP -N
```

Then in MongoDB Compass:
```
mongodb://opine_user:OpineApp2024Secure@localhost:27018/Opine?authSource=admin
```

---

## 🔍 Verification

After setting up SSH tunnel, test connection:
```bash
# Test from your local machine (new terminal):
mongosh "mongodb://opine_user:OpineApp2024Secure@localhost:27018/Opine?authSource=admin" --eval "db.adminCommand('ping')"
```

---

## 📝 Connection String Reference

**Direct (if security group allows):**
```
mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin
```

**Through SSH Tunnel:**
```
mongodb://opine_user:OpineApp2024Secure@localhost:27018/Opine?authSource=admin
```


