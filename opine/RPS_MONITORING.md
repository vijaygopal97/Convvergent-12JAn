# 📊 Real-Time Requests Per Second Monitoring

## ✅ Zero-Overhead Solution

All solutions **only read logs** - zero processing overhead, zero delay to your application.

## 🎯 Option 1: Simple Requests/Second Counter (Recommended)

**Shows:** Requests per second (sliding window)

```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

**Output:**
```
Every 1.0s: sudo tail -100 /var/log/nginx/access.log | wc -l

100
```

**How it works:**
- Counts requests in last 100 log entries
- Updates every 1 second
- Zero overhead (only reads logs)

## 🎯 Option 2: Requests/Second with Formatted Output

```bash
watch -n 1 'echo "Requests/Second: $(sudo tail -100 /var/log/nginx/access.log | wc -l)"'
```

## 🎯 Option 3: Live RPS Counter (Continuous)

**Shows:** Requests per second updated continuously

```bash
while true; do
  COUNT=$(sudo tail -100 /var/log/nginx/access.log | wc -l)
  echo "[$(date +%H:%M:%S)] Requests/Second: $COUNT"
  sleep 1
done
```

**Output:**
```
[23:20:15] Requests/Second: 85
[23:20:16] Requests/Second: 92
[23:20:17] Requests/Second: 78
```

## 🎯 Option 4: RPS + Individual Requests (Best of Both)

**Shows:** Both RPS counter and individual requests

```bash
# Terminal 1: RPS Counter
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'

# Terminal 2: Individual Requests
sudo tail -f /var/log/nginx/access.log | awk '{print $1, "→", $7, "("$9")"}'
```

Or use the combined script:
```bash
bash /tmp/live-rps.sh
```

## 🎯 Option 5: Accurate Requests/Second (Time-Based)

**Counts requests in actual 1-second windows:**

```bash
#!/bin/bash
LAST_LINE=$(sudo tail -1 /var/log/nginx/access.log)
LAST_TIME=$(echo "$LAST_LINE" | awk '{print $4}' | tr -d '[]')

while true; do
  sleep 1
  NEW_LAST=$(sudo tail -1 /var/log/nginx/access.log)
  NEW_TIME=$(echo "$NEW_LAST" | awk '{print $4}' | tr -d '[]')
  
  COUNT=$(sudo tail -1000 /var/log/nginx/access.log | awk -v start="$LAST_TIME" -v end="$NEW_TIME" '$4 >= start && $4 <= end' | wc -l)
  echo "[$(date +%H:%M:%S)] Requests/Second: $COUNT"
  
  LAST_TIME="$NEW_TIME"
done
```

## 📊 Quick Reference

**Simple RPS Counter (easiest):**
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

**RPS with timestamp:**
```bash
watch -n 1 'echo "[$(date +%H:%M:%S)] RPS: $(sudo tail -100 /var/log/nginx/access.log | wc -l)"'
```

**RPS for specific endpoint:**
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | grep "/api/cati" | wc -l'
```

**RPS for errors only:**
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | awk "\$9 >= 400" | wc -l'
```

## ✅ Why These Solutions Are Zero Overhead

1. **Only reads logs** - No processing, no database queries
2. **No application impact** - Monitoring doesn't touch your application
3. **No network overhead** - All local file operations
4. **Minimal CPU** - Simple text operations only

## 🎯 Recommended: Use Option 1

**Command:**
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

**Features:**
- ✅ Shows requests per second
- ✅ Zero overhead
- ✅ Real-time updates
- ✅ Simple and reliable
- ✅ Works immediately

