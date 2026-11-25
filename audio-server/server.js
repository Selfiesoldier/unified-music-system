import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import http from 'http';

import { PersistentStreamManager } from './src/persistentStreamManager.js';
import { AudioPlayer } from './src/audioPlayer.js';

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

// Pre-buffer static secret and precalculate SHA-256 digest to prevent memory allocations and length leaks
const STATIC_SECRET_BUF = Buffer.from(AUDIO_SECRET);
const STATIC_SECRET_DIGEST = crypto.createHash('sha256').update(STATIC_SECRET_BUF).digest();

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
app.set('etag', false); // Disable CPU-intensive FNV-1a hashing on dynamic JSON/API routes
app.disable('x-powered-by');

// ============================================================================
// 🛡️ ADVANCED IN-MEMORY DDOS, FLOOD & SLOWLORIS SHIELD (ZERO EXTERNAL DEPS)
// ============================================================================

const WHITELIST_IPS = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  '2.56.246.119', // Central Controller
  ...(process.env.WHITELIST_IPS ? process.env.WHITELIST_IPS.split(',').map(s => s.trim()) : [])
]);

// IP Tracking Data Stores
const ipRequestHistory = new Map(); // ip -> { count: number, windowStart: number }
const ipAuthFailures = new Map();   // ip -> { count: number, windowStart: number }
const jailedIps = new Map();        // ip -> unjailTimestamp
const activeStreamClientsByIp = new Map(); // ip -> Set<res>

const DDOS_CONFIG = {
  WINDOW_MS: 10000,           // 10s window
  MAX_REQUESTS_PER_WINDOW: 50, // 50 requests per 10s (~5 req/sec avg)
  FLOOD_BURST_JAIL_THRESHOLD: 100, // If > 100 req in 10s -> Auto Jail!
  JAIL_DURATION_MS: 15 * 60 * 1000, // 15 min jail
  AUTH_FAIL_WINDOW_MS: 60000,  // 1 min auth failure window
  MAX_AUTH_FAILS: 5,           // 5 failed auths -> Auto Jail for 30 min
  AUTH_JAIL_DURATION_MS: 30 * 60 * 1000,
  MAX_STREAM_PER_IP: 3,        // Max 3 concurrent /stream connections per IP
  MAX_GLOBAL_STREAMS: 50       // Max 50 total concurrent /stream listeners
};

// Security Statistics
const ddosStats = {
  totalBlockedRequests: 0,
  totalJailedIps: 0,
  activeJailedCount: 0,
  streamConnectionsBlocked: 0
};

// Helper: Normalize Client IP (trust forwarded headers only from local loopback proxy)
function getClientIp(req) {
  const rawIp = req.socket?.remoteAddress || req.ip || 'unknown';
  const normalizedRaw = rawIp.startsWith('::ffff:') ? rawIp.substring(7) : rawIp;
  const isTrustedProxy = normalizedRaw === '127.0.0.1' || normalizedRaw === '::1';
  if (isTrustedProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const first = String(forwarded).split(',')[0].trim();
      if (first) return first.startsWith('::ffff:') ? first.substring(7) : first;
    }
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
  }
  return normalizedRaw;
}

// Memory Cleanup Interval (every 60 seconds)
setInterval(() => {
  const now = Date.now();
  // Clean expired jails
  for (const [ip, unjailTime] of jailedIps.entries()) {
    if (now >= unjailTime) jailedIps.delete(ip);
  }
  ddosStats.activeJailedCount = jailedIps.size;

  // Clean stale request history
  for (const [ip, record] of ipRequestHistory.entries()) {
    if (now - record.windowStart > DDOS_CONFIG.WINDOW_MS * 2) {
      ipRequestHistory.delete(ip);
    }
  }

  // Clean stale auth fail records
  for (const [ip, record] of ipAuthFailures.entries()) {
    if (now - record.windowStart > DDOS_CONFIG.AUTH_FAIL_WINDOW_MS * 2) {
      ipAuthFailures.delete(ip);
    }
  }
}, 60000);

