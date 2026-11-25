---
phase: 9
plan: 3
completed_at: 2026-11-25T17:32:46+05:30
duration_minutes: 8
---

# Summary: Plan 9.3 — Reliability, Lifecycle, Watchdog & UI Fixes

## Results
- 2/2 tasks completed and committed atomically
- `node --check` passed on `main-server/server.js`, `main-server/sw.js`, and `main-server/public/js/app.js`; JSON validation passed on `main-server/package.json`

## Tasks Completed
| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Add graceful shutdown, IPC/TTS timeouts, caps, and accurate /health in server.js | `bdc405f` | ✅ |
| 2 | Fix sw.js watchdog, package.json scripts, and public/js/app.js UI wiring | `cc7039f` | ✅ |

## Deviations Applied
- **[Rule 1 - Bug] Prevented `PersistentStreamManager` auto-restart on shutdown and fixed `encoderAlive` self-exit reporting:** Added `this.isShuttingDown` checks in `startPersistentEncoder()`, `restartEncoder()`, `persistentEncoder.on('error')`, and `persistentEncoder.on('close')`, and added `PersistentStreamManager.shutdown()` to clear timers, destroy streams, kill `persistentEncoder`, and close connected listeners. Also updated `getHealthStatus().encoderAlive` to require `this.persistentEncoder.exitCode === null && this.isEncoderRunning` so self-exited FFmpeg processes accurately report `false` (`GET /health` HTTP `503`).
- **[Rule 1 - Bug] Scoped `ttsDecoder` 15s timeout to the decode stage and escaped queue HTML:** Cleared `decodeTimeout` in `ttsDecoder` `close`/`error` handlers before `feedPCMAudioRealtime(fullPCM)` so long TTS audio is not truncated during real-time playback, tracked `activeTtsDecoder` for `gracefulShutdown`, and added `escapeHtml()` in `main-server/public/js/app.js` when rendering `.q-item` titles, artists, and thumbnails.

## Files Changed
- `main-server/server.js` — Added `gracefulShutdown` on `SIGINT`/`SIGTERM`, `flushState()`, `PersistentStreamManager.shutdown()`, `signal: AbortSignal.timeout(8000)` on all `/api/*` fetches to `http://127.0.0.1:5001/...`, timeouts on `ensureYtDlp` (60s fetch), `generateTTSAudio` (8s URL + 8s fetch), `ttsDecoder` (15s decode), `startStream` pre-buffer loop (15s), `armRenderKeepAlive` (`AbortSignal.timeout(10000)`), caps `MAX_QUEUE_LENGTH = 200`, `MAX_SSE_CLIENTS = 50`, `MAX_STREAM_CLIENTS = 100`, and HTTP `503` on `GET /health` when `encoderAlive === false`.
- `main-server/package.json` — Updated `watch` and `dev` scripts from `server-watchdog.js` to `sw.js`.
- `main-server/sw.js` — Spawned `node --max-old-space-size=128 --expose-gc server.js` directly without `shell: isWindows`, updated `killProcess` on Windows to use `taskkill /pid <pid> /f /t`, and updated `gracefulShutdown` on Windows to run `taskkill /pid ${pid} /f /t` (with a 500ms `SIGINT` grace window for `server.js` state flush).
- `main-server/public/js/app.js` — Wired `#free-music-toggle` change events to `POST /api/terminal` (`/freemusic 60` / `/stopfreemusic`), removed the duplicate `#queue-count` overwrite in `updateMusicDashboard()`, and added a remove button calling `removeFromQueue(${idx})` inside `.q-item`.
- `.gsd/phases/9/9-3-SUMMARY.md` — Execution summary for Plan 9.3.

## Verification
- `node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\server.js"`: ✅ Passed (exit 0)
- `node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\sw.js"`: ✅ Passed (exit 0)
- `node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\public\js\app.js"`: ✅ Passed (exit 0)
- `node -e "JSON.parse(require('fs').readFileSync('C:/Users/sanif/OneDrive/Desktop/unified-music-system/main-server/package.json', 'utf8'))"`: ✅ Passed (exit 0; `watch` and `dev` reference `sw.js`)
- `Select-String` verification across `main-server/server.js`: ✅ Confirmed `signal: AbortSignal.timeout(...)` on all 16 `127.0.0.1:5001` `fetch` call sites (`3000` on `/api/say`, `8000` on all `/api/*` IPC proxy endpoints).

## Deferred
- `main-server/node_modules` is not installed in this repository checkout, so live runtime HTTP/signal execution tests of `server.js` and `sw.js` were not run here.
- Pre-existing uncommitted working-tree changes in `main-server/public/index.html`, `main-server/public/css/style.css`, and other directories (`audio-server/`, `bot/`, `residential/`, `worker/`, etc.) were left untouched outside Plan 9.3 scope.
