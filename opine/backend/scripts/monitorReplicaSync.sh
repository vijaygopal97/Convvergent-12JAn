#!/bin/bash

# ============================================
# MONGODB REPLICA SET SYNC STATUS MONITOR
# Monitors replica set sync progress and alerts when complete
# Usage: ./monitorReplicaSync.sh [check_interval_seconds]
# ============================================

INTERVAL=${1:-10}  # Default 10 seconds between checks
PRIMARY_SERVER="172.31.43.71"
SECONDARY_SERVER="172.31.47.152"
MONGODB_USER="opine_user"
MONGODB_PASS="OpineApp2024Secure"
# Use replica set connection string for better compatibility
REPLICA_SET_URI="mongodb://${MONGODB_USER}:${MONGODB_PASS}@${PRIMARY_SERVER}:27017,${SECONDARY_SERVER}:27017/admin?authSource=admin&replicaSet=rs0&readPreference=primaryPreferred"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to check replica set status
check_replica_status() {
  # Try replica set connection string first (with auth)
  local result=$(mongosh "${REPLICA_SET_URI}" --quiet --eval "
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
          optime: m.optimeDate ? m.optimeDate.toISOString() : null,
          lastHeartbeatMessage: m.lastHeartbeatMessage || null,
          lagTime: m.optimeDate && s.members.find(p => p.stateStr === 'PRIMARY')?.optimeDate ? 
            Math.round((s.members.find(p => p.stateStr === 'PRIMARY').optimeDate - m.optimeDate) / 1000) : null
        }))
      }));
    } catch(e) {
      print(JSON.stringify({error: e.message}));
    }
  " 2>/dev/null)
  
  # If failed, try direct connection to localhost with auth (most reliable)
  if [ -z "$result" ] || echo "$result" | grep -q "error" || echo "$result" | grep -q "requires authentication"; then
    result=$(mongosh "mongodb://${MONGODB_USER}:${MONGODB_PASS}@127.0.0.1:27017/admin?authSource=admin" --quiet --eval "
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
            optime: m.optimeDate ? m.optimeDate.toISOString() : null,
            lastHeartbeatMessage: m.lastHeartbeatMessage || null,
            lagTime: m.optimeDate && s.members.find(p => p.stateStr === 'PRIMARY')?.optimeDate ? 
              Math.round((s.members.find(p => p.stateStr === 'PRIMARY').optimeDate - m.optimeDate) / 1000) : null
          }))
        }));
      } catch(e) {
        print(JSON.stringify({error: e.message}));
      }
    " 2>/dev/null)
  fi
  
  # If still failed, try local connection (no auth - if auth is temporarily disabled)
  if [ -z "$result" ] || echo "$result" | grep -q "error" || echo "$result" | grep -q "requires authentication"; then
    result=$(mongosh --quiet --eval "
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
            optime: m.optimeDate ? m.optimeDate.toISOString() : null,
            lastHeartbeatMessage: m.lastHeartbeatMessage || null,
            lagTime: m.optimeDate && s.members.find(p => p.stateStr === 'PRIMARY')?.optimeDate ? 
              Math.round((s.members.find(p => p.stateStr === 'PRIMARY').optimeDate - m.optimeDate) / 1000) : null
          }))
        }));
      } catch(e) {
        print(JSON.stringify({error: e.message}));
      }
    " 2>/dev/null)
  fi
  
  # Last resort: try local connection if auth is disabled
  if [ -z "$result" ] || echo "$result" | grep -q "error" || echo "$result" | grep -q "requires authentication"; then
    result=$(mongosh "mongodb://127.0.0.1:27017/admin" --quiet --eval "
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
            optime: m.optimeDate ? m.optimeDate.toISOString() : null,
            lastHeartbeatMessage: m.lastHeartbeatMessage || null,
            lagTime: m.optimeDate && s.members.find(p => p.stateStr === 'PRIMARY')?.optimeDate ? 
              Math.round((s.members.find(p => p.stateStr === 'PRIMARY').optimeDate - m.optimeDate) / 1000) : null
          }))
        }));
      } catch(e) {
        print(JSON.stringify({error: e.message}));
      }
    " 2>/dev/null)
  fi
  
  echo "$result"
}

