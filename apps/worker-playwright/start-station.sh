#!/usr/bin/env bash
set -euo pipefail

if [[ "${TICKETLOG_STATION_MODE:-false}" != "true" ]]; then
  exec npm run start -w @ticketlog/worker-playwright
fi

if [[ -z "${TICKETLOG_OPERATOR_PASSWORD:-}" ]]; then
  echo "TICKETLOG_OPERATOR_PASSWORD is required when station mode is enabled" >&2
  exit 1
fi

if [[ ! "${TICKETLOG_OPERATOR_ACCESS_TOKEN:-}" =~ ^[A-Za-z0-9_-]{32,}$ ]]; then
  echo "TICKETLOG_OPERATOR_ACCESS_TOKEN must be a base64url or hex secret with at least 32 characters" >&2
  exit 1
fi

export DISPLAY="${DISPLAY:-:99}"
mkdir -p /data/ticketlog-session/profile

Xvfb "$DISPLAY" -screen 0 1440x900x24 -ac +extension GLX +render -noreset &
sleep 1

x11vnc -storepasswd "$TICKETLOG_OPERATOR_PASSWORD" /tmp/ticketlog-vnc.pass >/dev/null
x11vnc \
  -display "$DISPLAY" \
  -rfbauth /tmp/ticketlog-vnc.pass \
  -forever \
  -shared \
  -rfbport 5900 \
  -noxdamage \
  -quiet &

websockify \
  --web=/usr/share/novnc \
  6080 \
  localhost:5900 &

cat >/tmp/ticketlog-station-nginx.conf <<EOF
events {}
http {
  access_log off;
  server {
    listen ${PORT:-8080};

    location / {
      if (\$arg_access != "${TICKETLOG_OPERATOR_ACCESS_TOKEN}") { return 403; }
      proxy_pass http://127.0.0.1:6080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection "upgrade";
      proxy_read_timeout 3600s;
      proxy_send_timeout 3600s;
    }
  }
}
EOF

nginx -c /tmp/ticketlog-station-nginx.conf

exec npm run start -w @ticketlog/worker-playwright
