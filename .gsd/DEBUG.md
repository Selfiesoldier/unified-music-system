# Debug Session: Audio Stream Glitches, Pauses, and Drops

## Symptom
Real-world users experiencing multiple audio stream degradation issues:
1. **TTS Burst / Glitchy Sound:** During TTS voice announcements, audio sounds like a fast burst, chipmunk pitch, or harsh digital glitch artifacts.
2. **Stream Pausing and Quick Recovery:** The stream frequently pauses or buffers for a few seconds during track transitions and then resumes.
3. **Stream Dying / Disconnecting:** After extended listening or network blips, the audio stream permanently cuts out / dies, requiring a full player restart.

## Evidence Gathered
1. **Google TTS Audio Format Analysis:**
   - Stream negotiated as: MPEG-1 Layer 3, 44,100 Hz, Stereo, 96 kbps CBR.
   - Google TTS generates: MPEG-2 Layer 3, 24,000 Hz, Mono, 32 kbps.
   - `audio-server/server.js` `/announce` blindly streams the raw 24kHz Mono 32k audio directly into the 44.1kHz Stereo 96k Icecast broadcast without transcoding.
   - `streamAnnouncementMp3` uses `audioDurationSentMs = (offset / 12000) * 1000` (assuming 12 KB/s), sending 32kbps audio 3x faster than real-time (instant 3x speed burst).
   - Decoder samplerate & channel mode mismatch causes harsh digital distortion and lost frame synchronization.
2. **Concurrent Broadcast Interleaving:**
   - `streamAnnouncementMp3` does not coordinate with `audioPlayer.js`. If a track is playing when an announcement arrives, both streams call `streamManager.broadcast()` concurrently, interleaving audio frames and corrupting the MP3 bit reservoir.
3. **Zero-Audio Gap on Track Preparation:**
   - When `/play` is called in `audioPlayer.js`, it executes `this.stop(false, false)`. `resumeSilence` is explicitly passed as `false`.
   - `audioPlayer` clears the burst buffer and begins `await downloadFile(source, localInputPath)`.
   - For 1-3 seconds during the download, neither music nor silence is broadcast. Clients buffer drains completely and the player pauses.
4. **Silence Feed Accumulator Drift:**
   - In `startSilenceFeed()`, when `this.clients.size === 0 && this.audioBufferBytes >= this.maxBurstBytes`, the interval returns without updating `silenceChunksSent`.
   - Real-time `hrStart` keeps advancing.
   - The moment a client connects, `targetChunks - silenceChunksSent` is thousands of chunks behind, causing an immediate multi-megabyte burst of silence frames that overwhelms socket buffers and decoders.
5. **Backpressure False Disconnect:**
   - `meta.lastSuccessfulWrite` is only updated when `client.write()` returns `true`.
   - When socket buffers fill above 16KB (`highWaterMark`), `client.write()` returns `false` (standard Node.js backpressure).
   - There is no `'drain'` event listener to update `lastSuccessfulWrite`.
   - If buffer exceeds 256KB during a burst, `broadcast()` stops writing to that client. After 45s, `persistentStreamManager.js` forcibly terminates the listener (`this.removeClient(res) -> res.end()`), killing the stream.

## Hypotheses
| # | Hypothesis | Likelihood | Status |
|---|------------|------------|--------|
| H1 | TTS announcement audio format mismatch (24kHz Mono 32k vs 44.1kHz Stereo 96k) and 12KB/s timing error causes 3x speed burst and digital glitching | 95% | CONFIRMED |
| H2 | Interleaving of music frames and announcement frames during concurrent playback corrupts MP3 bitstreams | 90% | CONFIRMED |
| H3 | Stopping silence during track download (`stop(false, false)`) starves listeners of bytes, causing client player pauses | 95% | CONFIRMED |
| H4 | Silence feed idle drift causes multi-megabyte burst on client connect, triggering the 256KB buffer limit and 45s force-kill | 90% | CONFIRMED |
| H5 | Incomplete backpressure tracking without `drain` events leads to false client disconnects | 85% | CONFIRMED |


## Resolution

**Root Cause:**
1. **TTS Format & Timing Mismatch:** TTS was ingested as 24kHz Mono 32k MPEG-2 MP3 and broadcast with 12KB/s (96k) timing, causing a 3x speed burst and extreme digital pitch/glitch distortion.
2. **Uncoordinated Interleaved Playback:** `streamAnnouncementMp3` and `AudioPlayer` ran concurrently without mutual exclusion, mixing music and speech frames.
3. **Download Starvation:** `this.stop(false, false)` stopped silence feed while downloading the new track from controller, starving clients for 1-3 seconds.
4. **Silence Drift:** Idle accumulator drift caused multi-megabyte burst spikes upon client connect, leading to buffer overflow and disconnection.
5. **Backpressure Force-Kill:** Missing `'drain'` listener caused valid backpressured sockets to be terminated after 45s.