# Function to get sync progress estimate
get_sync_progress() {
  local member_state=$1
  local last_heartbeat=$2
  
  if [ "$member_state" == "STARTUP2" ]; then
    echo "📥 Initial Sync Starting..."
  elif [ "$member_state" == "RECOVERING" ]; then
    if [ -n "$last_heartbeat" ] && [ "$last_heartbeat" != "null" ]; then
      echo "📥 Recovering: $last_heartbeat"
    else
      echo "📥 Recovering..."
    fi
  elif [ "$member_state" == "SECONDARY" ]; then
    echo "✅ Synced and Ready"
  elif [ "$member_state" == "PRIMARY" ]; then
    echo "⭐ PRIMARY"
  else
    echo "⚠️ $member_state"
  fi
}

# Clear screen and show header
clear
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║            MONGODB REPLICA SET SYNC STATUS MONITOR                       ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "Monitoring sync status every ${GREEN}${INTERVAL} seconds${NC}"
echo -e "Started: $(date '+%Y-%m-%d %H:%M:%S')"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop monitoring${NC}"
echo ""

CHECK_COUNT=0
SYNC_COMPLETE=false
LAST_STATUS=""

while true; do
  CHECK_COUNT=$((CHECK_COUNT + 1))
  TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")
  
  # Get replica set status
  REPLICA_STATUS=$(check_replica_status)
  
  # Check for errors
  if [ -z "$REPLICA_STATUS" ] || echo "$REPLICA_STATUS" | grep -q '"error"'; then
    ERROR_MSG=$(echo "$REPLICA_STATUS" | jq -r '.error // "Connection failed"' 2>/dev/null)
    clear
    echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║            MONGODB REPLICA SET SYNC STATUS MONITOR                       ║${NC}"
    echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${RED}❌ Error: ${ERROR_MSG}${NC}"
    echo -e "Check #${CHECK_COUNT} at ${TIMESTAMP}"
    echo ""
    echo -e "${YELLOW}Retrying in ${INTERVAL} seconds...${NC}"
    sleep $INTERVAL
    continue
  fi
  
  # Parse status
  PRIMARY=$(echo "$REPLICA_STATUS" | jq -r '.primary // "UNKNOWN"' 2>/dev/null)
  SET_NAME=$(echo "$REPLICA_STATUS" | jq -r '.setName // "NONE"' 2>/dev/null)
  MEMBERS=$(echo "$REPLICA_STATUS" | jq -r '.members[]?' 2>/dev/null)
  
  # Clear and display status
  clear
  echo -e "${CYAN}╔════════════════════════════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║            MONGODB REPLICA SET SYNC STATUS MONITOR                       ║${NC}"
  echo -e "${CYAN}╚════════════════════════════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "Check #${CHECK_COUNT} | ${TIMESTAMP}"
  echo ""
  
  # Display replica set info
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}📊 REPLICA SET STATUS${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "  Replica Set: ${GREEN}${SET_NAME}${NC}"
  echo -e "  Primary: ${GREEN}${PRIMARY}${NC}"
  echo ""
  
  # Display members
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}🔗 REPLICA SET MEMBERS${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  ALL_SYNCED=true
  MEMBER_COUNT=0
  
  while IFS= read -r member_json; do
    if [ -z "$member_json" ] || [ "$member_json" == "null" ]; then
      continue
    fi
    
    MEMBER_COUNT=$((MEMBER_COUNT + 1))
    NAME=$(echo "$member_json" | jq -r '.name // "UNKNOWN"')
    STATE=$(echo "$member_json" | jq -r '.state // "UNKNOWN"')
    HEALTH=$(echo "$member_json" | jq -r '.health // 0')
    UPTIME=$(echo "$member_json" | jq -r '.uptime // 0')
    OPTIME=$(echo "$member_json" | jq -r '.optime // null')
    LAST_MSG=$(echo "$member_json" | jq -r '.lastHeartbeatMessage // null')
    LAG_TIME=$(echo "$member_json" | jq -r '.lagTime // null')
    
    UPTIME_MIN=$((UPTIME / 60))
    
    # Determine status icon and color
    if [ "$STATE" == "PRIMARY" ]; then
      ICON="⭐"
      COLOR="${GREEN}"
      STATUS_MSG="PRIMARY - Accepting Writes"
      ALL_SYNCED=true  # PRIMARY doesn't affect sync status
    elif [ "$STATE" == "SECONDARY" ]; then
      ICON="✅"
      COLOR="${GREEN}"
      STATUS_MSG="SECONDARY - Synced and Ready"
      if [ "$HEALTH" != "1" ]; then
        ALL_SYNCED=false
      fi
    elif [ "$STATE" == "STARTUP2" ] || [ "$STATE" == "RECOVERING" ]; then
      ICON="📥"
      COLOR="${YELLOW}"
      STATUS_MSG=$(get_sync_progress "$STATE" "$LAST_MSG")
      ALL_SYNCED=false
    else
      ICON="⚠️"
      COLOR="${RED}"
      STATUS_MSG="$STATE"
      ALL_SYNCED=false
    fi
    
    # Display member info
    echo -e "\n${COLOR}${ICON} ${NAME}${NC}"
    echo -e "  State: ${COLOR}${STATE}${NC}"
    echo -e "  Health: $([ "$HEALTH" == "1" ] && echo -e "${GREEN}Healthy${NC}" || echo -e "${RED}Unhealthy${NC}")"
    echo -e "  Uptime: ${UPTIME_MIN} minutes"
    echo -e "  Status: ${STATUS_MSG}"
    
    if [ -n "$LAG_TIME" ] && [ "$LAG_TIME" != "null" ] && [ "$STATE" == "SECONDARY" ]; then
      if [ "$LAG_TIME" -lt 5 ]; then
        echo -e "  Replication Lag: ${GREEN}${LAG_TIME}s${NC} (Excellent)"
      elif [ "$LAG_TIME" -lt 30 ]; then
        echo -e "  Replication Lag: ${YELLOW}${LAG_TIME}s${NC} (Good)"
      else
        echo -e "  Replication Lag: ${RED}${LAG_TIME}s${NC} (High)"
      fi
    fi
    
    if [ -n "$LAST_MSG" ] && [ "$LAST_MSG" != "null" ] && [ "$STATE" != "SECONDARY" ] && [ "$STATE" != "PRIMARY" ]; then
      echo -e "  ${YELLOW}Message: ${LAST_MSG}${NC}"
    fi
  done <<< "$(echo "$REPLICA_STATUS" | jq -c '.members[]?' 2>/dev/null)"
  
  if [ $MEMBER_COUNT -eq 0 ]; then
    echo -e "${RED}  ⚠️  No members found${NC}"
    ALL_SYNCED=false
  fi
  
  # Summary
  echo ""
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${CYAN}📈 SYNC STATUS SUMMARY${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  
  if $ALL_SYNCED; then
    echo -e "${GREEN}✅✅✅ ALL REPLICAS SYNCED ✅✅✅${NC}"
    echo ""
    echo -e "${GREEN}Your replica set is fully operational!${NC}"
    echo -e "${GREEN}All members are synced and ready.${NC}"
    echo ""
    echo -e "You can now use the comprehensive monitoring script:"
    echo -e "  ${CYAN}cd /var/www/opine/backend/scripts${NC}"
    echo -e "  ${CYAN}./monitorSystemHealth.sh${NC}"
    echo ""
    SYNC_COMPLETE=true
  else
    SECONDARY_COUNT=$(echo "$REPLICA_STATUS" | jq '[.members[]? | select(.state == "SECONDARY")] | length' 2>/dev/null)
    SYNCING_COUNT=$(echo "$REPLICA_STATUS" | jq '[.members[]? | select(.state == "STARTUP2" or .state == "RECOVERING")] | length' 2>/dev/null)
    
    echo -e "${YELLOW}📥 Sync in progress...${NC}"
    echo -e "  Secondary members synced: ${SECONDARY_COUNT}"
    echo -e "  Members syncing: ${SYNCING_COUNT}"
    echo ""
    echo -e "${YELLOW}Initial sync can take 10-30 minutes depending on data size.${NC}"
    echo -e "${YELLOW}Please wait...${NC}"
    SYNC_COMPLETE=false
  fi
  
  # Next check info
  echo ""
  echo -e "${BLUE}Next check in ${INTERVAL} seconds...${NC}"
  echo -e "${BLUE}(Press Ctrl+C to stop)${NC}"
  
  # If sync is complete, wait a bit more then exit (or continue monitoring)
  if $SYNC_COMPLETE; then
    if [ "$LAST_STATUS" != "SYNCED" ]; then
      LAST_STATUS="SYNCED"
      echo ""
      echo -e "${GREEN}🎉🎉🎉 SYNC COMPLETE - Monitoring for 60 seconds to confirm stability... 🎉🎉🎉${NC}"
    fi
    sleep $INTERVAL
    # Continue monitoring for a bit to confirm stability
    if [ $CHECK_COUNT -gt 6 ]; then
      echo ""
      echo -e "${GREEN}✅ Replica set is stable and fully synced!${NC}"
      echo -e "${GREEN}You can now use: ./monitorSystemHealth.sh${NC}"
      exit 0
    fi
  else
    LAST_STATUS="SYNCING"
    sleep $INTERVAL
  fi
done

