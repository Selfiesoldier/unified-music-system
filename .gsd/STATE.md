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
- **Audio Server 1 (`92.118.206.166:30238`):** Running pure byte relay with 0% CPU, 0 FFmpeg processes.
- **Audio Server 2 (`2.56.246.128:30289`):** Live verified playing *Noor, Khan, Madhurxo - Aarzu (Official Music Video)* with zero rejections (100+ seconds streaming).
- **Central Controller (`2.56.246.119:30195`):** Healthy with 0 child processes, active auto-repair offload to Cloud Worker.
- **Cloud Worker (`92.118.206.201:30229`):** Live verified `/transcode` (POST binary audio -> 96kbps CBR 44.1kHz MP3) in ~1.5s.
- **Termux Residential Bridge:** Live verified `/tts` returning compliant 96kbps CBR MP3.
