# Project Roadmap: Highrise Music Fleet & Engine

> **Current Milestone:** Milestone 2: Strict 100% FFmpeg-Free Audio Server Fleet
> **Current Phase:** 7 - Upstream Speech & TTS Normalization Pipeline
> **Status:** ready

---

## Milestone 1: Production Multi-Room Streaming Fleet (Complete ✅)

### Phase 1: Highrise Bot Audio Streaming & 96kbps Zero-CPU Engine
- **Status:** Complete ✅
- **Goal:** Eliminate bot CPU lag by implementing direct CBR 96kbps MP3 stream relays.
- [x] Plan 1.1: Build persistent Icecast/ICY stream manager with burst buffer.
- [x] Plan 1.2: Eliminate real-time ffmpeg transcoding during room playback.
- [x] Plan 1.3: Verify zero CPU spike on Highrise bot container.

### Phase 2: Dual-Room Multi-Controller & Dynamic Routing
- **Status:** Complete ✅
- **Goal:** Provide independent queue, state, and playback management for Room 1 and Room 2.
- [x] Plan 2.1: Implement RoomState model with separate state files in Controller.
- [x] Plan 2.2: Add multi-room tabs and real-time SSE stream events in web UI.
- [x] Plan 2.3: Wire Room 1 (`00f50ae1`) and Room 2 (`4c1b3907`) endpoints.

### Phase 3: Telegram Cloud Vault (L2 Cache) & Residential Bridge
- **Status:** Complete ✅
- **Goal:** Bypass YouTube datacenter IP throttling and enable instant cold-start streaming.
- [x] Plan 3.1: Build Android Termux Residential Bridge with Cloudflare Tunnel.
- [x] Plan 3.2: Implement Telegram Cloud Vault bot caching with direct CDN links.
- [x] Plan 3.3: Index 850+ audio tracks in telegram_vault.json for zero-wait retrieval.

### Phase 4: Direct Dashboard MP3 Upload & Strict Fleet Cache Limits
- **Status:** Complete ✅
- **Goal:** Allow instant local MP3 dashboard uploads and enforce 10-song/10-TTS disk limits.
- [x] Plan 4.1: Build binary MP3 upload API with automatic 96kbps normalization.
- [x] Plan 4.2: Implement drag-and-drop dropzone in Controller dashboard.
- [x] Plan 4.3: Enforce strict 10-song & 10-TTS LRU cache limits across all servers and downloaders.

### Phase 5: Radio-Browser Directory Integration & Verification
- **Status:** Complete ✅
- **Goal:** Publicly register station metadata and verify 24/7 stream uptime.
- [x] Plan 5.1: Configure ICY broadcast headers (`pakmusic` & `kmrmusic`).
- [x] Plan 5.2: Register stations on Radio-Browser community directory.
- [x] Plan 5.3: Set up automated health check and watchdog alerting.

---

## Milestone 2: Strict 100% FFmpeg-Free Audio Server Fleet

### Phase 6: Audio Server FFmpeg Purge & Pure Byte-Stream Engine
- **Status:** Complete ✅
- **Goal:** Completely eliminate all FFmpeg dependencies, binaries, and `child_process` spawns from the audio servers.
- [x] Plan 6.1: Static Pre-Rendered Silence Loop & Embedded Frame Fallback
- [x] Plan 6.2: Audio Server FFmpeg Purge & ffmpegHelper Removal
- [x] Plan 6.3: Strict Byte-Header Rejection for Non-96k MP3 Input

### Phase 7: Upstream Speech & TTS Normalization Pipeline
- **Status:** In Progress 🔄
- **Goal:** Move all audio normalization and speech conversion upstream so Audio Servers only receive pre-verified 96kbps CBR stereo MP3.
- [ ] Plan 7.1: Implement 96k CBR MP3 speech normalization on Central Controller / Download Worker.
- [ ] Plan 7.2: Ensure all TTS announcements are pre-transcoded before invoking Audio Server `/announce`.
- [ ] Plan 7.3: Verify Termux Residential Bridge and Cloud Worker direct 96k MP3 delivery.

### Phase 8: Fleet Deployment & Zero-Process Verification
- **Status:** ⬜ Not Started
- **Goal:** Deploy 100% FFmpeg-free code to all production nodes and verify zero process spawning and 0.0% CPU overhead.
- [ ] Plan 8.1: Update `deploy_audio_servers.py` to remove `ffmpegHelper.js` from deploy manifests.
- [ ] Plan 8.2: Deploy to Audio Server 1 (Room 1) and Audio Server 2 (Room 2).
- [ ] Plan 8.3: Verify process tree on containers (confirm 0 FFmpeg instances, 0 child processes under continuous playback).
