# Plan 10.1 Execution Summary — Audio Server Bug Fixes & Memory/Timeout Guards

**Date:** 2026-11-25
**Files changed:** `audio-server/server.js`, `audio-server/src/audioPlayer.js`

## Tasks Completed
1. **`POST /announce` (`/api/announce`, `/api/tts/speak`, `/api/speech`)**: Replaced broken `streamManager.playAnnouncement(...)` with `streamManager.startNewAnnouncementSession()` + `streamManager.streamAnnouncementMp3(mp3Buffer, sessionId)`, added a `5 MB` payload cap (`413`), and added `AbortSignal.timeout(10000)` on remote fetches.
2. **`POST /flush`**: Replaced manual buffer array reset with `streamManager.clearBurstBuffer()` so `audioBufferHead` is also reset to `0`.
3. **`proxyToController` & `/api/load-test/add`**: Added `AbortSignal.timeout(10000)` on controller proxy fetches and clamped `/api/load-test/add` `count` to `1–200` (returning `400` on invalid values).
4. **`AudioPlayer.play()` & `triggerWebhook()`**: Added `50 MB` max track size guard (`Content-Length`, `arrayBuffer`, and `fs.promises.stat` before `readFile`) and `new URL()` HTTP(S) validation on `webhookUrl`.
