#!/bin/bash

# Script to update nginx load balancer configuration to include new server
# This adds the new server to the upstream configuration with minimal downtime

set -e

NEW_SERVER="13.127.22.11"
NGINX_CONF="/etc/nginx/nginx.conf"
BACKUP_DIR="/etc/nginx/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔄 Updating Nginx Load Balancer Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Create backup directory
sudo mkdir -p $BACKUP_DIR

# Backup current nginx.conf
echo "[1/4] Creating backup of nginx.conf..."
sudo cp $NGINX_CONF ${BACKUP_DIR}/nginx.conf.backup.${TIMESTAMP}
echo "✅ Backup created: ${BACKUP_DIR}/nginx.conf.backup.${TIMESTAMP}"
echo ""

# Check if server already exists in upstream
if grep -q "$NEW_SERVER:5000" $NGINX_CONF; then
    echo "⚠️  Server $NEW_SERVER:5000 already exists in upstream configuration"
    echo "   Current configuration:"
    grep -A 5 "upstream opine_backend" $NGINX_CONF | grep "server"
    echo ""
    read -p "Do you want to continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# Update nginx.conf
echo "[2/4] Updating nginx.conf..."
# Find the upstream block and add the new server
sudo sed -i "/upstream opine_backend {/,/}/ {
    /server 127.0.0.1:5000 weight=1;/i\
    server ${NEW_SERVER}:5000 weight=10;
}" $NGINX_CONF

echo "✅ Configuration updated"
echo ""

# Test nginx configuration
echo "[3/4] Testing nginx configuration..."
if sudo nginx -t; then
    echo "✅ Nginx configuration is valid"
else
    echo "❌ Nginx configuration test failed!"
    echo "   Restoring backup..."
    sudo cp ${BACKUP_DIR}/nginx.conf.backup.${TIMESTAMP} $NGINX_CONF
    exit 1
fi
echo ""

# Reload nginx (zero-downtime)
echo "[4/4] Reloading nginx (zero-downtime)..."
if sudo systemctl reload nginx; then
    echo "✅ Nginx reloaded successfully"
else
    echo "❌ Failed to reload nginx"
    echo "   Restoring backup..."
    sudo cp ${BACKUP_DIR}/nginx.conf.backup.${TIMESTAMP} $NGINX_CONF
    sudo nginx -t && sudo systemctl reload nginx
    exit 1
fi
echo ""

# Show updated configuration
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Load balancer configuration updated successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Current upstream configuration:"
grep -A 10 "upstream opine_backend" $NGINX_CONF
echo ""