**Fix Applied:**
- `audio-server/src/persistentStreamManager.js`:
  - Added `normalizeAudioTo96kMp3` via FFmpeg to guarantee strict 96k CBR 44100Hz Stereo MP3 framing for all announcements.
  - Added automatic coordination: pauses `audioPlayer` during announcements and resumes seamlessly without catchup burst.
  - Synchronized `silenceChunksSent = targetChunks` on idle and clamped max catchup to 3 chunks (300ms) to prevent burst floods.
  - Attached socket `'drain'` listener and updated `lastSuccessfulWrite` on write acceptance; expanded bloat limit to 512KB.
- `audio-server/src/audioPlayer.js`:
  - Implemented `pauseForAnnouncement()` and `resumeAfterAnnouncement()` with duration offset compensation.
  - Set `this.stop(false, true)` on new track preparation so silence feeds continuously during track download (100% gapless).
- `main-server/server.js`:
  - Updated `getTtsUrl()` with direct Google TTS API CDN fallback if residential bridge is offline.
- `residential/server.js`:
  - Added native `/tts` endpoint for Android Termux residential proxy.

**Verified:**
- Audio Server 1 (`30238`) and Audio Server 2 (`30289`) deployed and verified healthy with active listeners.
- Main Controller (`30195`) deployed and verified healthy.

## Debug Session: Workflow Confirmation & Termux-First Faulty Track Re-encoding

### Expected Workflow (User Specification):
1. **Song Request:**
   - Check L1 SSD Cache (`CACHE_DIR`), then L2 Telegram Cloud Vault (`telegram_vault.json`).
   - If not in cache:
     - Check if Termux Residential Bridge is available.
     - **If Termux is available:** Request TTS announcement (`/tts`) AND download song (`/stream`). One copy cached in L2 Telegram Vault, one copy sent to Audio Server (`/play`).
     - **If Termux is NOT available:** Skip TTS completely. Request song from Cloud Worker (`/stream`). Worker generates music only (no TTS). One copy cached in L2 Telegram Vault, one copy sent to Audio Server (`/play`).
2. **Faulty Encoding Handling (Cache Hit with non-96k audio):**
   - When a faulty/legacy encoded track is retrieved from cache or vault:
     - Check if Termux Residential Bridge is available.
     - **If Termux is available:** Offload re-encoding to Termux (`/transcode`).
     - **If Termux is NOT available:** Offload re-encoding to Cloud Worker (`/transcode`).
   - In both cases:
     - Clean 96kbps CBR MP3 buffer returned to Central Controller.
     - Central Controller saves clean copy to L1 cache.
     - Central Controller uploads clean copy to L2 Telegram Vault.
     - Central Controller deletes old faulty message from Telegram channel (`deleteMessage`).
     - Audio Server receives clean 96k MP3 for zero-CPU playback.

### Identified Gap:
- Prior implementation routed `transcodeViaWorker` solely to the Cloud Worker without checking if Termux was available.
- `residential/server.js` lacked the `/transcode` endpoint and its `/stream` endpoint saved `.m4a`.

### Resolution Applied:
1. `residential/server.js`:
   - Added `/transcode` endpoint accepting POST binary audio and transcoding via single-thread FFmpeg to 96kbps CBR 44.1kHz stereo MP3.
   - Updated `/stream` to transcode downloaded YouTube audio directly to 96kbps CBR MP3 before delivering.
2. `main-server/server.js`:
   - Updated `transcodeAudio` to prioritize Termux (`${activeResidentialBridgeUrl}/transcode`) whenever `isBridgeAlive` is true, with seamless fallback to `${DOWNLOAD_WORKER_URL}/transcode` if Termux fails or is offline.
   - Preserved Telegram channel `deleteMessage` on the old faulty message.
3. Deployed and verified healthy on Central Controller (`6a95145f`).

---

## Debug Session: Mid-Stream Sample Rate Mismatch (48kHz vs 44.1kHz) & TTS Disconnects

### Symptom
User reported: *"when i was listening it was going preety good but sometime the tts is bursting again and i got disconnected"*.

