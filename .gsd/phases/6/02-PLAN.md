---
phase: 6
plan: 2
wave: 2
depends_on:
  - "01"
files_modified:
  - audio-server/src/persistentStreamManager.js
  - audio-server/src/ffmpegHelper.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "ffmpegHelper.js is completely removed from audio-server"
    - "persistentStreamManager.js contains zero child_process imports, spawns, or exec calls"
  artifacts:
    - "audio-server/src/persistentStreamManager.js"
---

# Plan 6.2: Audio Server FFmpeg Purge & ffmpegHelper Removal

## Objective
Completely eliminate all `child_process` modules (`spawn`, `exec`, `execSync`), process tracking, and FFmpeg references from `audio-server/src/persistentStreamManager.js`, and delete `audio-server/src/ffmpegHelper.js`. Ensure the stream engine operates as a 100% pure Node.js byte relay.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- audio-server/src/persistentStreamManager.js
- audio-server/src/ffmpegHelper.js

## Tasks

<task type="auto">
  <name>Eliminate all child_process and FFmpeg usage from persistentStreamManager.js</name>
  <files>
    audio-server/src/persistentStreamManager.js
  </files>
  <action>
    Remove all child_process imports and process spawning from `persistentStreamManager.js`.
    
    Steps:
    1. Remove `import { execSync, spawn } from 'child_process';` from line 1.
    2. Remove `import { getFFmpegPath } from './ffmpegHelper.js';`.
    3. Remove `this.currentAnnouncementProc` and all related child process tracking methods (`setAnnouncementProc`, `clearAnnouncementProc`, and any `proc.kill()` calls).
    4. Remove the FFmpeg normalization block from `normalizeAudioTo96kMp3` / `streamAnnouncementMp3`. Audio servers must NEVER transcode audio; speech normalization is strictly upstream.
    5. Replace `normalizeAudioTo96kMp3` with pure byte inspection: if the buffer is not valid 96k CBR MP3, log rejection and do not play or throw an informative error.
    
    AVOID: Leaving any `spawn`, `exec`, or `execSync` calls or dormant fallback transcode blocks.
    USE: Pure in-memory Buffer operations and byte-stream chunking.
  </action>
  <verify>
    node -e "import fs from 'fs'; const code = fs.readFileSync('audio-server/src/persistentStreamManager.js', 'utf8'); const forbidden = ['child_process', 'spawn', 'execSync', 'exec(', 'getFFmpegPath']; const hits = forbidden.filter(k => code.includes(k)); if (hits.length > 0) { console.error('Found forbidden terms:', hits); process.exit(1); } console.log('persistentStreamManager.js is completely clean of child_process and FFmpeg!'); process.exit(0);"
  </verify>
  <done>
    Zero occurrences of `child_process`, `spawn`, `execSync`, or `getFFmpegPath` in `persistentStreamManager.js`.
  </done>
</task>

<task type="auto">
  <name>Delete ffmpegHelper.js and verify clean module imports</name>
  <files>
    audio-server/src/ffmpegHelper.js
    audio-server/server.js
  </files>
  <action>
    Remove `ffmpegHelper.js` from the codebase and ensure all audio-server files boot cleanly.
    
    Steps:
    1. Delete `audio-server/src/ffmpegHelper.js`.
    2. Scan all audio-server files (`audio-server/server.js`, `audio-server/src/audioPlayer.js`, `audio-server/src/persistentStreamManager.js`) to guarantee no lingering imports or references to `ffmpegHelper.js`.
    3. Verify `audio-server/server.js` parses cleanly and boots without reference errors.
    
    AVOID: Retaining unreferenced helper files that confuse deployment manifests or audits.
    USE: Complete removal of unused legacy transcode helpers.
  </action>
  <verify>
    node -e "import fs from 'fs'; if (fs.existsSync('audio-server/src/ffmpegHelper.js')) { console.error('ffmpegHelper.js still exists!'); process.exit(1); } console.log('ffmpegHelper.js confirmed deleted.');" && node --check audio-server/server.js
  </verify>
  <done>
    `ffmpegHelper.js` is deleted; `node --check audio-server/server.js` exits with code 0.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] `ffmpegHelper.js` does not exist on filesystem
- [ ] `persistentStreamManager.js` contains 0 instances of child_process / spawn / execSync
- [ ] `node --check audio-server/server.js` passes with zero errors

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] No regressions in audio server execution

