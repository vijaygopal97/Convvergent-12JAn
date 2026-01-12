# Load Balancer Setup Guide

This guide explains how to set up load balancing with the current server as primary and 2 secondary servers.

## Architecture

- **Primary Server (Current)**: `172.31.43.71` - Primary backend and MongoDB primary
- **Secondary Server 1**: `13.233.231.180` - Secondary backend and MongoDB secondary
- **Secondary Server 2**: `13.127.22.11` - Secondary backend and MongoDB secondary

## Prerequisites

1. SSH access to all servers with passwordless authentication
2. MongoDB replica set already configured (rs0)
3. All servers have Node.js, PM2, and Nginx installed

## Setup Steps

### Step 1: Sync Code to Secondary Servers

On the **PRIMARY SERVER**, run:

```bash
cd /var/www/opine/backend/scripts
./syncCodeToSecondaryServers.sh
```

This will:
- Sync backend code (excluding node_modules, .env, logs)
- Sync frontend code (excluding node_modules, dist)
- Preserve sensitive files (.env) - you'll need to copy these manually

### Step 2: Set Up Secondary Servers

On **EACH SECONDARY SERVER**, run:

```bash
cd /var/www/opine/backend/scripts
sudo ./setupSecondaryServer.sh
```

This will:
- Install Node.js, PM2, Nginx (if not present)
- Install npm dependencies
- Build frontend
- Configure PM2
- Start backend services

**Important**: After running this script, you need to:
1. Copy `.env` file from primary server
2. Update `MONGODB_URI` to use replica set (already configured)
3. Restart PM2: `pm2 restart all`

### Step 3: Configure Load Balancer

On the **PRIMARY SERVER**, run:

```bash
cd /var/www/opine/backend/scripts
sudo ./updateNginxLoadBalancer.sh
```

This will:
- Update Nginx upstream configuration
- Configure load balancing with weights:
  - Primary: 50% of traffic (weight=3)
  - Secondary 1: 33% of traffic (weight=2)
  - Secondary 2: 17% of traffic (weight=1)
- Use `least_conn` method (least connections)
- Enable health checks (max_fails, fail_timeout)

### Step 4: Verify Setup

1. **Check Nginx configuration**:
   ```bash
   sudo nginx -t
   ```

2. **Check backend health**:
   ```bash
   curl http://localhost:5000/health
   ```

3. **Check load balancer**:
   ```bash
   curl http://localhost/health
   ```

4. **Monitor PM2 on all servers**:
   ```bash
   pm2 list
   pm2 logs
   ```

## Load Balancing Configuration

### Traffic Distribution
- **Primary Server**: 50% of requests (weight=3)
- **Secondary Server 1**: 33% of requests (weight=2)
- **Secondary Server 2**: 17% of requests (weight=1)

### Health Checks
- `max_fails=3`: Server is marked down after 3 failed requests
- `fail_timeout=30s`: Server is retried after 30 seconds
- `least_conn`: Routes requests to server with least active connections

### MongoDB Replica Set
MongoDB is already configured with replica set `rs0`:
- Primary: `13.202.181.167:27017`
- Secondary 1: `13.233.231.180:27017`
- Secondary 2: `13.127.22.11:27017`

Connection string in `.env`:
```
MONGODB_URI=mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017,13.233.231.180:27017,13.127.22.11:27017/Opine?replicaSet=rs0&authSource=admin&readPreference=secondaryPreferred&maxStalenessSeconds=90&maxPoolSize=100
```

## Manual Steps Required

1. **Copy .env file** to each secondary server:
   ```bash
   # On primary server
   scp /var/www/opine/backend/.env ubuntu@13.233.231.180:/var/www/opine/backend/.env
   scp /var/www/opine/backend/.env ubuntu@13.127.22.11:/var/www/opine/backend/.env
   ```

2. **Verify MongoDB replica set** on each server:
   ```bash
   mongo "mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin&replicaSet=rs0" --eval "rs.status()"
   ```

3. **Restart services** on secondary servers:
   ```bash
   pm2 restart all
   pm2 save
   ```

## Troubleshooting

### Check if servers are reachable:
```bash
curl http://13.233.231.180:5000/health
curl http://13.127.22.11:5000/health
```

### Check Nginx upstream status:
```bash
sudo nginx -T | grep -A 20 "upstream opine_backend"
```

### Check PM2 status on remote servers:
```bash
ssh ubuntu@13.233.231.180 "pm2 list"
ssh ubuntu@13.127.22.11 "pm2 list"
```

### View Nginx access logs:
```bash
sudo tail -f /var/log/nginx/access.log
```

## Notes

- **No code changes** are made to the primary server
- Code is synced using `rsync` (excludes node_modules, .env, logs)
- Load balancer uses `least_conn` method for better distribution
- Health checks automatically remove failed servers from rotation
- MongoDB replica set handles database replication automatically





