#!/bin/bash

# Script to update Nginx load balancer configuration
# Run this script ON THE PRIMARY SERVER
# Usage: ./updateNginxLoadBalancer.sh

set -e

# Configuration - UPDATE THESE WITH YOUR SERVER IPs
PRIMARY_SERVER_IP="172.31.43.71"      # Current server (primary)
SECONDARY_SERVER_1="13.233.231.180"   # Secondary Server 1
SECONDARY_SERVER_2="13.127.22.11"     # Secondary Server 2
BACKEND_PORT="5000"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🔧 Updating Nginx load balancer configuration...${NC}\n"

# Backup current nginx.conf
if [ -f "/etc/nginx/nginx.conf" ]; then
    cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${YELLOW}📋 Backed up nginx.conf${NC}"
fi

# Check if upstream block exists in nginx.conf
if grep -q "upstream opine_backend" /etc/nginx/nginx.conf; then
    echo -e "${YELLOW}📝 Updating existing upstream block...${NC}"
    
    # Create temporary file with new upstream configuration
    cat > /tmp/opine_backend_upstream.conf << EOF
# Opine Backend Load Balancer
# Primary server (this server) - receives most traffic
# Secondary servers - backup and load distribution
upstream opine_backend {
    # Primary server (this server) - weight 3 (receives 50% of traffic)
    server ${PRIMARY_SERVER_IP}:${BACKEND_PORT} weight=3 max_fails=3 fail_timeout=30s;
    
    # Secondary Server 1 - weight 2 (receives 33% of traffic)
    server ${SECONDARY_SERVER_1}:${BACKEND_PORT} weight=2 max_fails=3 fail_timeout=30s;
    
    # Secondary Server 2 - weight 1 (receives 17% of traffic)
    server ${SECONDARY_SERVER_2}:${BACKEND_PORT} weight=1 max_fails=3 fail_timeout=30s;
    
    # Load balancing method
    least_conn;
    
    # Keep connections alive
    keepalive 32;
}
EOF
    
    # Replace upstream block in nginx.conf
    # This is a bit complex, so we'll use sed
    sed -i '/^upstream opine_backend/,/^}/c\
# Opine Backend Load Balancer\
# Primary server (this server) - receives most traffic\
# Secondary servers - backup and load distribution\
upstream opine_backend {\
    # Primary server (this server) - weight 3 (receives 50% of traffic)\
    server '"${PRIMARY_SERVER_IP}"':'"${BACKEND_PORT}"' weight=3 max_fails=3 fail_timeout=30s;\
    \
    # Secondary Server 1 - weight 2 (receives 33% of traffic)\
    server '"${SECONDARY_SERVER_1}"':'"${BACKEND_PORT}"' weight=2 max_fails=3 fail_timeout=30s;\
    \
    # Secondary Server 2 - weight 1 (receives 17% of traffic)\
    server '"${SECONDARY_SERVER_2}"':'"${BACKEND_PORT}"' weight=1 max_fails=3 fail_timeout=30s;\
    \
    # Load balancing method\
    least_conn;\
    \
    # Keep connections alive\
    keepalive 32;\
}' /etc/nginx/nginx.conf
    
    echo -e "${GREEN}✅ Updated upstream block in nginx.conf${NC}"
else
    echo -e "${YELLOW}📝 Adding new upstream block to nginx.conf...${NC}"
    
    # Add upstream block before http block or at the beginning of http block
    if grep -q "^http {" /etc/nginx/nginx.conf; then
        # Insert after http { line
        sed -i '/^http {/a\
\
# Opine Backend Load Balancer\
upstream opine_backend {\
    server '"${PRIMARY_SERVER_IP}"':'"${BACKEND_PORT}"' weight=3 max_fails=3 fail_timeout=30s;\
    server '"${SECONDARY_SERVER_1}"':'"${BACKEND_PORT}"' weight=2 max_fails=3 fail_timeout=30s;\
    server '"${SECONDARY_SERVER_2}"':'"${BACKEND_PORT}"' weight=1 max_fails=3 fail_timeout=30s;\
    least_conn;\
    keepalive 32;\
}' /etc/nginx/nginx.conf
    else
        # Append to end of file
        cat >> /etc/nginx/nginx.conf << EOF

# Opine Backend Load Balancer
upstream opine_backend {
    server ${PRIMARY_SERVER_IP}:${BACKEND_PORT} weight=3 max_fails=3 fail_timeout=30s;
    server ${SECONDARY_SERVER_1}:${BACKEND_PORT} weight=2 max_fails=3 fail_timeout=30s;
    server ${SECONDARY_SERVER_2}:${BACKEND_PORT} weight=1 max_fails=3 fail_timeout=30s;
    least_conn;
    keepalive 32;
}
EOF
    fi
    
    echo -e "${GREEN}✅ Added upstream block to nginx.conf${NC}"
fi

# Test Nginx configuration
echo -e "${YELLOW}🧪 Testing Nginx configuration...${NC}"
if nginx -t; then
    echo -e "${GREEN}✅ Nginx configuration is valid${NC}"
    
    # Reload Nginx
    echo -e "${YELLOW}🔄 Reloading Nginx...${NC}"
    systemctl reload nginx || service nginx reload
    
    echo -e "${GREEN}✅ Nginx reloaded successfully!${NC}"
    echo ""
    echo -e "${GREEN}📊 Load Balancer Configuration:${NC}"
    echo -e "   Primary Server: ${PRIMARY_SERVER_IP}:${BACKEND_PORT} (weight: 3 - 50% traffic)"
    echo -e "   Secondary Server 1: ${SECONDARY_SERVER_1}:${BACKEND_PORT} (weight: 2 - 33% traffic)"
    echo -e "   Secondary Server 2: ${SECONDARY_SERVER_2}:${BACKEND_PORT} (weight: 1 - 17% traffic)"
    echo -e "   Method: least_conn (least connections)"
else
    echo -e "${RED}❌ Nginx configuration test failed!${NC}"
    echo -e "${YELLOW}   Restoring backup...${NC}"
    if [ -f "/etc/nginx/nginx.conf.backup.$(date +%Y%m%d)_*" ]; then
        cp /etc/nginx/nginx.conf.backup.* /etc/nginx/nginx.conf
    fi
    exit 1
fi





