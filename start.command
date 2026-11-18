#!/bin/bash
cd "$(dirname "$0")" || exit 1

PORT=8000
while lsof -i :"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SERVER_PID=$!

trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
sleep 1
open "http://127.0.0.1:$PORT/"

echo "托福学术阅读练习站已启动：http://127.0.0.1:$PORT/"
echo "按 Control + C 可停止本地服务。"
wait "$SERVER_PID"
