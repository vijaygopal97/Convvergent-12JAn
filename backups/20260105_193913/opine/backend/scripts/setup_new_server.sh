#!/bin/bash

# Comprehensive script to set up the 3rd server for load balancing
# This script copies everything from an existing server and configures it

set -e

# Configuration
NEW_SERVER="13.127.22.11"
NEW_SERVER_USER="ubuntu"
SSH_KEY="/var/www/opine/Convergent-New.pem"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30 -o ServerAliveInterval=10"
REMOTE_PATH="/var/www/opine"

# Source server (copy from existing server)
SOURCE_SERVER="13.233.231.180"
SOURCE_USER="ubuntu"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Setting up new server: $NEW_SERVER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test connectivity
echo "[1/8] Testing connectivity..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "echo 'Connection OK'" || {
    echo "❌ Cannot connect to new server"
    exit 1
}
echo "✅ Server is reachable"
echo ""

# Install system dependencies
echo "[2/8] Installing system dependencies..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl wget git build-essential ufw mongodb-org mongodb-org-server mongodb-org-shell mongodb-database-tools
    echo '✅ System dependencies installed'
"
echo ""

# Install Node.js
echo "[3/8] Installing Node.js..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
    fi
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
    fi
    echo '✅ Node.js \$(node --version) and PM2 \$(pm2 --version) installed'
"
echo ""

# Copy application from source server
echo "[4/8] Copying application code from $SOURCE_SERVER..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    sudo mkdir -p $REMOTE_PATH
    sudo chown -R \$(whoami):\$(whoami) $REMOTE_PATH
"

# Use rsync to copy files efficiently
rsync -avz -e "ssh $SSH_OPTS" \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'logs/*.log' \
    --exclude '*.log' \
    --exclude '.env' \
    ${SOURCE_USER}@${SOURCE_SERVER}:${REMOTE_PATH}/ \
    ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/ || {
    echo "⚠️  rsync had some issues, but continuing..."
}
echo "✅ Application code copied"
echo ""

# Copy .env file separately (important!)
echo "[5/8] Copying .env configuration..."
scp $SSH_OPTS ${SOURCE_USER}@${SOURCE_SERVER}:${REMOTE_PATH}/backend/.env ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/backend/.env || {
    echo "⚠️  Could not copy .env file automatically"
    echo "   Please copy it manually:"
    echo "   scp $SSH_KEY ${SOURCE_USER}@${SOURCE_SERVER}:${REMOTE_PATH}/backend/.env ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/backend/.env"
}
echo "✅ Configuration files copied"
echo ""

# Install npm dependencies
echo "[6/8] Installing npm dependencies..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    cd $REMOTE_PATH/backend
    npm install --production --silent
    echo '✅ npm dependencies installed'
"
echo ""

# Configure and start MongoDB
echo "[7/8] Configuring MongoDB..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    # Create data directory
    sudo mkdir -p /data/db
    sudo chown -R mongodb:mongodb /data/db
    
    # Configure MongoDB for replica set
    sudo tee /etc/mongod.conf > /dev/null <<'EOF'
storage:
  dbPath: /data/db
  journal:
    enabled: true

systemLog:
  destination: file
  logAppend: true
  path: /var/log/mongodb/mongod.log

net:
  port: 27017
  bindIp: 0.0.0.0

processManagement:
  timeZoneInfo: /usr/share/zoneinfo

replication:
  replSetName: rs0
EOF
    
    # Enable and start MongoDB
    sudo systemctl enable mongod
    sudo systemctl restart mongod
    sleep 3
    
    # Open firewall
    sudo ufw allow 27017/tcp || true
    
    echo '✅ MongoDB configured and started'
"
echo ""

# Start backend with PM2
echo "[8/8] Starting backend service..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    cd $REMOTE_PATH/backend
    
    # Stop existing if any
    pm2 delete opine-backend 2>/dev/null || true
    
    # Start backend
    cd $REMOTE_PATH
    pm2 start ecosystem.config.js --only opine-backend
    pm2 save
    
    # Setup PM2 startup
    pm2 startup systemd -u \$(whoami) --hp /home/\$(whoami) 2>/dev/null | grep 'sudo' | bash || true
    
    echo '✅ Backend service started'
    pm2 list | grep opine-backend
"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Server setup completed!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Next steps:"
echo "  1. Add MongoDB to replica set: node backend/scripts/addMongoDBReplicaMember.js 13.127.22.11:27017"
echo "  2. Update nginx load balancer configuration"
echo "  3. Update monitoring script"
echo ""

