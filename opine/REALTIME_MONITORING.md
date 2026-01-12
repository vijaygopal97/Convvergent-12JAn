# 📊 Real-Time NGINX Request Monitoring Guide

## ✅ WORKING SOLUTION: Terminal Real-Time Monitoring

The GoAccess HTML dashboard shows historical data only (requires WebSocket setup for real-time updates).  
**Use terminal monitoring for REAL-TIME data** (works immediately, zero delay).

## 🎯 Real-Time Monitoring Commands

### Option 1: Simple Formatted View (Recommended)
```bash
sudo tail -f /var/log/nginx/access.log | awk '{print $1, "→", $7, "("$9")"}'
```

**Shows:** `IP → Path (Status)`  
**Updates:** Real-time (zero delay)

### Option 2: Detailed View with Timestamp
```bash
sudo tail -f /var/log/nginx/access.log | while read line; do
  ip=$(echo $line | awk '{print $1}');
  method=$(echo $line | awk '{print $6}' | tr -d '"');
  path=$(echo $line | awk '{print $7}');
  status=$(echo $line | awk '{print $9}');
  size=$(echo $line | awk '{print $10}');
  echo "[$(date +%H:%M:%S)] $ip $method $path → $status ($size bytes)";
done
```

### Option 3: Requests Per Second Counter
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

**Shows:** Approximate requests per second

### Option 4: Error Monitoring Only
```bash
sudo tail -f /var/log/nginx/access.log | awk '$9 >= 400 {print $1, "→", $7, "("$9")"}'
```

**Shows:** Only 4xx and 5xx errors (real-time)

### Option 5: Top IPs (Last 1000 Requests)
```bash
sudo tail -1000 /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -10
```

### Option 6: Top Endpoints (Last 1000 Requests)
```bash
sudo tail -1000 /var/log/nginx/access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head -10
```

## 📊 Quick Stats Commands

**Count requests in last minute:**
```bash
sudo tail -n 1000 /var/log/nginx/access.log | grep "$(date +%d/%b/%Y:%H:%M)" | wc -l
```

**View last 100 requests:**
```bash
sudo tail -100 /var/log/nginx/access.log | awk '{print $1, "→", $7, "("$9")"}'
```

**View last 100 requests (formatted):**
```bash
sudo tail -100 /var/log/nginx/access.log | awk '{printf "%-15s %-6s %-50s %s\n", $1, $9, $7, $4}'
```

## 🎯 Why Terminal Monitoring is Better

1. ✅ **REAL-TIME** - Shows requests as they happen (zero delay)
2. ✅ **ZERO OVERHEAD** - Only reads logs (no processing)
3. ✅ **NO CONFIGURATION** - Works immediately
4. ✅ **COMPLETE DATA** - All requests visible
5. ✅ **CUSTOMIZABLE** - Easy to filter/format

## ⚠️ About GoAccess HTML Dashboard

- Shows **historical data** only (up to when file was generated)
- Real-time updates require **WebSocket configuration** in NGINX
- Static HTML file doesn't auto-refresh
- Use terminal monitoring for **real-time** data

## 📝 Example Output

```
103.186.41.42 → /api/survey-responses/start/68fd1915d41841da463f0d46 (200)
13.202.181.167 → /api/survey-responses/next-review?surveyId=68fd1915d41841da463f0d46&interviewMode=capi (200)
103.186.41.42 → /api/auth/me (304)
13.202.181.167 → /api/survey-responses/verify (200)
```

## 🔧 Tips

- **Press Ctrl+C** to stop monitoring
- Use **grep** to filter specific endpoints: `... | grep "/api/cati"`
- Use **awk** to filter by status code: `... | awk '$9==200'`
- Save to file: `sudo tail -f /var/log/nginx/access.log > monitoring.log`

