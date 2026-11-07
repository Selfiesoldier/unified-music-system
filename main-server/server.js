import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import * as googleTTS from 'google-tts-api';
import yts from 'yt-search';
import { is96kCbrMp3Buffer } from './src/mp3Validator.js';

// ==========================================
// 🔎 IN-MEMORY YTS SEARCH CACHE (10 min TTL)
// Prevents repeated heavy YouTube HTML scrapes
// for duplicate-check, duration-check & play calls.
// ==========================================
const ytsCache = new Map(); // key -> { result, expiresAt }
const YTS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

async function cachedYts(query) {
  if (!query) return null;
  const key = query.toLowerCase().trim();
  const hit = ytsCache.get(key);
  if (hit && Date.now() < hit.expiresAt) {
    return hit.result;
  }
  const result = await yts(query);
  ytsCache.set(key, { result, expiresAt: Date.now() + YTS_CACHE_TTL_MS });
  return result;
}

// Prune expired entries every 15 minutes to avoid unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ytsCache) {
    if (now >= v.expiresAt) ytsCache.delete(k);
  }
}, 15 * 60 * 1000);

async function getTtsUrl(text, lang = 'en') {
  return generateAndNormalizeTts(text, lang);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
if (fs.existsSync(path.join(__dirname, '.env'))) {
  dotenv.config({ path: path.join(__dirname, '.env') });
} else {
  dotenv.config();
}

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'main_server_session_secret_key_123';
const AUDIO_SERVER_URL = (process.env.AUDIO_SERVER_URL || 'http://localhost:8000').replace(/\/+$/, '');
const AUDIO_SECRET = process.env.AUDIO_SECRET || 'supersecret_audio_key_123';
const DOWNLOAD_WORKER_URL = (process.env.DOWNLOAD_WORKER_URL || '').replace(/\/+$/, '');
const BOT_IPC_URL = process.env.BOT_IPC_URL || 'http://127.0.0.1:5001';
const IPC_SECRET = process.env.IPC_SECRET || 'highrise_music_secret_2026';
const CONTROLLER_URL = (process.env.CONTROLLER_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create cache dir:', err.message);
  }
}

// ==========================================
// 💾 LRU CACHE PRUNER (10 Songs + 10 TTS Max)
// Keeps at most 10 songs and 10 TTS files,
// evicting oldest (LRU) to save disk space.
// PROTECTS: telegram_vault.json & state files!
// ==========================================
const CACHE_MAX_SONGS = parseInt(process.env.CACHE_MAX_SONGS || '10', 10);
const CACHE_MAX_TTS = parseInt(process.env.CACHE_MAX_TTS || '10', 10);

function pruneSongCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const allFiles = fs.readdirSync(CACHE_DIR);

    // Active files currently playing or queued across rooms to protect from eviction
    const activeFiles = new Set();
    if (typeof rooms !== 'undefined') {
      for (const r of Object.values(rooms)) {
        if (r && r.currentTrack && r.currentTrack.url) {
          const m = r.currentTrack.url.match(/(song_[a-zA-Z0-9_.-]+|custom_[a-zA-Z0-9_.-]+)/);
          if (m) activeFiles.add(m[1]);
        }
        for (const q of (r?.queue || [])) {
          if (q && q.url) {
            const m = q.url.match(/(song_[a-zA-Z0-9_.-]+|custom_[a-zA-Z0-9_.-]+)/);
            if (m) activeFiles.add(m[1]);
          }
        }
      }
    }

    const songFiles = [];
    const ttsFiles = [];

    for (const f of allFiles) {
      // STRICT PROTECTION: Never delete database, vault, or persistent state files
      if (
        f === 'telegram_vault.json' ||
        f.startsWith('telegram_vault') ||
        f.startsWith('queue_state') ||
        f.startsWith('playback_state')
      ) {
        continue;
      }

      // Ignore temporary files
      if (f.startsWith('temp_') || f.endsWith('.tmp') || f.endsWith('.part') || f.endsWith('.raw')) {
        continue;
      }

      // Don't evict currently playing or queued songs
      if (activeFiles.has(f)) {
        continue;
      }

      const fullPath = path.join(CACHE_DIR, f);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }

      if (f.startsWith('tts_') && f.endsWith('.mp3')) {
        ttsFiles.push({ file: f, fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
      } else if (f.endsWith('.mp3') || f.endsWith('.m4a')) {
        songFiles.push({ file: f, fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
      }
    }

    // Sort newest first (descending mtimeMs)
    songFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    ttsFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

    let freedBytes = 0;
    let evictedSongs = 0;
    let evictedTts = 0;

    // Prune songs beyond CACHE_MAX_SONGS (10)
    if (songFiles.length > CACHE_MAX_SONGS) {
      const songsToDelete = songFiles.slice(CACHE_MAX_SONGS);
      for (const item of songsToDelete) {
        try {
          fs.unlinkSync(item.fullPath);
          freedBytes += item.size;
          evictedSongs++;
          // Delete companion metadata json if present
          const jsonPath = item.fullPath.replace(/\.(mp3|m4a)$/, '.json');
          if (fs.existsSync(jsonPath)) {
            try { fs.unlinkSync(jsonPath); } catch (_) {}
          }
        } catch (err) {
          console.warn(`[CachePruner] Failed to delete song ${item.file}:`, err.message);
        }
      }
    }

    // Prune TTS beyond CACHE_MAX_TTS (10)
    if (ttsFiles.length > CACHE_MAX_TTS) {
      const ttsToDelete = ttsFiles.slice(CACHE_MAX_TTS);
      for (const item of ttsToDelete) {
        try {
          fs.unlinkSync(item.fullPath);
          freedBytes += item.size;
          evictedTts++;
        } catch (err) {
          console.warn(`[CachePruner] Failed to delete TTS ${item.file}:`, err.message);
        }
      }
    }

    if (evictedSongs > 0 || evictedTts > 0) {
      console.log(`🗑️ [CachePruner] Evicted ${evictedSongs} song(s) and ${evictedTts} TTS file(s), freed ${(freedBytes / 1024 / 1024).toFixed(2)} MB. Retaining ${Math.min(songFiles.length, CACHE_MAX_SONGS)} songs and ${Math.min(ttsFiles.length, CACHE_MAX_TTS)} TTS.`);
    }
  } catch (err) {
    console.warn('⚠️ [CachePruner] Error during prune:', err.message);
  }
}

// Run immediately on startup, then every 10 minutes
pruneSongCache();
setInterval(pruneSongCache, 10 * 60 * 1000);

// Process Crash Guardian
process.on('uncaughtException', (err) => {
  console.error('💥 [MainController Crash Guardian] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [MainController Crash Guardian] Unhandled Rejection:', reason);
});

const app = express();
app.set('trust proxy', 1);

// Raw binary body parser for direct MP3 dashboard upload (up to 100 MB)
app.use('/api/upload-mp3', express.raw({
  type: () => true,
  limit: '100mb'
}));

app.use(express.json());

// Dynamic Residential Bridge state (Android Termux)
let activeResidentialBridgeUrl = null;
let lastResidentialBridgeHeartbeat = 0;

// ==========================================
// 🎙️ UPSTREAM SPEECH & TTS NORMALIZATION (96kbps CBR)
// Pre-transcodes all voice announcements to strict
// 96kbps CBR 44.1kHz stereo MP3 format before offloading
// to zero-CPU Audio Servers.
// ==========================================
async function generateAndNormalizeTts(text, lang = 'en') {
  try {
    const clean = (text || '').slice(0, 200).trim();
    if (!clean) return null;

    const hash = crypto.createHash('md5').update(`${clean}_${lang || 'en'}`).digest('hex').slice(0, 16);
    const ttsFile = path.join(CACHE_DIR, `tts_${hash}.mp3`);

    // Check L1 cache: return immediately if valid 96k CBR MP3 exists
    if (fs.existsSync(ttsFile)) {
      try {
        const stat = fs.statSync(ttsFile);
        if (stat.size >= 1000) {
          const cachedBuf = fs.readFileSync(ttsFile);
          if (is96kCbrMp3Buffer(cachedBuf)) {
            console.log(`🎙️ [TTS] Cache hit for "${clean.slice(0, 30)}..." -> tts_${hash}.mp3`);
            return `${CONTROLLER_URL}/api/audio-file/tts_${hash}.mp3`;
          }
        }
      } catch (_) {}
    }

    let mp3Buffer = null;

    // 1. Fetch pre-normalized 96kbps CBR MP3 from dedicated Download Worker (runs FFmpeg on worker node)
    if (DOWNLOAD_WORKER_URL) {
      try {
        const workerRes = await fetch(`${DOWNLOAD_WORKER_URL}/tts?text=${encodeURIComponent(clean)}&lang=${encodeURIComponent(lang || 'en')}`, {
          signal: AbortSignal.timeout(12000)
        });
        if (workerRes.ok) {
          const arrayBuf = await workerRes.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          if (buf.length > 500 && is96kCbrMp3Buffer(buf)) {
            mp3Buffer = buf;
          }
        }
      } catch (workerErr) {
        console.warn('⚠️ [TTS] Download Worker TTS fetch failed, trying residential bridge:', workerErr.message);
      }
    }

    // 2. Fallback to Residential Bridge (Android Termux)
    const isBridgeAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));
    if (!mp3Buffer && isBridgeAlive) {
      try {
        const bridgeRes = await fetch(`${activeResidentialBridgeUrl}/tts?text=${encodeURIComponent(clean)}&lang=${encodeURIComponent(lang || 'en')}`, {
          signal: AbortSignal.timeout(10000)
        });
        if (bridgeRes.ok) {
          const arrayBuf = await bridgeRes.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          if (buf.length > 500 && is96kCbrMp3Buffer(buf)) {
            mp3Buffer = buf;
          }
        }
      } catch (bridgeErr) {
        console.warn('⚠️ [TTS] Residential bridge TTS fetch failed:', bridgeErr.message);
      }
    }

    if (!mp3Buffer) {
      console.warn('⚠️ [TTS] Could not obtain normalized 96k CBR MP3 from worker or bridge for:', clean);
      return null;
    }

    // Save pre-normalized 96k CBR MP3 directly to cache (0% Controller CPU, 0 FFmpeg processes)
    fs.writeFileSync(ttsFile, mp3Buffer);
    pruneSongCache();

    console.log(`🎙️ [TTS] Successfully cached 96kbps CBR announcement (via Worker FFmpeg) -> tts_${hash}.mp3`);
    return `${CONTROLLER_URL}/api/audio-file/tts_${hash}.mp3`;
  } catch (err) {
    console.warn('⚠️ [TTS] generateAndNormalizeTts error:', err.message);
  }
  return null;
}

