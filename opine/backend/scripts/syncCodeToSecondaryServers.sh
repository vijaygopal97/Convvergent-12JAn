#!/bin/bash

# Script to sync code from primary server to secondary servers
# Usage: ./syncCodeToSecondaryServers.sh

set -e

# Configuration - UPDATE THESE WITH YOUR SECONDARY SERVER IPs
SECONDARY_SERVER_1="13.233.231.180"  # Secondary Server 1
SECONDARY_SERVER_2="13.127.22.11"    # Secondary Server 2
SSH_USER="ubuntu"
PRIMARY_SERVER_PATH="/var/www/opine"
SECONDARY_SERVER_PATH="/var/www/opine"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting code synchronization to secondary servers...${NC}\n"

# Function to sync code to a server
sync_to_server() {
    local SERVER_IP=$1
    local SERVER_NAME=$2
    
    echo -e "${YELLOW}📡 Syncing to ${SERVER_NAME} (${SERVER_IP})...${NC}"
    
    # Test SSH connection
    if ! ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${SSH_USER}@${SERVER_IP} "echo 'SSH connection successful'" 2>/dev/null; then
        echo -e "${RED}❌ Cannot connect to ${SERVER_NAME} (${SERVER_IP})${NC}"
        echo -e "${YELLOW}   Please ensure:${NC}"
        echo -e "${YELLOW}   1. SSH key is set up for passwordless access${NC}"
        echo -e "${YELLOW}   2. Server is accessible${NC}"
        return 1
    fi
    
    # Create directory if it doesn't exist
    ssh ${SSH_USER}@${SERVER_IP} "mkdir -p ${SECONDARY_SERVER_PATH}"
    
    # Sync backend code (exclude node_modules, .env, logs, etc.)
    echo -e "   📦 Syncing backend code..."
    rsync -avz --progress \
        --exclude 'node_modules' \
        --exclude '.env' \
        --exclude '*.log' \
        --exclude 'logs' \
        --exclude '.git' \
        --exclude 'database_backups' \
        --exclude 'generated-csvs' \
        --exclude 'uploads' \
        --exclude '.DS_Store' \
        --exclude '*.swp' \
        --exclude '*.swo' \
        ${PRIMARY_SERVER_PATH}/backend/ \
        ${SSH_USER}@${SERVER_IP}:${SECONDARY_SERVER_PATH}/backend/
    
    # Sync frontend code (exclude node_modules, dist, etc.)
    echo -e "   📦 Syncing frontend code..."
    rsync -avz --progress \
        --exclude 'node_modules' \
        --exclude 'dist' \
        --exclude '.env' \
        --exclude '.git' \
        --exclude '.DS_Store' \
        --exclude '*.swp' \
        --exclude '*.swo' \
        ${PRIMARY_SERVER_PATH}/frontend/ \
        ${SSH_USER}@${SERVER_IP}:${SECONDARY_SERVER_PATH}/frontend/
    
    echo -e "${GREEN}✅ Code synced to ${SERVER_NAME}${NC}\n"
    return 0
}

# Sync to Server 1
sync_to_server ${SECONDARY_SERVER_1} "Secondary Server 1"

# Sync to Server 2
sync_to_server ${SECONDARY_SERVER_2} "Secondary Server 2"

echo -e "${GREEN}✅ Code synchronization completed!${NC}"
echo -e "${YELLOW}⚠️  Remember to:${NC}"
echo -e "${YELLOW}   1. Copy .env file manually to each server (contains sensitive data)${NC}"
echo -e "${YELLOW}   2. Run 'npm install' on each server${NC}"
echo -e "${YELLOW}   3. Restart PM2 processes on each server${NC}"





