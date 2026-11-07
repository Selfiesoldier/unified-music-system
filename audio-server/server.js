import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';
import readline from 'readline';
import http from 'http';

import { PersistentStreamManager } from './src/persistentStreamManager.js';
import { AudioPlayer } from './src/audioPlayer.js';
import { is96kCbrMp3Buffer } from './src/mp3Validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
if (fs.existsSync(path.join(__dirname, '.env'))) {
  dotenv.config({ path: path.join(__dirname, '.env') });
} else {
  dotenv.config();
}

// Crash Guardian - prevents crashes from killing audio broadcast
process.on('uncaughtException', (err) => {
  console.error('💥 [AudioServer Crash Guardian] Uncaught Exception:', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('💥 [AudioServer Crash Guardian] Unhandled Rejection:', reason);
});

const PORT = process.env.PORT || 8000;
const AUDIO_SECRET = process.env.AUDIO_SECRET || 'secret123';
const AUDIO_BITRATE = process.env.AUDIO_BITRATE || '96k';

const assetsDir = fs.existsSync(path.join(__dirname, 'assets'))
  ? path.join(__dirname, 'assets')
  : path.join(__dirname, '..', 'assets');

// Initialize Stream Manager
const streamManager = new PersistentStreamManager({
  bitrate: AUDIO_BITRATE,
  streamName: 'Highrise Dedicated Audio Stream',
  assetsDir
});
if (typeof streamManager.init === 'function') {
  streamManager.init();
}
if (typeof streamManager.startSilenceFeed === 'function') {
  streamManager.startSilenceFeed();
}

// Initialize Audio Player
const audioPlayer = new AudioPlayer(streamManager);
streamManager.audioPlayer = audioPlayer;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '10mb' }));

const CONTROLLER_URL = (process.env.CONTROLLER_URL || 'http://2.56.246.119:30195').replace(/\/+$/, '');
const ROOM_ID = process.env.ROOM_ID || 'room1';
const ROOM_NAME = process.env.ROOM_NAME || (ROOM_ID === 'room2' ? 'Room 2 (Party Room)' : 'Room 1 (Main Lounge)');

// Serve static dashboard files if present
const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir, { maxAge: '1d', etag: true }));
}

// Room Info API for Dashboard
app.get('/api/room-info', (req, res) => {
  res.json({
    roomId: ROOM_ID,
    roomName: ROOM_NAME,
    controllerUrl: CONTROLLER_URL,
    streamUrl: `http://${req.headers.host || 'localhost'}/stream`,
    listeners: streamManager.clients.size
  });
});

function timingSafeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireSecretCheck(req) {
  if (!AUDIO_SECRET || AUDIO_SECRET === 'none') return true;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (timingSafeCompare(token, AUDIO_SECRET)) return true;
  }

  const queryToken = (req.query.secret || req.query.token || '').trim();
  if (queryToken && timingSafeCompare(queryToken, AUDIO_SECRET)) return true;

  const bodyToken = (req.body && req.body.secret ? String(req.body.secret) : '').trim();
  if (bodyToken && timingSafeCompare(bodyToken, AUDIO_SECRET)) return true;

  return false;
}

function requireSecret(req, res, next) {
  if (requireSecretCheck(req)) return next();
  return res.status(401).json({ error: 'Unauthorized: invalid or missing audio secret' });
}

// ==========================================
// 📻 PUBLIC STREAM ROUTE (Highrise In-Room Feed)
// ==========================================
app.get(['/stream', '/STREAM'], (req, res) => {
  streamManager.addClient(res, req);
});

// ==========================================
// 🎛️ INTERNAL CONTROL API
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: Math.floor(process.uptime()),
    streamActive: true,
    encoderRunning: true,
    listeners: streamManager.clients.size
  });
});

app.get('/ping', (req, res) => res.send('pong'));

