# GSD State Tracking

**Milestone:** Milestone 2: Strict 100% FFmpeg-Free Audio Server Fleet  
**Status:** complete ✅  

## Architectural Principle Verified & Enforced
1. **Audio Server 1 & 2 (`00f50ae1`, `4c1b3907`):** 100% FFmpeg-free. Zero `child_process` spawns, zero exec calls. Pure JS 96k CBR byte stream relay only.
2. **Central Controller (`6a95145f`):** 100% FFmpeg-free. Standard Pterodactyl container with `FFmpeg path: null`. Zero `child_process` spawns for audio. Pure routing and state guardian.
3. **Download Worker (`e42d70e7`):** 100% isolated single-thread FFmpeg for JioSaavn / Akamai downloads and arbitrary audio transcoding (`/transcode`).
4. **Termux Residential Bridge (Mobile):** YouTube residential IP bypass AND SOLE producer of speech announcements (`/tts`).
   - **TTS Rule Enforced:** TTS announcements are strictly and solely produced when the Termux residential bridge is active. If the Termux bridge is unavailable or offline, TTS is completely bypassed/skipped (no TTS announcement played, zero delay to song start).
5. **96kbps CBR Audio Specification (44.1kHz & 48kHz):**
   - Both 44.1kHz (`sampleRateIdx === 0`, 313/314 bytes/frame) and 48kHz (`sampleRateIdx === 1`, 288 bytes/frame) stream at the exact same constant byte throughput: **12,000 bytes/sec** (1,200 bytes per 100ms interval).
   - `mp3Validator.js` validates both 44.1kHz and 48kHz 96k CBR MP3 headers natively with zero external dependencies.
   - **Legacy / Unencoded Vault Repair:** If an older song from Telegram Cloud Vault or local SSD cache is detected as non-96k (e.g. legacy 128kbps or M4A), Central Controller offloads it to Cloud Worker's `/transcode` endpoint via POST. Worker transcodes it to 96kbps CBR MP3, Controller caches the repaired file, permanently upgrades the Telegram Cloud Vault entry, and serves it seamlessly.

## Live Production Verification Evidence
- **Audio Server 1 (`92.118.206.166:30238`):** Running pure byte relay with 0.89% CPU, 41 MB RAM, 0 FFmpeg processes. Actively streaming live.
- **Audio Server 2 (`2.56.246.128:30289`):** Running pure byte relay with 0.72% CPU, 30 MB RAM, 0 FFmpeg processes. Gapless silence feed active.
- **Central Controller (`2.56.246.119:30195`):** Healthy with 1.1% CPU, 119 MB RAM, 0 child processes, active auto-repair offload.
- **Highrise Bot Container (`bf9ef46f`):** Running on Node DE-04 with 0.10% CPU, 48 MB RAM, ~13 hours uptime. Autoplay loop active.
- **Cloud Worker (`92.118.206.201:30229`):** Live verified `/transcode` (POST binary audio -> 96kbps CBR 44.1kHz MP3) in ~1.5s.
- **Termux Residential Bridge:** Live verified `/tts` returning compliant 96kbps CBR MP3. Reconnection supervisor & auto-respawn hardened.

## Fleet 24/7 Autoplay Hardening (Complete ✅)
1. **Cache Pruner Immunity:** `pruneSongCache()` protects active songs, queued songs, and `.json` metadata via `getSongCacheKey()` and `yt_<videoId>`.
2. **Atomic Vault Durability:** `telegram_vault.json` writes atomically via `.tmp` and maintains a `.bak` backup with automatic corrupt recovery.
3. **Resilient Bridge Tunneling:** `residential/manager.js` auto-updates registered bridge URL on Cloudflare edge change and restarts dead tunnels in 5s.
4. **MPEG Frame 0 Sync Alignment:** Streams start directly on audio sync word `0xFF 0xFB`, completely skipping ID3v2 headers and padding.
