#!/bin/bash
# Setup script for new server (3.109.82.159)
# Installs MongoDB, Node.js, and syncs backend code

set -e

echo "🚀 Starting new server setup..."

# Update system
echo "📦 Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# Install MongoDB
echo "📦 Installing MongoDB..."
if ! command -v mongod &> /dev/null; then
    sudo apt-get install -y wget curl gnupg
    wget -qO - https://www.mongodb.org/static/pgp/server-7.0.asc | sudo apt-key add -
    echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
    sudo apt-get update -y
    sudo apt-get install -y mongodb-org
    
    # Start MongoDB
    sudo systemctl enable mongod
    sudo systemctl start mongod
    echo "✅ MongoDB installed and started"
else
    echo "✅ MongoDB already installed"
fi

# Install Node.js (using NodeSource for latest LTS)
echo "📦 Installing Node.js..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
    echo "✅ Node.js installed: $(node --version)"
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install PM2
echo "📦 Installing PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
    echo "✅ PM2 installed"
else
    echo "✅ PM2 already installed"
fi

# Install nginx
echo "📦 Installing nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt-get install -y nginx
    sudo systemctl enable nginx
    echo "✅ nginx installed"
else
    echo "✅ nginx already installed"
fi

echo "✅ New server setup complete!"