app.get(['/status', '/api/status'], (req, res) => {
  res.json({
    player: audioPlayer.getStatus(),
    stream: streamManager.getStats(),
    isAnnouncing: Boolean(streamManager.isAnnouncing)
  });
});

// Play Audio Source (Direct Controller Playback or Dashboard Song Queue Proxy)
app.post(['/play', '/api/play'], async (req, res) => {
  // If webhookUrl is present, it's a playback instruction from Central Controller:
  if (req.body?.webhookUrl) {
    if (!requireSecretCheck(req)) {
      return res.status(401).json({ error: 'Unauthorized: invalid or missing audio secret' });
    }
    const source = req.body.url || req.body.source;
    const { title, volume, webhookUrl, cancelAnnouncement = false } = req.body;

    if (!source) {
      return res.status(400).json({ error: 'Missing "url" or "source" parameter' });
    }

    if (cancelAnnouncement) {
      streamManager.stopAnnouncement();
    }

    res.json({
      status: 'playing',
      source
    });

    audioPlayer.play({ source, title, volume, webhookUrl }).catch((err) => {
      console.error('[AudioServer] Playback error:', err.message);
    });
    return;
  }

  // Otherwise, user queued from Dashboard -> Proxy to Central Main Controller:
  return proxyToController(req, res);
});

// Stop Playback
app.post(['/stop', '/api/stop'], (req, res) => {
  if (requireSecretCheck(req) && !req.headers.authorization?.startsWith('Bearer changeme')) {
    streamManager.stopAnnouncement();
    audioPlayer.stop(false);
    return res.json({ status: 'stopped' });
  }
  return proxyToController(req, res);
});

// Adjust Volume
app.post('/api/volume', (req, res) => {
  if (requireSecretCheck(req) && !req.headers.authorization?.startsWith('Bearer changeme')) {
    const { volume } = req.body;
    const newVol = audioPlayer.setVolume(volume);
    return res.json({ status: 'ok', volume: newVol });
  }
  return proxyToController(req, res);
});

