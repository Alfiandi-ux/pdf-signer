#!/usr/bin/env bash
# Jalankan PDF Signer di browser lokal.
# Pemakaian:  bash start.sh [port]
set -u
cd "$(dirname "$0")" || exit 1
PORT="${1:-8000}"

echo "PDF Signer  →  http://localhost:${PORT}"
echo "Tekan Ctrl+C untuk berhenti."
echo

# Buka browser otomatis kalau tersedia (Termux:API)
if command -v termux-open-url >/dev/null 2>&1; then
  ( sleep 1; termux-open-url "http://localhost:${PORT}" >/dev/null 2>&1 ) &
fi

exec python3 -m http.server "$PORT" --bind 127.0.0.1
