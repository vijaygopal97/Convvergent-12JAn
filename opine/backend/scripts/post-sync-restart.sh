#!/bin/bash
# Post-Sync Restart Script for lsyncd
# This script restarts PM2 on the secondary server after code sync
# Debounced: Waits for sync completion before restarting

SECONDARY_SSH="3.109.82.159"
SSH_KEY="/var/www/MyLogos/Convergent-New.pem"
LOG_FILE="/var/log/lsyncd-post-sync.log"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Restart PM2 on secondary server
restart_secondary_pm2() {
    log "🔄 Restarting PM2 on secondary server..."
    
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=10 \
        ubuntu@"$SECONDARY_SSH" \
        "cd /var/www/opine/backend && pm2 restart opine-backend" 2>&1 | tee -a "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log "✅ PM2 restarted successfully on secondary server"
    else
        log "❌ Failed to restart PM2 on secondary server"
        return 1
    fi
}

# Wait a few seconds to batch multiple file changes (debouncing)
sleep 5

# Restart secondary PM2
restart_secondary_pm2

# Note: PRIMARY PM2 restart is optional
# Uncomment below if you want PRIMARY to restart as well:
# log "🔄 Restarting PM2 on primary server..."
# cd /var/www/opine/backend && pm2 restart opine-backend
# log "✅ PM2 restarted on primary server"

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
