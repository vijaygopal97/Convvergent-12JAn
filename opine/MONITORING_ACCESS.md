# 📊 Real-Time NGINX Monitoring - Access Guide

## ✅ Implementation Status

**NGINX Access Log Monitoring:** ✅ Active (Zero Overhead)
**Backend Servers:** ✅ Restarted (Both Primary & Secondary)

## 🎯 How to Monitor (3 Options)

### Option 1: Terminal Real-Time Monitoring (Easiest - Works Now!)

**View live requests:**
```bash
sudo tail -f /var/log/nginx/access.log
```

**Formatted view (IP → Path → Status):**
```bash
sudo tail -f /var/log/nginx/access.log | awk '{print $1, "→", $7, "("$9")"}'
```

**Requests per second (live counter):**
```bash
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

**Detailed terminal view:**
```bash
sudo tail -f /var/log/nginx/access.log | while read line; do
  ip=$(echo $line | awk '{print $1}')
  method=$(echo $line | awk '{print $6}' | tr -d '"')
  path=$(echo $line | awk '{print $7}')
  status=$(echo $line | awk '{print $9}')
  size=$(echo $line | awk '{print $10}')
  echo "[$(date +%H:%M:%S)] $ip $method $path → $status ($size bytes)"
done
```

### Option 2: GoAccess HTML Dashboard

**Status:** GoAccess is running (port 7890)
**Dashboard File:** `/var/www/opine/monitoring/realtime.html`

**To start GoAccess manually:**
```bash
cd /var/www/opine
sudo goaccess /var/log/nginx/access.log \
  --log-format=COMBINED \
  --real-time-html \
  --port=7890 \
  --output=/var/www/opine/monitoring/realtime.html \
  --addr=127.0.0.1 \
  --daemonize
```

**To check if running:**
```bash
ps aux | grep goaccess
```

**To stop:**
```bash
sudo killall goaccess
```

**To view the HTML file:**
- Copy `/var/www/opine/monitoring/realtime.html` to your local machine
- Open in browser
- Or configure NGINX to serve this directory (requires NGINX config)

### Option 3: GoAccess Interactive Terminal

**Interactive dashboard:**
```bash
sudo goaccess /var/log/nginx/access.log --log-format=COMBINED
```

**Press:**
- `q` to quit
- Arrow keys to navigate
- `F5` to refresh

## 📊 What You Can Monitor

From NGINX logs (`/var/log/nginx/access.log`):

1. **IP Address** - Where requests come from
2. **Request Path** - API endpoints hit
3. **HTTP Method** - GET, POST, PUT, DELETE
4. **Status Code** - 200, 404, 500, etc.
5. **Response Size** - Bytes transferred
6. **User-Agent** - Device/browser info
7. **Timestamp** - Exact request time
8. **Referer** - Source page

## 🎯 Performance Impact

**ZERO OVERHEAD** ✅
- NGINX already logs everything (no additional work)
- Monitoring only READS logs (doesn't modify)
- No impact on application performance
- No impact on response times

## 📝 Quick Commands Reference

```bash
# View last 100 requests
sudo tail -100 /var/log/nginx/access.log

# Count requests in last minute
sudo tail -n 1000 /var/log/nginx/access.log | grep "$(date +%d/%b/%Y:%H:%M)" | wc -l

# Top IPs
sudo tail -1000 /var/log/nginx/access.log | awk '{print $1}' | sort | uniq -c | sort -rn | head -10

# Top endpoints
sudo tail -1000 /var/log/nginx/access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head -10

# Error requests (4xx, 5xx)
sudo tail -f /var/log/nginx/access.log | awk '$9 >= 400 {print $1, $7, $9}'

# Requests per second (approximate)
watch -n 1 'sudo tail -100 /var/log/nginx/access.log | wc -l'
```

## 🔧 Troubleshooting

**If logs are not updating:**
```bash
sudo ls -lh /var/log/nginx/access.log
sudo tail -5 /var/log/nginx/access.log
```

**If GoAccess is not working:**
```bash
sudo killall goaccess
sudo goaccess /var/log/nginx/access.log --log-format=COMBINED --real-time-html --port=7890 --output=/var/www/opine/monitoring/realtime.html --daemonize
```

**Check NGINX is logging:**
```bash
sudo tail -f /var/log/nginx/access.log
# Make a request to your site, should see new log entries
```

