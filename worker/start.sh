#!/usr/bin/env bash
echo "========================================================"
echo "  Highrise Musicbot - Download Worker Service (v2)"
echo "========================================================"

# Check node
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+."
    exit 1
fi

# Check yt-dlp
if ! command -v yt-dlp &> /dev/null && [ ! -f "./yt-dlp" ]; then
    echo "⚠️ yt-dlp not found in PATH. Downloading latest release..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
    chmod +x yt-dlp
fi

export PORT="${PORT:-30033}"
echo "🚀 Starting worker service on port ${PORT}..."
node server.js
