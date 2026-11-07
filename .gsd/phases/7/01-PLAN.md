---
phase: 7
plan: 1
wave: 1
depends_on: []
files_modified:
  - main-server/src/audioNormalizer.js
  - main-server/server.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "Central Controller normalizes all Google TTS and Residential Bridge voice audio to strict 96kbps CBR 44.1kHz stereo MP3 before dispatching to audio servers"
    - "Normalized TTS is stored in main-server/cache/tts_<hash>.mp3 and served via /api/audio-file/ with LRU pruning"
    - "Audio Server /announce receives verified 96k CBR MP3 and does not reject with HTTP 400"
  artifacts:
    - "main-server/src/audioNormalizer.js"
    - "main-server/server.js"
---

# Plan 7.1: Central Controller TTS Upstream Normalization & Pre-Transcoding

## Objective
Implement upstream speech and TTS normalization on the Central Controller (`main-server`). All voice announcements (generated via Google TTS API or Residential Bridge) must be pre-transcoded via FFmpeg into strict 96kbps CBR 44.1kHz stereo MP3 format (`main-server/cache/tts_<hash>.mp3`) and served via `/api/audio-file/` before invoking Audio Server `/announce`. This ensures Audio Servers (which now strictly reject non-96k audio) accept all announcements without HTTP 400 rejections and without spawning FFmpeg processes.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- main-server/server.js
- audio-server/src/mp3Validator.js
- audio-server/server.js

## Tasks

<task type="auto">
  <name>Create Central Controller Audio Normalizer and Validator Utility</name>
  <files>
    main-server/src/audioNormalizer.js
  </files>
  <action>
    Create `main-server/src/audioNormalizer.js` to provide FFmpeg detection, byte-level 96k CBR MP3 validation, and upstream audio transcoding.
    
    Steps:
    1. Implement FFmpeg discovery (`getFFmpegPath()`):
       - Check `process.env.FFMPEG_PATH`.
       - Check `where ffmpeg` (Windows) / `which ffmpeg` (Linux) via `execSync`.
       - Check standard binary paths: `/usr/bin/ffmpeg`, `/usr/local/bin/ffmpeg`, `/bin/ffmpeg`.
       - Cache the resolved path.
    2. Implement `is96kCbrMp3Buffer(buffer)`:
       - Pure Node.js MPEG-1 Layer 3 96kbps CBR 44.1kHz stereo validator conforming to ISO/IEC 11172-3.
       - Parse ID3v2 header if present to skip tag offset.
       - Check MPEG audio frame sync (`byte 0 === 0xFF` and `(byte 1 & 0xE0) === 0xE0`).
       - Confirm MPEG-1 (`version === 3`), Layer III (`layer === 1`), Bitrate Index 7 (96 kbps), Sample Rate Index 0 (44.1 kHz), and Channel Mode non-mono (`mode !== 3`).
       - Validate second frame sync word if buffer length permits.
    3. Implement `normalizeTo96kMp3(inputSource, outputPath)`:
       - Accepts file path or in-memory Buffer as `inputSource`.
       - If `inputSource` is a Buffer, write to a temporary file `temp_raw_norm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.raw`.
       - Run FFmpeg command:
         `ffmpeg -y -i "${inputPath}" -c:a libmp3lame -b:a 96k -ar 44100 -ac 2 -write_xing 0 -id3v2_version 0 "${outputPath}"`
       - Ensure `outputPath` exists, is > 1000 bytes, and passes `is96kCbrMp3Buffer`.
       - Clean up temporary raw input file if created.
       - Return `{ success: true, outputPath, size }`.
    
    AVOID: Relying on shell execution without checking binary existence.
    USE: Exact FFmpeg flags `-c:a libmp3lame -b:a 96k -ar 44100 -ac 2 -write_xing 0 -id3v2_version 0` to produce strict CBR frames without Xing/Info VBR headers or ID3v2 bloat.
  </action>
  <verify>
    node -e "import('./main-server/src/audioNormalizer.js').then(m => { console.log('FFmpeg path:', m.getFFmpegPath()); const testBuf = Buffer.alloc(100); console.log('is96kCbrMp3Buffer exported:', typeof m.is96kCbrMp3Buffer === 'function'); console.log('normalizeTo96kMp3 exported:', typeof m.normalizeTo96kMp3 === 'function'); if (typeof m.normalizeTo96kMp3 !== 'function' || typeof m.is96kCbrMp3Buffer !== 'function') process.exit(1); process.exit(0); })"
  </verify>
  <done>
    `main-server/src/audioNormalizer.js` is created, exports `getFFmpegPath`, `is96kCbrMp3Buffer`, and `normalizeTo96kMp3`, and passes verification.
  </done>
