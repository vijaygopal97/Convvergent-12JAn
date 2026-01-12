#!/bin/bash

# Copy files from current server to new server
# This should be run from one of the existing servers

set -e

NEW_SERVER="13.127.22.11"
NEW_SERVER_USER="ubuntu"
SSH_KEY="/var/www/opine/Convergent-New.pem"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=30"
REMOTE_PATH="/var/www/opine"
LOCAL_PATH="/var/www/opine"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📤 Copying files to new server: $NEW_SERVER"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create directory structure on new server
echo "[1/3] Creating directory structure..."
ssh $SSH_OPTS ${NEW_SERVER_USER}@${NEW_SERVER} "
    sudo mkdir -p $REMOTE_PATH
    sudo chown -R \$(whoami):\$(whoami) $REMOTE_PATH
    mkdir -p $REMOTE_PATH/backend
    mkdir -p $REMOTE_PATH/logs
    echo '✅ Directories created'
"
echo ""

# Copy files using rsync (from local to remote)
echo "[2/3] Copying application files..."
rsync -avz -e "ssh $SSH_OPTS" \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'logs/*.log' \
    --exclude '*.log' \
    --exclude '.env' \
    $LOCAL_PATH/ \
    ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/ || {
    echo "❌ Failed to copy files"
    exit 1
}
echo "✅ Application files copied"
echo ""

# Copy .env file separately
echo "[3/3] Copying .env file..."
if [ -f "$LOCAL_PATH/backend/.env" ]; then
    scp $SSH_OPTS $LOCAL_PATH/backend/.env ${NEW_SERVER_USER}@${NEW_SERVER}:${REMOTE_PATH}/backend/.env
    echo "✅ .env file copied"
else
    echo "⚠️  .env file not found at $LOCAL_PATH/backend/.env"
    echo "   Please copy it manually"
fi
echo ""

echo "✅ File copy completed!"
echo ""

