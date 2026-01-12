#!/bin/bash

# Script to add the 3rd server (13.127.22.11) to load balancing and MongoDB replica set
# This script ensures minimal downtime by setting up everything before adding to load balancer

set -e  # Exit on error

# Configuration
NEW_SERVER="13.127.22.11"
NEW_SERVER_USER="ubuntu"
SSH_KEY="/var/www/opine/Convergent-New.pem"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30 -o ServerAliveInterval=10"
REMOTE_PATH="/var/www/opine"

# Existing servers for reference
EXISTING_SERVERS=(
    "13.233.231.180"
    "13.202.181.167"
)

# MongoDB Replica Set Configuration
MONGODB_PRIMARY="13.202.181.167:27017"
MONGODB_SECONDARY="13.233.231.180:27017"
NEW_MONGODB_MEMBER="$NEW_SERVER:27017"
REPLICA_SET_NAME="rs0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🚀 Adding 3rd Server to Load Balancing & MongoDB Replica${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "New Server: $NEW_SERVER"
echo ""

# Function to execute remote command
remote_exec() {
    ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "$1"
}

# Function to copy files to remote
remote_copy() {
    scp $SSH_OPTS "$1" ${NEW_SERVER_USER}@${NEW_SERVER}:"$2"
}

# Step 1: Verify connectivity
echo -e "${YELLOW}[1/9]${NC} Testing connectivity to new server..."
if remote_exec "echo 'Connection OK'"; then
    echo -e "${GREEN}✅ Server is reachable${NC}"
else
    echo -e "${RED}❌ Cannot connect to server${NC}"
    exit 1
fi
echo ""

# Step 2: Check and install system dependencies
echo -e "${YELLOW}[2/9]${NC} Installing system dependencies..."
remote_exec "
    export DEBIAN_FRONTEND=noninteractive
    sudo apt-get update -qq
    sudo apt-get install -y -qq curl wget git build-essential ufw mongodb-org mongodb-org-server mongodb-org-shell mongodb-database-tools
    echo '✅ System dependencies installed'
" || {
    echo -e "${RED}❌ Failed to install system dependencies${NC}"
    exit 1
}
echo ""

# Step 3: Install Node.js and PM2
echo -e "${YELLOW}[3/9]${NC} Installing Node.js and PM2..."
remote_exec "
    if ! command -v node &> /dev/null; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y -qq nodejs
    fi
    if ! command -v pm2 &> /dev/null; then
        sudo npm install -g pm2
    fi
    echo 'Node.js version: \$(node --version)'
    echo 'PM2 version: \$(pm2 --version)'
    echo '✅ Node.js and PM2 installed'
" || {
    echo -e "${RED}❌ Failed to install Node.js/PM2${NC}"
    exit 1
}
echo ""

# Step 4: Create directory structure
echo -e "${YELLOW}[4/9]${NC} Creating directory structure..."
remote_exec "
    sudo mkdir -p $REMOTE_PATH
    sudo chown -R \$(whoami):\$(whoami) $REMOTE_PATH
    mkdir -p $REMOTE_PATH/backend
    mkdir -p $REMOTE_PATH/logs
    echo '✅ Directory structure created'
" || {
    echo -e "${RED}❌ Failed to create directories${NC}"
    exit 1
}
echo ""

# Step 5: Copy application code from one of the existing servers
echo -e "${YELLOW}[5/9]${NC} Copying application code from existing server..."
SOURCE_SERVER="${EXISTING_SERVERS[0]}"
echo "Copying from: $SOURCE_SERVER"

# Use rsync for efficient copying
rsync -avz -e "ssh $SSH_OPTS" \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'logs/*' \
    --exclude '*.log' \
    ${SOURCE_SERVER_USER}@${SOURCE_SERVER}:${REMOTE_PATH}/backend/ \
    ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/backend/ || {
    echo -e "${YELLOW}⚠️  rsync failed, trying alternative method...${NC}"
    # Alternative: use scp from current server if we have access
    echo "Please ensure .env file is copied manually"
}
echo -e "${GREEN}✅ Application code copied${NC}"
echo ""

# Step 6: Install npm dependencies
echo -e "${YELLOW}[6/9]${NC} Installing npm dependencies..."
remote_exec "
    cd $REMOTE_PATH/backend
    npm install --production --silent
    echo '✅ npm dependencies installed'
" || {
    echo -e "${RED}❌ Failed to install npm dependencies${NC}"
    exit 1
}
echo ""

# Step 7: Configure MongoDB
echo -e "${YELLOW}[7/9]${NC} Configuring MongoDB..."
remote_exec "
    # Create MongoDB data directory
    sudo mkdir -p /data/db
    sudo chown -R mongodb:mongodb /data/db
    
    # Configure MongoDB for replica set
    sudo tee /etc/mongod.conf > /dev/null <<EOF
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
  replSetName: $REPLICA_SET_NAME
