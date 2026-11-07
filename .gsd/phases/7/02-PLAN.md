---
phase: 7
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - main-server/server.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "Central Controller fetchAndCache transcodes all incoming audio to strict 96kbps CBR 44.1kHz stereo MP3 before saving to song_<key>.mp3"
    - "Telegram Vault L2 downloads are validated/transcoded to 96k CBR MP3 before caching"
    - "Central Controller guarantees Audio Servers only receive verified 96k CBR MP3 files on /play"
  artifacts:
    - "main-server/server.js"
---

# Plan 7.2: Central Controller Download Normalization Pipeline

## Objective
Implement upstream normalization for all audio sources downloaded or ingested by the Central Controller (`main-server`). Whether audio originates from the Termux Residential Bridge (YouTube), Cloud Worker (JioSaavn), Telegram Cloud Vault (L2 CDN), or Direct Dashboard Upload, it must be automatically transcoded via FFmpeg into strict 96kbps CBR 44.1kHz stereo MP3 format (`song_<key>.mp3`) on the controller before passing the URL to `callAudioServer(room, '/play')`. Audio servers never transcode audio and strictly reject non-96k MP3 input.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- main-server/server.js
- main-server/src/audioNormalizer.js
- audio-server/src/audioPlayer.js

## Tasks

<task type="auto">
  <name>Upstream Audio Normalization in fetchAndCache and Telegram Vault Ingestion</name>
  <files>
    main-server/server.js
  </files>
  <action>
    Update audio ingestion pipelines in `main-server/server.js` so that all downloaded tracks are normalized via FFmpeg to 96kbps CBR 44.1kHz stereo MP3.
    
    Steps:
    1. In `fetchAndCache(serviceUrl, targetUrl, activeServiceName)`:
       - Stream the incoming audio from worker/bridge into a temporary file:
         `tempDlFile = path.join(CACHE_DIR, \`temp_dl_\${Date.now()}_\${Math.random().toString(36).slice(2, 6)}.raw\`)`.
       - After stream finishes and `tempDlFile` size is verified > 50000 bytes:
         Define target persistent file: `persistentFile = path.join(CACHE_DIR, \`song_\${cacheKey}.mp3\`)`.
       - Run `await normalizeTo96kMp3(tempDlFile, persistentFile)`.
       - Verify `persistentFile` exists, size > 50000 bytes, and passes `is96kCbrMp3Buffer(fs.readFileSync(persistentFile, { length: 4096 }))`.
       - Clean up `tempDlFile`.
       - Write companion metadata file `song_${cacheKey}.json` with `format: 'mp3'`, `bitrate: '96k'`, `source: activeServiceName`.
       - Trigger `pruneSongCache()`.
       - Dispatch background upload to Telegram Vault: `uploadToTelegramVaultBackground(persistentFile, cacheKey, track.title || rawTitle, artist, durationSeconds)`.
       - Return `persistentFile`.
    2. In `fetchAndSaveTelegramFile(directUrl, cacheKey, track)`:
       - Stream the Telegram file into `temp_${Date.now()}_tg.raw`.
       - If file is > 50000 bytes, transcode to `song_${cacheKey}.mp3` using `normalizeTo96kMp3(tempFile, persistentFile)`.
       - Clean up temp file, write metadata JSON with `format: 'mp3'`, `bitrate: '96k'`, and return `persistentFile`.
    3. In `/api/upload-mp3` (dashboard upload):
       - Replace the inline `execSync` call with `await normalizeTo96kMp3(tempFile, persistentFile)`.
       - Ensure `child_process` / `execSync` is cleanly handled via `audioNormalizer.js`.
    
    AVOID: Saving un-transcoded `.m4a` or `.webm` files directly into cache or serving them to Audio Servers.
    USE: Consistent 96k CBR MP3 transcoding for every downloaded track, ensuring 100% format uniformity across all sources.
  </action>
  <verify>
    node --check main-server/server.js
  </verify>
  <done>
    All download pipelines (`fetchAndCache`, `fetchAndSaveTelegramFile`, `/api/upload-mp3`) transcode input into verified `song_<key>.mp3` files.
  </done>
</task>

<task type="auto">
  <name>Strict 96k CBR Guard in downloadTrackToFile, playNext, and Cache Pruner</name>
  <files>
    main-server/server.js
  </files>
  <action>
    Enforce strict 96k MP3 verification before passing files to Audio Servers and update cache management.
    
    Steps:
    1. In `downloadTrackToFile(track)`:
       - Update Cache Hit Check:
         Check `mp3File = path.join(CACHE_DIR, \`song_\${cacheKey}.mp3\`)`.
         If `mp3File` exists and size > 50000 bytes:
         Verify header with `is96kCbrMp3Buffer`. If valid, return `mp3File`.
         If invalid or if legacy `m4aFile` is found:
         Transcode the legacy file to `mp3File` using `normalizeTo96kMp3` and remove obsolete legacy `.m4a`.
       - For Direct HTTP Audio Files (non-YouTube external links):
         Download the remote stream to a temp file and normalize to `song_${cacheKey}.mp3` rather than returning raw un-normalized URLs.
    2. In `playNext(room)`:
       - When `readyFile` is obtained:
         Confirm `readyFile` ends with `.mp3` and is verified 96k CBR MP3.
         Construct `audioFileUrl = \`\${CONTROLLER_URL}/api/audio-file/\${path.basename(readyFile)}\``.
         Ensure `callAudioServer(targetRoom, '/play', { url: audioFileUrl, ... })` only sends controller-served verified 96k CBR MP3 URLs.
    3. In `pruneSongCache()`:
       - Scan for legacy `.m4a` files in `CACHE_DIR` and remove them if a corresponding `.mp3` exists or if older than LRU window.
       - Enforce strict `CACHE_MAX_SONGS` (10) and `CACHE_MAX_TTS` (10) limits.
       - Protect `telegram_vault.json`, `playback_state*.json`, and `queue_state*.json` from eviction.
    
    AVOID: Allowing Audio Server to receive arbitrary third-party URLs that could cause validation failure or playback halts.
    USE: Central Controller serving verified 96kbps CBR MP3s via `/api/audio-file/song_<key>.mp3`.
  </action>
  <verify>
    node -e "import fs from 'fs'; const code = fs.readFileSync('main-server/server.js', 'utf8'); if (!code.includes('song_\${cacheKey}.mp3') || !code.includes('is96kCbrMp3Buffer')) { console.error('Missing expected normalization pattern in server.js'); process.exit(1); } console.log('server.js enforces 96k CBR MP3 caching and validation!'); process.exit(0);"
  </verify>
  <done>
    `main-server/server.js` guarantees that `playNext` only delivers verified 96k CBR MP3 URLs to Audio Servers and cache hygiene is maintained.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Central Controller fetchAndCache transcodes all incoming audio to strict 96kbps CBR 44.1kHz stereo MP3 before saving to song_<key>.mp3
- [ ] Telegram Vault L2 downloads are validated/transcoded to 96k CBR MP3 before caching
- [ ] Central Controller guarantees Audio Servers only receive verified 96k CBR MP3 files on /play

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in download router or playback queue
