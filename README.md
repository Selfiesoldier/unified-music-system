# Unified Music System (Advanced Decoupled Architecture)

A unified repository containing all 6 micro-tier components of the Highrise Music Bot Ecosystem. Every service is completely isolated, preventing FFmpeg or CPU-heavy transcoding from blocking API responses or bot event loops.

---

## 📁 System Architecture & Directory Layout

```text
unified-music-system/
├── audio-server/         # Dedicated Audio Streamer (Node.js + FFmpeg 96kbps constant live stream)
├── main-server/          # Main Controller & Dashboard (Queue orchestration, TTS, REST API)
├── bot/                  # Highrise Python Bot (WebSocket client, chat commands, economy, votes)
├── worker/               # High-Performance Downloader Worker (yt-dlp, SoundCloud, JioSaavn fallback)
├── residential/          # Residential Audio Bridge (Termux / Home PC bridge, Cloudflare tunnel)
└── playlist-archiver/    # Telegram Music Vault & Archiver (YouTube search engine, fast MP3 transcoder)
```

---

## 🌐 Active Cloud Deployments (Pterodactyl / Orihost)

| Service | Pterodactyl ID | Node | Public / API Endpoint | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Main Controller** | `6a95145f` | DE-05 | `http://2.56.246.119:30195` | Web dashboard, queue logic, REST API |
| **Audio Streamer** | `00f50ae1` | DE-04 | `http://92.118.206.166:30238` | Constant 96kbps CBR live audio stream |
| **Highrise Bot** | `bf9ef46f` | DE-06 | WebSocket | Highrise room chat & command processor |
| **Download Worker**| `e42d70e7` | DE-09 | `http://92.118.206.201:30229` | Fast cloud-based audio download worker |
| **Laptop Archiver** | Local | Laptop | `http://localhost:4500` | Ingests playlists & archives to Telegram vault |

---

## 📦 Module Summaries

### 1. `audio-server/`
* **Port**: `8000` (Local) / `30238` (Cloud)
* **Stream URL**: `/stream` (constant 96kbps MP3 stream, zero disconnection silence loop)
* **Endpoints**: `/play`, `/stop`, `/announce`, `/status`
* **Features**: Frame-paced audio streamer, instant crossfades, natural speech TTS announcements.

### 2. `main-server/`
* **Port**: `3000` (Local) / `30195` (Cloud)
* **Endpoints**: `/play`, `/next`, `/queue`, `/current`, `/insert`, `/clear`
* **Features**:
  * Strict user-request precedence: real user requests purge lingering autoplay filler.
  * Autoplay guard: rejects autoplay requests if a song is playing, preparing, or queued.
  * Real-time Server-Sent Events (SSE) broadcasting to web dashboard.

### 3. `bot/`
* **Runtime**: Python 3.10+
* **Core Files**: `main.py`, `systems/music/music_commands.py`, `systems/music/music_manager.py`
* **Features**:
  * Free & economy-based song requests (`/play`, `/dedicate`, `/insert`).
  * Admin instant skip & community vote skips (`/skip`, `/s`).
  * Autoplay fallback when the queue is 100% idle.

### 4. `worker/`
* **Port**: `30033` (Local) / `30229` (Cloud)
* **Features**: High-speed audio extraction via `yt-dlp` and JioSaavn fallback to bypass IP blocks.

### 5. `residential/`
* **Port**: `8888`
* **Features**: Residential bridge script designed for home PC or Android Termux to bypass datacenter YouTube IP blocks. Includes auto-registration via Cloudflare Tunnels (`manager.js`).

### 6. `playlist-archiver/`
* **Port**: `4500`
* **Features**:
  * Full YouTube search engine (`yt-search`) to resolve accurate video titles, channel artists, and durations.
  * Fast audio download via `--no-config` `yt-dlp`.
  * Uploads tracks directly to Telegram Music Vault channel with persistent indexing in `vault_db.json`.

---

## 🚀 Quick Start (Local Development)

### Audio Server:
```bash
cd audio-server
npm install
node server.js
```

### Main Controller:
```bash
cd main-server
npm install
node server.js
```

### Highrise Bot:
```bash
cd bot
pip install -r requirements.txt
python main.py
```

### Playlist Archiver:
```bash
cd playlist-archiver
npm install
node server.js
```

