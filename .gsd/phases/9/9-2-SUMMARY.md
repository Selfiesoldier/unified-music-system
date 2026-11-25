---
phase: 9
plan: 2
completed_at: 2026-11-25T17:23:45+05:30
duration_minutes: 9
---

# Summary: Plan 9.2 — Playback, Queue, TTS & SSE Bug Fixes

## Results
- 2/2 tasks completed and committed atomically
- Syntax check (`node --check`) and targeted functional verification scripts passed against the modified `main-server/server.js`

## Tasks Completed
| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Fix DELETE /api/queue/:index crash, SSE broadcast error handling, and playNext lock recursion | `2e21006` | ✅ |
| 2 | Fix TTS voice cache key, stdin EPIPE, cache copy race, and SoundCloud fallback | `8a885f8` | ✅ |

## Deviations Applied
- **[Rule 1 - Bug] Generation-guarded `playNext()` lock & `/play` / `/insert` / `/stop` lock safety:** Holding `isPlayNextLocked` across `await startStream(...)` meant an aborted `startStream()` unwinding after `POST /next` or `POST /stop` could reset `isPlayNextLocked = false` while a newer `playNext()` was running. Added `playNextGeneration` token checked in `finally`, bumped in `POST /next` and `POST /stop`, and guarded `POST /play` and `POST /insert` with `|| isPlayNextLocked`.
- **[Rule 2 - Missing Critical] SSE stream lifecycle guards:** In addition to `try/catch` around `write()` in `/events` heartbeat and `broadcastEventJSON()`, added `destroyed`/`writableEnded` checks and `res.on("close")` / `res.on("error")` cleanup in `/events` and `broadcastEvent()`.
- **[Rule 1 - Bug] Guarded `downloadTrackToFile()` SoundCloud fallback against unresolved titles:** Marked YouTube URLs whose `yts({ videoId })` lookup failed in `POST /play` with `skipSoundCloudFallback: true` (omitting literal `"Unknown Track"`), and skipped SoundCloud search in `downloadTrackToFile()` when no valid title exists or `title` equals `"Unknown Track"` (still allowing residential bridge playback by URL).

## Files Changed
- `main-server/server.js` — Fixed `DELETE /api/queue/:index`, SSE `/events` heartbeat / `broadcastEvent` / `broadcastEventJSON`, `playNext()` lock & loop handling, `ttsDecoder.stdin` `EPIPE` listener, `ttsHash` voice keying, `downloadTrackToFile()` 3-arg `executeYtdlpDownload` / `cleanTitle` raw-title fallback / awaited `saveSongToPersistentCache`, and `POST /play` `yts({ videoId })` failure handling.
- `.gsd/phases/9/9-2-SUMMARY.md` — Execution summary for Plan 9.2.

## Verification
- `node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\server.js"`: ✅ Passed (exit 0)
- `verify_task1.mjs` (Node VM harness executing extracted `DELETE /api/queue/:index`, `/events` + `broadcastEvent` + `broadcastEventJSON`, and `playNext()` from `main-server/server.js` with mocked Express/stream/timer stubs; `main-server/node_modules` not present in workspace): ✅ 5/5 checks passed (`DELETE /api/queue/:index` 200/400 & metadata guard, SSE dead/throwing client pruning across `/events`/heartbeat/`broadcastEvent`/`broadcastEventJSON`, `softStopPlayback` queue resumption without recursion, concurrent `playNext()` serialization, generation token lock isolation)
- `verify_task2.mjs` (Node VM harness executing extracted `ttsHash`, `injectTTSToStream`, `downloadTrackToFile`, and `POST /play` from `main-server/server.js` with mocked `spawn`/yt-dlp/fetch/`yts` stubs): ✅ 6/6 checks passed (`ttsHash` varies by `announcementVoice`, `ttsDecoder.stdin` `error` listener attached before `write` and survives `EPIPE`, 3-arg `executeYtdlpDownload` calls, raw title fallback when `cleanTitle` strips all words, awaited `saveSongToPersistentCache` on bridge + SoundCloud primary + SoundCloud retry paths before temp file `unlink`, and `POST /play` `yts({ videoId })` failure avoiding `scsearch1:Unknown Track`)