/**
 * 🚨 FIRST LINE OF DEFENSE: Pre-Routing Fast-Drop Middleware
 * Runs before any body-parsing, headers processing, or routing logic.
 */
app.use((req, res, next) => {
  const ip = getClientIp(req);
  const now = Date.now();

  // Whitelisted IPs completely bypass shields
  if (WHITELIST_IPS.has(ip)) {
    return next();
  }

  // 1. Check if IP is Jailed (Blacklisted)
  const unjailTime = jailedIps.get(ip);
  if (unjailTime) {
    if (now < unjailTime) {
      ddosStats.totalBlockedRequests++;
      // Immediate socket destruction to prevent any RAM or CPU overhead
      res.writeHead(429, {
        'Content-Type': 'text/plain',
        'Retry-After': String(Math.ceil((unjailTime - now) / 1000)),
        'Connection': 'close'
      }).end('Blocked: Too many malicious requests');
      return req.socket?.destroy();
    } else {
      jailedIps.delete(ip);
    }
  }

  // 2. Sliding Window Request Limiter
  let record = ipRequestHistory.get(ip);
  if (!record || now - record.windowStart > DDOS_CONFIG.WINDOW_MS) {
    record = { count: 1, windowStart: now };
    ipRequestHistory.set(ip, record);
  } else {
    record.count++;
  }

  // Auto-Jail if aggressive flood detected
  if (record.count > DDOS_CONFIG.FLOOD_BURST_JAIL_THRESHOLD) {
    jailedIps.set(ip, now + DDOS_CONFIG.JAIL_DURATION_MS);
    ddosStats.totalJailedIps++;
    ddosStats.activeJailedCount = jailedIps.size;
    ddosStats.totalBlockedRequests++;
    console.warn(`🚨 [DDoS Shield] IP ${ip} AUTO-JAILED for 15m (${record.count} reqs in ${DDOS_CONFIG.WINDOW_MS}ms flood)!`);
    res.writeHead(429, { 'Content-Type': 'text/plain', 'Connection': 'close' }).end('Blocked by DDoS Shield');
    return req.socket?.destroy();
  }

  // Rate Limit Warning (Drop excess requests)
  if (record.count > DDOS_CONFIG.MAX_REQUESTS_PER_WINDOW) {
    ddosStats.totalBlockedRequests++;
    return res.status(429).json({
      error: 'Too Many Requests',
      retryAfterSeconds: Math.ceil((record.windowStart + DDOS_CONFIG.WINDOW_MS - now) / 1000)
    });
  }

  next();
});

// Fast-path /ping for health monitors (before CORS and body parsing)
app.get('/ping', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain',
    'Content-Length': '4',
    'Cache-Control': 'no-cache'
  }).end('pong');
});

// Universal CORS & Preflight middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-admin-key, x-audio-secret, x-room-id');
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  next();
});

// Hardened Body Parser: Limit JSON to 256KB to prevent JSON bomb memory exhaustion
app.use(express.json({ limit: '256kb' }));

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

/**
 * Constant-time comparison using fixed-size SHA-256 digests.
 * Completely eliminates character-length timing leaks and avoids per-request Buffer allocations.
 */
function timingSafeCompare(providedToken) {
  if (!providedToken || typeof providedToken !== 'string') return false;
  const providedDigest = crypto.createHash('sha256').update(Buffer.from(providedToken)).digest();
  return crypto.timingSafeEqual(providedDigest, STATIC_SECRET_DIGEST);
}

function recordAuthFailure(req) {
  const ip = getClientIp(req);
  if (WHITELIST_IPS.has(ip)) return;
  const now = Date.now();
  let record = ipAuthFailures.get(ip);
  if (!record || now - record.windowStart > DDOS_CONFIG.AUTH_FAIL_WINDOW_MS) {
    record = { count: 1, windowStart: now };
    ipAuthFailures.set(ip, record);
  } else {
    record.count++;
  }

  if (record.count >= DDOS_CONFIG.MAX_AUTH_FAILS) {
    jailedIps.set(ip, now + DDOS_CONFIG.AUTH_JAIL_DURATION_MS);
    ddosStats.totalJailedIps++;
    ddosStats.activeJailedCount = jailedIps.size;
    console.warn(`🚨 [Auth Shield] IP ${ip} JAILED for 30m (${record.count} failed auth attempts)!`);
  }
}

