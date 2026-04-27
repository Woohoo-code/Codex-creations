#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8000}"
HOST="0.0.0.0"

LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "${LOCAL_IP}" ]]; then
  LOCAL_IP="<your-local-ip>"
fi

echo "Starting Video Analyzer on ${HOST}:${PORT}"
echo "Open locally:      http://127.0.0.1:${PORT}"
echo "Open on your LAN:  http://${LOCAL_IP}:${PORT}"
echo

python3 -m http.server "${PORT}" --bind "${HOST}"
