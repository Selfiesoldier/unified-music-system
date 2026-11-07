# Phase 6 Plan 3 Summary: Strict Byte-Header Rejection for Non-96k MP3 Input

## Execution Summary

Implemented a zero-dependency, pure Node.js byte-header validator for MPEG-1 Layer 3 96kbps CBR 44.1kHz stereo audio streams conforming to ISO/IEC 11172-3. Wired strict byte-header rejection into `/play` and `/announce` endpoints, ensuring invalid, corrupted, mono, non-44.1kHz, non-96k, or non-MP3 files are immediately rejected with zero CPU usage and zero child_process or FFmpeg invocations.

## Completed Tasks

| Task | Name | Commit | Files Touched | Verification |
|------|------|--------|---------------|--------------|
| 1 | Create pure JS MPEG-1 Layer 3 96kbps CBR header validator | `33cf73f` | `audio-server/src/mp3Validator.js` | Evaluated against `silence_96k.mp3` (valid), WAV RIFF header (rejected), AAC ADTS header (rejected), and 128kbps MP3 (rejected). Code 0 exit. |
| 2 | Enforce strict byte-header rejection on /play and /announce routes | `e30ca7b` | `audio-server/src/audioPlayer.js`, `audio-server/server.js`, `audio-server/src/persistentStreamManager.js` | Verified AudioPlayer rejects invalid audio file immediately, aborts playback, cleans temp files, and sm.streamAnnouncementMp3 returns false on bad buffers. |

## Key Changes

- **`audio-server/src/mp3Validator.js`**:
  - Implemented `is96kCbrMp3Buffer(buffer)`: Parses ID3v2 tag size (including footer flags) to locate audio frame sync word (`0xFF 0xEx`). Validates MPEG Audio Version ID (MPEG-1), Layer Description (Layer III), Bitrate Index (7 = 96 kbps), Sample Rate Index (0 = 44.1 kHz), and non-mono Channel Mode. Computes frame length (`Math.floor(144 * 96000 / 44100) + padding`) and confirms consecutive frame sync word at offset + frame length.
  - Implemented `validateMp3FileHeader(filePath)`: Safely reads file header, parses ID3 tag offset if present, reads audio frame chunk, and validates format via `is96kCbrMp3Buffer`.
- **`audio-server/src/audioPlayer.js`**:
  - Imported `validateMp3FileHeader` from `./mp3Validator.js`.
  - Replaced extension-only check with `validateMp3FileHeader(localInputPath)`.
  - Immediately stops session (`this.stop(true, true)`), cleans temp files, and returns with zero process invocations on invalid files.
- **`audio-server/server.js`**:
  - Imported `is96kCbrMp3Buffer` from `./src/mp3Validator.js`.
  - In `/announce`, checks buffer with `is96kCbrMp3Buffer(mp3Buffer)` and immediately returns HTTP 400 Bad Request `{ error: 'Rejected: audio must be strict 96kbps CBR 44.1kHz MP3' }` without invoking `streamAnnouncementMp3` or spawning any process.
- **`audio-server/src/persistentStreamManager.js`**:
  - Imported `is96kCbrMp3Buffer` from `./mp3Validator.js`.
  - Replaced inline validation in `normalizeAudioTo96kMp3` and guarded `streamAnnouncementMp3` directly with `is96kCbrMp3Buffer(mp3Buffer)`.

## Must-Haves Verification

1. `mp3Validator.js` exports `is96kCbrMp3Buffer` and `validateMp3FileHeader` - **CONFIRMED** (`typeof === 'function'`).
2. `/play` aborts playback if file fails 96k CBR MP3 header check - **CONFIRMED** (`ap.isPlaying === false` on non-96k file).
3. `/announce` returns HTTP 400 if payload fails 96k CBR MP3 header check - **CONFIRMED** (Fast HTTP 400 rejection in route handler, returns false in `streamAnnouncementMp3`).
4. Zero FFmpeg or child_process invocations on invalid audio inputs - **CONFIRMED** (0 imports of `child_process` across all audio-server modules).

## Deviations
None. Execution adhered strictly to the plan specification.
