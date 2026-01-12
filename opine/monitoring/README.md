# GoAccess Real-time Analytics Dashboard

## Access URL
https://convo.convergentview.com/monitoring/

## Starting GoAccess
Run as root:
```bash
sudo goaccess /var/log/nginx/access.log \
    --log-format=COMBINED \
    --real-time-html \
    --output=/var/www/opine/monitoring/index.html \
    --ws-url=wss://convo.convergentview.com/monitoring/ \
    --addr=127.0.0.1 \
    --port=7890 \
    --keep-db-files
```

## Features
- Real-time request monitoring
- Requests per second
- Top IPs, paths, status codes
- Device/browser breakdown
- Geographic data
- Zero overhead (reads NGINX logs only)

## Notes
- Must run as root to read /var/log/nginx/access.log
- WebSocket server runs on 127.0.0.1:7890
- NGINX proxies WebSocket connections for real-time updates
