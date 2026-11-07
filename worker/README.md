# ☁️ Downloader Worker Service (v2)

High-performance, standalone `yt-dlp` download worker for the Highrise Musicbot ecosystem. Handles audio extraction, candidate searches (SoundCloud / YouTube), and disk caching.

## Features
- **Instant SSD Cache**: Caches downloaded audio files (`worker_cache/`) and immediately serves repeat queries with zero delay (`200 OK`, `audio/mp4`).
- **LRU Auto-Pruning**: Automatically trims old files when the cache exceeds capacity (`MAX_CACHE_MB=500`).
- **Client Disconnection Guard**: Detects when a caller cancels or disconnects (`req.on('close')`), prints `🛑 [Client: ${clientIp}] disconnected before stream could be delivered.`, and immediately terminates `yt-dlp` to save bandwidth and CPU.
- **Docker Ready**: Includes a production `Dockerfile` with Node.js 20, FFmpeg, and the latest `yt-dlp`.

## Endpoints
- `GET /stream?url=<target_url_or_scsearch>`: Streams the extracted audio.
- `GET /health` or `GET /ping`: Health check returning uptime and status.

## Environment Variables
- `PORT`: Port to listen on (default `30033`).
- `CACHE_DIR`: Cache directory path (default `./worker_cache`).
- `MAX_CACHE_MB`: Maximum cache size in MB (default `500`).
- `MAX_CACHE_TRACKS`: Maximum number of cached tracks (default `60`).

## Deployment

### Docker
```bash
docker build -t highrise-worker .
docker run -d -p 30033:30033 --name highrise-worker highrise-worker
```

### Bare Linux / VPS
```bash
chmod +x start.sh
./start.sh
```

### Windows
Run `start.bat` or:
```cmd
node server.js
```
