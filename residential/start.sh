#!/usr/bin/env bash
echo "========================================================"
echo "  Highrise Musicbot - Residential Audio Bridge (v2)"
echo "  (Termux Android / Linux / Raspberry Pi)"
echo "========================================================"

# 1. Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed."
    if command -v pkg &> /dev/null; then
        echo "Installing Node.js on Termux..."
        pkg install -y nodejs
    else
        echo "Please install Node.js 18+."
        exit 1
    fi
fi

# 2. Check yt-dlp
if ! command -v yt-dlp &> /dev/null && [ ! -f "./yt-dlp" ]; then
    echo "⚠️ yt-dlp not found in PATH. Downloading latest release..."
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
    chmod +x yt-dlp
fi

# 3. Termux specific DNS & cloudflared checks
if command -v pkg &> /dev/null; then
    if [ -n "$PREFIX" ]; then
        mkdir -p "$PREFIX/etc"
        echo "nameserver 1.1.1.1" > "$PREFIX/etc/resolv.conf"
        echo "nameserver 8.8.8.8" >> "$PREFIX/etc/resolv.conf"
    fi
    if ! command -v cloudflared &> /dev/null; then
        echo "📦 Installing native Termux cloudflared..."
        pkg install -y cloudflared
    fi
fi

echo "🚀 Starting residential audio bridge on port 8888..."
node server.js
