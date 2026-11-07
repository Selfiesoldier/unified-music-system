# 📻 Standalone Audio Server for Highrise

A dedicated, ultra-stable audio transcoding and broadcasting server. It acts as an isolated "radio tower" for Highrise room listeners, completely decoupled from web dashboards, databases, and bot commands.

---

## 🎯 Why This Exists

1. **Zero Stream Interruptions**: The public `/stream` endpoint runs a persistent FFmpeg MP3 encoder with a seamless transition/silence loop. Your listeners in Highrise will **never disconnect**, even when switching tracks or when the main bot restarts.
2. **Dedicated CPU & Bandwidth**: FFmpeg audio transcoding has dedicated resources without competing with web requests or bot tasks.
3. **Deploy Anywhere**: Can run on a cheap $3–$5 VPS (Hetzner, Contabo, etc.) or a separate port on your current machine.

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd audio-server
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Default settings:
* `PORT=8000`
* `AUDIO_SECRET=supersecret_audio_key_123`
* `AUDIO_BITRATE=128k`

### 3. Start the Server
```bash
npm start
```
Or for auto-restart on changes:
```bash
npm run dev
```

---

## 📡 API Reference

### 1. Public Audio Stream
* **URL**: `GET /stream` (or `/STREAM`)
* **Purpose**: This is the URL you put into Highrise or any media player (VLC, web browser).
* **Behavior**: Always live (plays silence/transition when idle, switches seamlessly to real audio when a track is fed).

---

### 2. Play a Track
* **URL**: `POST /api/play`
* **Headers**: `Authorization: Bearer <AUDIO_SECRET>`
* **Body** (JSON):
```json
{
  "source": "https://example.com/audio.mp3",
  "title": "Song Title - Artist",
  "durationSeconds": 210,
  "volume": 100,
  "webhookUrl": "http://main-server:3000/api/audio-finished"
}
```
* Note: `source` can be an HTTP/HTTPS stream link or a local absolute path to an audio file on disk.

---

### 3. Stop Playback
* **URL**: `POST /api/stop`
* **Headers**: `Authorization: Bearer <AUDIO_SECRET>`
* **Behavior**: Instantly terminates active track decoder and seamlessly returns to transition music/silence loop.

---

### 4. Adjust Volume
* **URL**: `POST /api/volume`
* **Headers**: `Authorization: Bearer <AUDIO_SECRET>`
* **Body** (JSON):
```json
{
  "volume": 85
}
```

---

### 5. Check Health & Listener Stats
* **URL**: `GET /api/status`
* **Response**:
```json
{
  "player": {
    "isPlaying": true,
    "volume": 100,
    "currentTrack": {
      "title": "Song Title",
      "durationSeconds": 210,
      "elapsedSeconds": 45
    }
  },
  "stream": {
    "activeListeners": 14,
    "peakListeners": 25,
    "totalConnections": 88,
    "totalMegabytes": "45.20",
    "uptimeSeconds": 3600
  }
}
```

---

## 🔗 Connecting From Your Main Server

In your main `server.js` or Python queue manager, replace internal FFmpeg feeds with a simple HTTP request to this audio server:

```javascript
// Example in Node.js
async function playOnAudioServer(audioUrl, trackTitle) {
  const response = await fetch('http://localhost:8000/api/play', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer supersecret_audio_key_123'
    },
    body: JSON.stringify({
      source: audioUrl,
      title: trackTitle,
      volume: 100,
      webhookUrl: 'http://localhost:3000/api/audio-finished'
    })
  });
  return response.json();
}
```
