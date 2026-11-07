---
phase: 6
plan: 1
wave: 1
depends_on: []
files_modified:
  - audio-server/assets/silence_96k.mp3
  - audio-server/src/persistentStreamManager.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "Audio server initializes silence without invoking FFmpeg or child_process on boot"
    - "Stream manager uses pre-rendered silence_96k.mp3 or embedded base64 fallback frames"
  artifacts:
    - "audio-server/assets/silence_96k.mp3"
    - "audio-server/src/persistentStreamManager.js"
---

# Plan 6.1: Static Pre-Rendered Silence Loop & Embedded Frame Fallback

## Objective
Replace boot-time silence generation in `persistentStreamManager.js` with a static pre-rendered 96k CBR MP3 loop and embedded frame fallback. Ensure the audio server boots in 0ms without invoking `execSync`, `spawn`, or `getFFmpegPath()`, eliminating all process-spawning overhead during boot.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- audio-server/src/persistentStreamManager.js
- audio-server/assets/silence_96k.mp3

## Tasks

<task type="auto">
  <name>Pre-rendered static silence asset and embedded fallback audit</name>
  <files>
    audio-server/assets/silence_96k.mp3
    audio-server/src/persistentStreamManager.js
  </files>
  <action>
    Remove the `execSync` call and silence-generation shell command in `PersistentStreamManager.init()`.
    
    Steps:
    1. Verify `audio-server/assets/silence_96k.mp3` exists as a valid 96kbps CBR 44.1kHz Joint-Stereo MP3 (60,000 bytes for 5 seconds).
    2. Audit the embedded `FALLBACK_SILENCE_B64` in `audio-server/src/persistentStreamManager.js` to ensure it contains valid MPEG-1 Layer 3 96kbps 44.1kHz stereo/joint-stereo frames (sync byte `0xFF 0xFB 0x70 0x64`).
    3. Update `PersistentStreamManager.init()`:
       - Check if `silence_96k.mp3` exists in `this.assetsDir` and is > 1000 bytes. If present, load it via `fs.readFileSync(silencePath)`.
       - If missing or invalid, load `Buffer.from(FALLBACK_SILENCE_B64, 'base64')` directly.
       - Optionally write the decoded fallback buffer to `silencePath` via `fs.writeFileSync` as a pure Node.js file cache.
       - Eliminate `execSync`, `spawn`, and any shell execution from `init()`.
    
    AVOID: Spawning FFmpeg or running shell commands if the file is missing because containerized audio servers must run without FFmpeg.
    USE: Pure Node.js `fs` file loading with instant base64 fallback.
  </action>
  <verify>
    node -e "import('./audio-server/src/persistentStreamManager.js').then(m => { const sm = new m.PersistentStreamManager({ assetsDir: 'audio-server/assets' }); sm.init(); if (!sm.silenceMp3Buffer || sm.silenceMp3Buffer.length === 0) process.exit(1); console.log('Silence buffer loaded successfully:', sm.silenceMp3Buffer.length, 'bytes'); process.exit(0); })"
  </verify>
  <done>
    Silence buffer loads instantly from disk or embedded fallback with zero external process calls.
  </done>
</task>

<task type="auto">
  <name>Silence loop streaming and burst buffer synchronization</name>
  <files>
    audio-server/src/persistentStreamManager.js
  </files>
  <action>
    Audit and refine `startSilenceFeed()` and `broadcast(chunk)` in `PersistentStreamManager`.
    
    Steps:
    1. Ensure silence chunks are sliced at exact `CHUNK_SIZE = 1200` bytes (100ms at 96kbps CBR = 12,000 B/s * 0.1s).
    2. Ensure the cyclic offset into `this.silenceMp3Buffer` wraps around cleanly when reaching buffer end:
       - If remaining bytes in buffer < `CHUNK_SIZE`, wrap `silenceOffset = 0` and slice from beginning so emitted chunks are always exactly 1200 bytes.
    3. Verify burst buffer maintains byte-accurate 12 KB cushion for instant listener connection without catch-up burst floods.
    4. Confirm zero child process calls exist in silence feed logic.
    
    AVOID: Calling any external process or child process during silence streaming.
    USE: High-resolution monotonic timer `process.hrtime.bigint()` for pacing chunks.
  </action>
  <verify>
    node -e "import('./audio-server/src/persistentStreamManager.js').then(async m => { const sm = new m.PersistentStreamManager({ assetsDir: 'audio-server/assets' }); sm.init(); sm.startSilenceFeed(); await new Promise(r => setTimeout(r, 250)); sm.stopSilenceFeed(); const stats = sm.getStats(); console.log('Stats:', stats); if (stats.totalMegabytes === '0.00' && sm.stats.totalBytes === 0) process.exit(1); console.log('Silence loop emitted bytes cleanly:', sm.stats.totalBytes); process.exit(0); })"
  </verify>
  <done>
    Silence feed broadcasts cleanly at 1200 bytes/chunk without jitter or subprocess execution.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Audio server initializes silence without invoking FFmpeg or child_process on boot
- [ ] Stream manager uses pre-rendered silence_96k.mp3 or embedded base64 fallback frames
- [ ] Silence feed paces 1200-byte chunks at 96kbps CBR using process.hrtime.bigint

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in silence loop or client connection

