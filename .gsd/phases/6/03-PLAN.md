---
phase: 6
plan: 3
wave: 3
depends_on:
  - "02"
files_modified:
  - audio-server/src/mp3Validator.js
  - audio-server/src/audioPlayer.js
  - audio-server/server.js
  - audio-server/src/persistentStreamManager.js
autonomous: true
gap_closure: false
must_haves:
  truths:
    - "Non-96k MP3 input on /play is strictly rejected without spawning FFmpeg"
    - "Non-96k MP3 input on /announce is strictly rejected with HTTP 400 without spawning FFmpeg"
    - "mp3Validator.js accurately parses MPEG-1 Layer 3 96k CBR 44.1kHz frame headers"
  artifacts:
    - "audio-server/src/mp3Validator.js"
    - "audio-server/src/audioPlayer.js"
    - "audio-server/server.js"
---

# Plan 6.3: Strict Byte-Header Rejection for Non-96k MP3 Input

## Objective
Implement a lightweight, pure Node.js byte-header validator for MPEG-1 Layer 3 96kbps CBR 44.1kHz stereo audio, and enforce strict rejection on `/play` and `/announce` endpoints so that any non-96k or corrupted audio is rejected immediately with zero process spawning.

## Context
Load these files for context:
- .gsd/SPEC.md
- .gsd/ARCHITECTURE.md
- audio-server/src/audioPlayer.js
- audio-server/server.js
- audio-server/src/persistentStreamManager.js

## Tasks

<task type="auto">
  <name>Create pure JS MPEG-1 Layer 3 96kbps CBR header validator</name>
  <files>
    audio-server/src/mp3Validator.js
  </files>
  <action>
    Create `audio-server/src/mp3Validator.js` with zero external dependencies and zero child_process usage.
    
    Steps:
    1. Implement `is96kCbrMp3Buffer(buffer)`:
       - Check for ID3v2 header at byte 0 (`ID3`). If present, parse syncsafe tag size `((b[6] & 0x7F) << 21) | ((b[7] & 0x7F) << 14) | ((b[8] & 0x7F) << 7) | (b[9] & 0x7F) + 10` (+10 if footer present).
       - Locate first MPEG audio frame sync word starting at offset: `byte 0 == 0xFF` and `(byte 1 & 0xE0) == 0xE0` (11 sync bits).
       - Validate MPEG-1 Layer 3 parameters:
         * MPEG Audio Version ID: `(b1 >> 3) & 3 === 3` (MPEG-1)
         * Layer Description: `(b1 >> 1) & 3 === 1` (Layer III)
         * Bitrate Index: `(b2 >> 4) & 15 === 7` (96 kbps in MPEG-1 Layer III)
         * Sample Rate Index: `(b2 >> 2) & 3 === 0` (44.1 kHz)
         * Channel Mode: `(b3 >> 6) & 3 !== 3` (Stereo, Joint Stereo, or Dual Channel; reject mono if strict stereo required)
       - Frame length calculation: `Math.floor(144 * 96000 / 44100) + padding` (313 or 314 bytes).
       - Confirm next frame sync: if buffer length >= `offset + frameLength + 4`, verify sync word at `offset + frameLength` to ensure genuine audio stream.
       - Return `true` if and only if all checks pass, otherwise `false`.
    2. Implement `validateMp3FileHeader(filePath)`:
       - Safely read the initial chunk (e.g. 4096 bytes) using `fs.openSync` and `fs.readSync`.
       - Run `is96kCbrMp3Buffer` on the chunk and close the file descriptor.
    
    AVOID: Relying on file extensions (`.mp3` or `.m4a`) as proof of format.
    USE: Exact byte-level header parsing conforming to ISO/IEC 11172-3.
  </action>
  <verify>
    node -e "import { is96kCbrMp3Buffer } from './audio-server/src/mp3Validator.js'; import fs from 'fs'; const silence = fs.readFileSync('audio-server/assets/silence_96k.mp3'); const ok = is96kCbrMp3Buffer(silence); const badWav = Buffer.from('RIFF1234WAVEfmt '); const badAac = Buffer.from([0xFF, 0xF1, 0x50, 0x80]); const badBitrate = Buffer.from([0xFF, 0xFB, 0x90, 0x64]); console.log('Valid MP3 check:', ok); console.log('Bad WAV rejected:', !is96kCbrMp3Buffer(badWav)); console.log('Bad bitrate rejected:', !is96kCbrMp3Buffer(badBitrate)); if (!ok || is96kCbrMp3Buffer(badWav) || is96kCbrMp3Buffer(badBitrate)) process.exit(1); process.exit(0);"
  </verify>
  <done>
    Validator accurately confirms 96k CBR MP3 and rejects non-96k, non-MP3, or wrong-sample-rate buffers.
  </done>
