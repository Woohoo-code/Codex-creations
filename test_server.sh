#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-8000}"
python3 -m http.server "${PORT}" --bind 127.0.0.1 >/tmp/video_analyzer_test.log 2>&1 &
SERVER_PID=$!
trap 'kill ${SERVER_PID} 2>/dev/null || true' EXIT

sleep 1
STATUS_LINE="$(curl -sI "http://127.0.0.1:${PORT}" | head -n 1)"

echo "${STATUS_LINE}"
if [[ "${STATUS_LINE}" == *"200"* ]]; then
  echo "PASS: server responded successfully on 127.0.0.1:${PORT}"
else
  echo "FAIL: unexpected response: ${STATUS_LINE}"
  exit 1
fi
