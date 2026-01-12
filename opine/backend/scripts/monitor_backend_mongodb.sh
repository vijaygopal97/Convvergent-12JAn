#!/bin/bash
# Quick monitoring script for Backend Load Balancers and MongoDB Replicas
# Usage: bash monitor_backend_mongodb.sh

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 BACKEND LOAD BALANCER & MONGODB REPLICA STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Backend Server IPs
# Server 2 (3.109.186.86) removed - server unreachable and causing issues
BACKEND_SERVERS=(
  "13.233.231.180"
  "13.202.181.167"
)

# MongoDB Replica Members
# Server 2 (3.109.186.86) removed - server unreachable and causing issues
MONGODB_SERVERS=(
  "13.202.181.167:27017"
  "13.233.231.180:27017"
)

SSH_KEY="/var/www/opine/Convergent-New.pem"

# Function to check backend server status
check_backend_server() {
  local server=$1
  local name=$2
  
  echo "🔍 Checking Backend Server: $name ($server)"
  echo "────────────────────────────────────────────"
  
  # Check if server is reachable
  if ping -c 1 -W 2 $server > /dev/null 2>&1; then
    echo "  ✅ Server is reachable"
  else
    echo "  ❌ Server is NOT reachable"
    echo ""
    return
  fi
  
  # Check PM2 status
  PM2_STATUS=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$server "pm2 list 2>/dev/null | grep opine-backend | head -1" 2>/dev/null)
  
  if [ -z "$PM2_STATUS" ]; then
    echo "  ❌ PM2 backend process not found"
  else
    # Extract status
    STATUS=$(echo "$PM2_STATUS" | awk '{print $10}')
    CPU=$(echo "$PM2_STATUS" | awk '{print $11}')
    MEM=$(echo "$PM2_STATUS" | awk '{print $12}')
    
    if [ "$STATUS" = "online" ]; then
      echo "  ✅ Backend Status: $STATUS"
      echo "  📊 CPU: $CPU | Memory: $MEM"
    else
      echo "  ⚠️  Backend Status: $STATUS"
    fi
    
    # Count PM2 instances
    INSTANCE_COUNT=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$server "pm2 list 2>/dev/null | grep opine-backend | wc -l" 2>/dev/null)
    echo "  📈 Backend Instances: $INSTANCE_COUNT"
  fi
  
  # Check CPU usage
  CPU_USAGE=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$server "top -bn1 | grep 'Cpu(s)' | awk '{print \$2}' | sed 's/%us,//'" 2>/dev/null || echo "0")
  echo "  💻 Server CPU: ${CPU_USAGE}%"
  
  # Check memory usage
  MEM_USAGE=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$server "free | grep Mem | awk '{printf \"%.1f\", (\$3/\$2)*100}'" 2>/dev/null || echo "0")
  echo "  💾 Server Memory: ${MEM_USAGE}%"
  
  echo ""
}

# Function to check MongoDB replica member
check_mongodb_replica() {
  local server=$1
  local name=$2
  local host=$(echo $server | cut -d':' -f1)
  local port=$(echo $server | cut -d':' -f2)
  
  echo "🔍 Checking MongoDB Replica: $name ($server)"
  echo "────────────────────────────────────────────"
  
  # Check if server is reachable
  if ping -c 1 -W 2 $host > /dev/null 2>&1; then
    echo "  ✅ Server is reachable"
  else
    echo "  ❌ Server is NOT reachable"
    echo ""
    return
  fi
  
  # Check MongoDB port
  if timeout 2 bash -c "echo > /dev/tcp/$host/$port" 2>/dev/null; then
    echo "  ✅ MongoDB port $port is open"
  else
    echo "  ❌ MongoDB port $port is NOT accessible"
    echo ""
    return
  fi
  
  # Check MongoDB connections (using ss/netstat)
  CONNECTIONS=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$host "ss -tn 2>/dev/null | grep :$port | grep ESTAB | wc -l || netstat -an 2>/dev/null | grep :$port | grep ESTABLISHED | wc -l || echo '0'" 2>/dev/null || echo "0")
  echo "  🔌 Active MongoDB Connections: $CONNECTIONS"
  
  # Try to get replica set status (if mongosh is available)
  REPLICA_STATUS=$(ssh -i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$host "mongosh --quiet --eval 'rs.status().members.find(m => m.name.includes(\"$host\")).stateStr' 2>/dev/null || echo 'unknown'" 2>/dev/null || echo "unknown")
  
  if [ "$REPLICA_STATUS" != "unknown" ] && [ ! -z "$REPLICA_STATUS" ]; then
    if [ "$REPLICA_STATUS" = "PRIMARY" ]; then
      echo "  👑 Replica Role: PRIMARY"
    elif [ "$REPLICA_STATUS" = "SECONDARY" ]; then
      echo "  📋 Replica Role: SECONDARY"
    else
      echo "  ⚠️  Replica Role: $REPLICA_STATUS"
    fi
  else
    echo "  ℹ️  Replica Role: Unable to determine (mongosh may not be available)"
  fi
  
  echo ""
}

# Check all backend servers
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🖥️  BACKEND LOAD BALANCER SERVERS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_backend_server "13.233.231.180" "Server 1"
check_backend_server "13.202.181.167" "Server 3"

# Check all MongoDB replicas
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🗄️  MONGODB REPLICA SET MEMBERS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

check_mongodb_replica "13.202.181.167:27017" "Primary/Server 3"
check_mongodb_replica "13.233.231.180:27017" "Secondary 1/Server 1"

# Summary
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "✅ All checks completed at $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo "💡 Tips:"
echo "   - All backend servers should show 'online' status"
echo "   - MongoDB replicas should show PRIMARY or SECONDARY role"
echo "   - High CPU/Memory usage may indicate load"
echo ""


