#!/bin/bash

# ============================================
# COMPREHENSIVE SYSTEM HEALTH MONITOR
# Monitors: Backend Workers (Both Servers), MongoDB Replica Set, Connections
# Usage: ./monitorSystemHealth.sh [duration_in_minutes] [interval_in_seconds]
# ============================================

DURATION=${1:-60}  # Default 60 minutes
INTERVAL=${2:-10}  # Default 10 seconds

# Calculate END_TIME - add duration minutes to current time
if echo "$DURATION" | grep -q '\.'; then
  # Handle fractional minutes (e.g., 0.5 = 30 seconds)
  DURATION_SECONDS=$(echo "$DURATION * 60" | bc | cut -d. -f1)
  END_TIME=$(date -d "+${DURATION_SECONDS} seconds" +%s 2>/dev/null || echo $(( $(date +%s) + DURATION_SECONDS )))
else
  # Integer minutes
  END_TIME=$(date -d "+${DURATION} minutes" +%s 2>/dev/null || echo $(( $(date +%s) + (DURATION * 60) )))
fi

# Server Configuration
PRIMARY_SERVER="172.31.43.71"
SECONDARY_SERVER="172.31.47.152"
SECONDARY_SSH="3.109.82.159"
SSH_KEY="/var/www/MyLogos/Convergent-New.pem"
MONGODB_USER="opine_user"
MONGODB_PASS="OpineApp2024Secure"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Clear screen and show header
clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         COMPREHENSIVE SYSTEM HEALTH MONITOR - ENTERPRISE GRADE            ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Duration: ${GREEN}${DURATION} minutes${NC} | Interval: ${GREEN}${INTERVAL} seconds${NC} | Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

# Function to get memory stats for a server
get_server_memory() {
  local server_type=$1
  
  if [ "$server_type" == "primary" ]; then
    # Local server - use pm2 directly
    pm2 jlist 2>/dev/null | jq -c ".[] | select(.name | contains(\"opine-backend\")) | {id: .pm2_env.pm_id, memory: .monit.memory, cpu: .monit.cpu, status: .pm2_env.status}" 2>/dev/null || echo ""
  else
    # Secondary server - use SSH
    ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@"$SECONDARY_SSH" "pm2 jlist 2>/dev/null | jq -c '.[] | select(.name | contains(\"opine-backend\")) | {id: .pm2_env.pm_id, memory: .monit.memory, cpu: .monit.cpu, status: .pm2_env.status}'" 2>/dev/null || echo ""
  fi
}