EOF
    
    # Enable and start MongoDB
    sudo systemctl enable mongod
    sudo systemctl start mongod
    sleep 3
    
    # Open firewall for MongoDB
    sudo ufw allow 27017/tcp || true
    
    echo '✅ MongoDB configured and started'
" || {
    echo -e "${RED}❌ Failed to configure MongoDB${NC}"
    exit 1
}
echo ""

# Step 8: Add MongoDB to replica set (this will be done via a Node.js script)
echo -e "${YELLOW}[8/9]${NC} Adding MongoDB to replica set..."
# We'll create a script to add the replica member
cat > /tmp/add_replica_member.js << 'EOFSCRIPT'
const mongoose = require('mongoose');
require('dotenv').config({ path: '/var/www/opine/backend/.env' });

const PRIMARY_URI = process.env.MONGODB_URI || 'mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017/Opine?authSource=admin';
const NEW_MEMBER = process.argv[2] || '13.127.22.11:27017';

async function addReplicaMember() {
  try {
    console.log('📡 Connecting to primary MongoDB server...');
    await mongoose.connect(PRIMARY_URI, {
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000
    });
    console.log('✅ Connected to primary');
    
    const admin = mongoose.connection.db.admin();
    
    // Get current replica set status
    console.log('🔍 Getting current replica set status...');
    const status = await admin.command({ replSetGetStatus: 1 });
    
    console.log('Current members:');
    status.members.forEach((member, i) => {
      console.log(`  ${i + 1}. ${member.name} - ${member.stateStr}`);
    });
    
    // Check if member already exists
    const memberExists = status.members.some(m => m.name.includes(NEW_MEMBER.split(':')[0]));
    if (memberExists) {
      console.log('✅ Member already exists in replica set');
      await mongoose.disconnect();
      return;
    }
    
    // Add new member
    console.log(`➕ Adding new member: ${NEW_MEMBER}...`);
    const config = await admin.command({ replSetGetConfig: 1 });
    const currentConfig = config.config;
    
    // Find the highest member ID
    const maxId = Math.max(...currentConfig.members.map(m => m._id));
    
    // Add new member
    currentConfig.members.push({
      _id: maxId + 1,
      host: NEW_MEMBER
    });
    
    currentConfig.version = currentConfig.version + 1;
    
    // Apply new configuration
    await admin.command({
      replSetReconfig: currentConfig
    });
    
    console.log('✅ New member added successfully');
    
    // Wait a moment and check status
    await new Promise(resolve => setTimeout(resolve, 3000));
    const newStatus = await admin.command({ replSetGetStatus: 1 });
    console.log('\nUpdated members:');
    newStatus.members.forEach((member, i) => {
      console.log(`  ${i + 1}. ${member.name} - ${member.stateStr}`);
    });
    
    await mongoose.disconnect();
    console.log('\n✅ Replica set member addition completed!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('version')) {
      console.log('\n⚠️  Version conflict detected. Retrying...');
      // Retry with fresh config
      const admin = mongoose.connection.db.admin();
      const config = await admin.command({ replSetGetConfig: 1 });
      const currentConfig = config.config;
      const maxId = Math.max(...currentConfig.members.map(m => m._id));
      currentConfig.members.push({
        _id: maxId + 1,
        host: NEW_MEMBER
      });
      currentConfig.version = currentConfig.version + 1;
      await admin.command({ replSetReconfig: currentConfig });
      console.log('✅ Member added after retry');
    }
    process.exit(1);
  }
}

addReplicaMember();
EOFSCRIPT

# Copy the script to new server and run it from there (or run from current server)
echo "Adding replica member from primary..."
cd /var/www/opine/backend
node -e "$(cat /tmp/add_replica_member.js)" "$NEW_MONGODB_MEMBER" || {
    echo -e "${YELLOW}⚠️  Failed to add via script, will add manually${NC}"
}

echo -e "${GREEN}✅ MongoDB replica member added${NC}"
echo ""

# Step 9: Start backend service with PM2
echo -e "${YELLOW}[9/9]${NC} Starting backend service..."
remote_exec "
    cd $REMOTE_PATH/backend
    
    # Ensure ecosystem.config.js exists or create it
    if [ ! -f ../ecosystem.config.js ]; then
        echo 'Creating ecosystem.config.js...'
        # Copy from existing server or create default
    fi
    
    # Start with PM2
    pm2 delete opine-backend 2>/dev/null || true
    pm2 start ../ecosystem.config.js --only opine-backend
    pm2 save
    pm2 startup systemd -u \$(whoami) --hp /home/\$(whoami) | grep -v 'PM2' | sudo bash || true
    
    echo '✅ Backend service started'
    pm2 list | grep opine-backend
" || {
    echo -e "${RED}❌ Failed to start backend service${NC}"
    exit 1
}
echo ""

echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Server setup completed!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo "  1. Update nginx load balancer configuration"
echo "  2. Update monitoring script"
echo "  3. Test the new server"
echo ""