// Real-time Voice / TTS Announcement Overlay
app.post(['/announce', '/api/announce'], requireSecret, async (req, res) => {
  const { url, source, audioBase64, wait = false } = req.body;
  const audioInput = url || source;

  if (!audioInput && !audioBase64) {
    return res.status(400).json({ error: 'Missing audio source (url or audioBase64)' });
  }

  const sessionId = streamManager.startNewAnnouncementSession();

  try {
    let mp3Buffer = null;
    if (audioBase64) {
      mp3Buffer = Buffer.from(audioBase64, 'base64');
    } else if (audioInput) {
      // ZERO FFmpeg: Direct pure Node.js HTTP fetch of pre-encoded 96kbps MP3
      const fetchRes = await fetch(audioInput, { signal: AbortSignal.timeout(10000) });
      if (!fetchRes.ok) throw new Error(`Failed to fetch announcement audio: HTTP ${fetchRes.status}`);
      const arrayBuf = await fetchRes.arrayBuffer();
      mp3Buffer = Buffer.from(arrayBuf);
    }

    if (!mp3Buffer || mp3Buffer.length === 0) {
      return res.json({ status: 'cancelled' });
    }

    if (!is96kCbrMp3Buffer(mp3Buffer)) {
      console.warn('❌ [Announcement] Rejected: payload failed 96k CBR MP3 byte-header check.');
      return res.status(400).json({ error: 'Rejected: audio must be strict 96kbps CBR 44.1kHz MP3' });
    }

    const durationMs = Math.round((mp3Buffer.length / 12000) * 1000);
    console.log(`🎙️ [Announcement] Playing speech announcement (${(mp3Buffer.length / 1024).toFixed(1)} KB MP3, ~${(durationMs / 1000).toFixed(1)}s, 0% CPU, ZERO FFmpeg)... status: started`);

    const playbackPromise = streamManager.streamAnnouncementMp3(mp3Buffer, sessionId);

    if (!wait) {
      playbackPromise.then((completed) => {
        if (completed) console.log('✅ [Announcement] Finished playback (ZERO FFmpeg).');
      });
      return res.json({
        status: 'announcement_started',
        durationMs
      });
    }

    const completed = await playbackPromise;
    return res.json({
      status: completed ? 'announcement_completed' : 'cancelled',
      durationMs
    });
  } catch (e) {
    console.error('⚠️ [Announcement] Error:', e.message);
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// Stream Direct MP3 Uploads to Central Controller
app.post('/api/upload-mp3', (req, res) => {
  const targetUrl = new URL(`${CONTROLLER_URL}/api/upload-mp3`);
  targetUrl.searchParams.set('room', ROOM_ID);
  if (req.query.position) targetUrl.searchParams.set('position', req.query.position);
  if (req.query.title) targetUrl.searchParams.set('title', req.query.title);

  const forwardReq = http.request(targetUrl, {
    method: 'POST',
    headers: {
      'content-type': req.headers['content-type'] || 'audio/mpeg',
      'x-room-id': ROOM_ID,
      'authorization': req.headers['authorization'] || ''
    }
  }, (forwardRes) => {
    res.status(forwardRes.statusCode);
    for (const [k, v] of Object.entries(forwardRes.headers)) {
      res.setHeader(k, v);
    }
    forwardRes.pipe(res);
  });

  forwardReq.on('error', (err) => {
    console.error(`[UploadProxy:${ROOM_ID}] Error forwarding upload:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Central Controller Unreachable for upload', details: err.message });
    }
  });

  req.pipe(forwardReq);
});

// ==========================================
// 🌐 PROXY DASHBOARD API ROUTES TO CONTROLLER
// ==========================================
async function proxyToController(req, res) {
  try {
    const targetUrl = new URL(`${CONTROLLER_URL}${req.path}`);
    for (const [key, val] of Object.entries(req.query)) {
      targetUrl.searchParams.set(key, val);
    }
    targetUrl.searchParams.set('room', ROOM_ID);

    // Specific SSE streaming handling
    if (req.path === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });

      const sseRes = await fetch(targetUrl.toString(), {
        headers: { 'Accept': 'text/event-stream', 'x-room-id': ROOM_ID }
      });

      if (!sseRes.ok || !sseRes.body) {
        return res.status(502).end();
      }

      const reader = sseRes.body.getReader();
      const readChunk = async () => {
        try {
          const { done, value } = await reader.read();
          if (done) return res.end();
          res.write(value);
          readChunk();
        } catch (_) {
          try { reader.cancel(); } catch (e) {}
        }
      };
      readChunk();

      req.on('close', () => {
        try { reader.cancel(); } catch (e) {}
      });
      return;
    }

    // Normal REST API proxying
    const headers = { ...req.headers };
    delete headers.host;
    headers['x-room-id'] = ROOM_ID;

    const opts = {
      method: req.method,
      headers
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(req.body);
    }

    const controllerRes = await fetch(targetUrl.toString(), opts);
    res.status(controllerRes.status);
    for (const [k, v] of controllerRes.headers) {
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    }
    const data = await controllerRes.arrayBuffer();
    res.send(Buffer.from(data));
  } catch (err) {
    console.error(`⚠️ [ControllerProxy:${ROOM_ID}] Error proxying ${req.method} ${req.path}:`, err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Central Controller Unreachable', details: err.message });
    }
  }
}

const DASHBOARD_ROUTES = [
  '/api/login',
  '/events',
  '/current',
  '/queue',
  '/insert',
  '/next',
  '/volume',
  '/announcements',
  '/clear',
  '/search',
  '/resolve',
  '/api/queue/:index',
  '/api/config',
  '/api/stats',
  '/api/playlists',
  '/api/outfits',
  '/api/locations',
  '/api/shop',
  '/api/history',
  '/api/roster',
  '/api/economy',
  '/api/access',
  '/api/terminal',
  '/api/mode',
  '/api/broadcast'
];

DASHBOARD_ROUTES.forEach(route => {
  app.all(route, proxyToController);
});


// =========================================================================
// 🎧 DYNAMIC CONSOLE LOAD TESTER (Console Driven: Numbers add listeners)
// =========================================================================
const simulatedClients = new Map();
let nextClientId = 1;

const loadAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 1000,
  maxFreeSockets: 200
});

function addSimulatedListeners(count) {
  const targetPort = PORT || 8000;
  console.log(`[LoadTester] 🚀 Spawning ${count} simulated listeners (current simulated: ${simulatedClients.size})...`);
  
  for (let i = 0; i < count; i++) {
    const id = nextClientId++;
    const req = http.get(`http://127.0.0.1:${targetPort}/stream`, {
      agent: loadAgent,
      headers: {
        'User-Agent': `Highrise-SimulatedClient-${id}`,
        'Accept': 'audio/mpeg, audio/*; q=0.9, */*; q=0.1'
      }
    }, (res) => {
      simulatedClients.set(id, { req, res, id });
      res.on('data', () => {}); // Continuously consume audio packets
      res.on('end', () => simulatedClients.delete(id));
      res.on('error', () => simulatedClients.delete(id));
    });
    req.on('error', () => simulatedClients.delete(id));
  }

  setTimeout(() => {
    console.log(`[LoadTester] 📊 Live Listeners: ${simulatedClients.size} simulated | ${streamManager.clients.size} total server connections`);
  }, 500);
}

function stopAllSimulatedListeners() {
  console.log(`[LoadTester] 🛑 Stopping all ${simulatedClients.size} simulated listeners...`);
  for (const [id, c] of simulatedClients) {
    try { c.req.destroy(); } catch (_) {}
  }
  simulatedClients.clear();
  console.log(`[LoadTester] ✅ All simulated listeners cleared. Server listeners now: ${streamManager.clients.size}`);
}

// Readline interface for Pterodactyl console commands
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (rawLine) => {
  const line = (rawLine || '').trim().toLowerCase();
  if (!line) return;

  if (line === 'stop' || line === 'clear' || line === 'reset') {
    stopAllSimulatedListeners();
    return;
  }

  const match = line.match(/^\+?(\d+)$/);
  if (match) {
    const num = parseInt(match[1], 10);
    if (num > 0) {
      console.log(`\n📥 [Console Command] Received input: +${num} listeners!`);
      addSimulatedListeners(num);
      return;
    }
  }

  if (line === 'status') {
    console.log(`[LoadTester] 📊 Status: ${simulatedClients.size} simulated active | ${streamManager.clients.size} total server listeners`);
    return;
  }
});

// REST API endpoints so load can also be adjusted via HTTP:
app.post('/api/load-test/add', (req, res) => {
  const count = parseInt(req.query.count || req.body?.count || '10', 10);
  addSimulatedListeners(count);
  res.json({
    success: true,
    added: count,
    simulatedListeners: simulatedClients.size,
    totalListeners: streamManager.clients.size
  });
});

app.post('/api/load-test/stop', (req, res) => {
  stopAllSimulatedListeners();
  res.json({
    success: true,
    simulatedListeners: 0,
    totalListeners: streamManager.clients.size
  });
});

app.get('/api/load-test/status', (req, res) => {
  res.json({
    simulatedListeners: simulatedClients.size,
    totalListeners: streamManager.clients.size
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║       🎵 HIGHRISE DEDICATED ZERO-CPU AUDIO SERVER 🎵           ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:           ${String(PORT).padEnd(44)} ║
║  Bitrate:        ${AUDIO_BITRATE.padEnd(44)} ║
║  Stream URL:     http://localhost:${PORT}/stream${' '.repeat(Math.max(0, 31 - String(PORT).length))} ║
║  Mode:           Pre-Transcode MP3 Frame Streaming            ║
║  Architecture:   100% FFmpeg-Free | Pure Byte-Stream Relay    ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});
