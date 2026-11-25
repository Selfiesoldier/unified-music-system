---
phase: 10
plan: 1
wave: 1
gap_closure: false
---

# Plan 10.1: Audio Server Bug Fixes & Memory/Timeout Guards

## Objective
Fix the broken `/announce` route, `/flush` ring-buffer pointer bug, missing controller/fetch timeouts, and unbounded memory/load-test allocations in `audio-server/` locally without breaking pure 96kbps CBR MP3 byte-streaming.

## Context
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\.gsd\SPEC.md`
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\server.js`
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\src\audioPlayer.js`
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\src\persistentStreamManager.js`

## Tasks

<task type="auto">
  <name>Fix POST /announce, POST /flush, proxy timeout, and load-test cap in audio-server/server.js</name>
  <files>
    audio-server/server.js
  </files>
  <action>
    1. In `POST ['/announce', '/api/announce', '/api/tts/speak', '/api/speech']` (`server.js:454-495`):
       - Replace the nonexistent `streamManager.playAnnouncement(audioStream, mimeType)` call with `streamManager.startNewAnnouncementSession()` + `streamManager.streamAnnouncementMp3(mp3Buffer, sessionId)`.
       - Collect incoming stream chunks into `mp3Buffer` with a `5 * 1024 * 1024` (5 MB) size cap, returning `413` if exceeded.
       - Add `signal: AbortSignal.timeout(10000)` to `fetch(audioInput)`.
    2. In `POST ['/flush', '/api/flush']` (`server.js:504-513`):
       - Replace manual `streamManager.audioBuffer = []; streamManager.audioBufferBytes = 0;` with `streamManager.clearBurstBuffer()` so `audioBufferHead` is also reset to `0`.
    3. In `proxyToController(req, res)` (`server.js:519-558`):
       - Add `signal: AbortSignal.timeout(10000)` to `fetch(targetUrl, fetchOptions)` so a hung controller never stalls the audio server.
    4. In `POST /api/load-test/add` (`server.js:612-621`):
       - Clamp `count` to an integer between `1` and `200`, returning `400` if `NaN` or `<= 0`.
  </action>
  <verify>
    node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\server.js"
    # Verify streamAnnouncementMp3 and clearBurstBuffer are called, and playAnnouncement no longer exists
  </verify>
  <done>
    `/announce` calls `streamAnnouncementMp3` with a 5 MB cap and 10s fetch timeout, `/flush` uses `clearBurstBuffer()`, `proxyToController` has a 10s timeout, and `/api/load-test/add` caps simulated listeners at 200.
  </done>
</task>

<task type="auto">
  <name>Add 50 MB payload guard and webhook URL validation in audio-server/src/audioPlayer.js</name>
  <files>
    audio-server/src/audioPlayer.js
  </files>
  <action>
    1. In `AudioPlayer.play()` (`audioPlayer.js:93-100`):
       - Define `MAX_TRACK_BYTES = 50 * 1024 * 1024` (50 MB — covers >70 min of 96kbps CBR MP3).
       - Check `Content-Length` header if present and abort immediately if `> MAX_TRACK_BYTES`.
       - Also check `rawMp3Buffer.length > MAX_TRACK_BYTES` (and local `fs.promises.stat(source)` before `readFile`) so oversized files cannot OOM the container.
    2. In `AudioPlayer.triggerWebhook(url, data)` (`audioPlayer.js:277-288`):
       - Validate `url` with `new URL(url)` allowing only `http:` and `https:` protocols before calling `fetch()`.
  </action>
  <verify>
    node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\src\audioPlayer.js"
  </verify>
  <done>
    `audioPlayer.js` passes `node --check`, rejects >50 MB audio payloads before buffering, and validates webhook URLs.
  </done>
</task>

## Success Criteria
- [ ] `POST /announce` uses `streamAnnouncementMp3` with 5 MB cap and 10s timeout
- [ ] `POST /flush` resets `audioBufferHead` via `clearBurstBuffer()`
- [ ] `proxyToController` has a 10s timeout and `/api/load-test/add` is bounded
- [ ] `AudioPlayer.play()` enforces a 50 MB max track guard and validates `webhookUrl`
