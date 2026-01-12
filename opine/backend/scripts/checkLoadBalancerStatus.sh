#!/bin/bash

# Script to check load balancer status and server health
# Usage: ./checkLoadBalancerStatus.sh

set -e

# Configuration
PRIMARY_SERVER="172.31.43.71"
SECONDARY_SERVER_1="13.233.231.180"
SECONDARY_SERVER_2="13.127.22.11"
SSH_USER="ubuntu"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Load Balancer & Server Status Monitor${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

# Function to check server status
check_server() {
    local SERVER_IP=$1
    local SERVER_NAME=$2
    local IS_PRIMARY=$3
    
    echo -e "${YELLOW}📡 Checking ${SERVER_NAME} (${SERVER_IP})${NC}"
    
    if [ "$IS_PRIMARY" = "true" ]; then
        # Primary server - check locally
        echo -e "   ${BLUE}Backend Status:${NC}"
        pm2 list | grep opine-backend || echo "   ❌ Backend not running"
        
        echo -e "   ${BLUE}Health Check:${NC}"
        HEALTH=$(curl -s http://localhost:5000/health 2>/dev/null | jq -r '.status // "error"' 2>/dev/null || echo "error")
        if [ "$HEALTH" = "healthy" ]; then
            echo -e "   ${GREEN}✅ Backend is healthy${NC}"
        else
            echo -e "   ${RED}❌ Backend health check failed${NC}"
        fi
        
        echo -e "   ${BLUE}System Load:${NC}"
        echo -e "   $(uptime | awk -F'load average:' '{print $2}')"
        echo -e "   Memory: $(free -h | grep Mem | awk '{print $3 "/" $2}')"
        
    else
        # Secondary server - check via SSH
        if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=no ${SSH_USER}@${SERVER_IP} "echo 'connected'" 2>/dev/null > /dev/null; then
            echo -e "   ${GREEN}✅ SSH connection successful${NC}"
            
            echo -e "   ${BLUE}Backend Status:${NC}"
            ssh ${SSH_USER}@${SERVER_IP} "pm2 list 2>/dev/null | grep opine-backend || echo '   ❌ Backend not running'" 2>/dev/null || echo "   ⚠️  Could not check PM2"
            
            echo -e "   ${BLUE}Health Check:${NC}"
            HEALTH=$(ssh ${SSH_USER}@${SERVER_IP} "curl -s http://localhost:5000/health 2>/dev/null | jq -r '.status // \"error\"' 2>/dev/null || echo 'error'" 2>/dev/null)
            if [ "$HEALTH" = "healthy" ]; then
                echo -e "   ${GREEN}✅ Backend is healthy${NC}"
            else
                echo -e "   ${RED}❌ Backend health check failed${NC}"
            fi
            
            echo -e "   ${BLUE}System Load:${NC}"
            ssh ${SSH_USER}@${SERVER_IP} "uptime | awk -F'load average:' '{print \$2}'" 2>/dev/null || echo "   ⚠️  Could not get load"
            ssh ${SSH_USER}@${SERVER_IP} "free -h | grep Mem | awk '{print \$3 \"/\" \$2}'" 2>/dev/null || echo "   ⚠️  Could not get memory"
        else
            echo -e "   ${RED}❌ Cannot connect to server${NC}"
        fi
    fi
    echo ""
}

# Check Nginx Load Balancer Configuration
echo -e "${BLUE}🔧 Nginx Load Balancer Configuration:${NC}"
UPSTREAM_CONFIG=$(sudo nginx -T 2>/dev/null | grep -A 15 "upstream opine_backend" | head -20)
echo "$UPSTREAM_CONFIG" | while IFS= read -r line; do
    if echo "$line" | grep -q "server.*weight"; then
        echo -e "   ${GREEN}✅ $line${NC}"
    elif echo "$line" | grep -q "server"; then
        echo -e "   ${YELLOW}   $line${NC}"
    else
        echo -e "   $line"
    fi
done
echo ""

# Check MongoDB Replica Set
echo -e "${BLUE}🗄️  MongoDB Replica Set Status:${NC}"
MONGO_STATUS=$(mongosh "mongodb://opine_user:OpineApp2024Secure@13.202.181.167:27017,13.233.231.180:27017,13.127.22.11:27017/Opine?authSource=admin&replicaSet=rs0" --quiet --eval "rs.status().members.map(m => ({name: m.name, stateStr: m.stateStr, health: m.health})).forEach(m => print(JSON.stringify(m)))" 2>/dev/null || echo "error")

if [ "$MONGO_STATUS" != "error" ]; then
    echo "$MONGO_STATUS" | while IFS= read -r member; do
        NAME=$(echo "$member" | jq -r '.name' 2>/dev/null || echo "unknown")
        STATE=$(echo "$member" | jq -r '.stateStr' 2>/dev/null || echo "unknown")
        HEALTH=$(echo "$member" | jq -r '.health' 2>/dev/null || echo "0")
        
        if [ "$STATE" = "PRIMARY" ]; then
            echo -e "   ${GREEN}✅ PRIMARY: $NAME (Health: $HEALTH)${NC}"
        elif [ "$STATE" = "SECONDARY" ]; then
            if [ "$HEALTH" = "1" ]; then
                echo -e "   ${GREEN}✅ SECONDARY: $NAME (Health: $HEALTH)${NC}"
            else
                echo -e "   ${RED}❌ SECONDARY: $NAME (Health: $HEALTH)${NC}"
            fi
        else
            echo -e "   ${YELLOW}⚠️  $STATE: $NAME (Health: $HEALTH)${NC}"
        fi
    done
else
    echo -e "   ${RED}❌ Could not connect to MongoDB replica set${NC}"
fi
echo ""

# Check each server
check_server "$PRIMARY_SERVER" "PRIMARY SERVER" "true"
check_server "$SECONDARY_SERVER_1" "SECONDARY SERVER 1" "false"
check_server "$SECONDARY_SERVER_2" "SECONDARY SERVER 2" "false"

# Check Nginx access logs for load distribution
echo -e "${BLUE}📊 Recent Load Distribution (Last 20 requests):${NC}"
if [ -f "/var/log/nginx/access.log" ]; then
    sudo tail -100 /var/log/nginx/access.log 2>/dev/null | grep -E "(/api/|/health)" | tail -20 | awk '{print $1, $7}' | while IFS= read -r line; do
        echo -e "   $line"
    done
else
    echo -e "   ${YELLOW}⚠️  Nginx access log not found${NC}"
fi
echo ""

# Summary
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"

# Check if load balancer is active
NGINX_STATUS=$(sudo systemctl is-active nginx 2>/dev/null || echo "inactive")
if [ "$NGINX_STATUS" = "active" ]; then
    echo -e "${GREEN}✅ Nginx Load Balancer: ACTIVE${NC}"
else
    echo -e "${RED}❌ Nginx Load Balancer: INACTIVE${NC}"
fi

# Check if backend is running on primary
if pm2 list | grep -q "opine-backend.*online"; then
    echo -e "${GREEN}✅ Primary Backend: RUNNING${NC}"
else
    echo -e "${RED}❌ Primary Backend: NOT RUNNING${NC}"
fi

echo ""





