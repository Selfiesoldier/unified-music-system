# Project: Highrise Music Fleet & Engine

**Status:** FINALIZED  
**Version:** 1.0.0  
**Last Updated:** 2026-11-08  

## Vision
A highly resilient, multi-room, zero-CPU audio streaming infrastructure and automated bot fleet for Highrise Virtual World. Capable of instant playback, resilient YouTube and JioSaavn downloads with residential anti-bot bypass, cold-start instant delivery via Telegram Cloud Vault (L2 CDN), and independent dual-room audio broadcast.

## Problem Statement
Standard cloud server IPs face severe YouTube throttling, bot detection, and geographic blocking. Furthermore, real-time audio transcoding inside Highrise bots consumes massive CPU resources causing disconnections, jitter, and high server costs.

## Core Requirements & Specifications

### 1. Zero-CPU Audio Distribution
- **Target Format:** Strict 96 kbps CBR MP3 (`audio/mpeg`), 44.1 kHz stereo.
- **Streaming Principle:** Audio servers relay pre-encoded byte chunks directly to Highrise bot clients without running FFmpeg during playback.
- **CPU Target:** < 5% CPU usage under active streaming.

### 2. Multi-Room Fleet Architecture
- **Room 1:** Server `00f50ae1` (Port 30238, Node DE-04) — Radio Station `pakmusic`
- **Room 2:** Server `4c1b3907` (Port 30289, Node DE-06) — Radio Station `kmrmusic`
- **Controller:** Server `6a95145f` (Port 30195, Node DE-05) — Central queue, search router, state guardian, and multi-room dashboard.

### 3. Hierarchical Ingestion Pipeline (L1 -> L2 -> L3)
1. **L1 Local SSD Cache:** Stores recent tracks and TTS announcements on fast local disk (capped at 10 songs & 10 TTS files).
2. **L2 Telegram Cloud Vault:** Over 850 indexed audio files backed by Telegram Cloud CDN for 0s download and 0% CPU consumption.
3. **L3 Live Extraction:**
   - **Residential Bridge (Termux):** Routes YouTube requests through a residential Android mobile connection via Cloudflare Tunnel.
   - **Cloud Worker (`e42d70e7`):** Direct Akamai CDN extraction for Indian / Bollywood / Regional music via JioSaavn DES decryptor.

### 4. Fleet Cache Hygiene
- All servers and bridges enforce strict LRU eviction to hold at most **10 songs** and **10 TTS files**.
- Critical system files (`telegram_vault.json`, `playback_state*.json`, `queue_state*.json`) are strictly protected from deletion.