function requireSecretCheck(req) {
  if (!AUDIO_SECRET || AUDIO_SECRET === 'none' || AUDIO_SECRET === 'changeme') return false;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    if (token && token !== 'changeme' && timingSafeCompare(token)) return true;
  }

  const xAdminKey = req.headers['x-admin-key'];
  if (xAdminKey) {
    const token = String(xAdminKey).trim();
    if (token && token !== 'changeme' && timingSafeCompare(token)) return true;
  }

  const bodyToken = (req.body && req.body.secret ? String(req.body.secret) : '').trim();
  if (bodyToken && bodyToken !== 'changeme' && timingSafeCompare(bodyToken)) return true;

  return false;
}

function requireSecret(req, res, next) {
  if (requireSecretCheck(req)) return next();
  recordAuthFailure(req);
  return res.status(401).json({ error: 'Unauthorized: invalid or missing audio secret' });
}

// ==========================================
// 🔐 ADMIN COCKPIT AUTHENTICATION
// ==========================================
app.post(['/api/auth/verify', '/api/auth/login'], (req, res) => {
  const { password } = req.body || {};
  if (password && password !== 'changeme' && timingSafeCompare(password)) {
    return res.json({
      success: true,
      authenticated: true,
      message: 'Authenticated'
    });
  }
  recordAuthFailure(req);
  return res.status(401).json({ success: false, error: 'Unauthorized' });
});

// ==========================================
// 🎵 AUDIO STREAM ROUTE (Protected Against Slowloris & Client Exhaustion)
// ==========================================
app.get(['/stream', '/STREAM'], (req, res) => {
  const ip = getClientIp(req);
  const isWhitelisted = WHITELIST_IPS.has(ip);

  // 1. Global Stream Connection Cap
  if (!isWhitelisted && streamManager.clients.size >= DDOS_CONFIG.MAX_GLOBAL_STREAMS) {
    ddosStats.streamConnectionsBlocked++;
    return res.status(503).json({ error: 'Audio stream at maximum capacity' });
  }

  // 2. Per-IP Stream Connection Cap (Anti-Slowloris)
  let ipStreams = activeStreamClientsByIp.get(ip);
  if (!ipStreams) {
    ipStreams = new Set();
    activeStreamClientsByIp.set(ip, ipStreams);
  }

  if (!isWhitelisted && ipStreams.size >= DDOS_CONFIG.MAX_STREAM_PER_IP) {
    ddosStats.streamConnectionsBlocked++;
    console.warn(`⚠️ [Stream Shield] IP ${ip} exceeded max concurrent streams (${ipStreams.size}/${DDOS_CONFIG.MAX_STREAM_PER_IP}). Rejected.`);
    return res.status(429).json({ error: 'Too many concurrent stream connections from this IP' });
  }

  // Track stream client
  ipStreams.add(res);

  // Clean up on disconnect
  const cleanup = () => {
    ipStreams.delete(res);
    if (ipStreams.size === 0) activeStreamClientsByIp.delete(ip);
  };
  res.on('close', cleanup);
  res.on('finish', cleanup);

  // Stream socket configuration: disable idle requestTimeout for this audio stream
  if (req.socket) {
    req.socket.setTimeout(0);
  }

  streamManager.addClient(res, req);
});

// ==========================================
// 🎛️ STATUS & HEALTH (Public)
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

app.get(['/status', '/api/status'], (req, res) => {
  res.json({
    player: audioPlayer.getStatus(),
    stream: streamManager.getStats()
  });
});