</task>

<task type="auto">
  <name>Enforce strict byte-header rejection on /play and /announce routes</name>
  <files>
    audio-server/src/audioPlayer.js
    audio-server/server.js
    audio-server/src/persistentStreamManager.js
  </files>
  <action>
    Wire the validator into audio-server playback and announcement endpoints.
    
    Steps:
    1. In `audio-server/src/audioPlayer.js`:
       - Import `validateMp3FileHeader` from `./mp3Validator.js`.
       - In `AudioPlayer.play(trackInfo)`:
         Replace the previous filename check (`localInputPath.endsWith('.mp3')`) with `validateMp3FileHeader(localInputPath)`.
         If invalid:
         Log `❌ [AudioPlayer] Rejected non-96k MP3 input: ${localInputPath}. Strict zero-CPU engine requires pre-encoded 96kbps CBR MP3.`.
         Call `this.stop(true, true)`, clean temp files, and return immediately without spawning any subprocess.
    2. In `audio-server/server.js`:
       - Import `is96kCbrMp3Buffer` from `./src/mp3Validator.js`.
       - In `/announce` (`app.post(['/announce', '/api/announce'])`):
         After receiving `mp3Buffer` (via base64 or fetch):
         Validate with `is96kCbrMp3Buffer(mp3Buffer)`.
         If invalid:
         Return HTTP 400 Bad Request `{ error: 'Rejected: audio must be strict 96kbps CBR 44.1kHz MP3' }`.
         Do NOT call `streamAnnouncementMp3` and do not spawn any process.
    3. In `audio-server/src/persistentStreamManager.js`:
       - In `streamAnnouncementMp3`:
         Guard input with `is96kCbrMp3Buffer(mp3Buffer)`. If invalid, log warning and return `false` immediately.
    
    AVOID: Attempting any fallback transcoding or silent failure.
    USE: Fast HTTP 400 rejection on `/announce` and immediate playback abort with error logging on `/play`.
  </action>
  <verify>
    node -e "import { is96kCbrMp3Buffer, validateMp3FileHeader } from './audio-server/src/mp3Validator.js'; import { AudioPlayer } from './audio-server/src/audioPlayer.js'; import fs from 'fs'; const ap = new AudioPlayer(null); console.log('AudioPlayer instantiated, checking rejection logic...'); const tmpBad = 'audio-server/assets/test_bad.mp3'; fs.writeFileSync(tmpBad, Buffer.from('NOT_AN_MP3_DATA_AT_ALL')); const valid = validateMp3FileHeader(tmpBad); fs.unlinkSync(tmpBad); if (valid) { console.error('Failed: test_bad should be invalid'); process.exit(1); } console.log('Strict rejection verified for fake MP3 file.'); process.exit(0);"
  </verify>
  <done>
    `/play` and `/announce` reject non-96k audio immediately; 0 FFmpeg processes spawned.
  </done>
</task>

## Must-Haves
After all tasks complete, verify:
- [ ] `mp3Validator.js` exports `is96kCbrMp3Buffer` and `validateMp3FileHeader`
- [ ] `/play` aborts playback if file fails 96k CBR MP3 header check
- [ ] `/announce` returns HTTP 400 if payload fails 96k CBR MP3 header check
- [ ] Zero FFmpeg or child_process invocations on invalid audio inputs

## Success Criteria
- [ ] All tasks verified passing
- [ ] Must-haves confirmed
- [ ] Complete protection against non-96k CBR MP3 injection

