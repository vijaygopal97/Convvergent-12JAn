# 📊 Real-Time NGINX Access Log Monitoring Guide

## ✅ Implementation Complete

NGINX access log analysis has been set up with **ZERO OVERHEAD** - it only reads existing logs.

## 🎯 How to Monitor

### Option 1: GoAccess Real-Time HTML Dashboard (Recommended)

**Status:** Running in background
**Port:** 7890 (WebSocket for real-time updates)
**Output File:** `/var/www/opine/monitoring/realtime.html`

**To Access:**
1. The HTML file is generated at `/var/www/opine/monitoring/realtime.html`
2. You can open it directly or serve it via NGINX
3. WebSocket connection: `wss://convo.convergentview.com/monitoring/ws`

**Features:**
- ✅ Real-time requests/second visualization
- ✅ Top IPs, paths, status codes
- ✅ Device/browser breakdown (from User-Agent)
- ✅ Geographic data
- ✅ Response time statistics

### Option 2: Terminal Real-Time Monitoring

**View live requests:**
```bash
tail -f /var/log/nginx/access.log
```

**Requests per second:**
```bash
watch -n 1 'tail -100 /var/log/nginx/access.log | wc -l'
```

**Formatted view (IP, Path, Status):**
```bash
tail -f /var/log/nginx/access.log | awk '{print $1, $7, $9}'
```

**Custom parsing script:**
```bash
tail -f /var/log/nginx/access.log | while read line; do
  ip=$(echo $line | awk '{print $1}')
  path=$(echo $line | awk '{print $7}')
  status=$(echo $line | awk '{print $9}')
  echo "[$(date +%H:%M:%S)] $ip → $path ($status)"
done
```

### Option 3: GoAccess Terminal Interface

**Interactive terminal dashboard:**
```bash
sudo goaccess /var/log/nginx/access.log --log-format=COMBINED
```

## 🔄 Managing GoAccess

**Start GoAccess:**
```bash
sudo goaccess /var/log/nginx/access.log \
  --log-format=COMBINED \
  --real-time-html \
  --port=7890 \
  --output=/var/www/opine/monitoring/realtime.html \
  --ws-url=wss://convo.convergentview.com/monitoring/ws \
  > /tmp/goaccess.log 2>&1 &
```

**Stop GoAccess:**
```bash
sudo killall goaccess
```

**Check Status:**
```bash
ps aux | grep goaccess
```

**View Logs:**
```bash
tail -f /tmp/goaccess.log
```

## 📊 What Data is Available

From NGINX access logs, you can extract:

1. **IP Address** - Origin of requests
2. **Request Path/Endpoint** - Which API endpoints are hit
3. **HTTP Method** - GET, POST, PUT, DELETE
4. **Status Code** - 200, 404, 500, etc.
5. **Response Size** - Bytes transferred
6. **User-Agent** - Device, browser, OS information
7. **Referer** - Where traffic comes from
8. **Timestamp** - Exact request time

## 🎯 Performance Impact

**ZERO OVERHEAD** ✅
- NGINX already logs all requests (no additional work)
- GoAccess only **reads** logs (doesn't modify them)
- No impact on application performance
- No impact on response times

## 📝 Notes

- Log file location: `/var/log/nginx/access.log`
- Log format: Combined (standard NGINX format)
- Real-time updates: Yes (via WebSocket)
- Historical data: All requests since logs started

## 🔧 Troubleshooting

**If GoAccess is not running:**
```bash
sudo goaccess /var/log/nginx/access.log --log-format=COMBINED --real-time-html --port=7890 --output=/var/www/opine/monitoring/realtime.html &
```

**Check if port 7890 is in use:**
```bash
sudo netstat -tulpn | grep 7890
```

**View GoAccess errors:**
```bash
tail -f /tmp/goaccess.log
```

