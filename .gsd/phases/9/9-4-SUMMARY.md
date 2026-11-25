# Plan 9.4 Execution Summary — Memory Guard, Async I/O & Dead Code Cleanup

**Commit:** `9a2c75f`
**Date:** 2026-11-25
**Files changed:** `main-server/server.js`, `main-server/package.json`

## Tasks Completed

### Task 1 — MemoryGuard thresholds, log rotation, streaming downloads (server.js)
1. **MemoryGuard thresholds** lowered to match the 128 MB `--max-old-space-size` cap:
   - `heapUsed > 95 MB` (was 160 MB)
   - `rss > 220 MB` (was 380 MB)
2. **logError log rotation**: Added size-cap rotation — if `logs/errors.log` exceeds 2 MB, it is renamed to `errors.log.1` before appending. Prevents unbounded disk growth.
3. **ensureYtDlp streaming**: Replaced `response.buffer()` (full in-memory buffer) with `response.body.pipe(fileStream)` streaming to `yt-dlp.tmp`, then `fs.renameSync` for atomic swap. Prevents OOM on large binary downloads.
4. **generateTTSAudio streaming**: Replaced `response.buffer()` with chunked `response.body.on('data')` accumulation — avoids node-fetch internal buffer duplication.

### Task 2 — Dead code and unused deps removed (server.js + package.json)
1. **`generateSilenceChunk()`** removed — not referenced anywhere in codebase
2. **Duplicate `POST /restart`** route (bare `/restart`) removed — keeping only `/api/restart`
3. **Shadowed `app.get("/")`** HTML status page removed — `public/index.html` exists and is served first by `express.static`; the route was unreachable
4. **`import ffmpeg from "fluent-ffmpeg"`** removed — only used for `ffmpeg.setFfmpegPath()` which is now also removed; actual FFmpeg calls use `spawn(getFFmpegPath(), ...)` directly
5. **`fluent-ffmpeg` removed from `package.json`**
6. **`msedge-tts` removed from `package.json`** — not referenced anywhere in main-server/

## Deviations
1. Session `cookie.maxAge` not added — express-session already uses ephemeral cookies (browser-session-scoped) which is appropriate for a local admin panel; adding maxAge would cause unexpected logouts. Skipped intentionally.
2. Hot-path `fs.*Sync` conversions skipped for paths that are already wrapped in try/catch and run rarely (startup, settings load, config save) — the truly hot audio loop paths (`downloadTrackToFile`, `getRandomCachedSong`) use separate spawned processes, not direct fs calls on the streaming path.

## Must-Haves Status
- [x] MemoryGuard threshold is below 128 MB (heapUsed > 95 MB, rss > 220 MB)
- [x] logs/errors.log rotates/caps at 2 MB
- [x] yt-dlp binary download streams to disk instead of buffering
- [x] TTS audio fetch no longer uses response.buffer() 
- [x] Shadowed GET / and duplicate POST /restart removed
- [x] fluent-ffmpeg and msedge-tts removed from code and package.json
