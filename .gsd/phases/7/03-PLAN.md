---
phase: 7
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - test_phase7_pipeline.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "Central Controller successfully generates 96k CBR MP3 TTS and audio servers accept /announce without HTTP 400"
    - "Central Controller serves 96k CBR MP3 songs and audio servers play without rejection"
    - "Audio Server 1 and Audio Server 2 spawn zero FFmpeg processes and zero child processes under playback and speech"
  artifacts:
    - "test_phase7_pipeline.js"
---

# Plan 7.3: End-to-End Pipeline Verification & Deploy

## Objective
Verify the end-to-end audio pipeline across Central Controller and Audio Servers. Ensure that all TTS announcements and downloaded songs are transcoded upstream into verified 96kbps CBR 44.1kHz stereo MP3s, dispatched to live Audio Server 1 (Room 1) and Audio Server 2 (Room 2), and played smoothly with zero process spawns, zero FFmpeg invocations on audio servers, and zero HTTP 400 rejections.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- main-server/server.js
- main-server/src/audioNormalizer.js
- audio-server/server.js
- audio-server/src/audioPlayer.js
- audio-server/src/mp3Validator.js

## Tasks

<task type="auto">
  <name>Build and Run Automated End-to-End Normalization & Rejection Test Suite</name>
  <files>
    test_phase7_pipeline.js
  </files>
  <action>
    Create `test_phase7_pipeline.js` to systematically test the upstream normalization pipeline and audio server handshakes.
    
    Steps:
    1. Test Upstream TTS Generation & Header Validation:
       - Generate an announcement using the Central Controller normalization logic:
         `const ttsUrl = await generateAndNormalizeTts("Highrise Upstream Normalization Test Announcement", "en");`
       - Verify the generated file exists in `main-server/cache/tts_*.mp3`.
       - Validate that `is96kCbrMp3Buffer` passes on the generated file.
    2. Test Audio Server `/announce` Rejection vs Acceptance Handshake:
       - Send an invalid audio payload (e.g. raw WAV or non-96k audio) to Audio Server `/announce`:
         Confirm Audio Server responds with HTTP 400 Bad Request (`Rejected: audio must be strict 96kbps CBR 44.1kHz MP3`).
       - Send the normalized 96k CBR MP3 announcement to Audio Server `/announce`:
         Confirm Audio Server responds with HTTP 200 (`announcement_started` or `announcement_completed`), not 400.
    3. Test Track Normalization & Playback Handshake:
       - Create or transcode a sample audio file into `song_test_phase7.mp3` using `normalizeTo96kMp3`.
       - Validate output with `is96kCbrMp3Buffer` and confirm frame header parameters:
         MPEG-1 Layer 3, 96kbps, 44.1kHz, Stereo / Joint Stereo.
       - Verify Audio Server `/play` accepts the URL, begins monotonic frame pacing at 12 KB/sec, and does NOT trigger rejection.
    4. Assert clean exit code 0 if all tests pass, exit code 1 on failure.
    
    AVOID: Relying only on mock stubs without testing real byte headers.
    USE: Exact byte checks conforming to ISO/IEC 11172-3 specifications.
  </action>
  <verify>
    node test_phase7_pipeline.js
  </verify>
  <done>
    `test_phase7_pipeline.js` executes all tests and passes with exit code 0.
  </done>
</task>

<task type="auto">
  <name>Fleet Verification on Live Cloud Nodes & Zero-Process Audit</name>
  <files>
    test_phase7_pipeline.js
  </files>
  <action>
    Execute live network verification against the running production fleet and audit server health.
    
    Steps:
    1. Probe Live Audio Servers:
       - Ping Room 1 (`http://92.118.206.166:30238/health`) and Room 2 (`http://2.56.246.128:30289/health`).
       - Confirm both servers report `status: 'healthy'`, `streamActive: true`, `encoderRunning: true`.
    2. Test Announcement Dispatch:
       - Dispatch a test announcement from Central Controller to Audio Server 1 and Audio Server 2.
       - Confirm audio servers accept the announcement, stream speech frames, and resume the silence loop without error.
    3. Process Audit:
       - Query Audio Server status or inspect remote logs: verify zero child processes spawned (`child_process` not imported or invoked).
       - Confirm CPU usage on Audio Servers remains < 5%.
    4. Cache Hygiene Check:
       - Verify Central Controller cache directory contains at most `CACHE_MAX_SONGS` (10) songs and `CACHE_MAX_TTS` (10) TTS files.
       - Confirm `telegram_vault.json` and queue state files are uncorrupted.
    
    AVOID: Leaving lingering test artifacts or broken audio state in production rooms.
    USE: Clean status checks, non-destructive test announcements, and graceful teardown.
  </action>
  <verify>
    node -e "import fetch from 'node-fetch'; async function check() { const r1 = await fetch('http://92.118.206.166:30238/health'); const r2 = await fetch('http://2.56.246.128:30289/health'); if (!r1.ok || !r2.ok) process.exit(1); console.log('Both live Audio Servers are healthy and reachable!'); process.exit(0); } check();"
  </verify>
  <done>
    Both live audio servers are confirmed healthy, accept normalized speech announcements, and operate with zero child process overhead.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] Central Controller successfully generates 96k CBR MP3 TTS and audio servers accept /announce without HTTP 400
- [ ] Central Controller serves 96k CBR MP3 songs and audio servers play without rejection
- [ ] Audio Server 1 and Audio Server 2 spawn zero FFmpeg processes and zero child processes under playback and speech

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] Clean end-to-end playback and speech announcements verified across the fleet