// 🛡️ Security & DDoS Shield Stats (Authenticated)
app.get('/api/security/stats', requireSecret, (req, res) => {
  res.json({
    shieldActive: true,
    ddosStats,
    activeStreamClientsByIp: Array.from(activeStreamClientsByIp.entries()).map(([ip, set]) => ({ ip, count: set.size })),
    jailedIps: Array.from(jailedIps.entries()).map(([ip, unjailTime]) => ({
      ip,
      remainingSeconds: Math.max(0, Math.ceil((unjailTime - Date.now()) / 1000))
    }))
  });
});

// ==========================================
// 🔒 AUTHENTICATED AUDIO CONTROL ROUTES
// ==========================================

// Helper: Resolve local file path safely within allowed directories (prevents path traversal)
function resolveSafeLocalPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim() || inputPath.includes('\0')) return null;
  const resolved = path.resolve(inputPath);
  const allowedRoots = [path.resolve(__dirname), path.resolve(assetsDir), path.resolve(process.cwd())];
  for (const root of allowedRoots) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      return resolved;
    }
  }
  return null;
}

// Play Audio Source (URL or file path) OR Proxy Query to Controller
app.post(['/play', '/api/play'], requireSecret, async (req, res) => {
  const source = req.body.url || req.body.source || req.body.q;
  const { title, volume, webhookUrl, cancelAnnouncement = false } = req.body;

  if (!source) {
    return res.status(400).json({ error: 'Missing "url" or "source" parameter' });
  }

  if (webhookUrl) {
    try {
      const parsedWebhook = new URL(webhookUrl);
      if (parsedWebhook.protocol !== 'http:' && parsedWebhook.protocol !== 'https:') {
        return res.status(400).json({ error: 'Invalid webhookUrl protocol' });
      }
    } catch {
      return res.status(400).json({ error: 'Invalid webhookUrl' });
    }
  }

  const isHttpUrl = typeof source === 'string' && (source.startsWith('http://') || source.startsWith('https://'));
  const looksLikeLocalFile = typeof source === 'string' && (
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(source)
  );

  // If this is a search query or song title from the dashboard, forward directly to Central Controller
  if (!isHttpUrl && !looksLikeLocalFile) {
    console.log(`🔍 [AudioServer] Forwarding song query/request "${source}" to Central Controller for resolution...`);
    return proxyToController(req, res);
  }

  let safeSource = source;
  if (!isHttpUrl) {
    safeSource = resolveSafeLocalPath(source);
    if (!safeSource) {
      return res.status(400).json({ error: 'Invalid or disallowed local file path' });
    }
  }

  if (cancelAnnouncement) {
    streamManager.stopAnnouncement();
  }

  res.json({ status: 'playing', source: safeSource });

  audioPlayer.play({ source: safeSource, title, volume, webhookUrl }).catch((err) => {
    console.error('[AudioServer] Playback error:', err.message);
  });
});

// Stop Playback - stop local player
app.post(['/stop', '/api/stop'], requireSecret, (req, res) => {
  streamManager.stopAnnouncement();
  audioPlayer.stop(false);
  res.json({ status: 'stopped' });
});

// Adjust Volume
app.post('/api/volume', requireSecret, (req, res) => {
  const { volume } = req.body;
  const newVol = audioPlayer.setVolume(volume);
  res.json({ status: 'ok', volume: newVol });
});