# Function to check MongoDB replica set status
check_mongodb_replica() {
  # Try without auth first (might be temporarily disabled)
  local result=$(mongosh "mongodb://${PRIMARY_SERVER}:27017/admin" --quiet --eval "
    try {
      const r = db.adminCommand('ismaster');
      const s = rs.status();
      const members = s.members || [];
      
      print(JSON.stringify({
        primary: r.ismaster ? '${PRIMARY_SERVER}:27017' : (members.find(m => m.stateStr === 'PRIMARY')?.name || 'NONE'),
        setName: r.setName || 'NONE',
        members: members.map(m => ({
          name: m.name,
          state: m.stateStr,
          health: m.health,
          uptime: m.uptime || 0,
          optime: m.optimeDate || null
        }))
      }));
    } catch(e) {
      print(JSON.stringify({error: e.message}));
    }
  " 2>/dev/null)
  
  # If failed, try with auth
  if [ -z "$result" ] || echo "$result" | grep -q "error"; then
    result=$(mongosh "mongodb://${MONGODB_USER}:${MONGODB_PASS}@${PRIMARY_SERVER}:27017/admin?authSource=admin" --quiet --eval "
      try {
        const r = db.adminCommand('ismaster');
        const s = rs.status();
        const members = s.members || [];
        
        print(JSON.stringify({
          primary: r.ismaster ? '${PRIMARY_SERVER}:27017' : (members.find(m => m.stateStr === 'PRIMARY')?.name || 'NONE'),
          setName: r.setName || 'NONE',
          members: members.map(m => ({
            name: m.name,
            state: m.stateStr,
            health: m.health,
            uptime: m.uptime || 0,
            optime: m.optimeDate || null
          }))
        }));
      } catch(e) {
        print(JSON.stringify({error: e.message}));
      }
    " 2>/dev/null)
  fi
  
  echo "${result:-{\"error\":\"Connection failed\"}}"
}

# Function to check MongoDB connections
check_mongodb_connections() {
  # Try without auth first
  local result=$(mongosh "mongodb://${PRIMARY_SERVER}:27017/admin" --quiet --eval "
    try {
      const serverStatus = db.serverStatus();
      const conn = serverStatus.connections || {};
      const network = serverStatus.network || {};
      const repl = serverStatus.repl || {};
      
      print(JSON.stringify({
        current: conn.current || 0,
        available: conn.available || 0,
        active: conn.active || 0,
        network_in: network.bytesIn || 0,
        network_out: network.bytesOut || 0,
        oplog_lag: repl.lag || 0
      }));
    } catch(e) {
      print(JSON.stringify({error: e.message}));
    }
  " 2>/dev/null)
  
  # If failed, try with auth
  if [ -z "$result" ] || echo "$result" | grep -q "error"; then
    result=$(mongosh "mongodb://${MONGODB_USER}:${MONGODB_PASS}@${PRIMARY_SERVER}:27017/admin?authSource=admin" --quiet --eval "
      try {
        const serverStatus = db.serverStatus();
        const conn = serverStatus.connections || {};
        const network = serverStatus.network || {};
        const repl = serverStatus.repl || {};
        
        print(JSON.stringify({
          current: conn.current || 0,
          available: conn.available || 0,
          active: conn.active || 0,
          network_in: network.bytesIn || 0,
          network_out: network.bytesOut || 0,
          oplog_lag: repl.lag || 0
        }));
      } catch(e) {
        print(JSON.stringify({error: e.message}));
      }
    " 2>/dev/null)
  fi
  
  echo "${result:-{\"error\":\"Connection failed\"}}"
}

# Function to calculate memory stats
calculate_memory_stats() {
  local memory_json=$1
  local server_type=$2
  
  local total_mem=0
  local max_mem=0
  local min_mem=999999999
  local process_count=0
  local total_cpu=0
  
  if [ -z "$memory_json" ]; then
    echo "0|0|0|0|0|0"
    return
  fi
  
  while IFS= read -r line; do
    if [ -z "$line" ] || [ "$line" == "[]" ] || [ "$line" == "" ]; then
      continue
    fi
    
    # Check if line is valid JSON
    if ! echo "$line" | jq . >/dev/null 2>&1; then
      continue
    fi
    
    local mem=$(echo "$line" | jq -r '.memory // 0' 2>/dev/null)
    local cpu=$(echo "$line" | jq -r '.cpu // 0' 2>/dev/null)
    local status=$(echo "$line" | jq -r '.status // "unknown"' 2>/dev/null)
    
    if [ "$mem" != "null" ] && [ "$mem" != "0" ] && [ -n "$mem" ] && [ "$status" == "online" ]; then
      mem=$((mem / 1024 / 1024))  # Convert to MB
      total_mem=$((total_mem + mem))
      total_cpu=$(echo "$total_cpu + $cpu" | bc -l 2>/dev/null || echo "$total_cpu")
      process_count=$((process_count + 1))
      
      if [ $mem -gt $max_mem ]; then
        max_mem=$mem
      fi
      if [ $mem -lt $min_mem ]; then
        min_mem=$mem
      fi
    fi
  done <<< "$memory_json"
  
  local avg_mem=0
  if [ $process_count -gt 0 ]; then
    avg_mem=$((total_mem / process_count))
  fi
  
  echo "$total_mem|$max_mem|$min_mem|$avg_mem|$process_count|$total_cpu"
}

# Get baseline memory for both servers
echo -e "${BLUE}📊 Gathering baseline metrics...${NC}"
PRIMARY_BASELINE_JSON=$(get_server_memory "primary")
SECONDARY_BASELINE_JSON=$(get_server_memory "secondary")

PRIMARY_BASELINE_STATS=$(calculate_memory_stats "$PRIMARY_BASELINE_JSON" "primary")
PRIMARY_BASELINE_TOTAL=$(echo "$PRIMARY_BASELINE_STATS" | cut -d'|' -f1)
PRIMARY_BASELINE_MAX=$(echo "$PRIMARY_BASELINE_STATS" | cut -d'|' -f2)

SECONDARY_BASELINE_STATS=$(calculate_memory_stats "$SECONDARY_BASELINE_JSON" "secondary")
SECONDARY_BASELINE_TOTAL=$(echo "$SECONDARY_BASELINE_STATS" | cut -d'|' -f1)
SECONDARY_BASELINE_MAX=$(echo "$SECONDARY_BASELINE_STATS" | cut -d'|' -f2)

echo -e "${GREEN}✅ Baseline established${NC}"
echo -e "  Primary Server: ${PRIMARY_BASELINE_TOTAL}MB total (max: ${PRIMARY_BASELINE_MAX}MB)"
echo -e "  Secondary Server: ${SECONDARY_BASELINE_TOTAL}MB total (max: ${SECONDARY_BASELINE_MAX}MB)"
echo ""
sleep 2

# Monitoring variables
SNAPSHOT=1
PRIMARY_MAX_INCREASE=0
SECONDARY_MAX_INCREASE=0
PRIMARY_LEAK_COUNT=0
SECONDARY_LEAK_COUNT=0

# Main monitoring loop - continuously check time like reference script
while [ $(date +%s) -lt $END_TIME ]; do
  TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
  
  # Get current stats
  PRIMARY_CURRENT_JSON=$(get_server_memory "primary")
  SECONDARY_CURRENT_JSON=$(get_server_memory "secondary")
  MONGODB_REPLICA=$(check_mongodb_replica)
  MONGODB_CONN=$(check_mongodb_connections)
  
  # Calculate memory stats
  PRIMARY_CURRENT_STATS=$(calculate_memory_stats "$PRIMARY_CURRENT_JSON" "primary")
  PRIMARY_CURRENT_TOTAL=$(echo "$PRIMARY_CURRENT_STATS" | cut -d'|' -f1)
  PRIMARY_CURRENT_MAX=$(echo "$PRIMARY_CURRENT_STATS" | cut -d'|' -f2)
  PRIMARY_PROCESS_COUNT=$(echo "$PRIMARY_CURRENT_STATS" | cut -d'|' -f5)
  PRIMARY_TOTAL_CPU=$(echo "$PRIMARY_CURRENT_STATS" | cut -d'|' -f6)
  
  SECONDARY_CURRENT_STATS=$(calculate_memory_stats "$SECONDARY_CURRENT_JSON" "secondary")
  SECONDARY_CURRENT_TOTAL=$(echo "$SECONDARY_CURRENT_STATS" | cut -d'|' -f1)
  SECONDARY_CURRENT_MAX=$(echo "$SECONDARY_CURRENT_STATS" | cut -d'|' -f2)
  SECONDARY_PROCESS_COUNT=$(echo "$SECONDARY_CURRENT_STATS" | cut -d'|' -f5)
  SECONDARY_TOTAL_CPU=$(echo "$SECONDARY_CURRENT_STATS" | cut -d'|' -f6)
  
  # Calculate memory increases
  PRIMARY_MEM_INCREASE=$((PRIMARY_CURRENT_TOTAL - PRIMARY_BASELINE_TOTAL))
  SECONDARY_MEM_INCREASE=$((SECONDARY_CURRENT_TOTAL - SECONDARY_BASELINE_TOTAL))
  
  # Track max increases
  if [ $PRIMARY_MEM_INCREASE -gt $PRIMARY_MAX_INCREASE ]; then
    PRIMARY_MAX_INCREASE=$PRIMARY_MEM_INCREASE
  fi
  if [ $SECONDARY_MEM_INCREASE -gt $SECONDARY_MAX_INCREASE ]; then
    SECONDARY_MAX_INCREASE=$SECONDARY_MEM_INCREASE
  fi
  
  # Count leaks
  if [ $PRIMARY_MEM_INCREASE -gt 200 ]; then
    PRIMARY_LEAK_COUNT=$((PRIMARY_LEAK_COUNT + 1))
  fi
  if [ $SECONDARY_MEM_INCREASE -gt 200 ]; then
    SECONDARY_LEAK_COUNT=$((SECONDARY_LEAK_COUNT + 1))
  fi
  
  # Determine status
  PRIMARY_STATUS="${GREEN}✅ Stable${NC}"
  if [ $PRIMARY_MEM_INCREASE -gt 500 ]; then
    PRIMARY_STATUS="${RED}🚨 MASSIVE LEAK${NC}"
  elif [ $PRIMARY_MEM_INCREASE -gt 200 ]; then
    PRIMARY_STATUS="${YELLOW}⚠️  LEAK${NC}"
  elif [ $PRIMARY_MEM_INCREASE -gt 50 ]; then
    PRIMARY_STATUS="${YELLOW}⚠️  Growing${NC}"
  fi
  
  SECONDARY_STATUS="${GREEN}✅ Stable${NC}"
  if [ $SECONDARY_MEM_INCREASE -gt 500 ]; then
    SECONDARY_STATUS="${RED}🚨 MASSIVE LEAK${NC}"
  elif [ $SECONDARY_MEM_INCREASE -gt 200 ]; then
    SECONDARY_STATUS="${YELLOW}⚠️  LEAK${NC}"
  elif [ $SECONDARY_MEM_INCREASE -gt 50 ]; then
    SECONDARY_STATUS="${YELLOW}⚠️  Growing${NC}"
  fi
  
  # Parse MongoDB replica set status
  MONGODB_PRIMARY=$(echo "$MONGODB_REPLICA" | jq -r '.primary // "UNKNOWN"' 2>/dev/null)
  MONGODB_SET_NAME=$(echo "$MONGODB_REPLICA" | jq -r '.setName // "NONE"' 2>/dev/null)
  MONGODB_ERROR=$(echo "$MONGODB_REPLICA" | jq -r '.error // empty' 2>/dev/null)
  
  MONGODB_MEMBERS=$(echo "$MONGODB_REPLICA" | jq -r '.members[]? | "\(.name):\(.state):\(.health)"' 2>/dev/null || echo "")
  
  # Parse MongoDB connections
  MONGODB_CONN_CURRENT=$(echo "$MONGODB_CONN" | jq -r '.current // 0' 2>/dev/null)
  MONGODB_CONN_ACTIVE=$(echo "$MONGODB_CONN" | jq -r '.active // 0' 2>/dev/null)
  MONGODB_NETWORK_IN=$(echo "$MONGODB_CONN" | jq -r '.network_in // 0' 2>/dev/null)
  MONGODB_NETWORK_OUT=$(echo "$MONGODB_CONN" | jq -r '.network_out // 0' 2>/dev/null)
  
  # Convert network bytes to MB
  if [ "$MONGODB_NETWORK_IN" != "null" ] && [ -n "$MONGODB_NETWORK_IN" ]; then
    MONGODB_NETWORK_IN_MB=$((MONGODB_NETWORK_IN / 1024 / 1024))
  else
    MONGODB_NETWORK_IN_MB=0
  fi
  
  if [ "$MONGODB_NETWORK_OUT" != "null" ] && [ -n "$MONGODB_NETWORK_OUT" ]; then
    MONGODB_NETWORK_OUT_MB=$((MONGODB_NETWORK_OUT / 1024 / 1024))
  else
    MONGODB_NETWORK_OUT_MB=0
  fi
  
  # Clear and display dashboard
  clear
  echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║         COMPREHENSIVE SYSTEM HEALTH MONITOR - ENTERPRISE GRADE            ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BLUE}Snapshot #${SNAPSHOT}${NC} | ${TIMESTAMP} | Elapsed: $(( (SNAPSHOT * INTERVAL) / 60 ))min"
  echo ""
  
  # Backend Workers Section
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}📊 BACKEND WORKERS HEALTH${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  # Primary Server
  echo -e "\n${YELLOW}Primary Server (${PRIMARY_SERVER}):${NC}"
  echo -e "  Memory: ${PRIMARY_CURRENT_TOTAL}MB total | ${PRIMARY_CURRENT_MAX}MB max | ${PRIMARY_STATUS}"
  echo -e "  Change: ${PRIMARY_MEM_INCREASE:+${GREEN}+}${PRIMARY_MEM_INCREASE}${PRIMARY_MEM_INCREASE:-0}${NC}MB from baseline"
  echo -e "  Workers: ${PRIMARY_PROCESS_COUNT} processes | CPU: $(printf "%.1f" "$PRIMARY_TOTAL_CPU")% total"
  
  # Show individual process breakdown
  if [ -n "$PRIMARY_CURRENT_JSON" ]; then
    echo -e "  ${BLUE}Process Breakdown:${NC}"
    echo "$PRIMARY_CURRENT_JSON" | while IFS= read -r line; do
      if [ -n "$line" ] && echo "$line" | jq . >/dev/null 2>&1; then
        id=$(echo "$line" | jq -r '.id // ""')
        mem=$(echo "$line" | jq -r '.memory // 0')
        cpu=$(echo "$line" | jq -r '.cpu // 0')
        status=$(echo "$line" | jq -r '.status // "unknown"')
        if [ "$status" == "online" ] && [ -n "$id" ]; then
          mem=$((mem / 1024 / 1024))
          echo "    Worker ${id}: ${mem}MB | CPU: $(printf "%.1f" "$cpu")%"
        fi
      fi
    done
  fi
  
  # Secondary Server
  echo -e "\n${YELLOW}Secondary Server (${SECONDARY_SERVER}):${NC}"
  if [ -z "$SECONDARY_CURRENT_JSON" ]; then
    echo -e "  ${RED}⚠️  Cannot connect to secondary server${NC}"
  else
    echo -e "  Memory: ${SECONDARY_CURRENT_TOTAL}MB total | ${SECONDARY_CURRENT_MAX}MB max | ${SECONDARY_STATUS}"
    echo -e "  Change: ${SECONDARY_MEM_INCREASE:+${GREEN}+}${SECONDARY_MEM_INCREASE}${SECONDARY_MEM_INCREASE:-0}${NC}MB from baseline"
    echo -e "  Workers: ${SECONDARY_PROCESS_COUNT} processes | CPU: $(printf "%.1f" "$SECONDARY_TOTAL_CPU")% total"
    
    # Show individual process breakdown
    echo -e "  ${BLUE}Process Breakdown:${NC}"
    echo "$SECONDARY_CURRENT_JSON" | while IFS= read -r line; do
      if [ -n "$line" ] && echo "$line" | jq . >/dev/null 2>&1; then
        id=$(echo "$line" | jq -r '.id // ""')
        mem=$(echo "$line" | jq -r '.memory // 0')
        cpu=$(echo "$line" | jq -r '.cpu // 0')
        status=$(echo "$line" | jq -r '.status // "unknown"')
        if [ "$status" == "online" ] && [ -n "$id" ]; then
          mem=$((mem / 1024 / 1024))
          echo "    Worker ${id}: ${mem}MB | CPU: $(printf "%.1f" "$cpu")%"
        fi
      fi
    done
  fi
  
  # MongoDB Replica Set Section
  echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}🗄️  MONGODB REPLICA SET HEALTH${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if [ -n "$MONGODB_ERROR" ] && [ "$MONGODB_ERROR" != "null" ]; then
    echo -e "${RED}  ⚠️  Error: ${MONGODB_ERROR}${NC}"
  else
    echo -e "  Replica Set: ${GREEN}${MONGODB_SET_NAME}${NC}"
    echo -e "  Primary: ${GREEN}${MONGODB_PRIMARY}${NC}"
    echo -e "\n  ${BLUE}Members:${NC}"
    
    if [ -n "$MONGODB_MEMBERS" ]; then
      while IFS=':' read -r name state health; do
        if [ "$state" == "PRIMARY" ]; then
          HEALTH_ICON="⭐"
          COLOR="${GREEN}"
        elif [ "$state" == "SECONDARY" ]; then
          HEALTH_ICON="✓"
          COLOR="${GREEN}"
        else
          HEALTH_ICON="⚠️"
          COLOR="${YELLOW}"
        fi
        
        if [ "$health" == "1" ]; then
          HEALTH_STATUS="${GREEN}Healthy${NC}"
        else
          HEALTH_STATUS="${RED}Unhealthy${NC}"
        fi
        
        echo -e "    ${COLOR}${HEALTH_ICON} ${name}${NC}: ${state} | ${HEALTH_STATUS}"
      done <<< "$MONGODB_MEMBERS"
    else
      echo -e "    ${YELLOW}⚠️  No members found${NC}"
    fi
  fi
  
  # MongoDB Connections Section
  echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}🔌 MONGODB CONNECTIONS & NETWORK${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if [ "$MONGODB_CONN_CURRENT" != "null" ] && [ -n "$MONGODB_CONN_CURRENT" ]; then
    echo -e "  Connections: ${CYAN}${MONGODB_CONN_CURRENT}${NC} current | ${CYAN}${MONGODB_CONN_ACTIVE}${NC} active"
    echo -e "  Network: ${CYAN}${MONGODB_NETWORK_IN_MB}${NC}MB in | ${CYAN}${MONGODB_NETWORK_OUT_MB}${NC}MB out"
  else
    echo -e "  ${RED}⚠️  Cannot retrieve connection stats${NC}"
  fi
  
  # Summary Section
  echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}📈 SUMMARY${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  Primary Max Increase: ${PRIMARY_MAX_INCREASE:+${GREEN}+}${PRIMARY_MAX_INCREASE}${PRIMARY_MAX_INCREASE:-0}${NC}MB (Leak events: ${PRIMARY_LEAK_COUNT})"
  echo -e "  Secondary Max Increase: ${SECONDARY_MAX_INCREASE:+${GREEN}+}${SECONDARY_MAX_INCREASE}${SECONDARY_MAX_INCREASE:-0}${NC}MB (Leak events: ${SECONDARY_LEAK_COUNT})"
  
  SNAPSHOT=$((SNAPSHOT + 1))
  sleep $INTERVAL
done

# Final Summary
clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    MONITORING SESSION COMPLETE                             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Duration: ${DURATION} minutes | Total Snapshots: $((SNAPSHOT - 1))"
echo -e "Ended: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""

echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}📊 MEMORY LEAK ANALYSIS${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Primary Server Summary
echo -e "${YELLOW}Primary Server (${PRIMARY_SERVER}):${NC}"
echo -e "  Baseline: ${PRIMARY_BASELINE_TOTAL}MB"
echo -e "  Peak Increase: ${PRIMARY_MAX_INCREASE:+${GREEN}+}${PRIMARY_MAX_INCREASE}${PRIMARY_MAX_INCREASE:-0}${NC}MB"
echo -e "  Leak Detections (>200MB): ${PRIMARY_LEAK_COUNT}"

if [ $PRIMARY_MAX_INCREASE -gt 500 ]; then
  echo -e "  ${RED}🚨 CRITICAL: Massive memory leak detected${NC}"
  echo -e "  ${RED}   Action: Investigate endpoints immediately${NC}"
elif [ $PRIMARY_MAX_INCREASE -gt 200 ]; then
  echo -e "  ${YELLOW}⚠️  WARNING: Moderate memory growth${NC}"
  echo -e "  ${YELLOW}   Action: Monitor closely for leaks${NC}"
elif [ $PRIMARY_MAX_INCREASE -gt 50 ]; then
  echo -e "  ${GREEN}✅ ACCEPTABLE: Minor memory growth${NC}"
else
  echo -e "  ${GREEN}✅ EXCELLENT: Memory stable${NC}"
fi

echo ""

# Secondary Server Summary
echo -e "${YELLOW}Secondary Server (${SECONDARY_SERVER}):${NC}"
if [ "$SECONDARY_BASELINE_TOTAL" != "0" ] && [ -n "$SECONDARY_BASELINE_TOTAL" ]; then
  echo -e "  Baseline: ${SECONDARY_BASELINE_TOTAL}MB"
  echo -e "  Peak Increase: ${SECONDARY_MAX_INCREASE:+${GREEN}+}${SECONDARY_MAX_INCREASE}${SECONDARY_MAX_INCREASE:-0}${NC}MB"
  echo -e "  Leak Detections (>200MB): ${SECONDARY_LEAK_COUNT}"
  
  if [ $SECONDARY_MAX_INCREASE -gt 500 ]; then
    echo -e "  ${RED}🚨 CRITICAL: Massive memory leak detected${NC}"
    echo -e "  ${RED}   Action: Investigate endpoints immediately${NC}"
  elif [ $SECONDARY_MAX_INCREASE -gt 200 ]; then
    echo -e "  ${YELLOW}⚠️  WARNING: Moderate memory growth${NC}"
    echo -e "  ${YELLOW}   Action: Monitor closely for leaks${NC}"
  elif [ $SECONDARY_MAX_INCREASE -gt 50 ]; then
    echo -e "  ${GREEN}✅ ACCEPTABLE: Minor memory growth${NC}"
  else
    echo -e "  ${GREEN}✅ EXCELLENT: Memory stable${NC}"
  fi
else
  echo -e "  ${YELLOW}⚠️  Secondary server not accessible during monitoring${NC}"
fi

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}🗄️  MONGODB FINAL STATUS${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

FINAL_MONGODB_REPLICA=$(check_mongodb_replica)
FINAL_MONGODB_CONN=$(check_mongodb_connections)

FINAL_PRIMARY=$(echo "$FINAL_MONGODB_REPLICA" | jq -r '.primary // "UNKNOWN"' 2>/dev/null)
FINAL_SET_NAME=$(echo "$FINAL_MONGODB_REPLICA" | jq -r '.setName // "NONE"' 2>/dev/null)
FINAL_CONN_CURRENT=$(echo "$FINAL_MONGODB_CONN" | jq -r '.current // 0' 2>/dev/null)

echo -e "  Replica Set: ${GREEN}${FINAL_SET_NAME}${NC}"
echo -e "  Primary: ${GREEN}${FINAL_PRIMARY}${NC}"
echo -e "  Active Connections: ${CYAN}${FINAL_CONN_CURRENT}${NC}"

echo ""
echo -e "${GREEN}✅ Monitoring complete!${NC}"

