#!/bin/bash

# Script to set up a secondary server
# Run this script ON THE SECONDARY SERVER after code is synced
# Usage: ./setupSecondaryServer.sh

set -e

echo "🚀 Setting up secondary server..."

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "❌ Please run as root or with sudo"
    exit 1
fi

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
fi

# Install PM2 if not present
if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2..."
    npm install -g pm2
fi

# Install Nginx if not present
if ! command -v nginx &> /dev/null; then
    echo "📦 Installing Nginx..."
    apt-get update
    apt-get install -y nginx
fi

# Navigate to backend directory
cd /var/www/opine/backend

# Install dependencies
echo "📦 Installing backend dependencies..."
npm install --production

# Navigate to frontend directory
cd /var/www/opine/frontend

# Install dependencies
echo "📦 Installing frontend dependencies..."
npm install

# Build frontend
echo "🏗️  Building frontend..."
npm run build

# Create PM2 ecosystem config if it doesn't exist
if [ ! -f "/var/www/opine/backend/ecosystem.config.js" ]; then
    echo "📝 Creating PM2 ecosystem config..."
    cat > /var/www/opine/backend/ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'opine-backend',
    script: './server.js',
    instances: 2,
    exec_mode: 'cluster',
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    autorestart: true,
    watch: false
  }]
};
EOF
fi

# Start backend with PM2
echo "🚀 Starting backend with PM2..."
cd /var/www/opine/backend
pm2 start ecosystem.config.js || pm2 start server.js --name opine-backend -i 2 --max-memory-restart 2G
pm2 save
pm2 startup

echo "✅ Secondary server setup completed!"
echo ""
echo "⚠️  Next steps:"
echo "   1. Copy .env file from primary server"
echo "   2. Update MONGODB_URI to point to replica set"
echo "   3. Restart PM2: pm2 restart all"
echo "   4. Configure Nginx load balancer on primary server"