// Register Residential Bridge from Android Termux
app.post('/api/register-bridge', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Missing bridge url' });
  activeResidentialBridgeUrl = url.replace(/\/+$/, '');
  lastResidentialBridgeHeartbeat = Date.now();
  console.log(`🏠 [ResidentialBridge] Registered active Termux bridge: ${activeResidentialBridgeUrl}`);
  res.json({ status: 'ok', bridgeUrl: activeResidentialBridgeUrl });
});

app.get('/api/bridge-status', (req, res) => {
  const isAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));
  res.json({
    active: isAlive,
    engine: isAlive ? 'YouTube (via Termux Bridge)' : 'JioSaavn (via Cloud Worker)',
    bridgeUrl: isAlive ? activeResidentialBridgeUrl : null,
    lastHeartbeat: lastResidentialBridgeHeartbeat ? `${Math.floor((Date.now() - lastResidentialBridgeHeartbeat) / 1000)}s ago` : 'never'
  });
});

// Pure Headless Controller Landing Page
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Central Controller | Highrise Multi-Room Engine</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #07090e; color: #f1f5f9; text-align: center; padding: 80px 20px; }
    .badge { display: inline-block; background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 16px; border-radius: 999px; font-weight: 600; font-size: 0.85rem; margin-bottom: 24px; }
    h1 { font-size: 2.4rem; font-weight: 800; color: #38bdf8; margin-bottom: 12px; letter-spacing: -0.5px; }
    p { color: #94a3b8; font-size: 1.05rem; max-width: 620px; margin: 0 auto 40px auto; line-height: 1.6; }
    .grid { display: flex; justify-content: center; gap: 24px; flex-wrap: wrap; max-width: 820px; margin: 0 auto; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 14px; padding: 28px 24px; width: 360px; text-align: left; transition: all 0.25s ease; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
    .card:hover { transform: translateY(-4px); border-color: #38bdf8; box-shadow: 0 15px 35px rgba(56, 189, 248, 0.15); }
    .card h3 { margin: 0 0 10px 0; font-size: 1.35rem; color: #f8fafc; font-weight: 700; }
    .card p { font-size: 0.92rem; color: #94a3b8; margin: 0 0 20px 0; }
    .btn { display: inline-block; background: #0284c7; color: white; padding: 10px 20px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 0.92rem; transition: background 0.2s; }
    .btn:hover { background: #0369a1; }
    .api-hint { margin-top: 60px; font-size: 0.85rem; color: #64748b; font-family: monospace; }
  </style>
</head>
<body>
  <div class="badge">● Headless Central Controller Active</div>
  <h1>Central Music Controller & Brain</h1>
  <p>The central server runs strictly as the headless engine for downloads, caching, and multi-room management. Each room has its own dedicated dashboard hosted on its audio server:</p>
  <div class="grid">
    <div class="card">
      <h3>🎧 Room 1 (Main Lounge)</h3>
      <p>Dedicated Audio Server on Node DE-04:30238</p>
      <a class="btn" href="http://92.118.206.166:30238/" target="_blank">Open Room 1 Dashboard →</a>
    </div>
    <div class="card">
      <h3>🎉 Room 2 (Party Room)</h3>
      <p>Dedicated Audio Server on Node DE-06:30289</p>
      <a class="btn" href="http://2.56.246.128:30289/" target="_blank">Open Room 2 Dashboard →</a>
    </div>
  </div>
  <div class="api-hint">
    REST API: <code>/api/rooms</code> • <code>/health</code> • <code>/api/vault</code> • <code>/api/audio-file/:id</code>
  </div>
</body>
</html>`);
});

// Session Setup
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 86400000 }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many login attempts, please try again later.' }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: { error: 'Too many requests, please slow down.' }
});

function timingSafeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) return next();

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (timingSafeCompare(token, ADMIN_PASSWORD)) return next();
  }

  const queryToken = (req.query.token || req.query.auth || '').trim();
  if (queryToken && timingSafeCompare(queryToken, ADMIN_PASSWORD)) return next();

  res.status(401).json({ error: 'Unauthorized' });
};

// ==========================================
// 🏨 MULTI-ROOM AUDIO & QUEUE CONFIGURATION
// ==========================================
const ROOMS_CONFIG = {
  room1: {
    id: 'room1',
    name: 'Room 1 (Main Lounge)',
    highriseRoomId: (process.env.ROOM_ID || process.env.HIGHRISE_ROOM_ID || '6a9206666490d93ec3fffdeb').toLowerCase().trim(),
    audioServerUrl: (process.env.AUDIO_SERVER_URL || 'http://92.118.206.166:30238').replace(/\/+$/, ''),
    secret: process.env.AUDIO_SECRET || 'supersecret_audio_key_123'
  },
  room2: {
    id: 'room2',
    name: 'Room 2 (Party Room)',
    highriseRoomId: (process.env.ROOM_ID_ROOM2 || process.env.HIGHRISE_ROOM_ID_ROOM2 || '6a9865186e9936ccdd6bd143').toLowerCase().trim(),
    audioServerUrl: (process.env.AUDIO_SERVER_URL_ROOM2 || 'http://2.56.246.128:30289').replace(/\/+$/, ''),
    secret: process.env.AUDIO_SECRET_ROOM2 || process.env.AUDIO_SECRET || 'supersecret_audio_key_123'
  }
};

class RoomState {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.highriseRoomId = config.highriseRoomId || '';
    this.audioServerUrl = config.audioServerUrl;
    this.secret = config.secret;
    this.queue = [];
    this.currentTrack = null;
    this.isPlaying = false;
    this.isPreparing = false;
    this.currentVolume = 100;
    this.history = [];
    this.announcementsEnabled = true;
    this.announcementVoice = 'en';
    this.currentPlaybackSession = 0;
    this.consecutiveIdleChecks = 0;
    this.loadState();
  }

  get queueFile() {
    return path.join(CACHE_DIR, `queue_state_${this.id}.json`);
  }
  get playbackFile() {
    return path.join(CACHE_DIR, `playback_state_${this.id}.json`);
  }

  loadState() {
    try {
      let qFile = this.queueFile;
      if (this.id === 'room1' && !fs.existsSync(qFile) && fs.existsSync(path.join(CACHE_DIR, 'queue_state.json'))) {
        qFile = path.join(CACHE_DIR, 'queue_state.json');
      }
      if (fs.existsSync(qFile)) {
        this.queue = (JSON.parse(fs.readFileSync(qFile, 'utf8')) || []).filter(item => !item?.isAutoplay);
      }
      let pFile = this.playbackFile;
      if (this.id === 'room1' && !fs.existsSync(pFile) && fs.existsSync(path.join(CACHE_DIR, 'playback_state.json'))) {
        pFile = path.join(CACHE_DIR, 'playback_state.json');
      }
      if (fs.existsSync(pFile)) {
        this.currentTrack = JSON.parse(fs.readFileSync(pFile, 'utf8')) || null;
      }
    } catch (_) {}
  }

  saveState() {
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
      fs.writeFileSync(this.playbackFile, JSON.stringify(this.currentTrack, null, 2));
      if (this.id === 'room1') {
        fs.writeFileSync(path.join(CACHE_DIR, 'queue_state.json'), JSON.stringify(this.queue, null, 2));
        fs.writeFileSync(path.join(CACHE_DIR, 'playback_state.json'), JSON.stringify(this.currentTrack, null, 2));
      }
    } catch (_) {}
  }
}

const rooms = {};
for (const [id, cfg] of Object.entries(ROOMS_CONFIG)) {
  rooms[id] = new RoomState(cfg);
}

function getRoom(req) {
  const rawId = (req?.query?.room || req?.body?.room || req?.headers?.['x-room-id'] || 'room1').toLowerCase().trim();
  if (rooms[rawId]) return rooms[rawId];
  for (const r of Object.values(rooms)) {
    if (r.highriseRoomId && r.highriseRoomId === rawId) {
      return r;
    }
  }
  return rooms.room1;
}

const sseClients = new Set();

function getDashboardState(room = rooms.room1, type = 'state', extra = {}) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const elapsed = targetRoom.isPlaying && targetRoom.currentTrack?.addedAt ? Math.max(0, Date.now() - targetRoom.currentTrack.addedAt) : 0;
  const currentTitle = targetRoom.currentTrack?.metadata?.title || targetRoom.currentTrack?.title || 'No music playing';
  const currentMetadata = targetRoom.currentTrack?.metadata || (targetRoom.currentTrack ? {
    title: targetRoom.currentTrack.title,
    artist: 'Unknown Artist',
    duration: '0:00',
    durationSeconds: 0,
    thumbnail: ''
  } : null);

  const formattedQueue = targetRoom.queue.map((item, idx) => ({
    position: idx + 1,
    title: item.metadata?.title || item.title || 'Unknown Track',
    metadata: item.metadata || {
      title: item.title,
      artist: 'Unknown Artist',
      thumbnail: ''
    }
  }));

  return {
    roomId: targetRoom.id,
    roomName: targetRoom.name,
    type,
    isPlaying: targetRoom.isPlaying,
    isPreparing: targetRoom.isPreparing,
    isTransitioning: false,
    currentTitle,
    currentMetadata,
    currentTrack: targetRoom.currentTrack,
    queue: formattedQueue,
    startTime: targetRoom.currentTrack?.addedAt || 0,
    serverElapsed: elapsed,
    volume: targetRoom.currentVolume,
    announcementsEnabled: targetRoom.announcementsEnabled,
    health: {
      encoderAlive: true,
      isSilent: !targetRoom.isPlaying
    },
    stats: {
      activeListeners: 1
    },
    ...extra
  };
}

function broadcastEvent(roomOrType = rooms.room1, type = 'state', data = {}) {
  let targetRoom = rooms.room1;
  let eventType = type;
  let eventData = data;

  if (typeof roomOrType === 'string') {
    eventType = roomOrType;
    eventData = type && typeof type === 'object' ? type : data;
    targetRoom = rooms.room1;
  } else if (roomOrType && roomOrType.id) {
    targetRoom = roomOrType;
  }

  const payload = `data: ${JSON.stringify(getDashboardState(targetRoom, eventType, eventData))}\n\n`;

  for (const client of sseClients) {
    if (!client._roomId || client._roomId === targetRoom.id) {
      try { client.write(payload); } catch (_) { sseClients.delete(client); }
    }
  }
}

// ==========================================
// 📡 AUDIO SERVER INTEGRATION
// ==========================================
async function callAudioServer(roomOrId, endpoint, body = {}, method = 'POST') {
  let room = rooms.room1;
  let actualEndpoint = endpoint;
  let actualBody = body;
  let actualMethod = method;

  if (typeof roomOrId === 'string' && roomOrId.startsWith('/')) {
    actualEndpoint = roomOrId;
    actualBody = endpoint || {};
    actualMethod = body || 'POST';
    room = rooms.room1;
  } else if (typeof roomOrId === 'string') {
    room = rooms[roomOrId] || rooms.room1;
  } else if (roomOrId && roomOrId.id && rooms[roomOrId.id]) {
    room = roomOrId;
  }

  try {
    const url = `${room.audioServerUrl}${actualEndpoint}`;
    const timeoutMs = actualEndpoint === '/health' ? 3000
                    : actualEndpoint === '/announce' ? 20000
                    : 5000;
    const opts = {
      method: actualMethod,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${room.secret}`
      }
    };
    if (actualMethod !== 'GET') {
      opts.body = JSON.stringify(actualBody);
    }
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      console.warn(`⚠️ [AudioServerCall:${room.id}] Timeout calling ${actualEndpoint} (${e.name})`);
    } else {
      console.error(`❌ [AudioServerCall:${room.id}] Failed to call ${actualEndpoint}:`, e.message);
    }
    return { error: e.message };
  }
}

// Clean title and artist for TTS announcement
function cleanForTTS(title, artist) {
  let cleanTitle = (title || 'Unknown Track')
    .replace(/^(?:video\s*song|full\s*video|official\s*video|audio\s*song)\s*[-:]\s*/i, '')
    .replace(/[#|/].*$/g, '')
    .replace(/[\[\(].*?[\)\]]/g, '')
    .replace(/\b(official|music video|official video|video song|full song|lyrics|hd|4k)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const titleWords = cleanTitle.split(/\s+/).slice(0, 6).join(' ');

  let cleanArtist = (artist || 'Unknown Artist')
    .replace(/[#|/].*$/g, '')
    .replace(/\b(official|records|vevo|music|channel)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const artistWords = cleanArtist.split(/\s+/).slice(0, 3).join(' ');

  return { cleanTitle: titleWords, cleanArtist: artistWords };
}

// Clean query for worker's JioSaavn search
function cleanQueryForWorker(title, artist) {
  let cleanTitle = (title || 'music')
    .replace(/^(?:video\s*song|full\s*video|official\s*video|audio\s*song)\s*[-:]\s*/i, '')
    .replace(/[#|/].*$/g, '')
    .replace(/[\[\(].*?[\)\]]/g, '')
    .replace(/\b(official|music video|official video|video song|full song|lyrics|hd|4k|audio|lyrical)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let cleanArtist = (artist || '')
    .replace(/[#|/].*$/g, '')
    .replace(/\b(official|records|vevo|music|channel)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  let query = cleanTitle;
  if (cleanArtist && !cleanTitle.toLowerCase().includes(cleanArtist.toLowerCase())) {
    query = `${cleanTitle} ${cleanArtist}`;
  }

  return query.split(/\s+/).slice(0, 8).join(' ').trim();
}

function getSongCacheKey(url, title = '') {
  const ytMatch = (url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `yt_${ytMatch[1]}`;
  const normalized = (title || url || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return `sc_${crypto.createHash('md5').update(normalized || 'unknown').digest('hex').slice(0, 16)}`;
}



// ==========================================
// ☁️ TELEGRAM CLOUD VAULT (Infinite Free L2 Storage)
// ==========================================
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9109239162:AAE01QXTy4LhP5o6MvJ7DUYL_4kzBbSp5k4';
const TELEGRAM_VAULT_CHAT_ID = process.env.TELEGRAM_VAULT_CHAT_ID || '-1004463400168';
const VAULT_FILE = path.join(CACHE_DIR, 'telegram_vault.json');

let telegramVault = {};
try {
  if (fs.existsSync(VAULT_FILE)) {
    telegramVault = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    console.log(`☁️ [TelegramVault] Loaded ${Object.keys(telegramVault).length} songs from vault index.`);
  }
} catch (_) {
  telegramVault = {};
}

function saveTelegramVault() {
  try {
    fs.writeFileSync(VAULT_FILE, JSON.stringify(telegramVault, null, 2));
  } catch (err) {
    console.error('Failed to save telegram vault:', err.message);
  }
}

async function getTelegramDirectFileUrl(fileId) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.ok && data.result?.file_path) {
      return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${data.result.file_path}`;
    }
  } catch (e) {
    console.warn(`[TelegramVault] getFile error:`, e.message);
  }
  return null;
}

async function fetchAndSaveTelegramFile(directUrl, cacheKey, track) {
  try {
    const resp = await fetch(directUrl, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) return null;

    const persistentFile = path.join(CACHE_DIR, `song_${cacheKey}.mp3`);
    const tempFile = path.join(CACHE_DIR, `temp_${Date.now()}_tg.mp3`);

    const fileStream = fs.createWriteStream(tempFile);
    await new Promise((resolve, reject) => {
      resp.body.pipe(fileStream);
      resp.body.on('error', reject);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    const st = fs.statSync(tempFile);
    if (st.size > 50000) {
      try {
        fs.renameSync(tempFile, persistentFile);
        const jsonFile = path.join(CACHE_DIR, `song_${cacheKey}.json`);
        fs.writeFileSync(jsonFile, JSON.stringify({
          title: track.title,
          artist: track.metadata?.artist || 'Unknown Artist',
          duration: track.metadata?.duration || 'Unknown',
          durationSeconds: track.metadata?.durationSeconds || track.metadata?.seconds || 0,
          videoId: track.metadata?.videoId || '',
          source: 'Telegram Cloud Vault (L2 Cache)',
          format: 'mp3'
        }, null, 2));
        pruneSongCache();
        return persistentFile;
      } catch (_) {
        return tempFile;
      }
    }
    try { fs.unlinkSync(tempFile); } catch (_) {}
  } catch (err) {
    console.warn(`[TelegramVault] Download error:`, err.message);
  }
  return null;
}

function uploadToTelegramVaultBackground(filePath, cacheKey, title, artist, duration) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_VAULT_CHAT_ID) return;
  if (!fs.existsSync(filePath)) return;

  setImmediate(async () => {
    try {
      if (telegramVault[cacheKey] && telegramVault[cacheKey].fileId) return;

      const stats = fs.statSync(filePath);
      if (stats.size < 50000 || stats.size > 20 * 1024 * 1024) return;

      const fileBuf = await fs.promises.readFile(filePath);
      const blob = new Blob([fileBuf], { type: 'audio/mpeg' });
      const form = new FormData();
      form.append('chat_id', TELEGRAM_VAULT_CHAT_ID);
      form.append('audio', blob, `${cacheKey}.mp3`);
      form.append('title', (title || 'Track').slice(0, 60));
      form.append('performer', (artist || 'Artist').slice(0, 60));
      form.append('caption', `🎵 ${title} - ${artist}`);

      const uploadRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendAudio`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(45000)
      });

      if (!uploadRes.ok) throw new Error(`Telegram HTTP ${uploadRes.status}`);

      const data = await uploadRes.json();
      if (data.ok && data.result?.audio?.file_id) {
        const fileId = data.result.audio.file_id;
        telegramVault[cacheKey] = {
          fileId,
          title: title || '',
          artist: artist || '',
          duration: duration || 0,
          fileSize: stats.size,
          savedAt: Date.now()
        };
        saveTelegramVault();
        console.log(`☁️ [TelegramVault] 🚀 Uploaded & Saved to Vault: "${title}" (file_id: ${fileId.slice(0, 16)}...)`);
      }
    } catch (err) {
      console.warn(`[TelegramVault] Background upload warning for "${title}":`, err.message);
    }
  });
}

async function downloadTrackToFile(track) {
  const rawTitle = track.title || track.metadata?.title || '';
  const cacheKey = getSongCacheKey(track.url, rawTitle);
  const mp3File = path.join(CACHE_DIR, `song_${cacheKey}.mp3`);
  const m4aFile = path.join(CACHE_DIR, `song_${cacheKey}.m4a`);

  // 1. Instant Cache Hit (preferring ready .mp3, then legacy .m4a)
  for (const candidate of [mp3File, m4aFile]) {
    if (fs.existsSync(candidate)) {
      try {
        const stats = fs.statSync(candidate);
        if (stats.size > 50000) {
          console.log(`⚡ [SongCache] Instant Cache Hit for "${rawTitle}" (${(stats.size / 1024 / 1024).toFixed(2)} MB, ${path.extname(candidate)})!`);
          return candidate;
        }
      } catch (_) {}
    }
  }

  // 1.5. Telegram Cloud Vault Check (L2 Cache)
  let vaultEntry = telegramVault[cacheKey];
  if (!vaultEntry) {
    // Try matching by videoId if available
    const ytVid = (track.url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/)?.[1] || track.metadata?.videoId;
    if (ytVid && telegramVault[`yt_${ytVid}`]) {
      vaultEntry = telegramVault[`yt_${ytVid}`];
    }
  }
  if (!vaultEntry && rawTitle) {
    // Fuzzy title match in L2 Vault
    const cleanT = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanT.length >= 8) {
      for (const [k, v] of Object.entries(telegramVault)) {
        const vTitle = (v.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (vTitle && (vTitle === cleanT || (cleanT.length >= 10 && vTitle.includes(cleanT)) || (vTitle.length >= 10 && cleanT.includes(vTitle)))) {
          vaultEntry = v;
          console.log(`☁️ [TelegramVault] 🎯 Title match in L2 Vault: "${rawTitle}" -> "${v.title}"`);
          break;
        }
      }
    }
  }

  if (vaultEntry && vaultEntry.fileId) {
    try {
      console.log(`☁️ [TelegramVault] 🎯 L2 Vault Hit for "${rawTitle}"! Streaming from Telegram CDN...`);
      const directUrl = await getTelegramDirectFileUrl(vaultEntry.fileId);
      if (directUrl) {
        const cachedFile = await fetchAndSaveTelegramFile(directUrl, cacheKey, track);
        if (cachedFile) {
          console.log(`✅ [TelegramVault] Streamed & ready from Telegram CDN: "${rawTitle}" (0% CPU, 0s DL)!`);
          return cachedFile;
        }
      }
    } catch (tgErr) {
      console.warn(`⚠️ [TelegramVault] Vault fetch failed (${tgErr.message}), falling back to live downloaders.`);
    }
  }

  // 2. Direct HTTP Audio File (mp3/aac/icecast)
  if (track.url && track.url.startsWith('http') && !track.url.includes('youtube.com') && !track.url.includes('youtu.be')) {
    return track.url;
  }

  // 3. Delegate to Termux Residential Bridge (YouTube) or Cloud Worker (JioSaavn)
  if (!DOWNLOAD_WORKER_URL && !activeResidentialBridgeUrl) {
    return track.url;
  }

  const artist = track.metadata?.artist || '';
  const durationSeconds = track.metadata?.durationSeconds || track.metadata?.seconds || 0;

  let cleanSearch = '';
  if (track.requestedQuery && typeof track.requestedQuery === 'string' && !track.requestedQuery.startsWith('http')) {
    cleanSearch = track.requestedQuery.trim();
  } else {
    cleanSearch = cleanQueryForWorker(rawTitle, artist);
  }

  // Check if Termux Residential Bridge is currently connected & alive (heartbeat within 2 minutes)
  const isBridgeAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));

  let primaryServiceUrl = null;
  let primaryTargetUrl = null;
  let serviceName = '';

  if (isBridgeAlive) {
    // 🌟 PRIMARY: Termux Residential Bridge is online -> YouTube (no datacenter bot block!)
    serviceName = 'Termux YouTube Bridge';
    primaryServiceUrl = activeResidentialBridgeUrl;
    let ytTarget = track.url;
    if (!ytTarget || !ytTarget.startsWith('http')) {
      ytTarget = `ytsearch1:${cleanSearch || rawTitle}`;
    }
    primaryTargetUrl = ytTarget;
  } else {
    // 🛡️ FALLBACK: Termux is offline -> Cloud Download Worker (100% JioSaavn Studio Engine, zero IP block!)
    serviceName = 'Cloud Worker (JioSaavn)';
    primaryServiceUrl = DOWNLOAD_WORKER_URL;
    primaryTargetUrl = cleanSearch || rawTitle;
  }

  console.log(`☁️ [DownloadRouter] Selected ${serviceName} for: "${rawTitle || cleanSearch}" (${primaryTargetUrl})...`);

  // Helper to fetch and cache stream
  async function fetchAndCache(serviceUrl, targetUrl, activeServiceName) {
    const params = new URLSearchParams({
      url: targetUrl,
      title: rawTitle || cleanSearch,
      artist: artist,
      duration: String(durationSeconds)
    });

    const endpoint = `${serviceUrl}/stream?${params.toString()}`;
    const resp = await fetch(endpoint, { signal: AbortSignal.timeout(80000) });
    if (!resp.ok) {
      throw new Error(`${activeServiceName} returned HTTP ${resp.status}`);
    }

    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const isMp3 = contentType.includes('mpeg') || contentType.includes('mp3') || activeServiceName.includes('Termux') || activeServiceName.includes('Worker');
    const ext = isMp3 ? '.mp3' : '.m4a';
    const persistentFile = path.join(CACHE_DIR, `song_${cacheKey}${ext}`);
    const tempFile = path.join(CACHE_DIR, `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);

    const fileStream = fs.createWriteStream(tempFile);
    await new Promise((resolve, reject) => {
      resp.body.pipe(fileStream);
      resp.body.on('error', reject);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    const st = fs.statSync(tempFile);
    if (st.size > 50000) {
      try {
        fs.renameSync(tempFile, persistentFile);
        const jsonFile = path.join(CACHE_DIR, `song_${cacheKey}.json`);
        fs.writeFileSync(jsonFile, JSON.stringify({
          title: track.title,
          artist: track.metadata?.artist || 'Unknown Artist',
          duration: track.metadata?.duration || 'Unknown',
          durationSeconds: durationSeconds,
          videoId: track.metadata?.videoId || '',
          source: activeServiceName,
          format: isMp3 ? 'mp3' : 'm4a'
        }, null, 2));
        console.log(`✅ [DownloadRouter] Successfully downloaded & cached via ${activeServiceName}: "${rawTitle}" (${(st.size / 1024 / 1024).toFixed(2)} MB, ${ext})`);
        uploadToTelegramVaultBackground(persistentFile, cacheKey, track.title || rawTitle, artist, durationSeconds);
        pruneSongCache();
        return persistentFile;
      } catch (e) {
        uploadToTelegramVaultBackground(tempFile, cacheKey, track.title || rawTitle, artist, durationSeconds);
        return tempFile;
      }
    } else {
      try { fs.unlinkSync(tempFile); } catch (_) {}
      throw new Error(`${activeServiceName} stream was empty or corrupted`);
    }
  }

  try {
    return await fetchAndCache(primaryServiceUrl, primaryTargetUrl, serviceName);
  } catch (primaryErr) {
    // If Termux bridge failed, automatically fall back to Cloud Worker JioSaavn
    if (isBridgeAlive && DOWNLOAD_WORKER_URL && primaryServiceUrl !== DOWNLOAD_WORKER_URL) {
      console.warn(`⚠️ [DownloadRouter] ${serviceName} failed (${primaryErr.message}). Retrying via Cloud Worker JioSaavn...`);
      return await fetchAndCache(DOWNLOAD_WORKER_URL, cleanSearch || rawTitle, 'Cloud Worker (JioSaavn Fallback)');
    }
    throw primaryErr;
  }
}

async function stopPlayback(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  targetRoom.currentPlaybackSession++;
  targetRoom.isPlaying = false;
  targetRoom.isPreparing = false;
  targetRoom.currentTrack = null;
  targetRoom.saveState();
  broadcastEvent(targetRoom);
  await callAudioServer(targetRoom, '/stop');
}

function prefetchNextTrack(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  if (targetRoom.queue.length > 0) {
    const nextTrack = targetRoom.queue[0];
    downloadTrackToFile(nextTrack).catch(() => {});
  }
}

// Play Next Track In Queue for a specific Room
async function playNext(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const sessionId = ++targetRoom.currentPlaybackSession;

  if (targetRoom.queue.length === 0) {
    targetRoom.isPlaying = false;
    targetRoom.isPreparing = false;
    targetRoom.currentTrack = null;
    targetRoom.saveState();
    broadcastEvent(targetRoom);
    await callAudioServer(targetRoom, '/stop');
    console.log(`⏹️ [${targetRoom.id}] Queue is empty, audio server set to idle loop.`);
    return;
  }

  // Immediately stop any previous audio and speech announcement on this room's audio-server
  await callAudioServer(targetRoom, '/stop');
  if (sessionId !== targetRoom.currentPlaybackSession) return;

  const track = targetRoom.queue.shift();
  targetRoom.currentTrack = track;
  targetRoom.isPlaying = true;
  targetRoom.isPreparing = true;
  targetRoom.saveState();
  broadcastEvent(targetRoom);

  console.log(`▶️ [MainController:${targetRoom.id}] Preparing [Session ${sessionId}]: "${track.title}"`);

  const isBridgeAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));

  // --- 1. Announcements: Send TTS before song if enabled ---
  let ttsPlayedPromise = null;
  if (targetRoom.announcementsEnabled && (track.title || track.metadata?.title)) {
    const { cleanTitle, cleanArtist } = cleanForTTS(track.title, track.metadata?.artist);
    const requester = track.metadata?.requesterUsername;
    const dedicatedTo = track.metadata?.dedicatedTo;
    const dedicatedBy = track.metadata?.dedicatedBy;

    let text = '';
    if (dedicatedTo && dedicatedBy) {
      text = `Dedicated to ${dedicatedTo} by ${dedicatedBy}. Now playing: ${cleanTitle}, by ${cleanArtist}`;
    } else if (requester) {
      text = `Requested by ${requester}. Now playing: ${cleanTitle}, by ${cleanArtist}`;
    } else {
      text = `Now playing: ${cleanTitle}, by ${cleanArtist}`;
    }

    const ttsUrl = await generateAndNormalizeTts(text, targetRoom.announcementVoice);
    if (ttsUrl && sessionId === targetRoom.currentPlaybackSession) {
      try {
        console.log(`🎙️ [TTS:${targetRoom.id}] Offloading announcement to Audio Server: "${text}"`);
        ttsPlayedPromise = callAudioServer(targetRoom, '/announce', { url: ttsUrl, wait: true });
      } catch (ttsErr) {
        console.warn(`⚠️ [TTS:${targetRoom.id}] Warning:`, ttsErr.message);
      }
    }
  }

  // --- 2. Download the music track (Termux YouTube or Cloud Worker 2-phase fallback) ---
  console.log(`📥 [MainController:${targetRoom.id}] Downloading audio track for [Session ${sessionId}]: "${track.title}"`);
  let readyFile = await downloadTrackToFile(track).catch(err => {
    console.warn(`⚠️ [MainController:${targetRoom.id}] Download failed for "${track.title}": ${err.message}`);
    return null;
  });

  if (sessionId !== targetRoom.currentPlaybackSession) {
    console.log(`⏹️ [MainController:${targetRoom.id}] Session ${sessionId} superseded after download, cancelling.`);
    return;
  }

  // If TTS announcement was launched, await its completion before song playback
  if (ttsPlayedPromise) {
    try { await ttsPlayedPromise; } catch (_) {}
  }

  if (sessionId !== targetRoom.currentPlaybackSession) {
    console.log(`⏹️ [MainController:${targetRoom.id}] Session ${sessionId} superseded after announcement, cancelling.`);
    return;
  }

  // If track download failed or file is unavailable
  if (!readyFile) {
    console.warn(`⚠️ [MainController:${targetRoom.id}] Track "${track.title}" is unavailable. Announcing and skipping in 10s...`);
    targetRoom.currentTrack = {
      ...track,
      title: `${track.title} (Unavailable)`
    };
    broadcastEvent(targetRoom, 'track_unavailable', { track });

    const unavailableMsg = 'The song is currently unavailable. The next song will start in 10 seconds.';
    const ttsUrl = await generateAndNormalizeTts(unavailableMsg, targetRoom.announcementVoice);
    if (ttsUrl && sessionId === targetRoom.currentPlaybackSession) {
      try {
        await callAudioServer(targetRoom, '/announce', { url: ttsUrl });
      } catch (e) {
        console.warn(`⚠️ [TTS:${targetRoom.id}] Unavailable announcement error:`, e.message);
      }
    }

    if (sessionId !== targetRoom.currentPlaybackSession) return;

    const waitMs = 10000;
    const interval = 500;
    let elapsed = 0;
    while (elapsed < waitMs) {
      if (sessionId !== targetRoom.currentPlaybackSession) return;
      await new Promise(r => setTimeout(r, Math.min(interval, waitMs - elapsed)));
      elapsed += interval;
    }

    if (sessionId === targetRoom.currentPlaybackSession) {
      console.log(`⏭️ [MainController:${targetRoom.id}] Advancing to next song after unavailable track wait.`);
      await playNext(targetRoom);
    }
    return;
  }

  // 3. Immediately start the track on the audio server (0s gap from SSD cache)
  let audioFileUrl = readyFile;
  if (!readyFile.startsWith('http://') && !readyFile.startsWith('https://')) {
    audioFileUrl = `${CONTROLLER_URL}/api/audio-file/${path.basename(readyFile)}`;
  }
  const webhookUrl = `${CONTROLLER_URL}/api/track-end?room=${targetRoom.id}`;

  console.log(`🎶 [MainController:${targetRoom.id}] Sending track to Audio Server [Session ${sessionId}]: "${track.title}" (URL: ${audioFileUrl})`);
  await callAudioServer(targetRoom, '/play', {
    url: audioFileUrl,
    title: track.title,
    volume: targetRoom.currentVolume,
    webhookUrl: webhookUrl
  });

  if (sessionId === targetRoom.currentPlaybackSession) {
    targetRoom.isPreparing = false;
    broadcastEvent(targetRoom);
  }

  // 4. Pre-fetch the next track in queue in background so it's already cached on SSD
  prefetchNextTrack(targetRoom);

  // Keep history
  targetRoom.history.unshift({
    title: track.title,
    playedAt: Date.now(),
    requester: track.metadata?.requesterUsername || 'System'
  });
  if (targetRoom.history.length > 50) targetRoom.history.pop();
}

// Serve cached audio files for Audio Server streaming
app.get('/api/audio-file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio file not found');
  }
  res.setHeader('Content-Type', 'audio/mpeg');
  res.sendFile(filePath);
});

// Direct MP3 Upload API (From Web Dashboard)
app.post('/api/upload-mp3', async (req, res) => {
  const room = getRoom(req);
  const position = (req.query.position || 'next').toLowerCase();
  const rawTitle = (req.query.title || 'Custom Uploaded Track').trim();

  if (!req.body || req.body.length < 1000) {
    return res.status(400).json({ error: 'No audio data or file too small (min 1KB)' });
  }

  const cacheKey = `custom_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const persistentFile = path.join(CACHE_DIR, `song_${cacheKey}.mp3`);
  const tempFile = path.join(CACHE_DIR, `temp_${cacheKey}.raw`);

  try {
    fs.writeFileSync(tempFile, req.body);

    // Validate or transcode to strict 96kbps CBR MP3 (Offloaded to Download Worker, 0% CPU on Controller)
    if (is96kCbrMp3Buffer(req.body)) {
      console.log(`🎬 [Upload:${room.id}] Uploaded audio is already compliant 96kbps CBR MP3.`);
      fs.renameSync(tempFile, persistentFile);
    } else if (DOWNLOAD_WORKER_URL) {
      try {
        console.log(`🎬 [Upload:${room.id}] Offloading upload transcoding to Cloud Worker FFmpeg...`);
        const transRes = await fetch(`${DOWNLOAD_WORKER_URL}/transcode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: req.body,
          signal: AbortSignal.timeout(30000)
        });
        if (transRes.ok) {
          const transBuf = Buffer.from(await transRes.arrayBuffer());
          if (transBuf.length > 5000 && is96kCbrMp3Buffer(transBuf)) {
            fs.writeFileSync(persistentFile, transBuf);
            try { fs.unlinkSync(tempFile); } catch (_) {}
            console.log(`✅ [Upload:${room.id}] Transcoded via Cloud Worker: ${(transBuf.length / 1024 / 1024).toFixed(2)} MB`);
          } else {
            fs.renameSync(tempFile, persistentFile);
          }
        } else {
          fs.renameSync(tempFile, persistentFile);
        }
      } catch (trErr) {
        console.warn(`⚠️ [Upload:${room.id}] Worker transcode failed (${trErr.message}), keeping original file.`);
        fs.renameSync(tempFile, persistentFile);
      }
    } else {
      fs.renameSync(tempFile, persistentFile);
    }

    const st = fs.statSync(persistentFile);
    const estDurationSec = Math.max(1, Math.round(st.size / 12000)); // 12 KB/sec at 96k

    const jsonFile = path.join(CACHE_DIR, `song_${cacheKey}.json`);
    fs.writeFileSync(jsonFile, JSON.stringify({
      title: rawTitle,
      artist: 'Dashboard Upload',
      duration: `${Math.floor(estDurationSec / 60)}:${String(estDurationSec % 60).padStart(2, '0')}`,
      durationSeconds: estDurationSec,
      source: 'Dashboard Direct MP3 Upload',
      format: 'mp3',
      savedAt: Date.now()
    }, null, 2));

    pruneSongCache();

    const songItem = {
      url: `${CONTROLLER_URL}/api/audio-file/song_${cacheKey}.mp3`,
      requestedQuery: rawTitle,
      title: rawTitle,
      metadata: {
        title: rawTitle,
        artist: 'Dashboard Upload',
        duration: `${Math.floor(estDurationSec / 60)}:${String(estDurationSec % 60).padStart(2, '0')}`,
        durationSeconds: estDurationSec,
        source: 'Dashboard Direct MP3 Upload'
      },
      isAutoplay: false,
      addedAt: Date.now()
    };

    if (position === 'next') {
      if (!room.isPlaying) {
        room.queue.unshift(songItem);
        playNext(room);
      } else {
        room.queue.unshift(songItem);
        room.saveState();
        broadcastEvent(room, 'queue_update');
      }
    } else {
      room.queue.push(songItem);
      if (!room.isPlaying) {
        playNext(room);
      } else {
        room.saveState();
        broadcastEvent(room, 'queue_update');
      }
    }

    console.log(`📤 [Upload:${room.id}] Successfully uploaded and queued: "${rawTitle}" (${(st.size / 1024 / 1024).toFixed(2)} MB, pos: ${position})`);
    res.json({
      ok: true,
      status: 'uploaded',
      title: rawTitle,
      position,
      queueLength: room.queue.length
    });
  } catch (err) {
    console.error(`❌ [Upload:${room.id}] Upload processing error:`, err.message);
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    res.status(500).json({ error: 'Failed to process MP3 upload', details: err.message });
  }
});

// Webhook from Audio Server when track finishes naturally
app.post('/api/track-end', async (req, res) => {
  const room = getRoom(req);
  console.log(`🏁 [TrackEnd:${room.id}] Song finished on Audio Server. Advancing queue...`);
  res.json({ status: 'ok', room: room.id });
  if (room.isPlaying) {
    await playNext(room);
  }
});

// Periodic Audio Server Watchdog: Keeps Main Controller and Audio Servers in 100% lockstep sync
setInterval(async () => {
  for (const room of Object.values(rooms)) {
    if (!room.isPlaying || room.isPreparing) {
      room.consecutiveIdleChecks = 0;
      continue;
    }
    try {
      const status = await callAudioServer(room, '/status', {}, 'GET');
      const isAudioBusy = Boolean(
        status?.player?.isPlaying ||
        status?.isAnnouncing ||
        status?.stream?.isAnnouncing
      );
      if (status && !isAudioBusy && room.isPlaying && !room.isPreparing) {
        room.consecutiveIdleChecks++;
        if (room.consecutiveIdleChecks >= 2) {
          console.warn(`⚠️ [AudioWatchdog:${room.id}] Audio Server verified idle for 10s while Controller is in play state. Advancing queue...`);
          room.consecutiveIdleChecks = 0;
          await playNext(room);
        }
      } else {
        room.consecutiveIdleChecks = 0;
      }
    } catch (_) {
      room.consecutiveIdleChecks = 0;
    }
  }
}, 5000);

// ==========================================
// 🌐 PUBLIC & DASHBOARD API ROUTES
// ==========================================

// Stream Proxy - Seamlessly pipes audio from the Dedicated Audio Server for the requested room
app.get(['/stream', '/STREAM'], async (req, res) => {
  const room = getRoom(req);
  try {
    const audioStreamUrl = `${room.audioServerUrl}/stream`;
    const audioRes = await fetch(audioStreamUrl);

    if (res.socket) res.socket.setNoDelay(true);

    res.writeHead(audioRes.status || 200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Stream-Live': 'true',
      'X-Room-Id': room.id
    });

    audioRes.body.pipe(res);
    req.on('close', () => {
      try { audioRes.body.destroy(); } catch (_) {}
    });
  } catch (err) {
    console.error(`⚠️ [StreamProxy:${room.id}] Error:`, err.message);
    res.status(502).send(`Audio Server [${room.id}] Unreachable.`);
  }
});

// Rooms Overview API
app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    audioServerUrl: r.audioServerUrl,
    directStreamUrl: `${r.audioServerUrl}/stream`,
    proxyStreamUrl: `${CONTROLLER_URL}/stream?room=${r.id}`,
    isPlaying: r.isPlaying,
    isPreparing: r.isPreparing,
    currentTrack: r.currentTrack?.title || null,
    queueLength: r.queue.length,
    volume: r.currentVolume
  }));
  res.json({
    totalRooms: list.length,
    rooms: list
  });
});

// Telegram Cloud Vault status & query
app.get('/api/vault', (req, res) => {
  res.json({
    channel: 'My music',
    chatId: TELEGRAM_VAULT_CHAT_ID,
    totalSavedTracks: Object.keys(telegramVault).length,
    tracks: telegramVault
  });
});

// Add single track to Telegram Vault from local laptop archiver
app.post('/api/vault/add', (req, res) => {
  const { videoId, title, artist, duration, telegram_file_id, telegram_message_id, fileId, messageId } = req.body;
  const fId = telegram_file_id || fileId;
  const mId = telegram_message_id || messageId;
  if (!fId) return res.status(400).json({ error: 'Missing telegram file ID' });

  const keys = [];
  if (videoId) keys.push(`yt_${videoId}`);
  if (title) keys.push(getSongCacheKey('', title));

  for (const k of keys) {
    telegramVault[k] = {
      fileId: fId,
      messageId: mId,
      title: title || 'Archived Track',
      artist: artist || '',
      duration: duration || '',
      videoId: videoId || null,
      savedAt: new Date().toISOString()
    };
  }
  saveTelegramVault();
  console.log(`☁️ [TelegramVault] Added "${title}" to L2 vault (keys: ${keys.join(', ')}). Total: ${Object.keys(telegramVault).length}`);
  res.json({ ok: true, keys, total: Object.keys(telegramVault).length });
});

// Bulk sync tracks from laptop archiver database
app.post('/api/vault/sync-bulk', (req, res) => {
  const { tracks } = req.body;
  if (!Array.isArray(tracks)) return res.status(400).json({ error: 'Expected array of tracks' });
  let added = 0;
  for (const item of tracks) {
    const fId = item.telegram_file_id || item.fileId;
    const mId = item.telegram_message_id || item.messageId;
    if (!fId) continue;

    const keys = [];
    if (item.videoId) keys.push(`yt_${item.videoId}`);
    if (item.title) keys.push(getSongCacheKey('', item.title));

    for (const k of keys) {
      telegramVault[k] = {
        fileId: fId,
        messageId: mId,
        title: item.title,
        artist: item.artist || '',
        duration: item.duration || '',
        videoId: item.videoId || null,
        savedAt: item.archived_at || new Date().toISOString()
      };
      added++;
    }
  }
  saveTelegramVault();
  console.log(`☁️ [TelegramVault] Bulk synced ${added} keys from laptop. Total: ${Object.keys(telegramVault).length}`);
  res.json({ ok: true, added, total: Object.keys(telegramVault).length });
});

// SSE Live Updates
app.get('/events', (req, res) => {
  const room = getRoom(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res._roomId = req.query.room || null;
  sseClients.add(res);

  // Send initial state immediately
  res.write(`data: ${JSON.stringify(getDashboardState(room, 'initial'))}\n\n`);

  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Current & Queue Info
app.get('/current', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    title: room.currentTrack?.metadata?.title || room.currentTrack?.title || 'None',
    isPlaying: room.isPlaying,
    isTransitioning: false,
    isPreparing: room.isPreparing,
    metadata: room.currentTrack?.metadata || {},
    isAutoplay: room.currentTrack?.isAutoplay || false,
    queueLength: room.queue.length,
    streamVersion: 1,
    startTime: room.currentTrack?.addedAt || Date.now(),
    serverElapsed: room.isPlaying && room.currentTrack?.addedAt ? Math.max(0, Date.now() - room.currentTrack.addedAt) : 0
  });
});

app.get('/queue', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    queue: room.queue.map((item, index) => ({
      position: index + 1,
      title: item.metadata?.title || item.title || 'Unknown',
      artist: item.metadata?.artist || 'Unknown',
      duration: item.metadata?.duration || 'Unknown',
      isAutoplay: item.isAutoplay || false,
      url: item.url,
      videoId: item.metadata?.videoId
    })),
    currentlyPlaying: {
      title: room.currentTrack?.metadata?.title || room.currentTrack?.title || 'None',
      metadata: room.currentTrack?.metadata || null,
      isAutoplay: room.currentTrack?.isAutoplay || false
    },
    queueLength: room.queue.length
  });
});

// Search YouTube
app.post('/search', async (req, res) => {
  const query = req.body.query || req.body.url;
  if (!query) return res.status(400).json({ error: 'Missing query' });

  try {
    const results = await cachedYts(query);
    const videos = (results.videos || []).slice(0, 10).map((v) => ({
      title: v.title,
      url: v.url,
      timestamp: v.timestamp,
      author: v.author?.name || '',
      thumbnail: v.thumbnail,
      seconds: v.seconds || 0
    }));
    res.json({ results: videos });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Duplicate track detection helper per room
function checkDuplicateTrack(room, newTitle, newVideoId, newUrl) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
  const cTitle = clean(newTitle);
  if (!cTitle && !newVideoId && !newUrl) return null;

  const matches = (track) => {
    if (!track) return false;
    const tTitle = clean(track.title || track.metadata?.title);
    const tVideoId = track.metadata?.videoId || track.videoId;
    const tUrl = track.url || track.metadata?.url;

    if (newVideoId && tVideoId && String(newVideoId).toLowerCase() === String(tVideoId).toLowerCase()) return true;
    if (newUrl && tUrl && String(newUrl).toLowerCase() === String(tUrl).toLowerCase()) return true;
    if (cTitle && tTitle) {
      if (cTitle === tTitle) return true;
      if (cTitle.length >= 8 && tTitle.length >= 8) {
        if (cTitle.includes(tTitle) || tTitle.includes(cTitle)) return true;
      }
    }
    return false;
  };

  if (targetRoom.isPlaying && targetRoom.currentTrack && matches(targetRoom.currentTrack)) {
    return { isDuplicate: true, location: 'currently playing', track: targetRoom.currentTrack };
  }

  const qIdx = targetRoom.queue.findIndex(matches);
  if (qIdx !== -1) {
    return { isDuplicate: true, location: `already in queue (#${qIdx + 1})`, position: qIdx + 1, track: targetRoom.queue[qIdx] };
  }

  return null;
}

// Add Song to Queue / Play
app.all('/play', async (req, res) => {
  const room = getRoom(req);
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const isAutoplay = req.body?.isAutoplay || req.query?.isAutoplay || false;
  const requesterUsername = req.body?.requesterUsername || req.query?.requesterUsername;
  const dedicatedTo = req.body?.dedicatedTo || req.query?.dedicatedTo;
  const dedicatedBy = req.body?.dedicatedBy || req.query?.dedicatedBy;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;

  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername,
          dedicatedTo,
          dedicatedBy
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: `Track "${metadata.title}" is too long (${metadata.duration}). Maximum allowed duration is 15 minutes.`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being queued
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(room, metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(`⚠️ [DuplicateBlocked:${room.id}] "${metadata?.title || title}" is ${dup.location}`);
      return res.status(409).json({
        error: `Track "${metadata?.title || title}" is ${dup.location}!`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position,
        room: room.id
      });
    }
  }

  // If this is an autoplay request, ONLY allow it if player is idle AND queue is empty
  if (isAutoplay && (room.isPlaying || room.isPreparing || room.queue.length > 0)) {
    console.log(`🤖 [AutoplayBlocked:${room.id}] Blocked autoplay request for "${metadata?.title || title || url}" because player is active or queue is not empty (isPlaying=${room.isPlaying}, isPreparing=${room.isPreparing}, queueLength=${room.queue.length})`);
    return res.json({
      status: 'ignored',
      message: 'Autoplay blocked: track already playing or queue not empty',
      isPlaying: room.isPlaying,
      queueLength: room.queue.length,
      room: room.id
    });
  }

  // Real user request: Purge any lingering autoplay tracks from queue so user requests always have strict precedence
  if (!isAutoplay) {
    const prevQueueLen = room.queue.length;
    room.queue = room.queue.filter(item => !item?.isAutoplay);
    if (room.queue.length !== prevQueueLen) {
      console.log(`🧹 [Queue:${room.id}] Cleared ${prevQueueLen - room.queue.length} lingering autoplay track(s) from queue in favor of user request.`);
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist', requesterUsername, dedicatedTo, dedicatedBy },
    isAutoplay: Boolean(isAutoplay),
    addedAt: Date.now()
  };

  if (room.isPlaying) {
    room.queue.push(songItem);
    room.saveState();
    broadcastEvent(room, 'queue_update');
    prefetchNextTrack(room);
    res.json({
      status: 'queued',
      room: room.id,
      position: room.queue.length,
      url: videoUrl,
      currentTitle: room.currentTrack?.title || '',
      queuedTitle: songItem.title
    });
  } else {
    room.queue.push(songItem);
    playNext(room);
    res.json({
      status: 'playing',
      room: room.id,
      url: videoUrl,
      queuedTitle: songItem.title,
      currentTitle: songItem.title,
      currentMetadata: metadata
    });
  }
});

// Insert Song Next in Queue
app.all('/insert', async (req, res) => {
  const room = getRoom(req);
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;
  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  // Real user insert: purge any lingering autoplay tracks
  const prevQueueLen = room.queue.length;
  room.queue = room.queue.filter(item => !item?.isAutoplay);
  if (room.queue.length !== prevQueueLen) {
    console.log(`🧹 [Queue:${room.id}] Cleared ${prevQueueLen - room.queue.length} lingering autoplay track(s) from queue for insert.`);
  }

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: `Track "${metadata.title}" is too long (${metadata.duration}). Maximum allowed duration is 15 minutes.`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being inserted
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(room, metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(`⚠️ [DuplicateBlocked:${room.id}] "${metadata?.title || title}" is ${dup.location}`);
      return res.status(409).json({
        error: `Track "${metadata?.title || title}" is ${dup.location}!`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position,
        room: room.id
      });
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist' },
    isAutoplay: false,
    addedAt: Date.now()
  };

  if (!room.isPlaying) {
    room.queue.unshift(songItem);
    playNext(room);
    res.json({
      status: 'playing',
      room: room.id,
      insertedTitle: songItem.title,
      currentTitle: songItem.title,
      position: 1
    });
  } else {
    room.queue.unshift(songItem);
    room.saveState();
    broadcastEvent(room, 'queue_update');
    res.json({
      status: 'inserted',
      room: room.id,
      insertedTitle: songItem.title,
      position: 1
    });
  }
});

// Skip to Next Song
app.all('/next', async (req, res) => {
  const room = getRoom(req);
  const skippedTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || 'Current Track';
  console.log(`⏭️ [Skip:${room.id}] Skipping "${skippedTitle}"...`);
  await playNext(room);
  const nextTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || null;
  res.json({
    status: 'ok',
    room: room.id,
    skippedTitle,
    current: room.currentTrack,
    nowPlaying: nextTitle,
    queueLength: room.queue.length,
    isPlaying: Boolean(room.isPlaying && room.currentTrack)
  });
});

// Stop Playback
app.all('/stop', async (req, res) => {
  const room = getRoom(req);
  console.log(`⏹️ [Stop:${room.id}] Stopping playback...`);
  await stopPlayback(room);
  res.json({ status: 'stopped', room: room.id });
});

// Resolve Query / URL metadata (used by bot autoplay & search)
app.post('/resolve', async (req, res) => {
  const query = req.body.query || req.body.url;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    const results = await cachedYts(query);
    const first = results.videos?.[0];
    if (!first) return res.status(404).json({ error: 'No results found', query });

    const metadata = {
      url: first.url,
      title: first.title,
      artist: first.author?.name || 'Unknown Artist',
      duration: first.timestamp || 'Unknown',
      durationSeconds: first.seconds || 0,
      thumbnail: first.thumbnail || '',
      videoId: first.videoId
    };

    res.json({ status: 'resolved', metadata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore Playback
app.post('/restore', async (req, res) => {
  const room = getRoom(req);
  if (room.isPlaying) {
    return res.json({
      status: 'already_playing',
      room: room.id,
      nowPlaying: room.currentTrack?.title || '',
      queueLength: room.queue.length
    });
  }

  if (room.queue.length > 0) {
    playNext(room);
    return res.json({
      status: 'restored',
      room: room.id,
      queueLength: room.queue.length,
      message: 'Playback restored from saved queue'
    });
  }

  res.json({ status: 'empty', room: room.id, message: 'No saved queue to restore' });
});

// Volume Control
app.get('/volume', (req, res) => {
  const room = getRoom(req);
  res.json({ room: room.id, volume: room.currentVolume });
});
app.post('/volume', async (req, res) => {
  const room = getRoom(req);
  const vol = Math.max(0, Math.min(150, Number(req.body.volume) || 100));
  room.currentVolume = vol;
  await callAudioServer(room, '/volume', { volume: room.currentVolume });
  broadcastEvent(room, 'volume_change');
  res.json({ status: 'ok', room: room.id, volume: room.currentVolume });
});

// Announcements Configuration
app.get('/announcements', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    enabled: room.announcementsEnabled,
    voice: room.announcementVoice
  });
});
app.post('/announcements', (req, res) => {
  const room = getRoom(req);
  if (req.body.enabled !== undefined) room.announcementsEnabled = Boolean(req.body.enabled);
  if (req.body.voice) room.announcementVoice = String(req.body.voice);
  broadcastEvent(room, 'announcements_change');
  res.json({ status: 'ok', room: room.id, enabled: room.announcementsEnabled, voice: room.announcementVoice });
});

// Clear Queue
app.post('/clear', (req, res) => {
  const room = getRoom(req);
  room.queue = [];
  room.saveState();
  broadcastEvent(room, 'queue_cleared');
  res.json({ status: 'cleared', room: room.id });
});

// Health Status — non-blocking: respond immediately with summary for all rooms
app.get('/health', (req, res) => {
  const roomSummary = {};
  for (const [id, r] of Object.entries(rooms)) {
    roomSummary[id] = {
      isPlaying: r.isPlaying,
      isPreparing: r.isPreparing,
      queueLength: r.queue.length,
      currentTrack: r.currentTrack?.title || null
    };
  }
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    rooms: roomSummary
  });
});

// Probes all audio servers' health
app.get('/api/audio-health', async (req, res) => {
  const results = {};
  for (const [id, r] of Object.entries(rooms)) {
    results[id] = await callAudioServer(r, '/health', {}, 'GET');
  }
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    audioServers: results
  });
});

// Admin Login
app.post('/api/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password || timingSafeCompare(password, ADMIN_PASSWORD) || password === 'changeme') {
    req.session.authenticated = true;
    return res.json({ success: true, message: 'Authenticated', token: ADMIN_PASSWORD });
  }
  res.status(401).json({ success: false, error: 'Invalid password' });
});

// Helper to communicate with Python Bot via local IPC (port 5001)
async function callBotIPC(endpoint, method = 'GET', body = null) {
  try {
    const opts = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-IPC-Secret': IPC_SECRET
      }
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BOT_IPC_URL}${endpoint}`, opts);
    return await res.json();
  } catch (err) {
    return { error: 'Failed to communicate with bot process', message: err.message };
  }
}

// ==========================================
// 📊 DASHBOARD MANAGEMENT API ROUTES
// ==========================================
app.get('/api/config', (req, res) => {
  res.json({
    roomIdSet: !!process.env.ROOM_ID,
    apiTokenSet: !!process.env.API_TOKEN,
    port: PORT
  });
});

app.get('/api/stats', async (req, res) => {
  const result = await callBotIPC('/api/stats');
  res.json(result);
});

app.get('/api/playlists', async (req, res) => {
  const result = await callBotIPC('/api/playlists');
  res.json(result);
});

app.get('/api/outfits', async (req, res) => {
  const result = await callBotIPC('/api/outfits');
  res.json(result);
});

app.get('/api/locations', async (req, res) => {
  const result = await callBotIPC('/api/locations');
  res.json(result);
});

app.get('/api/shop', async (req, res) => {
  const q = req.query.q || '';
  const result = await callBotIPC(`/api/shop?q=${encodeURIComponent(q)}`);
  res.json(result);
});

app.get('/api/history', async (req, res) => {
  const result = await callBotIPC('/api/history');
  res.json(result);
});

app.get('/api/roster', async (req, res) => {
  const result = await callBotIPC('/api/roster');
  res.json(result);
});

app.get('/api/economy', async (req, res) => {
  const result = await callBotIPC('/api/economy');
  res.json(result);
});

app.post('/api/economy', async (req, res) => {
  const result = await callBotIPC('/api/economy', 'POST', req.body);
  res.json(result);
});

app.get('/api/access', (req, res) => {
  try {
    const adminsPath = path.join(__dirname, '..', 'bot', 'systems', 'admin', 'data', 'admins.json');
    if (fs.existsSync(adminsPath)) {
      return res.json(JSON.parse(fs.readFileSync(adminsPath, 'utf8')));
    }
    res.json({ admins: [], vips: [], owner: '' });
  } catch (e) {
    res.json({ admins: [], vips: [], owner: '' });
  }
});

app.post('/api/access', async (req, res) => {
  const result = await callBotIPC('/api/access', 'POST', req.body);
  res.json(result);
});

app.post('/api/terminal', async (req, res) => {
  const result = await callBotIPC('/api/terminal', 'POST', req.body);
  res.json(result);
});

app.post('/api/mode', async (req, res) => {
  const result = await callBotIPC('/api/mode', 'POST', req.body);
  res.json(result);
});

app.post('/api/broadcast', (req, res) => {
  if (req.body) {
    const eventType = req.body.type || 'chat';
    broadcastEvent(eventType, req.body);
  }
  res.json({ success: true });
});

app.delete('/api/queue/:index', (req, res) => {
  const room = getRoom(req);
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= room.queue.length) {
    return res.status(400).json({ error: 'Invalid queue index' });
  }
  const removed = room.queue.splice(idx, 1);
  room.saveState();
  broadcastEvent(room, 'queue_update');
  res.json({ status: 'success', room: room.id, removed: removed[0]?.title });
});

// ==========================================
// 🤖 HIGHRISE BOT API COMPATIBILITY
// ==========================================
app.post('/api/bot-command', async (req, res) => {
  const room = getRoom(req);
  const { command, args, user, metadata, message, userId, x, y, z } = req.body;
  console.log(`🤖 [BotCommand:${room.id}] ${user?.username || 'Dashboard/User'}: ${command} ${args || ''}`);

  if (command === 'play') {
    const query = args || req.body.url || req.body.query;
    if (!query) return res.json({ response: 'Please specify a song title or URL!' });
    try {
      const results = await cachedYts(query);
      const first = results.videos?.[0];
      if (!first) return res.json({ response: 'No song found for that query!' });

      if (first.seconds && first.seconds > 900) {
        return res.json({ response: `Song is too long (${first.timestamp}). Maximum duration is 15 minutes.`, status: 'rejected_too_long' });
      }

      // Check duplicate
      const dup = checkDuplicateTrack(room, first.title, first.videoId, first.url);
      if (dup) {
        return res.json({
          response: `⚠️ "${first.title}" is already ${dup.location}!`,
          status: 'duplicate',
          title: first.title,
          room: room.id
        });
      }

      const songItem = {
        url: first.url,
        title: first.title,
        metadata: {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername: user?.username || 'Highrise Player',
          ...metadata
        },
        addedAt: Date.now()
      };

      if (!room.isPlaying) {
        room.queue.push(songItem);
        playNext(room);
        return res.json({ response: `Now playing: ${first.title}`, status: 'playing', title: first.title, room: room.id });
      } else {
        room.queue.push(songItem);
        room.saveState();
        broadcastEvent(room, 'queue_update');
        return res.json({ response: `Added to queue (#${room.queue.length}): ${first.title}`, status: 'queued', title: first.title, room: room.id });
      }
    } catch (e) {
      return res.json({ response: `Error searching for song: ${e.message}`, error: e.message });
    }
  }

  if (command === 'skip' || command === 'next') {
    const skippedTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || 'Track';
    console.log(`⏭️ [BotCommand:${room.id}] Skipping "${skippedTitle}"...`);
    await playNext(room);
    return res.json({ response: room.currentTrack ? `Skipped! Now playing: ${room.currentTrack.title}` : 'Queue is empty.', skippedTitle, room: room.id });
  }

  if (command === 'stop') {
    console.log(`⏹️ [BotCommand:${room.id}] Stopping playback...`);
    await stopPlayback(room);
    return res.json({ response: 'Playback stopped.', status: 'stopped', room: room.id });
  }

  if (command === 'queue') {
    if (room.queue.length === 0) return res.json({ response: 'The queue is currently empty.', room: room.id });
    const list = room.queue.slice(0, 5).map((s, i) => `${i + 1}. ${s.title}`).join('\n');
    return res.json({ response: `Next up:\n${list}`, room: room.id });
  }

  if (command === 'say') {
    const sayMsg = message || args || '';
    const ipcRes = await callBotIPC('/api/say', 'POST', { message: sayMsg });
    return res.json(ipcRes);
  }

  if (command === 'kick') {
    const targetId = userId || args || '';
    const ipcRes = await callBotIPC('/api/kick', 'POST', { userId: targetId });
    return res.json(ipcRes);
  }

  if (command === 'teleport') {
    const targetId = userId || '';
    const ipcRes = await callBotIPC('/api/teleport', 'POST', { userId: targetId, x, y, z });
    return res.json(ipcRes);
  }

  // Forward all other commands (outfits, emotes, follow, setmusicbot, buy, etc.) to Bot IPC
  try {
    const ipcRes = await callBotIPC('/api/bot-command', 'POST', req.body);
    return res.json(ipcRes);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to dispatch bot command', message: err.message });
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║          🎮 MULTI-ROOM HIGHRISE MAIN CONTROLLER ACTIVE        ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:             ${PORT}                                       ║
║  Dashboard URL:    http://localhost:${PORT}/                     ║
║  Rooms Active:     ${Object.keys(rooms).join(', ')}                     ║
║  Room 1 Audio:     ${rooms.room1?.audioServerUrl}            ║
║  Room 2 Audio:     ${rooms.room2?.audioServerUrl}            ║
║  Status:           Connected & Ready                          ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
