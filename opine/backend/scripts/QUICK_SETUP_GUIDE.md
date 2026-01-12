# Quick Setup Guide - Load Balancer with Primary and Secondary Servers

## 🎯 Overview

This setup configures:
- **Primary Server** (Current): `172.31.43.71` - Primary backend, MongoDB primary
- **Secondary Server 1**: `13.233.231.180` - Secondary backend, MongoDB secondary  
- **Secondary Server 2**: `13.127.22.11` - Secondary backend, MongoDB secondary

## ✅ Step 1: Sync Code to Secondary Servers

**On PRIMARY SERVER**, run:

```bash
cd /var/www/opine/backend/scripts
./syncCodeToSecondaryServers.sh
```

This syncs code without changing anything on the primary server.

## ✅ Step 2: Set Up Secondary Servers

**On EACH SECONDARY SERVER** (SSH into them), run:

```bash
cd /var/www/opine/backend/scripts
sudo ./setupSecondaryServer.sh
```

Then manually:
1. Copy `.env` file from primary:
   ```bash
   # On primary server
   scp /var/www/opine/backend/.env ubuntu@13.233.231.180:/var/www/opine/backend/.env
   scp /var/www/opine/backend/.env ubuntu@13.127.22.11:/var/www/opine/backend/.env
   ```

2. Install dependencies and restart:
   ```bash
   # On each secondary server
   cd /var/www/opine/backend && npm install --production
   cd /var/www/opine/frontend && npm install && npm run build
   pm2 restart all
   pm2 save
   ```

## ✅ Step 3: Verify Load Balancer (Already Done!)

The load balancer has been configured on the primary server:
- Primary: 50% traffic (weight=3)
- Secondary 1: 33% traffic (weight=2)
- Secondary 2: 17% traffic (weight=1)
- Method: `least_conn` (least connections)
- Health checks: Enabled (max_fails=3, fail_timeout=30s)

## ✅ Step 4: Verify Everything Works

**Test health endpoints:**

```bash
# Primary server
curl http://172.31.43.71:5000/health

# Secondary server 1
curl http://13.233.231.180:5000/health

# Secondary server 2
curl http://13.127.22.11:5000/health
```

**Test load balancer:**

```bash
curl http://localhost/health
```

**Check Nginx status:**

```bash
sudo nginx -t
sudo systemctl status nginx
```

## 📋 MongoDB Replica Set

MongoDB is already configured with replica set `rs0`:
- All servers use the same connection string in `.env`
- Primary handles writes
- Secondaries handle reads (readPreference=secondaryPreferred)

## 🔧 Manual Configuration Updates Needed

1. **Update IP addresses** in scripts if your server IPs are different:
   - `syncCodeToSecondaryServers.sh` - Update SECONDARY_SERVER_1 and SECONDARY_SERVER_2
   - `updateNginxLoadBalancer.sh` - Update server IPs

2. **Ensure SSH access** is set up:
   ```bash
   # Test SSH access
   ssh ubuntu@13.233.231.180 "echo 'SSH works'"
   ssh ubuntu@13.127.22.11 "echo 'SSH works'"
   ```

3. **Firewall rules** - Ensure port 5000 is open on all servers:
   ```bash
   sudo ufw allow 5000/tcp
   ```

## 🚨 Troubleshooting

**If secondary servers are not reachable:**
```bash
# Check if backend is running
ssh ubuntu@13.233.231.180 "pm2 list"
ssh ubuntu@13.127.22.11 "pm2 list"

# Check if port is open
telnet 13.233.231.180 5000
telnet 13.127.22.11 5000
```

**If Nginx fails:**
```bash
# Check Nginx logs
sudo tail -f /var/log/nginx/error.log

# Restore backup
sudo cp /etc/nginx/nginx.conf.backup.* /etc/nginx/nginx.conf
sudo nginx -t && sudo systemctl reload nginx
```

**View load balancer status:**
```bash
sudo nginx -T | grep -A 20 "upstream opine_backend"
```

## 📝 Notes

- **No code changes** were made to the primary server
- Code is synced using `rsync` (excludes node_modules, .env, logs)
- Load balancer automatically removes failed servers
- MongoDB replica set handles database replication
- Health checks run every 30 seconds