</task>

<task type="auto">
  <name>Implement Upstream TTS Normalization and Cache Pipeline in Central Controller</name>
  <files>
    main-server/server.js
  </files>
  <action>
    Wire upstream TTS generation, FFmpeg normalization, and caching into `main-server/server.js`.
    
    Steps:
    1. Import `getFFmpegPath`, `is96kCbrMp3Buffer`, and `normalizeTo96kMp3` from `./src/audioNormalizer.js` at the top of `main-server/server.js`.
    2. Replace the old `getTtsUrl(text, lang)` function with an asynchronous `generateAndNormalizeTts(text, lang = 'en')`:
       - Clean and trim text (max 200 chars). Return `null` if empty.
       - Calculate deterministic MD5 hash of `${clean}_${lang}`: `hash = crypto.createHash('md5').update(\`${clean}_\${lang}\`).digest('hex').slice(0, 16)`.
       - Target file: `ttsFile = path.join(CACHE_DIR, \`tts_\${hash}.mp3\`)`.
       - If `ttsFile` exists, is > 1000 bytes, and passes `is96kCbrMp3Buffer(fs.readFileSync(ttsFile))`:
         Return instant cache hit URL: `${CONTROLLER_URL}/api/audio-file/tts_${hash}.mp3`.
       - If cache miss:
         * Obtain raw audio stream: If `activeResidentialBridgeUrl` is alive, fetch `${activeResidentialBridgeUrl}/tts?text=${encodeURIComponent(clean)}&lang=${encodeURIComponent(lang)}`.
         * Else fallback to Google TTS: `gUrl = googleTTS.getAudioUrl(clean, { lang, slow: false, host: 'https://translate.google.com' })` and fetch audio buffer via `node-fetch`.
         * Write raw audio buffer to a temp file `temp_raw_tts_${Date.now()}_${hash}.raw`.
         * Run `await normalizeTo96kMp3(tempRawPath, ttsFile)`.
         * Clean up temp raw file.
         * Trigger `pruneSongCache()` to maintain `CACHE_MAX_TTS` (10) limit.
         * Return `${CONTROLLER_URL}/api/audio-file/tts_${hash}.mp3`.
    3. Update `playNext(room)` in `main-server/server.js`:
       - Before track playback when `targetRoom.announcementsEnabled` is active:
         Replace `ttsUrl = getTtsUrl(...)` with `const ttsUrl = await generateAndNormalizeTts(text, targetRoom.announcementVoice)`.
         Call `callAudioServer(targetRoom, '/announce', { url: ttsUrl, wait: true })`.
       - When a track is unavailable and announcement is played:
         Replace `ttsUrl = getTtsUrl(...)` with `const ttsUrl = await generateAndNormalizeTts(unavailableMsg, targetRoom.announcementVoice)`.
         Call `callAudioServer(targetRoom, '/announce', { url: ttsUrl })`.
    4. Verify `app.get('/api/audio-file/:filename')` serves `tts_*.mp3` files with header `Content-Type: audio/mpeg`.
    
    AVOID: Sending raw Google Translate TTS URLs or un-normalized Residential Bridge audio to Audio Server `/announce` because the audio server will reject with HTTP 400.
    USE: Deterministic hash caching in `cache/tts_<hash>.mp3` and serving pre-normalized 96k CBR MP3 URLs from the Central Controller.
  </action>
  <verify>
    node --check main-server/server.js && node -e "import('./main-server/server.js').catch(e => { if (e.code !== 'ERR_MODULE_NOT_FOUND' && !e.message.includes('listen')) console.error(e); process.exit(0); })"
  </verify>
  <done>
    `main-server/server.js` passes syntax validation and pre-transcodes all TTS announcements to verified 96kbps CBR MP3 files before calling Audio Server `/announce`.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Central Controller normalizes all Google TTS and Residential Bridge voice audio to strict 96kbps CBR 44.1kHz stereo MP3 before dispatching to audio servers
- [ ] Normalized TTS is stored in main-server/cache/tts_<hash>.mp3 and served via /api/audio-file/ with LRU pruning
- [ ] Audio Server /announce receives verified 96k CBR MP3 and does not reject with HTTP 400

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] Zero syntax or import regressions in main-server