// Real-time Voice / TTS Announcement Overlay
const MAX_ANNOUNCE_BYTES = 5 * 1024 * 1024; // 5 MB cap
app.post(['/announce', '/api/announce', '/api/tts/speak', '/api/speech'], requireSecret, async (req, res) => {
  const { url, source, audioBase64, wait = false } = req.body;
  const audioInput = url || source;

  if (!audioInput && !audioBase64) {
    return res.status(400).json({ error: 'Missing audio source (url or audioBase64)' });
  }

  try {
    let mp3Buffer;

    if (audioBase64) {
      mp3Buffer = Buffer.from(audioBase64, 'base64');
      if (mp3Buffer.length > MAX_ANNOUNCE_BYTES) {
        return res.status(413).json({ error: 'Announcement audio exceeds 5 MB limit' });
      }
    } else if (typeof audioInput === 'string' && (audioInput.startsWith('http://') || audioInput.startsWith('https://'))) {
      const fetchResponse = await fetch(audioInput, { signal: AbortSignal.timeout(10000) });
      if (!fetchResponse.ok) {
        return res.status(502).json({ error: `Failed to fetch audio stream: ${fetchResponse.statusText}` });
      }
      const contentLen = Number(fetchResponse.headers.get('content-length') || 0);
      if (contentLen > MAX_ANNOUNCE_BYTES) {
        return res.status(413).json({ error: 'Announcement audio exceeds 5 MB limit' });
      }
      const arrayBuf = await fetchResponse.arrayBuffer();
      if (arrayBuf.byteLength > MAX_ANNOUNCE_BYTES) {
        return res.status(413).json({ error: 'Announcement audio exceeds 5 MB limit' });
      }
      mp3Buffer = Buffer.from(arrayBuf);
    } else {
      const safePath = resolveSafeLocalPath(audioInput);
      if (!safePath) {
        return res.status(400).json({ error: 'Invalid or disallowed local file path' });
      }
      let stat;
      try {
        stat = await fs.promises.stat(safePath);
      } catch {
        return res.status(404).json({ error: 'Local audio file not found' });
      }
      if (stat.size > MAX_ANNOUNCE_BYTES) {
        return res.status(413).json({ error: 'Announcement audio exceeds 5 MB limit' });
      }
      mp3Buffer = await fs.promises.readFile(safePath);
    }

    const sessionId = streamManager.startNewAnnouncementSession();

    if (wait) {
      const ok = await streamManager.streamAnnouncementMp3(mp3Buffer, sessionId);
      if (!ok) {
        return res.status(422).json({ error: 'Invalid 96kbps CBR MP3 announcement payload or interrupted' });
      }
      res.json({ status: 'completed' });
    } else {
      streamManager.streamAnnouncementMp3(mp3Buffer, sessionId).catch((err) => {
        console.error('⚠️ [AudioServer] Announcement playback error:', err.message);
      });
      res.json({ status: 'playing' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stop active announcement
app.post(['/announce/stop', '/api/announce/stop'], requireSecret, (req, res) => {
  streamManager.stopAnnouncement();
  res.json({ status: 'stopped' });
});

// Flush / Reset Audio Stream
app.post(['/flush', '/api/flush'], requireSecret, (req, res) => {
  audioPlayer.stop(false);
  streamManager.stopAnnouncement();
  streamManager.clearBurstBuffer();
  if (!streamManager.isSendingSilence) {
    streamManager.startSilenceFeed();
  }
  res.json({ status: 'flushed' });
});

// ==========================================
// 🔁 PROXY CONTROLLER ENDPOINTS
// ==========================================

async function proxyToController(req, res) {
  const targetUrl = `${CONTROLLER_URL}${req.originalUrl || req.url}`;
  try {
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Accept': 'application/json'
    };
    if (req.headers.authorization) headers['Authorization'] = req.headers.authorization;
    if (req.headers['x-admin-key']) headers['x-admin-key'] = req.headers['x-admin-key'];
    if (req.headers['x-audio-secret']) headers['x-audio-secret'] = req.headers['x-audio-secret'];
    if (req.headers['x-room-id']) headers['x-room-id'] = req.headers['x-room-id'];

    const fetchOptions = {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(10000)
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && Object.keys(req.body).length > 0) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    const controllerRes = await fetch(targetUrl, fetchOptions);
    const contentType = controllerRes.headers.get('content-type');

    res.status(controllerRes.status);
    if (contentType && contentType.includes('application/json')) {
      const data = await controllerRes.json();
      return res.json(data);
    } else {
      const text = await controllerRes.text();
      return res.send(text);
    }
  } catch (err) {
    console.error(`💥 [AudioServer Proxy Error] Failed to proxy to ${targetUrl}:`, err.message);
    return res.status(502).json({
      error: 'Failed to communicate with Central Controller',
      details: err.message
    });
  }
}

// Reverse proxy routes for Dashboard & Bot integration
app.all([
  '/api/queue*',
  '/api/skip*',
  '/api/search*',
  '/api/system*',
  '/api/modes*',
  '/api/worker*',
  '/api/rooms*'
], requireSecret, proxyToController);

// ==========================================
// 🧪 HIGH-LOAD SIMULATED LISTENER ENGINE
// ==========================================
const simulatedClients = new Set();
function addSimulatedListeners(count = 10) {
  for (let i = 0; i < count; i++) {
    const mockRes = {
      writable: true,
      writableLength: 0,
      headersSent: true,
      socket: {
        setNoDelay: () => {},
        setKeepAlive: () => {}
      },
      writeHead: () => {},
      write: (chunk) => {
        return true;
      },
      end: () => {
        simulatedClients.delete(mockRes);
      },
      on: (event, handler) => {
        if (event === 'close') mockRes._closeHandler = handler;
      }
    };
    simulatedClients.add(mockRes);
    streamManager.addClient(mockRes);
  }
  console.log(`🧪 [LoadTest] Injected ${count} simulated listeners (Total: ${streamManager.clients.size})`);
}

function stopAllSimulatedListeners() {
  const count = simulatedClients.size;
  for (const client of simulatedClients) {
    streamManager.removeClient(client);
    if (typeof client._closeHandler === 'function') client._closeHandler();
  }
  simulatedClients.clear();
  console.log(`🧪 [LoadTest] Cleared ${count} simulated listeners.`);
}

app.post('/api/load-test/add', requireSecret, (req, res) => {
  const rawCount = Number(req.query.count ?? req.body?.count ?? 10);
  if (!Number.isFinite(rawCount) || rawCount <= 0) {
    return res.status(400).json({ error: 'Invalid count: must be a positive integer (1-200)' });
  }
  const count = Math.min(200, Math.floor(rawCount));
  addSimulatedListeners(count);
  res.json({
    success: true,
    added: count,
    simulatedListeners: simulatedClients.size,
    totalListeners: streamManager.clients.size
  });
});

app.post('/api/load-test/stop', requireSecret, (req, res) => {
  stopAllSimulatedListeners();
  res.json({
    success: true,
    simulatedListeners: 0,
    totalListeners: streamManager.clients.size
  });
});

app.get('/api/load-test/status', requireSecret, (req, res) => {
  res.json({
    simulatedListeners: simulatedClients.size,
    totalListeners: streamManager.clients.size
  });
});

// Start listening
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║       🎵 HIGHRISE DEDICATED ZERO-CPU AUDIO SERVER 🎵           ║
║       🛡️ FORTIFIED WITH ACTIVE DDOS & FLOOD SHIELD 🛡️          ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:           ${String(PORT).padEnd(44)} ║
║  Bitrate:        ${AUDIO_BITRATE.padEnd(44)} ║
║  Stream URL:     http://localhost:${PORT}/stream${' '.repeat(Math.max(0, 31 - String(PORT).length))} ║
║  DDoS Shield:    Active (Pre-Routing Jail, Max 50 req/10s)    ║
║  Stream Cap:     Max 3 / IP | Max 50 Global                   ║
║  Anti-Slowloris: Enforced (15s Request / 8s Header Timeouts)  ║
╚═══════════════════════════════════════════════════════════════╝
  `);
});

// Anti-Slowloris Timeouts on raw HTTP Server
server.requestTimeout = 15000;  // 15 seconds max for standard HTTP requests
server.headersTimeout = 8000;   // 8 seconds max to receive HTTP headers
server.keepAliveTimeout = 5000; // 5 seconds idle keepalive

// Graceful container shutdown handlers
const handleShutdown = (signal) => {
  console.log(`\n🛑 [AudioServer] Received ${signal}. Draining active streams...`);
  stopAllSimulatedListeners();
  if (streamManager) {
    streamManager.stopSilenceFeed();
    for (const client of streamManager.clients) {
      try { client.end(); } catch (_) {}
    }
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