### Evidence Gathered
1. **Byte Header Inspection of Cache:**
   - Inspected audio frame sync words across all cached songs on Central Controller (`http://2.56.246.119:30195/api/audio-file/`):
     - `song_yt_0JLRExeOH-k.mp3`: offset=45, header `fffb7400` -> **48,000 Hz (48kHz)**.
     - `song_yt_4ujQOR2DMFM.mp3`: offset=45, header `fffb7400` -> **48,000 Hz (48kHz)**.
     - `song_yt_T5xcnjAG8pE.mp3`: offset=45, header `fffb7400` -> **48,000 Hz (48kHz)**.
     - `tts_2f967d976f65da7b.mp3`: offset=0, header `fffb7064` -> **44,100 Hz (44.1kHz)**.
     - `silence_96k.mp3`: offset=0, header `fffb7064` -> **44,100 Hz (44.1kHz)**.
   - Exactly 6 out of 11 cached songs were 48kHz (originating from yt-dlp YouTube archiving without sample rate clamping).
   - 5 songs were already 44.1kHz. This perfectly explained why the issue only happened *"sometime"*.
2. **Mechanism of Audio Burst & Disconnect:**
   - When a 48kHz track plays, the listener's audio decoder (browser, VLC, Highrise client) configures its DAC/audio clock to 48,000 Hz.
   - When an announcement or silence (44.1kHz) arrives:
     - The decoder receives 44.1kHz frames (1152 samples) and renders them at 48kHz, causing a ~9% speedup / pitch-shifted chipmunk burst.
     - Strict decoders reject mid-stream sample rate changes and abort the HTTP connection (`👋 Client left /stream`).
     - The client automatically reconnects (`👤 Client joined /stream`), immediately receiving the instant burst buffer, giving another stuttering burst sensation.
3. **Pacing Lead & Backpressure Bloat:**
   - `streamAnnouncementMp3` used `TARGET_LEAD_MS = 200` while `audioPlayer.js` and `silenceFeed` used 1,000ms, causing lead cushion jitter during speech.
   - `persistentStreamManager.js` allowed stalled listener buffers to accumulate up to 512 KB (43 seconds of audio), flooding reconnecting listeners.

### Resolution Applied
1. **Fleet-Wide Strict 44.1kHz Enforcement:**
   - Updated `audio-server/src/mp3Validator.js` and `main-server/src/mp3Validator.js` to strictly require `sampleRateIdx === 0` (44.1 kHz). Any 48kHz audio is rejected at the validator gate.
   - Central Controller (`main-server/server.js`) automatically detects 48kHz files via `validateMp3FileHeader` and offloads them to Worker/Termux `/transcode` to produce strict 44.1kHz 96kbps CBR Stereo MP3 before caching and streaming.
2. **Monotonic Hrtime Announcement Pacing:**
   - Refactored `streamAnnouncementMp3` in `audio-server/src/persistentStreamManager.js` to use monotonic `process.hrtime.bigint()` with `LEAD_NS = 1_000_000_000n` (1.0s cushion), perfectly matching `audioPlayer` and `silenceFeed`.
3. **Backpressure Hardening:**
   - Reduced stalled client buffer threshold from 512 KB down to 64 KB (~5.4s).
   - Only update `meta.lastSuccessfulWrite` when `client.write()` returns `true` or upon `'drain'`.
4. **YouTube Archiver Resampling:**
   - Added `-ar 44100 -ac 2` to `playlist-archiver/resolver.js` yt-dlp arguments.
5. **Fleet Proactive Cache Repair & Deployment:**
   - Ran `scripts/fix_cached_sample_rates.py` against Central Controller, repairing all 48kHz cached tracks to verified 44.1kHz.
   - Deployed `audio-server` to Room 1 (`00f50ae1`) and Room 2 (`4c1b3907`).
   - Deployed `main-server` to Central Controller (`6a95145f`).

### Empirical Verification
- All cached songs on Central Controller verified `srIdx=0` (44.1kHz).
- New track downloads verified `srIdx=0` (44.1kHz), sync offset: 0.
- Executed live announcement during active song playback (`scripts/test_live_announcement.js`):
  - `LOG: ⏸️ [AudioPlayer] Paused music frame streaming for announcement.`
  - Announcement streamed 88.8 KB in 7.1s smoothly.
  - `LOG: ▶️ [AudioPlayer] Resumed music streaming after announcement (offset adjusted by 6640ms, zero burst).`
  - Active listeners remained connected with **0 disconnects and 0 reconnects**.
