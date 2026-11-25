import express from "express";
import { spawn, execSync, exec } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import { PassThrough, Readable } from "stream";
import yts from "yt-search";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import googleTTS from "google-tts-api";
import ffmpegStatic from "ffmpeg-static";
import session from "express-session";
import rateLimit from "express-rate-limit";
import crypto from "crypto";
import dotenv from "dotenv";
// live_logs disabled for CPU optimization

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env explicitly from script directory and current working directory with override: true
if (fs.existsSync(path.join(__dirname, ".env"))) {
  dotenv.config({ path: path.join(__dirname, ".env"), override: true });
}
if (fs.existsSync(path.join(process.cwd(), ".env"))) {
  dotenv.config({ path: path.join(process.cwd(), ".env"), override: true });
}
dotenv.config({ override: true });

const CACHE_DIR = path.join(__dirname, 'cache');
const TTS_CACHE_DIR = path.join(__dirname, 'tts_cache');
try {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  if (!fs.existsSync(TTS_CACHE_DIR)) fs.mkdirSync(TTS_CACHE_DIR, { recursive: true });
} catch (_) {}

// Process Crash Guardian - Prevents unhandled errors from terminating the server
process.on('uncaughtException', (err) => {
  console.error('💥 [Crash Guardian] Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 [Crash Guardian] Unhandled Rejection at:', promise, 'reason:', reason);
});


const app = express();
app.set("trust proxy", 1);
app.use(express.json());

let resolvedFfmpegPath = null;

function getFFmpegPath() {
  if (resolvedFfmpegPath) return resolvedFfmpegPath;

  // 1. Explicit environment variable
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    resolvedFfmpegPath = process.env.FFMPEG_PATH;
    console.log(`🎬 Using FFmpeg from FFMPEG_PATH: ${resolvedFfmpegPath}`);
    return resolvedFfmpegPath;
  }

  // 2. Check ffmpeg-static package
  if (ffmpegStatic && typeof ffmpegStatic === "string" && fs.existsSync(ffmpegStatic)) {
    try {
      if (process.platform !== "win32") {
        try { fs.chmodSync(ffmpegStatic, 0o755); } catch (e) {}
      }
      resolvedFfmpegPath = ffmpegStatic;
      console.log(`🎬 Using FFmpeg from ffmpeg-static: ${resolvedFfmpegPath}`);
      return resolvedFfmpegPath;
    } catch (e) {}
  }

  // 3. Check system PATH via which/where
  try {
    const cmd = process.platform === "win32" ? "where ffmpeg" : "which ffmpeg";
    const systemPath = execSync(cmd, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/)[0];
    if (systemPath && fs.existsSync(systemPath)) {
      resolvedFfmpegPath = systemPath;
      console.log(`🎬 Using system FFmpeg: ${resolvedFfmpegPath}`);
      return resolvedFfmpegPath;
    }
  } catch (e) {}

  // 4. Common standard Linux/Unix installation locations
  const commonPaths = [
    "/usr/bin/ffmpeg",
    "/usr/local/bin/ffmpeg",
    "/bin/ffmpeg",
    "/usr/lib/ffmpeg"
  ];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      resolvedFfmpegPath = p;
      console.log(`🎬 Using FFmpeg at standard path: ${resolvedFfmpegPath}`);
      return resolvedFfmpegPath;
    }
  }

  // 5. Fallback: return 'ffmpeg' and let OS resolve from PATH
  resolvedFfmpegPath = "ffmpeg";
  console.log(`🎬 Falling back to 'ffmpeg' from PATH`);
  return resolvedFfmpegPath;
}

ffmpeg.setFfmpegPath(getFFmpegPath());

// Serve static dashboard files with browser cache to eliminate repeat disk I/O and CPU
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d", etag: true }));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 86400000 } // 24h
});

// Bypass session allocation on high-frequency streaming and health routes to save CPU & RAM
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p === "/stream" || p.startsWith("/stream") || p === "/health" || p === "/ping" || p.startsWith("/assets")) {
    return next();
  }
  return sessionMiddleware(req, res, next);
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // 30 requests per windowMs
  message: { error: "Too many login attempts, please try again later." }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 180, // 180 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." }
});

function timingSafeCompare(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const requireAuth = (req, res, next) => {
  if (req.session && req.session.authenticated) {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (timingSafeCompare(token, ADMIN_PASSWORD)) {
      return next();
    }
  }

  const queryToken = (req.query.token || req.query.auth || '').trim();
  if (queryToken && timingSafeCompare(queryToken, ADMIN_PASSWORD)) {
    return next();
  }
  
  res.status(401).send({ error: "Unauthorized" });
};

// Global rate limiter (exempting live audio streaming)
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (p === '/stream' || p.startsWith('/stream')) {
    return next();
  }
  return apiLimiter(req, res, next);
});

// GLOBAL AUTH: Allow direct unauthenticated access for Highrise bot & room listeners
app.use((req, res, next) => {
  const p2 = req.path.toLowerCase();
  const publicPaths = [
    '/', '/events', '/current', '/queue', '/stats', '/health', '/ping',
    '/stream', '/play', '/next', '/stop', '/search', '/insert',
    '/volume', '/quality', '/announcements', '/api/login', '/api/bot-command',
    '/api/register-bridge', '/api/bridge-status'
  ];
  if (publicPaths.includes(p2) || p2.startsWith('/stream') || p2.startsWith('/assets') || p2.startsWith('/public')) {
    return next();
  }
  // Enforce auth strictly for administrative operations (e.g. /api/restart, /api/terminal, /api/config)
  return requireAuth(req, res, next);
});

// Early /health removed; comprehensive /health at line 2469 active


// ==========================================
// 🌉 MULTI-BRIDGE POOL & LOAD BALANCER
// ==========================================
class BridgePoolManager {
  constructor() {
    this.bridges = new Map();
    this.storageFile = path.join(__dirname, 'cache', 'bridge_pool.json');
    this.loadFromDisk();
    setInterval(() => this.pruneStaleBridges(), 60000);
  }

  loadFromDisk() {
    try {
      const legacyFile = path.join(__dirname, 'cache', 'bridge_url.txt');
      if (fs.existsSync(legacyFile)) {
        const savedUrl = fs.readFileSync(legacyFile, 'utf8').trim();
        if (savedUrl) this.register(savedUrl, 'Primary Bridge');
      }

      if (process.env.RESIDENTIAL_BRIDGE_URL) {
        this.register(process.env.RESIDENTIAL_BRIDGE_URL, 'Env Bridge');
      }

      if (fs.existsSync(this.storageFile)) {
        const data = JSON.parse(fs.readFileSync(this.storageFile, 'utf8'));
        if (Array.isArray(data)) {
          for (const b of data) {
            if (b && b.url) {
              this.bridges.set(b.url, {
                url: b.url,
                name: b.name || `Bridge-${this.bridges.size + 1}`,
                lastSeen: b.lastSeen || Date.now(),
                isHealthy: b.isHealthy ?? true,
                lastHealthCheck: 0,
                failCount: 0,
                activeDownloads: 0,
                totalDownloads: b.totalDownloads || 0
              });
            }
          }
        }
      }
    } catch (_) {}
  }

  saveToDisk() {
    try {
      const list = Array.from(this.bridges.values()).map(b => ({
        url: b.url,
        name: b.name,
        lastSeen: b.lastSeen,
        isHealthy: b.isHealthy,
        totalDownloads: b.totalDownloads
      }));
      fs.writeFileSync(this.storageFile, JSON.stringify(list, null, 2), 'utf8');

      const best = this.getPrimaryBridge();
      if (best) {
        fs.writeFileSync(path.join(__dirname, 'cache', 'bridge_url.txt'), best.url, 'utf8');
      }
    } catch (_) {}
  }

  register(rawUrl, customName = null) {
    if (!rawUrl) return null;
    const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
    const now = Date.now();
    const existing = this.bridges.get(cleanUrl);

    const record = {
      url: cleanUrl,
      name: customName || existing?.name || `Bridge-${this.bridges.size + 1}`,
      lastSeen: now,
      isHealthy: true,
      lastHealthCheck: now,
      failCount: 0,
      activeDownloads: existing?.activeDownloads || 0,
      totalDownloads: existing?.totalDownloads || 0
    };

    // Deduplicate: remove any stale tunnel for the same device name
    if (customName) {
      for (const [oldUrl, b] of this.bridges.entries()) {
        if (b.name === customName && oldUrl !== cleanUrl) {
          console.log(`🔄 [BridgePool] Replacing stale tunnel for "${customName}": ${oldUrl} -> ${cleanUrl}`);
          this.bridges.delete(oldUrl);
        }
      }
    }

    const isNew = !existing;
    this.bridges.set(cleanUrl, record);

    if (isNew) {
      console.log(`🌉 [BridgePool] Registered new residential bridge: "${record.name}" (${cleanUrl}) [Total bridges: ${this.bridges.size}]`);
      this.saveToDisk();
    } else {
      existing.lastSeen = now;
      existing.isHealthy = true;
      existing.failCount = 0;
      if (customName && existing.name !== customName) existing.name = customName;
    }
    return record;
  }

  remove(rawUrl) {
    if (!rawUrl) return;
    const cleanUrl = rawUrl.trim().replace(/\/+$/, '');
    if (this.bridges.has(cleanUrl)) {
      const b = this.bridges.get(cleanUrl);
      console.log(`🧹 [BridgePool] Removed dead bridge "${b?.name || 'Bridge'}" (${cleanUrl})`);
      this.bridges.delete(cleanUrl);
      this.saveToDisk();
    }
  }

  getPrimaryBridge() {
    const active = this.getAvailableBridges();
    return active.length > 0 ? active[0] : null;
  }

  getAvailableBridges() {
    const now = Date.now();
    const candidates = [];
    for (const b of this.bridges.values()) {
      const isAlive = (now - b.lastSeen < 300000) && b.failCount < 3;
      if (isAlive && b.isHealthy) {
        candidates.push(b);
      }
    }
    // Load balance: least active downloads first, then lowest failCount, then newest
    candidates.sort((a, b) => {
      if (a.activeDownloads !== b.activeDownloads) return a.activeDownloads - b.activeDownloads;
      if (a.failCount !== b.failCount) return a.failCount - b.failCount;
      return b.lastSeen - a.lastSeen;
    });
    return candidates;
  }

  async checkBridgeHealth(bridge) {
    if (!bridge) return false;
    const now = Date.now();
    if (now - bridge.lastHealthCheck < 15000) {
      return bridge.isHealthy;
    }
    try {
      const resp = await fetch(`${bridge.url}/health`, { signal: AbortSignal.timeout(3500) });
      bridge.isHealthy = resp.ok;
      if (resp.ok) {
        bridge.failCount = 0;
        bridge.lastSeen = now;
      }
    } catch (_) {
      bridge.isHealthy = false;
      bridge.failCount = (bridge.failCount || 0) + 1;
    }
    bridge.lastHealthCheck = now;
    return bridge.isHealthy;
  }

  async checkPoolHealth() {
    const candidates = Array.from(this.bridges.values());
    if (candidates.length === 0) return false;
    await Promise.allSettled(candidates.map(b => this.checkBridgeHealth(b)));
    return candidates.some(b => b.isHealthy);
  }

  markDownloadStart(bridge) {
    if (bridge) {
      bridge.activeDownloads = (bridge.activeDownloads || 0) + 1;
      bridge.totalDownloads = (bridge.totalDownloads || 0) + 1;
    }
  }

  markDownloadEnd(bridge, success = true) {
    if (bridge) {
      bridge.activeDownloads = Math.max(0, (bridge.activeDownloads || 1) - 1);
      if (success) {
        bridge.failCount = 0;
        bridge.isHealthy = true;
      } else {
        bridge.failCount = (bridge.failCount || 0) + 1;
        if (bridge.failCount >= 2) {
          bridge.isHealthy = false;
        }
      }
    }
  }

  pruneStaleBridges() {
    const now = Date.now();
    let pruned = 0;
    for (const [url, b] of this.bridges.entries()) {
      if (now - b.lastSeen > 900000) {
        this.bridges.delete(url);
        pruned++;
      }
    }
    if (pruned > 0) {
      console.log(`🧹 [BridgePool] Pruned ${pruned} offline bridge(s) [Active: ${this.bridges.size}]`);
      this.saveToDisk();
    }
  }

  getStatus() {
    const now = Date.now();
    const list = Array.from(this.bridges.values()).map(b => ({
      name: b.name,
      url: b.url,
      isHealthy: b.isHealthy,
      activeDownloads: b.activeDownloads,
      totalDownloads: b.totalDownloads,
      failCount: b.failCount,
      lastSeenSecAgo: Math.floor((now - b.lastSeen) / 1000)
    }));
    return {
      activeBridges: list.filter(b => b.isHealthy && b.lastSeenSecAgo < 300).length,
      totalBridges: list.length,
      bridges: list
    };
  }
}

const bridgePoolManager = new BridgePoolManager();
let residentialBridgeUrl = bridgePoolManager.getPrimaryBridge()?.url || null;

app.post("/api/register-bridge", (req, res) => {
  const { url, name } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url parameter" });
  const bridge = bridgePoolManager.register(url, name);
  residentialBridgeUrl = bridgePoolManager.getPrimaryBridge()?.url || bridge.url;
  res.json({
    success: true,
    bridge: {
      name: bridge.name,
      url: bridge.url
    },
    totalActiveBridges: bridgePoolManager.getAvailableBridges().length
  });
});

app.get("/api/bridge-status", async (req, res) => {
  const status = bridgePoolManager.getStatus();
  res.json({
    active: status.activeBridges > 0,
    ...status
  });
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

app.get("/debug-exec", (req, res) => res.status(403).send("Disabled for CPU protection."));

app.get("/debug-ytdlp", async (req, res) => {
  const testUrl = req.query.url || 'https://youtube.com/watch?v=NPRd7Xc0tfM';
  const outTest = path.join(CACHE_DIR, `debug_${Date.now()}.m4a`);
  
  const results = {
    platform: process.platform,
    pythonCmd: PYTHON_CMD,
    ytdlpPath: YTDLP_PATH,
    ytdlpExists: fs.existsSync(YTDLP_PATH),
    ytdlpSize: fs.existsSync(YTDLP_PATH) ? fs.statSync(YTDLP_PATH).size : 0,
    envProxies: {
      YTDLP_PROXY: process.env.YTDLP_PROXY || null,
      PROXY: process.env.PROXY || null,
      HTTP_PROXY: process.env.HTTP_PROXY || null,
      HTTPS_PROXY: process.env.HTTPS_PROXY || null
    },
    versionStdout: '',
    versionStderr: '',
    downloadStdout: '',
    downloadStderr: '',
    code: null,
    signal: null,
    error: null,
    durationMs: 0
  };

  const startTime = Date.now();

  try {
    const p = spawnYtdlp(['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => results.versionStdout += d.toString());
    p.stderr.on('data', d => results.versionStderr += d.toString());
    await new Promise(r => {
      const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch(e) {} r(); }, 4000);
      p.on('close', () => { clearTimeout(t); r(); });
      p.on('error', err => { clearTimeout(t); results.versionError = err.message; r(); });
    });
  } catch (e) {
    results.versionError = e.message;
  }

  try {
    const ytdlpArgs = [
      '--force-ipv4',
      '--no-cache-dir',
      '--socket-timeout', '5',
      '--retries', '1',
      '--extractor-args', 'youtube:player_client=android,web',
      '-f', 'ba/b[height<=360]/18/best',
      '--no-playlist',
      '--no-check-certificates',
      '--newline',
      '-v',
      '-o', outTest,
      testUrl
    ];

    const proc = spawnYtdlp(ytdlpArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => results.downloadStdout += d.toString());
    proc.stderr.on('data', d => results.downloadStderr += d.toString());
    
    const timeout = setTimeout(() => {
      results.timedOut = true;
      try { proc.kill('SIGKILL'); } catch(e) {}
    }, 12000);

    await new Promise(r => {
      proc.on('close', (c, s) => {
        clearTimeout(timeout);
        results.code = c;
        results.signal = s;
        r();
      });
      proc.on('error', err => {
        clearTimeout(timeout);
        results.error = err.message;
        r();
      });
    });
  } catch (e) {
    results.error = e.message;
  }

  results.durationMs = Date.now() - startTime;
  results.fileExists = fs.existsSync(outTest);
  results.fileSize = results.fileExists ? fs.statSync(outTest).size : 0;
  try { if (results.fileExists) fs.unlinkSync(outTest); } catch (e) {}

  res.json(results);
});

app.post("/api/login", loginLimiter, (req, res) => {
  const { password } = req.body;
  if (password && timingSafeCompare(password, ADMIN_PASSWORD)) {
    req.session.authenticated = true;
    res.send({ status: "ok", token: ADMIN_PASSWORD });
  } else {
    res.status(401).send({ error: "Invalid password" });
  }
});


const __ytdlp_filename = fileURLToPath(import.meta.url);
const __ytdlp_dirname = path.dirname(__ytdlp_filename);
const isWindows = process.platform === "win32";
const YTDLP_NAME = isWindows ? "yt-dlp.exe" : "yt-dlp";
const YTDLP_PATH = path.join(__ytdlp_dirname, YTDLP_NAME);
const YTDLP_URL = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP_NAME}`;

// On Pterodactyl containers, /home/container is mounted noexec.
// The yt-dlp file is a Python zipapp (#!/usr/bin/env python3).
// We must run it via python3 explicitly to bypass the noexec restriction.
let PYTHON_CMD = null; // Will be set during startup

function spawnYtdlp(args, options) {
  if (PYTHON_CMD && !isWindows) {
    // Run as: python3 -u /path/to/yt-dlp [args...] (-u forces unbuffered stdout/stderr)
    return spawn(PYTHON_CMD, ['-u', YTDLP_PATH, ...args], options);
  }
  // Fallback: run directly (works on Windows, or if exec is allowed)
  return spawn(YTDLP_PATH, args, options);
}

async function detectPython() {
  for (const cmd of ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3', '/usr/bin/python']) {
    try {
      const p = spawn(cmd, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const result = await new Promise(resolve => {
        let out = '';
        p.stdout.on('data', d => out += d);
        p.stderr.on('data', d => out += d);
        const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch(e) {} resolve(null); }, 3000);
        p.on('close', code => { clearTimeout(t); resolve(code === 0 ? out.trim() : null); });
        p.on('error', () => { clearTimeout(t); resolve(null); });
      });
      if (result) {
        console.log(`🐍 Found ${cmd}: ${result}`);
        return cmd;
      }
    } catch (e) {}
  }
  return null;
}

async function ensureYtDlp() {
  // Detect Python first (needed on noexec containers)
  if (!isWindows) {
    PYTHON_CMD = await detectPython();
    if (PYTHON_CMD) {
      console.log(`🐍 Will run yt-dlp via: ${PYTHON_CMD} ${YTDLP_PATH}`);
    } else {
      console.log('⚠️ No python3 found, will try direct execution');
    }
  }
  
  if (fs.existsSync(YTDLP_PATH)) {
    const stats = fs.statSync(YTDLP_PATH);
    if (stats.size > 1000) {
      if (!isWindows) {
        try { fs.chmodSync(YTDLP_PATH, 0o755); } catch (e) {}
      }
      console.log("✅ yt-dlp binary exists and is ready.");
      return true;
    } else {
      console.log("⚠️ yt-dlp binary is corrupted, re-downloading...");
      try { fs.unlinkSync(YTDLP_PATH); } catch (e) {}
    }
  }

  console.log("⬇️ Downloading latest yt-dlp binary from GitHub...");
  
  try {
    const response = await fetch(YTDLP_URL, { redirect: 'follow' });
    
    if (!response.ok) {
      console.error(`❌ yt-dlp download failed: HTTP ${response.status}`);
      return false;
    }
    
    const buffer = await response.buffer();
    fs.writeFileSync(YTDLP_PATH, buffer);
    if (!isWindows) {
      try { fs.chmodSync(YTDLP_PATH, 0o755); } catch (e) {}
    }
    
    const stats = fs.statSync(YTDLP_PATH);
    console.log(`✅ Latest yt-dlp binary downloaded (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    return true;
  } catch (err) {
    console.error("❌ yt-dlp download failed:", err.message);
    if (fs.existsSync(YTDLP_PATH)) {
      try { fs.unlinkSync(YTDLP_PATH); } catch (e) {}
    }
    return false;
  }
}

function getCookieArgs() {
  // Completely disabled to eliminate YouTube reload challenges and timeout races
  return [];
}

function getProxyArgs() {
  const proxy = process.env.YTDLP_PROXY || process.env.PROXY;
  if (proxy && proxy.trim().length > 0) {
    console.log(`🌐 [ProxyEngine] Using proxy for stream requests: ${proxy.trim()}`);
    return ['--proxy', proxy.trim()];
  }
  return [];
}

// Remove any stale local tmp directories that may contain dead PyInstaller locks
try {
  const staleTmp = path.join(__dirname, 'tmp');
  if (fs.existsSync(staleTmp)) fs.rmSync(staleTmp, { recursive: true, force: true });
} catch (e) {}
const ytdlpEnv = {
  ...process.env,
  DENO_V8_FLAGS: '--max-old-space-size=48 --max-semi-space-size=1',
  NODE_OPTIONS: '--max-old-space-size=48'
};

const QUEUE_FILE = path.join(__dirname, "queue_state.json");
const PLAYBACK_STATE_FILE = path.join(__dirname, "playback_state.json");
const ERROR_LOG_FILE = path.join(__dirname, "logs", "errors.log");
const SETTINGS_FILE = path.join(__dirname, "server_settings.json");

const DEFAULT_SETTINGS = {
  announcementsEnabled: false,
  announcementVoice: 'en',
  announcementWordLimit: 10,
  volume: 100,
  audioBitrate: '192k'
};

const VOICE_OPTIONS = {
  'en': 'English (US)',
  'en-gb': 'English (UK)',
  'en-au': 'English (Australia)',
  'en-in': 'English (India)',
  'hi': 'Hindi',
  'ur': 'Urdu',
  'es': 'Spanish',
  'fr': 'French',
  'de': 'German',
  'it': 'Italian',
  'pt': 'Portuguese',
  'ar': 'Arabic'
};

const AVAILABLE_BITRATES = ['96k', '128k', '192k', '256k', '320k'];

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf8');
      const loaded = JSON.parse(data);
      return { ...DEFAULT_SETTINGS, ...loaded };
    }
  } catch (err) {
    console.error('⚠️ Failed to load settings, using defaults:', err.message);
  }
  return { ...DEFAULT_SETTINGS };
}

async function saveSettings() {
  try {
    const settings = { 
      announcementsEnabled,
      announcementVoice,
      announcementWordLimit,
      volume,
      audioBitrate
    };
    await atomicWrite(SETTINGS_FILE, JSON.stringify(settings, null, 2));
    console.log(`💾 Settings saved (announcements: ${announcementsEnabled}, voice: ${announcementVoice}, wordLimit: ${announcementWordLimit}, volume: ${volume}%, bitrate: ${audioBitrate})`);
  } catch (err) {
    console.error('⚠️ Failed to save settings:', err.message);
  }
}

const settings = loadSettings();
let announcementsEnabled = settings.announcementsEnabled;
let announcementVoice = settings.announcementVoice || 'en';
let announcementWordLimit = settings.announcementWordLimit || 10;
let volume = settings.volume !== undefined ? settings.volume : 100;
let audioBitrate = settings.audioBitrate || '192k';

function truncateToWords(text, wordLimit) {
  const words = text.split(/\s+/);
  if (words.length <= wordLimit) return text;
  return words.slice(0, wordLimit).join(' ');
}

async function generateTTSAudio(text) {
  try {
    console.log(`🎙️ Generating TTS: "${text.substring(0, 50)}..."`);
    
    const url = await googleTTS(text, announcementVoice, 1);
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TTS fetch failed: ${response.status}`);
    }
    
    const audioBuffer = await response.buffer();
    console.log(`✅ TTS audio fetched (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
    
    return audioBuffer;
  } catch (err) {
    console.error('❌ TTS generation failed:', err.message);
    return null;
  }
}

async function injectTTSToStream(ttsBuffer, onDecoded = null, cacheKey = null) {
  const cachedPcmPath = cacheKey ? path.join(CACHE_DIR, `tts_${cacheKey}.pcm`) : null;
  if (cachedPcmPath && fs.existsSync(cachedPcmPath)) {
    try {
      const cachedPcm = await fs.promises.readFile(cachedPcmPath);
      if (cachedPcm.length > 10000) {
        console.log(`⚡ [TTSCache] Instant 0ms Cache Hit for announcement (${(cachedPcm.length / 1024).toFixed(1)} KB PCM, 0% CPU!)`);
        try {
          const now = new Date();
          fs.utimesSync(cachedPcmPath, now, now);
        } catch (_) {}
        if (typeof onDecoded === 'function') {
          try { onDecoded(); } catch (e) {}
        }
        await streamManager.feedPCMAudioRealtime(cachedPcm);
        console.log('✅ TTS announcement completed playback');
        return true;
      }
    } catch (_) {}
  }

  return new Promise((resolve) => {
    if (!ttsBuffer || !streamManager.pcmInputStream || streamManager.pcmInputStream.destroyed) {
      if (typeof onDecoded === 'function') onDecoded();
      resolve(false);
      return;
    }
    
    console.log('🎙️ Decoding TTS to PCM and injecting to stream...');
    
    const volumeFilter = volume !== 100 ? `volume=${volume / 100}` : '';
    const filterArgs = volumeFilter ? ['-af', volumeFilter] : [];
    
    const ttsDecoder = spawn(getFFmpegPath(), [
      '-threads', '1',
      '-i', 'pipe:0',
      '-f', 's16le',
      '-ar', '44100',
      '-ac', '2',
      ...filterArgs,
      'pipe:1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let pcmData = [];
    
    ttsDecoder.stdout.on('data', (chunk) => {
      pcmData.push(chunk);
    });
    
    ttsDecoder.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error')) {
        console.error('TTS decode error:', msg);
      }
    });
    
    ttsDecoder.on('close', async (code) => {
      if (typeof onDecoded === 'function') {
        try { onDecoded(); } catch (e) {}
      }
      if (code === 0 && pcmData.length > 0) {
        const fullPCM = Buffer.concat(pcmData);
        const durationSec = (fullPCM.length / 176400).toFixed(1);
        console.log(`✅ TTS decoded (${(fullPCM.length / 1024).toFixed(1)} KB PCM, ~${durationSec}s speech), playing smoothly at 1x rate...`);
        
        if (cachedPcmPath && fullPCM.length > 10000) {
          fs.promises.writeFile(cachedPcmPath, fullPCM)
            .then(() => pruneTTSCache())
            .catch(() => {});
        }
        
        try {
          await streamManager.feedPCMAudioRealtime(fullPCM);
          console.log('✅ TTS announcement completed playback');
          resolve(true);
        } catch (err) {
          console.error('Failed to inject TTS:', err.message);
          resolve(false);
        }
      } else {
        console.error('TTS decode failed with code:', code);
        resolve(false);
      }
    });
    
    ttsDecoder.on('error', (err) => {
      if (typeof onDecoded === 'function') {
        try { onDecoded(); } catch (e) {}
      }
      console.error('TTS decoder error:', err.message);
      resolve(false);
    });
    
    if (ttsDecoder.stdin) {
      ttsDecoder.stdin.on('error', () => {});
      ttsDecoder.stdin.write(ttsBuffer);
      ttsDecoder.stdin.end();
    }
  });
}

// Pre-allocated static silence buffers to eliminate continuous heap allocations (20/sec)
const SILENCE_50MS_PCM = Buffer.alloc(Math.floor((44100 * 50) / 1000) * 2 * 2, 0);
const SILENCE_300MS_PCM = Buffer.alloc(Math.floor((44100 * 300) / 1000) * 2 * 2, 0);

class PersistentStreamManager {
  constructor() {
    this.clients = new Set();
    this.clientMetadata = new Map();
    this.audioBuffer = [];
    this.maxBufferSize = 200;
    this.instantStartChunks = 25;
    
    this.stats = {
      totalBytes: 0,
      droppedClients: 0,
      peakListeners: 0,
      startTime: Date.now(),
      totalConnections: 0
    };
    
    this.persistentEncoder = null;
    this.pcmInputStream = null;
    this.isEncoderRunning = false;
    this.isSendingSilence = false;
    this.silenceInterval = null;
    
    this.transitionSilenceMs = 150;
    this.transitionPcm = null;
    this.transitionOffset = 0;
    this.loadTransitionTrack();
    
    setInterval(() => {
      const now = Date.now();
      for (const [client, meta] of this.clientMetadata) {
        if (meta.writeFailures > 0) {
          meta.writeFailures = Math.floor(meta.writeFailures * 0.5);
        }
        if (meta.isPaused && (now - meta.pausedAt) > 5000) {
          meta.isPaused = false;
          meta.pausedAt = null;
        }
      }
    }, 10000);
  }
  
  startPersistentEncoder() {
    if (this.isEncoderRunning) {
      console.log('🔧 Persistent encoder already running');
      return;
    }
    
    console.log('🚀 Starting persistent FFmpeg encoder (NEVER STOPS)...');
    
    this.pcmInputStream = new PassThrough({ highWaterMark: 128 * 1024 });
    
    this.persistentEncoder = spawn(getFFmpegPath(), [
      '-threads', '1',
      '-f', 's16le',
      '-ar', '44100',
      '-ac', '2',
      '-i', 'pipe:0',
      '-c:a', 'libmp3lame',
      '-b:a', audioBitrate,
      '-compression_level', '0',
      '-flush_packets', '1',
      '-write_xing', '0',
      '-id3v2_version', '0',
      '-f', 'mp3',
      'pipe:1'
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    this.persistentEncoder.stdout.on('data', (chunk) => {
      this.broadcast(chunk);
    });
    
    this.persistentEncoder.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Error') || msg.includes('error')) {
        console.error('FFmpeg encoder:', msg.trim());
      }
    });
    
    this.persistentEncoder.on('error', (err) => {
      console.error('❌ Persistent encoder error:', err.message);
      this.isEncoderRunning = false;
      this.restartEncoder();
    });
    
    this.persistentEncoder.on('close', (code) => {
      console.error(`⚠️ Persistent encoder closed with code ${code} - RESTARTING`);
      this.isEncoderRunning = false;
      this.restartEncoder();
    });
    
    this.pcmInputStream.pipe(this.persistentEncoder.stdin);
    
    this.isEncoderRunning = true;
    this.restartAttempts = 0;
    console.log('✅ Persistent FFmpeg encoder started - will never stop');
    
    this.startSilenceFeed();
  }
  
  restartEncoder() {
    if (this.isEncoderRunning || this.restartTimeout) return;
    
    this.restartAttempts = (this.restartAttempts || 0) + 1;
    const delay = Math.min(1000 * Math.pow(1.5, Math.min(this.restartAttempts - 1, 6)), 15000);
    
    console.log(`🔄 Restarting persistent encoder in ${(delay / 1000).toFixed(1)}s (attempt ${this.restartAttempts})...`);
    this.restartTimeout = setTimeout(() => {
      this.restartTimeout = null;
      this.startPersistentEncoder();
    }, delay);
  }
  

  loadTransitionTrack() {
    try {
      const pcmPath = path.join(__dirname, 'assets', 'transition.pcm');
      const m4aPath = path.join(__dirname, 'assets', 'transition.m4a');

      if (!fs.existsSync(pcmPath) && fs.existsSync(m4aPath)) {
        console.log('🔄 [TransitionEngine] Generating transition.pcm from assets/transition.m4a...');
        try {
          execSync(`"${getFFmpegPath()}" -y -i "${m4aPath}" -f s16le -ar 44100 -ac 2 "${pcmPath}"`, { stdio: 'ignore' });
        } catch (convErr) {
          console.warn('⚠️ [TransitionEngine] ffmpeg audio conversion warning:', convErr.message);
        }
      }

      if (fs.existsSync(pcmPath)) {
        const raw = fs.readFileSync(pcmPath);
        const chunkSize = 8820; // 50ms aligned chunk
        const alignedLen = raw.length - (raw.length % chunkSize);
        this.transitionPcm = Buffer.allocUnsafe(alignedLen);
        raw.copy(this.transitionPcm, 0, 0, alignedLen);
        this.transitionOffset = 0;
        console.log(`☕ [TransitionEngine] Loaded seamless transition music loop (${(this.transitionPcm.length / 1024 / 1024).toFixed(2)} MB, ~${(this.transitionPcm.length / 176400).toFixed(1)}s)`);
      } else {
        console.warn('⚠️ [TransitionEngine] No transition track found at assets/transition.m4a');
      }
    } catch (e) {
      console.error('⚠️ [TransitionEngine] Error loading transition track:', e.message);
      this.transitionPcm = null;
    }
  }

  generateSilencePCM(durationMs = 100) {
    if (durationMs === 50) return SILENCE_50MS_PCM;
    if (durationMs === 300) return SILENCE_300MS_PCM;
    const sampleRate = 44100;
    const channels = 2;
    const bytesPerSample = 2;
    const numSamples = Math.floor((sampleRate * durationMs) / 1000);
    const bufferSize = numSamples * channels * bytesPerSample;
    return Buffer.alloc(bufferSize, 0);
  }
  
  startSilenceFeed() {
    if (this.silenceInterval) return;
    
    this.isSendingSilence = true;
    this.silenceStartTime = Date.now();
    this.silenceSentMs = 0;
    console.log(this.transitionPcm ? '☕ Starting transition music loop to keep stream alive...' : '🔇 Starting silence feed to keep encoder alive...');
    
    const CHUNK_MS = 50;
    const CHUNK_SIZE = 8820;
    const silenceZeroChunk = this.generateSilencePCM(CHUNK_MS);
    
    this.silenceInterval = setInterval(() => {
      if (!this.isSendingSilence || !this.pcmInputStream || this.pcmInputStream.destroyed) {
        return;
      }
      
      const elapsedMs = Date.now() - this.silenceStartTime;
      // Clock-corrected pacing: maintain a 250ms lead cushion ahead of wall-clock time
      // Prevents client buffer starvation and eliminates disconnection between tracks
      while (this.silenceSentMs - elapsedMs < 250) {
        let chunk = silenceZeroChunk;
        // Play transition track during track transitions (up to 45s), then rest on zero-CPU silence when idle
        if (this.transitionPcm && this.transitionPcm.length >= CHUNK_SIZE && this.silenceSentMs < 45000) {
          chunk = this.transitionPcm.subarray(this.transitionOffset, this.transitionOffset + CHUNK_SIZE);
          this.transitionOffset += CHUNK_SIZE;
          if (this.transitionOffset >= this.transitionPcm.length) {
            this.transitionOffset = 0; // Seamless loop wrap-around
          }
        }
        try {
          this.pcmInputStream.write(chunk);
          this.silenceSentMs += CHUNK_MS;
        } catch (err) {
          break;
        }
      }
    }, 50);
  }
  
  stopSilenceFeed() {
    this.isSendingSilence = false;
    console.log(this.transitionPcm ? '🔊 Stopped transition music - real audio playing' : '🔊 Stopped silence feed - real audio playing');
  }
  
  resumeSilenceFeed() {
    this.isSendingSilence = true;
    this.silenceStartTime = Date.now();
    this.silenceSentMs = 0;
    console.log(this.transitionPcm ? '☕ Resuming transition music loop...' : '🔇 Resuming silence feed...');
  }
  
  injectTransitionSilence() {
    if (!this.pcmInputStream || this.pcmInputStream.destroyed) return;
    
    console.log(`🔇 Injecting ${this.transitionSilenceMs}ms transition silence...`);
    const silenceBuffer = this.generateSilencePCM(this.transitionSilenceMs);
    
    try {
      this.pcmInputStream.write(silenceBuffer);
    } catch (err) {
      console.error('Failed to inject transition silence:', err.message);
    }
  }
  
  feedPCMAudio(pcmChunk) {
    if (!this.pcmInputStream || this.pcmInputStream.destroyed) {
      console.error('⚠️ PCM input stream not available');
      return false;
    }
    
    if (this.isSendingSilence) {
      this.stopSilenceFeed();
    }
    
    try {
      return this.pcmInputStream.write(pcmChunk);
    } catch (err) {
      console.error('Error feeding PCM audio:', err.message);
      return false;
    }
  }

  async feedPCMAudioRealtime(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length === 0) return true;
    if (!this.pcmInputStream || this.pcmInputStream.destroyed) {
      console.error('⚠️ PCM input stream not available');
      return false;
    }

    if (this.isSendingSilence) {
      this.stopSilenceFeed();
    }

    const TARGET_LEAD_MS = 250; // 250ms lead cushion prevents burst while maintaining real-time playback
    const chunkSize = 8820; // 50ms of 44.1kHz 16-bit stereo PCM
    let offset = 0;
    const startTime = Date.now();

    while (offset < pcmBuffer.length) {
      if (!this.pcmInputStream || this.pcmInputStream.destroyed) break;
      const end = Math.min(offset + chunkSize, pcmBuffer.length);
      const chunk = pcmBuffer.slice(offset, end);
      try {
        this.pcmInputStream.write(chunk);
      } catch (err) {
        console.error('Error writing realtime PCM chunk:', err.message);
        break;
      }
      offset = end;

      // Maintain an exact 250ms lead cushion ahead of wall-clock real time
      const audioDurationSentMs = (offset / 176400) * 1000;
      const realTimeElapsedMs = Date.now() - startTime;
      const leadMs = audioDurationSentMs - realTimeElapsedMs;

      if (leadMs > TARGET_LEAD_MS) {
        const sleepMs = leadMs - TARGET_LEAD_MS;
        await new Promise(r => setTimeout(r, sleepMs));
      }
    }

    // Await the remaining lead audio so the announcement finishes naturally in real-time
    const totalDurationMs = (pcmBuffer.length / 176400) * 1000;
    const remainingMs = Math.max(0, totalDurationMs - (Date.now() - startTime));
    if (remainingMs > 0) {
      await new Promise(r => setTimeout(r, remainingMs));
    }

    return true;
  }
  
  generateSilenceChunk() {
    const frames = [];
    for (let i = 0; i < 10; i++) {
      const frameHeader = Buffer.from([0xFF, 0xFB, 0x90, 0x00]);
      const frameData = Buffer.alloc(413, 0);
      frames.push(Buffer.concat([frameHeader, frameData]));
    }
    return Buffer.concat(frames);
  }
  
  addClient(res, req) {
    const now = Date.now();
    
    const clientInfo = {
      addedAt: now,
      bytesWritten: 0,
      writeFailures: 0,
      lastWrite: now,
      lastSuccessfulWrite: now,
      isPaused: false,
      pausedAt: null,
      clientId: `${now}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    this.clients.add(res);
    this.clientMetadata.set(res, clientInfo);
    this.stats.totalConnections++;
    
    if (this.clients.size > this.stats.peakListeners) {
      this.stats.peakListeners = this.clients.size;
    }
    
    if (this.audioBuffer.length > 0) {
      try {
        const startIdx = Math.max(0, this.audioBuffer.length - this.instantStartChunks);
        const burstChunks = this.audioBuffer.slice(startIdx);
        if (burstChunks.length > 0) {
          const burstData = Buffer.concat(burstChunks);
          res.write(burstData);
          clientInfo.bytesWritten += burstData.length;
        }
      } catch (err) {
      }
    }
    
    let cleanupCalled = false;
    const cleanup = () => {
      if (cleanupCalled) return;
      cleanupCalled = true;
      setTimeout(() => {
        this.removeClient(res);
      }, 100);
    };
    
    req.on('close', cleanup);
    req.on('aborted', cleanup);
    res.on('error', cleanup);
    res.on('close', cleanup);
    
    res.on('drain', () => {
      const meta = this.clientMetadata.get(res);
      if (meta) {
        meta.isPaused = false;
        meta.pausedAt = null;
        meta.lastSuccessfulWrite = Date.now();
      }
    });
    
    console.log(`📻 Client connected (${this.clients.size} total, ID: ${clientInfo.clientId})`);
  }
  
  removeClient(res) {
    if (this.clients.has(res)) {
      const meta = this.clientMetadata.get(res);
      const clientId = meta?.clientId || 'unknown';
      
      this.clients.delete(res);
      this.clientMetadata.delete(res);
      
      console.log(`📻 Client disconnected (${this.clients.size} remaining, ID: ${clientId})`);
    }
  }
  
  broadcast(chunk) {
    this.audioBuffer.push(chunk);
    if (this.audioBuffer.length > this.maxBufferSize) {
      this.audioBuffer.shift();
    }
    
    if (this.clients.size === 0) return;
    
    this.stats.totalBytes += chunk.length;
    const clientsToRemove = [];
    const now = Date.now();
    
    for (const client of this.clients) {
      const meta = this.clientMetadata.get(client);
      if (!meta) continue;
      
      // Zombie client check: 45 seconds of no activity
      const timeSinceLastSuccess = now - meta.lastSuccessfulWrite;
      if (timeSinceLastSuccess > 45000) {
        console.log(`⚠️ Dropping unresponsive client after ${Math.floor(timeSinceLastSuccess/1000)}s`);
        clientsToRemove.push(client);
        this.stats.droppedClients++;
        continue;
      }

      // Real-time audio backpressure throttling:
      // If a client's TCP socket buffer has accumulated > 64KB (~3.5s of audio),
      // skip sending new chunks until its buffer drains.
      // This absorbs network jitters without dropping the connection or causing reconnection storms!
      if (client.writableLength > 64 * 1024) {
        if (!meta.isPaused) {
          meta.isPaused = true;
          meta.pausedAt = now;
        }
        // Only drop if client has been completely unresponsive / frozen for over 35 seconds
        if (now - meta.lastSuccessfulWrite > 35000) {
          console.log(`⚠️ Dropping unresponsive client after 35s stall (${Math.floor(client.writableLength / 1024)} KB queued)`);
          clientsToRemove.push(client);
          this.stats.droppedClients++;
        }
        continue;
      }
      
      try {
        const canWrite = client.write(chunk);
        meta.lastWrite = now;
        if (canWrite) {
          meta.lastSuccessfulWrite = now;
        }
        meta.bytesWritten += chunk.length;
      } catch (err) {
        if (err.code === 'ERR_STREAM_DESTROYED' || err.code === 'EPIPE' || err.code === 'ECONNRESET') {
          clientsToRemove.push(client);
        }
      }
    }
    
    for (const client of clientsToRemove) {
      this.removeClient(client);
      try {
        client.end();
      } catch (e) {}
    }
  }
  
  getStats() {
    const uptime = (Date.now() - this.stats.startTime) / 1000;
    const bytesPerSecond = uptime > 0 ? this.stats.totalBytes / uptime : 0;
    
    let pausedClients = 0;
    for (const [, meta] of this.clientMetadata) {
      if (meta.isPaused) pausedClients++;
    }
    
    return {
      activeListeners: this.clients.size,
      pausedListeners: pausedClients,
      peakListeners: this.stats.peakListeners,
      totalConnections: this.stats.totalConnections,
      totalBytesSent: this.stats.totalBytes,
      droppedClients: this.stats.droppedClients,
      bytesPerSecond: Math.round(bytesPerSecond),
      uptimeSeconds: Math.round(uptime),
      bufferSize: this.audioBuffer.length,
      isSendingSilence: this.isSendingSilence,
      encoderRunning: this.isEncoderRunning
    };
  }
  
  getHealthStatus() {
    return {
      encoderPID: this.persistentEncoder?.pid || null,
      encoderAlive: this.persistentEncoder && !this.persistentEncoder.killed,
      isEncoderRunning: this.isEncoderRunning,
      clientCount: this.clients.size,
      isSendingSilence: this.isSendingSilence
    };
  }
  
  clear() {
    this.clients.clear();
    this.clientMetadata.clear();
  }
  
  clearAudioBuffer() {
    const oldLength = this.audioBuffer.length;
    this.audioBuffer = [];
    console.log(`🧹 Audio buffer cleared (had ${oldLength} chunks)`);
  }
}

function logError(functionName, error, additionalContext = {}) {
  const timestamp = new Date().toISOString().replace('T', ' ').split('.')[0];
  const errorType = error.name || 'Error';
  const errorMessage = error.message || String(error);
  const stack = error.stack || 'No stack trace available';
  
  let logEntry = `[${timestamp}] ============================================================\n`;
  logEntry += `Function: ${functionName}\n`;
  logEntry += `Error Type: ${errorType}\n`;
  logEntry += `Error Message: ${errorMessage}\n`;
  
  if (Object.keys(additionalContext).length > 0) {
    logEntry += `Additional Context: ${JSON.stringify(additionalContext, null, 2)}\n`;
  }
  
  logEntry += `------------------------------------------------------------\n`;
  logEntry += `Stack Trace:\n${stack}\n`;
  logEntry += `============================================================\n\n`;
  
  try {
    const logsDir = path.dirname(ERROR_LOG_FILE);
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    fs.appendFileSync(ERROR_LOG_FILE, logEntry, 'utf8');
    console.error(`❌ Error logged to ${ERROR_LOG_FILE}: ${errorMessage}`);
  } catch (writeError) {
    console.error('Failed to write to error log:', writeError.message);
    console.error('Original error:', errorMessage);
  }
}

const writeLocks = {};

async function atomicWrite(filepath, data) {
  while (writeLocks[filepath]) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  writeLocks[filepath] = true;
  try {
    const tempPath = filepath + '.tmp';
    await fs.promises.writeFile(tempPath, data);
    await fs.promises.rename(tempPath, filepath);
  } finally {
    writeLocks[filepath] = false;
  }
}

let queue = [];
let isPlaying = false;
let currentTitle = "No music playing";
let currentMetadata = null;
let currentIsAutoplay = false;
let currentYtdlp = null;
let currentDecoder = null;
let isTransitioning = false;
let isPreparingTrack = false;
let streamVersion = 0;
let currentStreamId = 0;
let lastSkipTime = 0;
let currentStartTime = 0;
let consecutiveZeroByteFailures = 0;

try {
  if (fs.existsSync(CACHE_DIR)) {
    const staleFiles = fs.readdirSync(CACHE_DIR);
    for (const f of staleFiles) {
      if (f.endsWith('.tmp') || f.endsWith('.part') || f.endsWith('.ytdl') || (f.startsWith('track_') && f.endsWith('.m4a')) || f.startsWith('debug_')) {
        try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (e) {}
      }
    }
  }
  if (fs.existsSync(TTS_CACHE_DIR)) {
    const legacyFiles = fs.readdirSync(TTS_CACHE_DIR);
    for (const f of legacyFiles) {
      try { fs.unlinkSync(path.join(TTS_CACHE_DIR, f)); } catch (e) {}
    }
  }
} catch (e) {}
let currentLocalFilePath = null;

// ==========================================
// 🎵 CACHE BUDGET CONFIGURATION & LRU GUARDS
// ==========================================
const MAX_CACHED_SONGS = parseInt(process.env.MAX_CACHED_SONGS, 10) || 60;
const MAX_CACHE_SIZE_BYTES = (parseInt(process.env.MAX_CACHE_SIZE_MB, 10) || 400) * 1024 * 1024; // 400 MB total cache budget
const MIN_KEPT_SONGS = 5; // Allow evicting down to 5 songs if individual files are huge

const MAX_TTS_CACHE_BYTES = (parseInt(process.env.MAX_TTS_CACHE_MB, 10) || 25) * 1024 * 1024; // 25 MB max TTS PCM audio
const MAX_TTS_FILES = parseInt(process.env.MAX_TTS_FILES, 10) || 20; // 20 announcements max
const TTS_CACHE_TTL_MS = (parseInt(process.env.TTS_CACHE_TTL_HOURS, 10) || 6) * 60 * 60 * 1000; // 6 hours TTL

function getSongCacheKey(url, title = '') {
  const ytMatch = (url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `yt_${ytMatch[1]}`;
  const normalized = (title || url || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return `sc_${crypto.createHash('md5').update(normalized || 'unknown').digest('hex').slice(0, 16)}`;
}

// 🎙️ Auto-prune TTS cache: strict LRU, file count limit, and TTL expiration
async function pruneTTSCache() {
  try {
    const directories = [CACHE_DIR, TTS_CACHE_DIR].filter(d => fs.existsSync(d));
    const now = Date.now();
    const ttsFiles = [];
    let totalBytes = 0;

    for (const dir of directories) {
      const files = await fs.promises.readdir(dir);
      for (const f of files) {
        const isTtsPcm = dir === CACHE_DIR && f.startsWith('tts_') && f.endsWith('.pcm');
        const isLegacyTts = dir === TTS_CACHE_DIR && (f.endsWith('.mp3') || f.endsWith('.pcm') || f.endsWith('.m4a'));
        
        if (isTtsPcm || isLegacyTts) {
          const filePath = path.join(dir, f);
          try {
            const st = await fs.promises.stat(filePath);
            // Delete any announcement audio older than TTL
            if (now - st.mtimeMs > TTS_CACHE_TTL_MS) {
              await fs.promises.unlink(filePath).catch(() => {});
              continue;
            }
            ttsFiles.push({ name: f, path: filePath, size: st.size, mtime: st.mtimeMs });
            totalBytes += st.size;
          } catch (_) {}
        }
      }
    }

    ttsFiles.sort((a, b) => a.mtime - b.mtime);

    while ((ttsFiles.length > MAX_TTS_FILES || totalBytes > MAX_TTS_CACHE_BYTES) && ttsFiles.length > 0) {
      const oldest = ttsFiles.shift();
      try {
        await fs.promises.unlink(oldest.path);
        totalBytes -= oldest.size;
        console.log(`🧹 [TTSCache] Evicted LRU announcement: ${oldest.name} (${(oldest.size / 1024).toFixed(1)} KB)`);
      } catch (_) {}
    }
  } catch (e) {
    console.warn(`[TTSCache] Notice: Prune failed: ${e.message}`);
  }
}

// 🎵 Auto-prune persistent songs: strict LRU, max count, max size, with companion metadata cleanup
async function pruneLRUSongCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const files = await fs.promises.readdir(CACHE_DIR);
    const songFiles = [];
    let totalBytes = 0;

    for (const f of files) {
      if (f.startsWith('song_') && f.endsWith('.m4a')) {
        const filePath = path.join(CACHE_DIR, f);
        try {
          const st = await fs.promises.stat(filePath);
          songFiles.push({ name: f, path: filePath, size: st.size, mtime: st.mtimeMs });
          totalBytes += st.size;
        } catch (_) {}
      }
    }

    songFiles.sort((a, b) => a.mtime - b.mtime);

    while ((songFiles.length > MAX_CACHED_SONGS || totalBytes > MAX_CACHE_SIZE_BYTES) && songFiles.length > MIN_KEPT_SONGS) {
      const oldest = songFiles.shift();
      try {
        await fs.promises.unlink(oldest.path);
        totalBytes -= oldest.size;
        const metaPath = oldest.path.replace(/\.m4a$/, '.json');
        if (fs.existsSync(metaPath)) {
          await fs.promises.unlink(metaPath).catch(() => {});
        }
        console.log(`🧹 [SongCache] Evicted LRU cached track: ${oldest.name} (${(oldest.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (_) {}
    }
  } catch (e) {
    console.warn(`[SongCache] Notice: Song prune failed: ${e.message}`);
  }
}

async function saveSongToPersistentCache(filePath, cacheKey, metadata, source = 'youtube') {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dest = path.join(CACHE_DIR, `song_${cacheKey}.m4a`);
    if (filePath !== dest) {
      await fs.promises.copyFile(filePath, dest);
      console.log(`💾 [SongCache] Saved "${path.basename(dest)}" to persistent cache for 0s instant replay!`);
    }
    if (metadata && (metadata.title || metadata.artist)) {
      const jsonDest = path.join(CACHE_DIR, `song_${cacheKey}.json`);
      const metaToSave = {
        title: metadata.title || 'Unknown Track',
        artist: metadata.artist || 'Unknown Artist',
        duration: metadata.duration || '',
        durationSeconds: metadata.durationSeconds || 0,
        videoId: metadata.videoId || null,
        source: source
      };
      await fs.promises.writeFile(jsonDest, JSON.stringify(metaToSave, null, 2), 'utf8').catch(() => {});
    }
    await pruneLRUSongCache();
  } catch (err) {
    console.warn(`[SongCache] Notice: Could not cache song: ${err.message}`);
  }
}

// 🎵 SMART TITLE & ARTIST PARSER
class SmartTitleParser {
  static clean(rawTitle = '', rawArtist = '') {
    if (!rawTitle) return { title: 'Unknown Track', artist: rawArtist || 'Unknown Artist' };

    let text = rawTitle;
    let explicitArtist = null;

    let cleanRawArtist = (rawArtist || '')
      .replace(/ - Topic$/i, '')
      .replace(/VEVO$/i, '')
      .replace(/Official Channel/i, '')
      .trim();

    // 1. Cut off secondary SEO pipes / slashes
    if (text.includes('|')) text = text.split('|')[0].trim();
    if (text.includes('//')) text = text.split('//')[0].trim();

    // 2. Remove bracketed / parenthesized noise
    text = text.replace(/[\[\(].*?(official|video|audio|lyrics|music|remix|hd|4k|mv|visualizer|prod\.|produced).*?[\)\]]/gi, '');
    text = text.replace(/[\[\(].*?[\)\]]/g, '');

    // 3. Remove descriptor prefixes & hashtags
    text = text.replace(/^(?:video\s*song|full\s*video(?:\s*song)?|official\s*video|audio\s*song|full\s*song|lyric\s*video)\s*[-:]\s*/i, '');
    text = text.replace(/#\w+/g, '');

    // 4. Remove marketing buzzwords & years
    text = text.replace(/\b(official|music video|official video|lyric video|full song|new song|video song|hd|4k)\b/gi, '');
    text = text.replace(/\b(202[0-9]|201[0-9])\b/g, '');

    let parsedArtist = explicitArtist || cleanRawArtist;
    let parsedTitle = text.trim();

    // 5. Handle "Artist - Title" splitting
    if (text.includes(' - ')) {
      const parts = text.split(' - ').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        parsedArtist = parts[0];
        parsedTitle = parts[1];
      }
    }

    parsedArtist = parsedArtist.replace(/\b(records|record label|entertainment|films|studios|music)\b/gi, '').trim();
    parsedTitle = parsedTitle.replace(/[^a-zA-Z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();
    parsedArtist = parsedArtist.replace(/[^a-zA-Z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

    parsedTitle = parsedTitle.split(' ').slice(0, 5).join(' ');
    parsedArtist = parsedArtist.split(' ').slice(0, 3).join(' ');

    return {
      title: parsedTitle || rawTitle,
      artist: parsedArtist || rawArtist
    };
  }
}

function getRandomCachedSong() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return null;
    const files = fs.readdirSync(CACHE_DIR).filter(f => f.startsWith('song_') && f.endsWith('.m4a'));
    if (!files.length) return null;
    const validSongs = [];
    for (const f of files) {
      const full = path.join(CACHE_DIR, f);
      try {
        if (fs.statSync(full).size > 50000) validSongs.push(full);
      } catch (_) {}
    }
    if (!validSongs.length) return null;
    return validSongs[Math.floor(Math.random() * validSongs.length)];
  } catch (_) {
    return null;
  }
}

function getCachedSongMetadata(filePath) {
  try {
    if (!filePath) return {};
    const jsonPath = filePath.replace(/\.m4a$/i, '.json');
    if (fs.existsSync(jsonPath)) {
      const raw = fs.readFileSync(jsonPath, 'utf8');
      const data = JSON.parse(raw);
      if (data && (data.title || data.artist)) return data;
    }
  } catch (_) {}

  try {
    const base = path.basename(filePath, path.extname(filePath));
    const cleanName = base.replace(/^song_/, '').replace(/^sc_/, '').replace(/^yt_/, '');
    const parsed = SmartTitleParser.clean(cleanName, 'Highrise Favorites');
    return {
      title: parsed.title || cleanName,
      artist: parsed.artist || 'Highrise Radio'
    };
  } catch (_) {
    return { title: 'Highrise Favorite', artist: 'Highrise Radio' };
  }
}

async function sendRoomNotification(text) {
  try {
    await fetch('http://127.0.0.1:5001/api/say', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-IPC-Secret': process.env.IPC_SECRET
      },
      body: JSON.stringify({ message: text }),
      signal: AbortSignal.timeout(3000)
    });
  } catch (_) {}
}

let isBridgeHealthy = false;
let lastBridgeHealthCheck = 0;

async function checkBridgeHealth() {
  const healthy = await bridgePoolManager.checkPoolHealth();
  isBridgeHealthy = healthy;
  residentialBridgeUrl = bridgePoolManager.getPrimaryBridge()?.url || null;
  return healthy;
}


// 🧹 Auto-prune cache directory asynchronously to prevent Linux page-cache and disk bloat (cgroup OOM prevention)
function pruneStaleCacheFiles(keepFile = null) {
  setImmediate(async () => {
    try {
      if (!fs.existsSync(CACHE_DIR)) return;
      const files = await fs.promises.readdir(CACHE_DIR);
      const keepBasename = keepFile ? path.basename(keepFile) : null;
      let prunedCount = 0;
      for (const f of files) {
        const filePath = path.join(CACHE_DIR, f);
        const isStaleTrack = f.startsWith('track_') && f.endsWith('.m4a') && f !== keepBasename;
        const isTempFile = f.endsWith('.part') || f.endsWith('.ytdl') || f.endsWith('.tmp') || f.includes('.temp.');
        const isDebugAudio = f.startsWith('debug_') && f.endsWith('.m4a');
        
        if (isStaleTrack || isTempFile || isDebugAudio) {
          try {
            await fs.promises.unlink(filePath);
            prunedCount++;
          } catch (e) {}
        } else if (f.startsWith('song_') && f.endsWith('.json')) {
          const m4aPath = path.join(CACHE_DIR, f.replace(/\.json$/, '.m4a'));
          if (!fs.existsSync(m4aPath)) {
            try {
              await fs.promises.unlink(filePath);
              prunedCount++;
            } catch (e) {}
          }
        }
      }
      if (prunedCount > 0) {
        console.log(`🧹 [MemoryGuard] Pruned ${prunedCount} stale audio cache files from disk`);
      }
      await pruneTTSCache();
      await pruneLRUSongCache();
    } catch (e) {}
  });
}

// 🛡️ Global Cache Disk Ceiling Guardian: enforces strict MAX_CACHE_SIZE_BYTES budget across directories
async function enforceGlobalCacheLimit() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    
    // 1. Sweep stale temporary files and TTL-expired TTS
    pruneStaleCacheFiles(currentLocalFilePath);
    await pruneTTSCache();
    await pruneLRUSongCache();

    // 2. Measure total disk space across cache directories
    const dirsToCheck = [CACHE_DIR, TTS_CACHE_DIR].filter(d => fs.existsSync(d));
    let totalDirBytes = 0;
    const allFiles = [];

    for (const d of dirsToCheck) {
      const files = await fs.promises.readdir(d);
      for (const f of files) {
        const full = path.join(d, f);
        try {
          const st = await fs.promises.stat(full);
          if (st.isFile()) {
            totalDirBytes += st.size;
            allFiles.push({ path: full, name: f, size: st.size, mtime: st.mtimeMs, dir: d });
          }
        } catch (_) {}
      }
    }

    const totalDirMb = (totalDirBytes / 1024 / 1024).toFixed(1);
    const maxMb = (MAX_CACHE_SIZE_BYTES / 1024 / 1024).toFixed(0);

    // If total cache exceeds budget, aggressively evict down to 80% of budget
    if (totalDirBytes > MAX_CACHE_SIZE_BYTES) {
      console.warn(`⚠️ [CacheGuardian] Disk cache (${totalDirMb} MB) exceeds budget (${maxMb} MB). Enforcing emergency eviction...`);
      
      const targetBytes = Math.floor(MAX_CACHE_SIZE_BYTES * 0.8);
      
      const evictable = allFiles.filter(item => {
        if (currentLocalFilePath && item.path === currentLocalFilePath) return false;
        if (item.name.includes('transition')) return false;
        if (item.name === 'bridge_pool.json' || item.name === 'bridge_url.txt') return false;
        return true;
      });

      // Priority sort: TTS / temp files first, then songs by oldest mtime
      evictable.sort((a, b) => {
        const aIsTtsOrTemp = a.name.startsWith('tts_') || a.name.includes('.temp.') || a.name.endsWith('.part');
        const bIsTtsOrTemp = b.name.startsWith('tts_') || b.name.includes('.temp.') || b.name.endsWith('.part');
        if (aIsTtsOrTemp && !bIsTtsOrTemp) return -1;
        if (!aIsTtsOrTemp && bIsTtsOrTemp) return 1;
        return a.mtime - b.mtime;
      });

      let evictedBytes = 0;
      for (const file of evictable) {
        if (totalDirBytes - evictedBytes <= targetBytes) break;
        try {
          await fs.promises.unlink(file.path);
          evictedBytes += file.size;
          if (file.name.startsWith('song_') && file.name.endsWith('.m4a')) {
            const companionJson = file.path.replace(/\.m4a$/, '.json');
            if (fs.existsSync(companionJson)) {
              await fs.promises.unlink(companionJson).catch(() => {});
            }
          }
          console.log(`🧹 [CacheGuardian] Evicted: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
        } catch (_) {}
      }

      console.log(`✅ [CacheGuardian] Cache restored to ${((totalDirBytes - evictedBytes) / 1024 / 1024).toFixed(1)} MB (evicted ${(evictedBytes / 1024 / 1024).toFixed(1)} MB)`);
    }
  } catch (err) {
    console.warn(`[CacheGuardian] Notice: Error in cache limit enforcement: ${err.message}`);
  }
}


const streamManager = new PersistentStreamManager();

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      const savedQueue = JSON.parse(data);
      
      if (!Array.isArray(savedQueue)) {
        console.error('⚠️ Queue file corrupted: not an array, resetting to empty queue');
        return [];
      }
      
      console.log(`📂 Loaded ${savedQueue.length} songs from saved queue`);
      return savedQueue;
    }
  } catch (err) {
    console.error('⚠️ Failed to load queue:', err.message);
    logError('loadQueue', err, { queueFile: QUEUE_FILE });
  }
  return [];
}

let saveQueueTimer = null;
function saveQueue() {
  if (saveQueueTimer) clearTimeout(saveQueueTimer);
  saveQueueTimer = setTimeout(async () => {
    saveQueueTimer = null;
    try {
      await atomicWrite(QUEUE_FILE, JSON.stringify(queue));
      console.log(`💾 Queue saved (${queue.length} songs)`);
      broadcastEvent();
    } catch (err) {
      console.error('⚠️ Failed to save queue:', err.message);
      logError('saveQueue', err, { queueLength: queue.length });
    }
  }, 100);
}

function loadPlaybackState() {
  try {
    if (fs.existsSync(PLAYBACK_STATE_FILE)) {
      const data = fs.readFileSync(PLAYBACK_STATE_FILE, 'utf8');
      const state = JSON.parse(data);
      console.log(`📂 Loaded playback state (was playing: ${state.isPlaying})`);
      return state;
    }
  } catch (err) {
    console.error('⚠️ Failed to load playback state:', err.message);
  }
  return { isPlaying: false, currentTitle: null, currentMetadata: null };
}

let savePlaybackStateTimer = null;
function savePlaybackState() {
  if (savePlaybackStateTimer) clearTimeout(savePlaybackStateTimer);
  savePlaybackStateTimer = setTimeout(async () => {
    savePlaybackStateTimer = null;
    try {
      const state = {
        isPlaying,
        currentTitle,
        currentMetadata,
        currentIsAutoplay,
        savedAt: Date.now()
      };
      await atomicWrite(PLAYBACK_STATE_FILE, JSON.stringify(state));
      console.log(`💾 Playback state saved (playing: ${currentTitle})`);
      broadcastEvent();
    } catch (err) {
      console.error('⚠️ Failed to save playback state:', err.message);
    }
  }, 100);
}

const metadataCache = new Map();
const CACHE_TTL = 1800000; // 30 minutes

function getCached(key) {
  const cached = metadataCache.get(key);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    return cached.data;
  }
  return null;
}

function setCache(key, data) {
  metadataCache.set(key, { data, timestamp: Date.now() });
  if (metadataCache.size > 150) {
    const keys = Array.from(metadataCache.keys());
    for (let i = 0; i < 50; i++) metadataCache.delete(keys[i]);
  }
}

async function searchYouTube(query) {
  const cacheKey = `search:${query}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const results = await yts(query);
    if (results.videos && results.videos.length > 0) {
      const video = results.videos[0];
      const result = {
        url: video.url,
        title: video.title,
        artist: video.author?.name || video.author || "Unknown Artist",
        duration: video.timestamp || "Unknown",
        durationSeconds: video.seconds || 0,
        views: video.views ? video.views.toLocaleString() : "0",
        thumbnail: video.thumbnail || video.image || "",
        ago: video.ago || "",
        videoId: video.videoId
      };
      setCache(cacheKey, result);
      return result;
    }
    return null;
  } catch (err) {
    console.error("YouTube search error:", err);
    logError('searchYouTube', err, { query });
    return null;
  }
}

async function getVideoMetadata(url) {
  const cacheKey = `meta:${url}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    let videoId = null;
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('youtu.be')) {
      videoId = urlObj.pathname.substring(1);
    } else {
      videoId = urlObj.searchParams.get('v');
    }
    
    if (videoId) {
      const results = await yts({ videoId: videoId });
      if (results && results.title) {
        const metaResult = {
          url: url,
          title: results.title,
          artist: results.author?.name || results.author || "Unknown Artist",
          duration: results.timestamp || "Unknown",
          durationSeconds: results.seconds || 0,
          views: results.views ? results.views.toLocaleString() : "0",
          thumbnail: results.thumbnail || results.image || "",
          ago: results.ago || "",
          videoId: videoId
        };
        setCache(cacheKey, metaResult);
        return metaResult;
      }
    }
    return null;
  } catch (err) {
    console.error("Metadata fetch error:", err);
    return null;
  }
}

function killCurrentStream() {
  // V8 background incremental GC handles memory without stop-the-world thread blocking
  currentStreamId++;
  if (currentYtdlp && currentDecoder) {
    try {
      currentYtdlp.stdout.unpipe();
    } catch (e) {}
  }
  
  if (currentDecoder) {
    try {
      if (currentDecoder.stdin && !currentDecoder.stdin.destroyed) {
        currentDecoder.stdin.destroy();
      }
      if (currentDecoder.stdout && !currentDecoder.stdout.destroyed) {
        currentDecoder.stdout.destroy();
      }
      if (currentDecoder.stderr && !currentDecoder.stderr.destroyed) {
        currentDecoder.stderr.destroy();
      }
    } catch (e) {}
    try {
      currentDecoder.kill('SIGKILL');
    } catch (e) {}
    currentDecoder = null;
  }
  
  if (currentYtdlp) {
    try {
      if (currentYtdlp.stdout && !currentYtdlp.stdout.destroyed) {
        currentYtdlp.stdout.destroy();
      }
      if (currentYtdlp.stderr && !currentYtdlp.stderr.destroyed) {
        currentYtdlp.stderr.destroy();
      }
    } catch (e) {}
    try {
      currentYtdlp.kill('SIGKILL');
    } catch (e) {}
    currentYtdlp = null;
  }

  if (currentLocalFilePath) {
    try {
      if (fs.existsSync(currentLocalFilePath) && !path.basename(currentLocalFilePath).startsWith('song_')) {
        fs.unlinkSync(currentLocalFilePath);
      }
    } catch (e) {}
    currentLocalFilePath = null;
  }
  
  // streamManager.clearAudioBuffer(); // Keep circular audio buffer intact to prevent client stream starvation
}

function executeYtdlpDownload(url, outputPath, thisStreamId) {
  const proxyArgs = getProxyArgs();
  const isSoundCloud = url.includes('soundcloud.com') || url.startsWith('scsearch');
  // Lightweight Node.js engine prevents 512MB OOM
  const jsRuntimeArgs = ['--no-js-runtimes', '--js-runtimes', 'node'];
  const formatArg = 'bestaudio/ba/b/best';

  const ytdlpArgs = [
    '--force-ipv4',
    '--no-cache-dir',
    '--socket-timeout', '10',
    '--retries', '2',
    '--concurrent-fragments', '1',
    '--no-video',
    ...jsRuntimeArgs,
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    '-f', formatArg,
    '--no-playlist',
    '--no-check-certificates',
    '--newline',
    ...proxyArgs,
    '-o', outputPath,
    url
  ];

  console.log(`📥 [Downloader] Fetching audio track to "${path.basename(outputPath)}" (fast direct mode, no cookies) from ${isSoundCloud ? 'SoundCloud' : 'YouTube'}...`);

  return new Promise((resolve, reject) => {
    if (thisStreamId !== currentStreamId) return reject(new Error('Superseded'));

    currentYtdlp = spawnYtdlp(ytdlpArgs, { env: ytdlpEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let lastLog = 0;
    let errOutput = '';
    let isSettled = false;

    // Hard timeout: 45s max for yt-dlp download
    const downloadTimeout = setTimeout(() => {
      if (!isSettled && currentYtdlp) {
        console.error(`⚠️ [Downloader] yt-dlp download timed out after 45s. Aborting download.`);
        try { currentYtdlp.kill('SIGKILL'); } catch (e) {}
      }
    }, 45000);

    const handleOutput = (d, isErr) => {
      const msg = d.toString();
      if (isErr) errOutput += msg;
      const lines = msg.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.includes('[download]') && trimmed.includes('%')) {
          const now = Date.now();
          if (now - lastLog > 1500 || trimmed.includes('100%')) {
            lastLog = now;
            console.log(`📥 [yt-dlp] ${trimmed}`);
          }
        } else if (trimmed.includes('ERROR') || trimmed.includes('error')) {
          console.error(`❌ [yt-dlp Error] ${trimmed}`);
        } else if (trimmed.includes('WARNING') || trimmed.includes('warning')) {
          console.warn(`⚠️ [yt-dlp] ${trimmed}`);
        } else if (trimmed.startsWith('[')) {
          console.log(`ℹ️ [yt-dlp] ${trimmed}`);
        }
      }
    };

    if (currentYtdlp.stdout) {
      currentYtdlp.stdout.on('data', (d) => handleOutput(d, false));
    }
    if (currentYtdlp.stderr) {
      currentYtdlp.stderr.on('data', (d) => handleOutput(d, true));
    }

    currentYtdlp.on('close', (code, signal) => {
      clearTimeout(downloadTimeout);
      currentYtdlp = null;
      if (isSettled) return;
      isSettled = true;

      if (thisStreamId !== currentStreamId) {
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
        return reject(new Error('Superseded'));
      }

      if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10000) {
        const mb = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        console.log(`✅ [Downloader] Track file ready (${mb} MB) at "${path.basename(outputPath)}"`);
        resolve(outputPath);
      } else {
        const err = `yt-dlp exited with code ${code} (signal: ${signal}): ${errOutput.slice(-300).trim()}`;
        try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
        reject(new Error(err));
      }
    });

    currentYtdlp.on('error', (err) => {
      clearTimeout(downloadTimeout);
      currentYtdlp = null;
      if (isSettled) return;
      isSettled = true;
      try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (e) {}
      reject(err);
    });
  });
}

async function downloadTrackToFile(url, outputPath, thisStreamId, title = '', metadata = null) {
  const isDirectSoundCloud = url.includes('soundcloud.com') || url.startsWith('scsearch:');
  const cacheKey = getSongCacheKey(url, title);
  const cachedPath = path.join(CACHE_DIR, `song_${cacheKey}.m4a`);

  // 1. Check local persistent song cache first (0s instant playback!)
  if (fs.existsSync(cachedPath)) {
    try {
      const stats = fs.statSync(cachedPath);
      if (stats.size > 50000) {
        console.log(`⚡ [SongCache] Instant Cache Hit for "${title || url}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)!`);
        try {
          const now = new Date();
          fs.utimesSync(cachedPath, now, now);
          const jsonPath = cachedPath.replace(/\.m4a$/, '.json');
          if (fs.existsSync(jsonPath)) fs.utimesSync(jsonPath, now, now);
        } catch (_) {}
        return cachedPath; // Zero-copy: decode directly from persistent cache
      }
    } catch (_) {}
  }

  // 2. If Residential Bridges are connected and healthy, stream YouTube with Multi-Bridge Load Balancing & Failover
  if (!isDirectSoundCloud) {
    const candidateBridges = bridgePoolManager.getAvailableBridges();
    if (candidateBridges.length > 0) {
      for (const bridge of candidateBridges) {
        if (thisStreamId !== currentStreamId) break;

        console.log(`🏠 [Downloader] Streaming YouTube audio via Bridge "${bridge.name}" (${bridge.url})...`);
        bridgePoolManager.markDownloadStart(bridge);

        let downloadSuccess = false;
        try {
          const bridgeStreamUrl = `${bridge.url}/stream?url=${encodeURIComponent(url)}`;
          const resp = await fetch(bridgeStreamUrl, { signal: AbortSignal.timeout(60000) });
          if (!resp.ok) {
            if (resp.status === 530 || resp.status === 404) {
              bridgePoolManager.remove(bridge.url);
            }
            throw new Error(`Bridge returned HTTP status ${resp.status}`);
          }
          const fileStream = fs.createWriteStream(outputPath);
          await new Promise((resolve, reject) => {
            resp.body.pipe(fileStream);
            resp.body.on('error', reject);
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
          });
          if (thisStreamId !== currentStreamId) {
            try { fs.unlinkSync(outputPath); } catch (_) {}
            throw new Error("Download aborted: Stream ID changed");
          }
          const stats = fs.statSync(outputPath);
          if (stats.size > 50000) {
            console.log(`✅ [Downloader] YouTube track downloaded via "${bridge.name}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
            downloadSuccess = true;
            bridgePoolManager.markDownloadEnd(bridge, true);

            await saveSongToPersistentCache(outputPath, cacheKey, metadata, 'youtube');
            return outputPath;
          }
          console.warn(`⚠️ [Downloader] "${bridge.name}" file too small (${stats.size} bytes), trying next bridge...`);
        } catch (bridgeErr) {
          if (thisStreamId !== currentStreamId) throw bridgeErr;
          console.warn(`⚠️ [Downloader] Bridge "${bridge.name}" failed (${bridgeErr.message}), trying next bridge...`);
        } finally {
          if (!downloadSuccess) {
            bridgePoolManager.markDownloadEnd(bridge, false);
            try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch (_) {}
          }
        }
      }
      console.warn(`⚠️ [Downloader] All available residential bridges failed, proceeding to SoundCloud fallback...`);
    } else {
      console.log(`⚡ [Downloader] No active residential bridges — fast-tracking directly to SoundCloud (skipping 30s cloud timeout)...`);
    }
  }

  // 3. Clean high-fidelity SoundCloud Fallback
  const isHttpUrl = /^https?:\/\//i.test(url || '');
  const rawTitle = (title || (!isHttpUrl ? url : '') || '').trim();
  if (!isDirectSoundCloud && (!rawTitle || rawTitle.toLowerCase() === 'unknown track' || metadata?.skipSoundCloudFallback)) {
    console.warn(`⚠️ [Downloader] Skipping SoundCloud fallback — unresolved track title for "${url}"`);
    await sendRoomNotification(`⚠️ Track unavailable (YouTube bridge offline and track title could not be resolved).`);
    throw new Error(`Song not found on SoundCloud (unresolved title)`);
  }

  const strippedTitle = rawTitle
    .replace(/^(?:video\s*song|full\s*video|official\s*video|audio\s*song)\s*[-:]\s*/i, '')
    .replace(/[#|/]/g, ' ')
    .replace(/\b(official|music|video|song|full|lyrics|hd|4k)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const cleanTitle = strippedTitle || rawTitle;

  const scTarget = isDirectSoundCloud ? url : `scsearch1:${cleanTitle} original -cover -nightcore -slowed -reverb -karaoke`;
  console.log(`⚡ [Downloader] SoundCloud: Fetching audio for "${cleanTitle || url}"...`);

  try {
    await executeYtdlpDownload(scTarget, outputPath, thisStreamId);
    const stats = fs.statSync(outputPath);
    if (stats.size > 50000) {
      await saveSongToPersistentCache(outputPath, cacheKey, metadata, isDirectSoundCloud ? 'soundcloud' : 'youtube');
      return outputPath;
    }
  } catch (scErr) {
    if (!isDirectSoundCloud && cleanTitle) {
      try {
        console.warn(`⚠️ [Downloader] Filtered SoundCloud failed, retrying standard query...`);
        await executeYtdlpDownload(`scsearch1:${cleanTitle}`, outputPath, thisStreamId);
        const stats = fs.statSync(outputPath);
        if (stats.size > 50000) {
          await saveSongToPersistentCache(outputPath, cacheKey, metadata, isDirectSoundCloud ? 'soundcloud' : 'youtube');
          return outputPath;
        }
      } catch (scErr2) {}
    }
  }

  // 4. If neither Bridge nor SoundCloud found the song
  console.error(`❌ [Downloader] Song "${title || url}" not found on SoundCloud (or Bridge is offline)`);
  await sendRoomNotification(`⚠️ "${cleanTitle || 'Song'}" not found on SoundCloud (YouTube bridge is offline).`);
  throw new Error(`Song not found on SoundCloud`);
}

async function startStream(url, title, metadata) {
  killCurrentStream();
  const thisStreamId = ++currentStreamId;
  isPreparingTrack = true;
  isTransitioning = true;
  isPlaying = false;
  currentStartTime = 0;
  currentTitle = title || "Preparing track...";
  currentMetadata = metadata;
  broadcastEvent();
  
  console.log(`\n🎵 Starting stream #${thisStreamId}: ${title || url}`);
  
  streamManager.resumeSilenceFeed();

  const localFilePath = path.join(CACHE_DIR, `track_${thisStreamId}.m4a`);
  currentLocalFilePath = localFilePath;
  pruneStaleCacheFiles(localFilePath);

  // 1. Lazy download runner: sequence download after TTS decode to prevent CPU overlap
  let downloadPromise = null;
  const startDownload = () => {
    if (!downloadPromise) {
      downloadPromise = downloadTrackToFile(url, localFilePath, thisStreamId, title, metadata).catch(err => {
        console.error(`❌ Track download failed: ${err.message}`);
        return null;
      });
    }
    return downloadPromise;
  };

  // 2. Play TTS announcement if enabled
  const hasAnnouncement = announcementsEnabled && (title || (metadata && metadata.title));
  if (hasAnnouncement) {
    // 1-second radio DJ breathing delay: gives Orihost container CPU time to settle to baseline idle (< 5%),
    // drains all listener network sockets, and provides a polished radio pause between songs
    await new Promise(r => setTimeout(r, 1000));
    if (thisStreamId !== currentStreamId) return;

    // Clean title & artist of YouTube clutter to make speech concise and fast to decode
    let cleanSongTitle = (title || metadata?.title || 'Unknown Track')
      .replace(/^(?:video\s*song|full\s*video|official\s*video|audio\s*song)\s*[-:]\s*/i, '')
      .replace(/[#|/].*$/g, '')
      .replace(/[\[\(].*?[\)\]]/g, '')
      .replace(/\b(official|music video|official video|video song|full song|lyrics|hd|4k)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    cleanSongTitle = truncateToWords(cleanSongTitle, 6);

    let cleanArtistName = (metadata?.artist || 'Unknown Artist')
      .replace(/[#|/].*$/g, '')
      .replace(/\b(official|records|vevo|music|channel)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    cleanArtistName = truncateToWords(cleanArtistName, 3);

    const requester = metadata?.requesterUsername;
    const dedicatedTo = metadata?.dedicatedTo;
    const dedicatedBy = metadata?.dedicatedBy;
    
    let announcementText = '';
    if (dedicatedTo && dedicatedBy) {
      announcementText = `Dedicated to ${dedicatedTo} by ${dedicatedBy}. Now playing: ${cleanSongTitle}, by ${cleanArtistName}`;
    } else if (requester) {
      announcementText = `Requested by ${requester}. Now playing: ${cleanSongTitle}, by ${cleanArtistName}`;
    } else {
      announcementText = `Now playing: ${cleanSongTitle}, by ${cleanArtistName}`;
    }
    
    console.log(`🎙️ Announcement: ${announcementText}`);
    const ttsHash = crypto.createHash('md5').update(`${announcementVoice}:${announcementText}`).digest('hex').slice(0, 16);
    
    try {
      const ttsBuffer = await generateTTSAudio(announcementText);
      if (ttsBuffer && thisStreamId === currentStreamId) {
        streamManager.injectTransitionSilence();
        await injectTTSToStream(ttsBuffer, () => startDownload(), ttsHash);
        streamManager.injectTransitionSilence();
      } else {
        startDownload();
      }
    } catch (ttsErr) {
      console.error('⚠️ TTS announcement error:', ttsErr.message);
      startDownload();
    }
  } else {
    startDownload();
  }

  // Ensure download is underway if not yet started
  startDownload();

  // If track was superseded or skipped during TTS, abort
  if (thisStreamId !== currentStreamId) {
    try { if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath); } catch (e) {}
    return;
  }

  // 3. Await the complete downloaded track file (usually already downloaded during TTS)
  // If download is still in flight (e.g. slow connection), resume transition music to prevent dead air
  let silenceTimer = null;
  if (!hasAnnouncement) {
    streamManager.resumeSilenceFeed();
  } else {
    // For TTS: only resume transition music if download takes longer than 200ms extra
    silenceTimer = setTimeout(() => {
      streamManager.resumeSilenceFeed();
    }, 200);
  }

  let readyFile = await downloadPromise;
  if (silenceTimer) clearTimeout(silenceTimer);

  if (thisStreamId !== currentStreamId) {
    try { if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath); } catch (e) {}
    return;
  }

  if (!readyFile) {
    if (thisStreamId !== currentStreamId) return;
    console.warn(`⚠️ Track "${title}" could not be downloaded. Activating Loop-Breaker Top Hits fallback...`);
    const topHit = getRandomCachedSong();
    if (topHit) {
      const fallbackMeta = getCachedSongMetadata(topHit);
      const fallbackTitle = fallbackMeta.title || 'Top Hit Favorite';
      const fallbackArtist = fallbackMeta.artist || 'Top Hits Collection';

      console.log(`🎶 [LoopBreaker] Playing verified cached favorite: "${fallbackTitle}" by ${fallbackArtist} (${path.basename(topHit)})`);
      
      currentTitle = fallbackTitle;
      currentMetadata = {
        ...fallbackMeta,
        title: fallbackTitle,
        artist: fallbackArtist,
        isFallback: true,
        originalRequestedTitle: title || 'Requested song'
      };

      await sendRoomNotification(`⚠️ "${title || 'Requested song'}" is unavailable right now. Now playing "${fallbackTitle}" from our Top Hits collection!`);
      readyFile = topHit;
      consecutiveZeroByteFailures = 0;
    } else {
      console.warn("🛑 [LoopBreaker] Zero cached songs found on disk. Halting playback to prevent CPU throttling loop.");
      isPreparingTrack = false;
      isTransitioning = false;
      softStopPlayback();
      return;
    }
  }

  // 4. Stream the complete local file natively with Frame-Aligned Pacer
  const volumeFilter = volume !== 100 ? `volume=${volume / 100}` : '';
  const filterArgs = volumeFilter ? ['-af', volumeFilter] : [];

  const fileToDecode = readyFile || localFilePath;
  console.log(`🔊 [Local Streamer] Decoding "${path.basename(fileToDecode)}" and starting smooth playback...`);

  // Decode local file at max speed into memory buffer queue
  const ffmpegArgs = [
    '-threads', '1',
    '-vn', '-sn', '-dn',
    '-i', fileToDecode,
    '-f', 's16le',
    '-ar', '44100',
    '-ac', '2',
    ...filterArgs,
    'pipe:1'
  ];

  currentDecoder = spawn(getFFmpegPath(), ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  const CHUNK_SIZE = 8820; // Exactly 50ms of 44.1kHz 16-bit stereo PCM (2,205 samples)
  const pcmChunks = [];
  let queuedBytes = 0;
  let isDecoderPaused = false;
  let decoderFinished = false;
  let totalBytesDecoded = 0;

  // Ultra-gentle PCM micro-buffer: 1.0s (~176 KB), resume at 0.75s (~132 KB) - eliminates decoder CPU burst
  const MAX_ACCUM_BYTES = CHUNK_SIZE * 20;
  const RESUME_ACCUM_BYTES = CHUNK_SIZE * 15;

  let lastPcmReceivedAt = Date.now();

  function pullPcmChunk(neededBytes) {
    if (queuedBytes < neededBytes || pcmChunks.length === 0) return null;
    if (pcmChunks[0].length === neededBytes) {
      queuedBytes -= neededBytes;
      return pcmChunks.shift();
    }
    if (pcmChunks[0].length > neededBytes) {
      const chunk = pcmChunks[0].subarray(0, neededBytes);
      pcmChunks[0] = pcmChunks[0].subarray(neededBytes);
      queuedBytes -= neededBytes;
      return chunk;
    }

    const out = Buffer.allocUnsafe(neededBytes);
    let outOffset = 0;
    while (outOffset < neededBytes && pcmChunks.length > 0) {
      const head = pcmChunks[0];
      const remaining = neededBytes - outOffset;
      if (head.length <= remaining) {
        head.copy(out, outOffset);
        outOffset += head.length;
        queuedBytes -= head.length;
        pcmChunks.shift();
      } else {
        head.copy(out, outOffset, 0, remaining);
        pcmChunks[0] = head.subarray(remaining);
        queuedBytes -= remaining;
        outOffset += remaining;
      }
    }
    return out;
  }

  function pullRemainingPcm() {
    if (queuedBytes < 4) return null;
    const validLen = queuedBytes - (queuedBytes % 4);
    return pullPcmChunk(validLen);
  }

  currentDecoder.stdout.on('data', (chunk) => {
    lastPcmReceivedAt = Date.now();
    pcmChunks.push(chunk);
    queuedBytes += chunk.length;
    totalBytesDecoded += chunk.length;

    if (!isDecoderPaused && queuedBytes >= MAX_ACCUM_BYTES) {
      currentDecoder.stdout.pause();
      isDecoderPaused = true;
    }
  });

  currentDecoder.stdout.on('end', () => {
    decoderFinished = true;
  });

  currentDecoder.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg.includes('Error') || msg.includes('fatal') || msg.includes('Conversion failed')) {
      console.warn(`⚠️ [FFmpeg Decoder] ${msg.split(/\r?\n/).slice(-1)[0]}`);
    }
  });

  currentDecoder.on('close', () => {
    decoderFinished = true;
  });

  currentDecoder.on('error', (err) => {
    console.error('FFmpeg decoder process error:', err.message);
    decoderFinished = true;
  });

  // Wait for initial pre-buffer (0.5s cushion = 88,200 bytes)
  while (queuedBytes < 88200 && !decoderFinished) {
    if (thisStreamId !== currentStreamId) return;
    await new Promise(r => setTimeout(r, 20));
  }

  if (thisStreamId !== currentStreamId) return;

  if (queuedBytes === 0 && decoderFinished) {
    if (thisStreamId !== currentStreamId) return;
    consecutiveZeroByteFailures++;
    console.warn(`⚠️ Track decoding produced 0 bytes for "${title}". Failures: ${consecutiveZeroByteFailures}/3`);
    try { if (fs.existsSync(localFilePath) && localFilePath !== fileToDecode) fs.unlinkSync(localFilePath); } catch (e) {}
    currentLocalFilePath = null;
    isPreparingTrack = false;
    isTransitioning = false;
    if (consecutiveZeroByteFailures >= 3) {
      softStopPlayback();
    } else {
      setTimeout(() => {
        if (thisStreamId === currentStreamId) playNext();
      }, 3000);
    }
    return;
  }

  if (thisStreamId !== currentStreamId) return;

  // Ready to play!
  streamManager.stopSilenceFeed();
  isPlaying = true;
  isPreparingTrack = false;
  isTransitioning = false;
  currentTitle = title || "Unknown Track";
  currentMetadata = metadata;
  currentStartTime = Date.now();
  streamVersion++;
  console.log("🎧 Now playing:", currentTitle);
  savePlaybackState();
  broadcastEvent();

  const TARGET_LEAD_MS = 300; // 300ms steady lead cushion - eliminates 50-chunk CPU spike burst and audio hiccups
  const pacingStartTime = Date.now();
  let bytesSent = 0;

  const expectedDurationSec = (metadata && metadata.durationSeconds) 
    ? Number(metadata.durationSeconds) 
    : (currentMetadata && currentMetadata.durationSeconds ? Number(currentMetadata.durationSeconds) : 0);
  const maxAllowedDurationMs = expectedDurationSec > 0 ? (expectedDurationSec + 8) * 1000 : 0;

  console.log(`🔊 [Playing] Continuous 1.0x frame-accurate playback active (300ms smooth cushion)!`);

  // Stream in steady, frame-aligned 50ms chunks using self-correcting lead cushion
  while (thisStreamId === currentStreamId) {
    if (queuedBytes >= CHUNK_SIZE) {
      const chunk = pullPcmChunk(CHUNK_SIZE);
      if (chunk) {
        streamManager.feedPCMAudio(chunk);
        bytesSent += chunk.length;
      }

      if (isDecoderPaused && queuedBytes <= RESUME_ACCUM_BYTES) {
        if (currentDecoder && currentDecoder.stdout && !currentDecoder.stdout.destroyed) {
          currentDecoder.stdout.resume();
          isDecoderPaused = false;
          lastPcmReceivedAt = Date.now(); // Reset timer upon resuming stdout
        }
      }

      // Maintain a steady 2500ms lead cushion ahead of wall-clock real time
      const audioDurationSentMs = (bytesSent / 176400) * 1000;
      const realTimeElapsedMs = Date.now() - pacingStartTime;
      const leadMs = audioDurationSentMs - realTimeElapsedMs;

      if (leadMs > TARGET_LEAD_MS) {
        // Clamp sleep to 10ms-50ms to eliminate 1ms micro-sleep timer interrupts
        const sleepMs = Math.max(10, Math.min(50, leadMs - TARGET_LEAD_MS));
        await new Promise(r => setTimeout(r, sleepMs));
      }
    } else if (decoderFinished) {
      // Decoder has finished and buffer has less than CHUNK_SIZE remaining
      const chunk = pullRemainingPcm();
      if (chunk) {
        streamManager.feedPCMAudio(chunk);
        bytesSent += chunk.length;
      }
      pcmChunks.length = 0;
      queuedBytes = 0;
      break; // All audio completely fed to persistent encoder!
    } else {
      // 2. Decoder stall watchdog: only check if decoder is unpaused, not finished, and buffer is truly starved
      if (isDecoderPaused) {
        lastPcmReceivedAt = Date.now(); // Never count paused buffering time as a stall
      } else if (!decoderFinished && Date.now() - lastPcmReceivedAt > 15000) {
        console.warn(`⚠️ [Decoder Watchdog] Decoder stalled with no new audio for 15s. Finishing track.`);
        const remaining = pullRemainingPcm();
        if (remaining) {
          streamManager.feedPCMAudio(remaining);
          bytesSent += remaining.length;
        }
        pcmChunks.length = 0;
        queuedBytes = 0;
        decoderFinished = true;
        break;
      }

      // Waiting for decoder to fill next 50ms chunk
      await new Promise(r => setTimeout(r, 10));
    }
  

      // 3. Duration limit watchdog: if playback exceeded expected duration + grace period
    const realTimeElapsedMs = Date.now() - pacingStartTime;
    if (maxAllowedDurationMs > 0 && realTimeElapsedMs > maxAllowedDurationMs) {
      console.warn(`⏰ [Duration Watchdog] Song reached duration limit (${expectedDurationSec}s + grace). Finishing track gracefully.`);
      break;
    }
  }

  // Ensure decoder process is terminated immediately after loop
  if (currentDecoder) {
    try {
      if (currentDecoder.stdout && !currentDecoder.stdout.destroyed) currentDecoder.stdout.destroy();
      if (!currentDecoder.killed) currentDecoder.kill('SIGKILL');
    } catch (e) {}
    currentDecoder = null;
  }

  // If track was skipped or superseded, abort cleanly
  if (thisStreamId !== currentStreamId) {
    try { if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath); } catch (e) {}
    return;
  }

  // All bytes fed to persistent encoder. Await remaining lead cushion so listeners hear final notes.
  const totalTrackDurationMs = (bytesSent / 176400) * 1000;
  const remainingPlayTimeMs = Math.max(0, totalTrackDurationMs - (Date.now() - pacingStartTime));
  if (remainingPlayTimeMs > 0) {
    await new Promise(r => setTimeout(r, Math.min(remainingPlayTimeMs, 3000)));
  }

  if (thisStreamId !== currentStreamId) return;

  const totalPlayedSec = Math.floor((Date.now() - currentStartTime) / 1000);
  console.log(`✅ Track completed: ${title || currentTitle} (${totalPlayedSec}s, ${(bytesSent / 1024).toFixed(1)} KB)`);

  streamManager.resumeSilenceFeed();

  // Clean up local track file immediately (protecting persistent song cache)
  try {
    if (fs.existsSync(localFilePath) && localFilePath !== fileToDecode) {
      fs.unlinkSync(localFilePath);
    }
  } catch (e) {}
  currentLocalFilePath = null;

  consecutiveZeroByteFailures = 0;
  isPlaying = false;
  isPreparingTrack = false;
  isTransitioning = false;
  currentStartTime = 0;
  savePlaybackState();
  broadcastEvent();

  if (thisStreamId === currentStreamId) {
    setImmediate(() => playNext());
  }
}

function softStopPlayback() {
  console.log("⏸️ Soft stop - keeping stream alive with silence...");
  currentStreamId++;
  isPlaying = false;
  isPreparingTrack = false;
  isTransitioning = false;
  
  savePlaybackState();
  
  killCurrentStream();
  
  currentTitle = "Waiting for next song...";
  currentMetadata = null;
  currentIsAutoplay = false;
  
  streamManager.resumeSilenceFeed();
}

function stopPlayback() {
  console.log("⏸️ Stopping playback completely...");
  currentStreamId++;
  isPlaying = false;
  isPreparingTrack = false;
  isTransitioning = false;
  
  savePlaybackState();
  
  killCurrentStream();
  
  currentTitle = "No music playing";
  currentMetadata = null;
  currentIsAutoplay = false;

  streamManager.resumeSilenceFeed();
}

const sseClients = new Set();
app.get("/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  
  sseClients.add(res);

  let heartbeat = null;
  const cleanupSseClient = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    sseClients.delete(res);
  };

  req.on("close", cleanupSseClient);
  if (typeof res.on === "function") {
    res.on("close", cleanupSseClient);
    res.on("error", cleanupSseClient);
  }
  
  const currentState = {
    isPlaying,
    isTransitioning,
    currentTitle,
    currentMetadata,
    queue,
    startTime: currentStartTime,
    serverElapsed: isPlaying && currentStartTime > 0 ? Math.max(0, Date.now() - currentStartTime) : 0,
    volume,
    announcementsEnabled,
    health: streamManager.getHealthStatus(),
    stats: streamManager.getStats()
  };
  try {
    if (res.destroyed || res.writableEnded) {
      cleanupSseClient();
      return;
    }
    res.write(`data: ${JSON.stringify(currentState)}\n\n`);
  } catch (_) {
    cleanupSseClient();
    return;
  }
  
  heartbeat = setInterval(() => {
    if (res.destroyed || res.writableEnded) {
      cleanupSseClient();
      return;
    }
    try {
      res.write(':heartbeat\n\n');
    } catch (_) {
      cleanupSseClient();
    }
  }, 20000);
});

let broadcastTimeout = null;
function broadcastEvent() {
  if (sseClients.size === 0) return;
  if (broadcastTimeout) return; // Debounce rapid state update bursts within 50ms
  broadcastTimeout = setTimeout(() => {
    broadcastTimeout = null;
    if (sseClients.size === 0) return;
    const currentState = {
      isPlaying,
      isTransitioning,
      currentTitle,
      currentMetadata,
      queue,
      startTime: currentStartTime,
      serverElapsed: isPlaying && currentStartTime > 0 ? Math.max(0, Date.now() - currentStartTime) : 0,
      volume,
      announcementsEnabled,
      health: streamManager.getHealthStatus(),
      stats: streamManager.getStats()
    };
    const payload = `data: ${JSON.stringify(currentState)}\n\n`;
    for (const client of sseClients) {
      if (client.destroyed || client.writableEnded) {
        sseClients.delete(client);
        continue;
      }
      try {
        client.write(payload);
      } catch (_) {
        sseClients.delete(client);
      }
    }
  }, 50);
}

function broadcastEventJSON(data) {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    if (client.destroyed || client.writableEnded) {
      sseClients.delete(client);
      continue;
    }
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// REST API for web interface
function isValidYouTubeURL(urlString) {
  try {
    if (typeof urlString !== "string") return false;
    if (!urlString.startsWith("http://") && !urlString.startsWith("https://")) return false;
    
    const url = new URL(urlString);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    
    const allowedHosts = [
      "www.youtube.com", "youtube.com", "youtu.be",
      "m.youtube.com", "music.youtube.com"
    ];
    
    return allowedHosts.includes(url.hostname.toLowerCase());
  } catch (e) {
    return false;
  }
}

app.post("/search", async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).send({ error: "Missing search query" });
  }
  
  try {
    const searchResult = await searchYouTube(url);
    
    if (!searchResult) {
      return res.status(404).send({ error: "No results found for: " + url });
    }
    
    res.send({ 
      status: "found", 
      title: searchResult.title,
      artist: searchResult.artist,
      duration: searchResult.duration,
      url: searchResult.url,
      metadata: searchResult
    });
  } catch (err) {
    console.error("Error in /search endpoint:", err);
    res.status(500).send({ error: err.message });
  }
});

app.post("/play", async (req, res) => {
  console.log("Received /play request:", req.body);
  const { url, isAutoplay = false, sourcePlaylist, ownerUsername, requesterUsername, dedicatedTo, dedicatedBy } = req.body;
  
  if (!url) {
    return res.status(400).send({ error: "Missing URL or search query" });
  }
  
  try {
    let videoUrl = url;
    let metadata = null;
    let resolvedVideoId = null;
    
    if (isValidYouTubeURL(url)) {
      videoUrl = url;
      
      let videoId = null;
      try {
        const urlObj = new URL(url);
        if (urlObj.hostname.includes('youtu.be')) {
          videoId = urlObj.pathname.substring(1);
        } else {
          videoId = urlObj.searchParams.get('v');
        }
      } catch (e) {}
      resolvedVideoId = videoId;
      
      if (videoId) {
        try {
          const results = await yts({ videoId: videoId });
          if (results && results.title) {
            metadata = {
              url: url,
              title: results.title,
              artist: results.author?.name || results.author || "Unknown Artist",
              duration: results.timestamp || "Unknown",
              durationSeconds: results.seconds || 0,
              views: results.views ? results.views.toLocaleString() : "0",
              thumbnail: results.thumbnail || results.image || "",
              ago: results.ago || "",
              videoId: videoId
            };
          }
        } catch (err) {}
      }
    } else {
      const searchResult = await searchYouTube(url);
      
      if (!searchResult) {
        return res.status(404).send({ error: "No results found for: " + url });
      }
      
      videoUrl = searchResult.url;
      metadata = searchResult;
    }
    
    if (!metadata) {
      metadata = {
        url: videoUrl,
        ...(resolvedVideoId ? { videoId: resolvedVideoId } : {}),
        ...(isValidYouTubeURL(url) ? { skipSoundCloudFallback: true } : {}),
        artist: "Unknown Artist",
        duration: "Unknown"
      };
    }
    
    if (sourcePlaylist) {
      metadata.sourcePlaylist = sourcePlaylist;
      metadata.ownerUsername = ownerUsername;
    }
    if (requesterUsername) {
      metadata.requesterUsername = requesterUsername;
    }
    if (dedicatedTo) {
      metadata.dedicatedTo = dedicatedTo;
      metadata.dedicatedBy = dedicatedBy;
    }
    
    queue.push({ url: videoUrl, metadata, isAutoplay });
    saveQueue();
    
    if (isPlaying || isTransitioning || isPreparingTrack || isPlayNextLocked) {
      res.send({ 
        status: "queued", 
        position: queue.length,
        url: videoUrl, 
        currentTitle,
        currentMetadata,
        currentIsAutoplay,
        queuedTitle: metadata?.title,
        streamVersion: streamVersion
      });
    } else {
      playNext().catch(playErr => {
        console.error("Background playNext error:", playErr);
      });
      res.send({ 
        status: "playing", 
        url: videoUrl, 
        currentTitle: metadata?.title || "Starting playback...",
        currentMetadata: metadata,
        currentIsAutoplay,
        streamVersion: streamVersion
      });
    }
  } catch (err) {
    console.error("Error in /play endpoint:", err);
    res.status(500).send({ error: "Failed to add song to queue", message: err.message });
  }
});

app.post("/insert", async (req, res) => {
  const { url, requesterUsername, dedicatedTo, dedicatedBy } = req.body;
  
  if (!url) {
    return res.status(400).send({ error: "No URL or search query provided" });
  }
  
  console.log("⏫ INSERT command - Adding to front of queue:", url);
  let videoUrl = url;
  let metadata = null;
  
  try {
    if (url.includes("youtube.com") || url.includes("youtu.be")) {
      videoUrl = url;
      try {
        metadata = await getVideoMetadata(url);
      } catch (metaErr) {
        metadata = { title: "Unknown Track", artist: "Unknown Artist", duration: "Unknown" };
      }
    } else {
      const searchResult = await searchYouTube(url);
      
      if (!searchResult) {
        return res.status(404).send({ error: "No results found for: " + url });
      }
      
      videoUrl = searchResult.url;
      metadata = searchResult;
    }
    
    if (!metadata) {
      metadata = { title: "Unknown Track", artist: "Unknown Artist", duration: "Unknown" };
    }
    
    if (requesterUsername) {
      metadata.requesterUsername = requesterUsername;
      metadata.insertedBy = requesterUsername;
    }
    if (dedicatedTo) {
      metadata.dedicatedTo = dedicatedTo;
      metadata.dedicatedBy = dedicatedBy;
    }
    
    queue.unshift({ url: videoUrl, metadata, isAutoplay: false });
    saveQueue();
    
    if (isPlaying || isTransitioning || isPreparingTrack || isPlayNextLocked) {
      res.send({ 
        status: "inserted", 
        position: 1,
        url: videoUrl, 
        currentTitle,
        insertedTitle: metadata?.title,
        queueLength: queue.length,
        streamVersion: streamVersion
      });
    } else {
      playNext().catch(playErr => {
        console.error("Background playNext error in /insert:", playErr);
      });
      res.send({ 
        status: "playing", 
        url: videoUrl, 
        currentTitle: metadata?.title || "Starting playback...",
        currentMetadata: metadata,
        streamVersion: streamVersion
      });
    }
  } catch (err) {
    console.error("Error in /insert endpoint:", err);
    res.status(500).send({ error: "Failed to insert song", message: err.message });
  }
});

app.post("/stop", (req, res) => {
  console.log("⏹️ STOP command received");
  
  queue = [];
  saveQueue();
  
  stopPlayback();
  isPlayNextLocked = false;
  playNextGeneration++;
  
  res.send({ 
    status: "stopped",
    message: "Playback stopped and queue cleared"
  });
});

app.post("/next", async (req, res) => {
  console.log("⏭️ SKIP command received");
  
  if (Date.now() - lastSkipTime < 3000) {
    return res.status(429).send({
      status: "cooldown",
      message: "Please wait a few seconds before skipping again."
    });
  }
  
  const skippedTitle = currentTitle;
  lastSkipTime = Date.now();
  
  currentStreamId++;
  killCurrentStream();
  
  isPreparingTrack = false;
  isTransitioning = false;
  isPlaying = false;
  isPlayNextLocked = false; // Release lock so skip can immediately execute
  playNextGeneration++;
  
  playNext().catch(err => console.error("Error in skip playNext:", err));
  
  res.send({ 
    status: "skipped", 
    skippedTitle: skippedTitle,
    nowPlaying: queue.length > 0 ? (queue[0].metadata?.title || "Upcoming track") : "Waiting for next song...",
    queueLength: queue.length
  });
});

app.get("/current", (req, res) => {
  res.send({
    title: currentTitle,
    isPlaying: isPlaying,
    isTransitioning: isTransitioning || isPreparingTrack,
    isPreparing: isPreparingTrack,
    metadata: currentMetadata,
    isAutoplay: currentIsAutoplay,
    queueLength: queue.length,
    streamVersion: streamVersion,
    startTime: currentStartTime,
    serverElapsed: isPlaying && currentStartTime > 0 ? Math.max(0, Date.now() - currentStartTime) : 0,
    streamHealth: streamManager.getHealthStatus()
  });
});

app.get("/queue", (req, res) => {
  res.send({
    queue: queue.map((item, index) => ({
      position: index + 1,
      title: item.metadata?.title || "Unknown",
      artist: item.metadata?.artist || "Unknown",
      duration: item.metadata?.duration || "Unknown",
      isAutoplay: item.isAutoplay || false,
      url: item.url,
      videoId: item.metadata?.videoId
    })),
    currentlyPlaying: {
      title: currentTitle,
      metadata: currentMetadata,
      isAutoplay: currentIsAutoplay
    },
    queueLength: queue.length
  });
});

app.get("/stats", (req, res) => {
  res.send({
    status: "ok",
    ...streamManager.getStats(),
    currentTitle,
    isPlaying,
    queueLength: queue.length
  });
});

app.get("/health", (req, res) => {
  const health = streamManager.getHealthStatus();
  res.send({
    status: health.encoderAlive ? "healthy" : "unhealthy",
    ...health,
    isPlaying,
    currentTitle,
    queueLength: queue.length
  });
});

app.get("/volume", (req, res) => {
  res.send({
    status: "ok",
    volume: volume,
    min: 0,
    max: 200
  });
});

app.post("/volume", (req, res) => {
  const { level } = req.body;
  
  if (level === undefined || level === null) {
    return res.status(400).send({ 
      error: "Missing level parameter",
      min: 0,
      max: 200,
      current: volume
    });
  }
  
  const newVolume = parseInt(level, 10);
  
  if (isNaN(newVolume) || newVolume < 0 || newVolume > 200) {
    return res.status(400).send({ 
      error: "Volume must be between 0 and 200",
      current: volume
    });
  }
  
  const oldVolume = volume;
  volume = newVolume;
  
  saveSettings();
  broadcastEvent();
  
  console.log(`🔊 Volume changed: ${oldVolume}% → ${volume}%`);
  
  res.send({
    status: "ok",
    message: "Volume updated. Will apply to next track.",
    oldVolume: oldVolume,
    newVolume: volume
  });
});

app.get("/announcements", (req, res) => {
  res.send({
    status: "ok",
    enabled: announcementsEnabled,
    voice: announcementVoice,
    voiceName: VOICE_OPTIONS[announcementVoice] || 'English (US)',
    wordLimit: announcementWordLimit,
    availableVoices: VOICE_OPTIONS
  });
});

app.post("/announcements", (req, res) => {
  const { enabled, voice, wordLimit } = req.body;
  
  if (enabled !== undefined) {
    announcementsEnabled = Boolean(enabled);
  }
  
  if (voice !== undefined) {
    if (VOICE_OPTIONS[voice]) {
      announcementVoice = voice;
    } else {
      return res.status(400).send({
        status: "error",
        error: `Invalid voice code. Available: ${Object.keys(VOICE_OPTIONS).join(', ')}`
      });
    }
  }
  
  if (wordLimit !== undefined) {
    const limit = parseInt(wordLimit);
    if (isNaN(limit) || limit < 3 || limit > 50) {
      return res.status(400).send({
        status: "error",
        error: "Word limit must be between 3 and 50"
      });
    }
    announcementWordLimit = limit;
  }
  
  saveSettings();
  broadcastEvent();
  
  res.send({
    status: "ok",
    enabled: announcementsEnabled,
    voice: announcementVoice,
    voiceName: VOICE_OPTIONS[announcementVoice] || 'English (US)',
    wordLimit: announcementWordLimit,
    message: announcementsEnabled 
      ? "TTS announcements enabled! Song info will play during transitions."
      : "TTS announcements disabled."
  });
});

app.get("/quality", (req, res) => {
  res.send({
    status: "ok",
    bitrate: audioBitrate,
    availableOptions: AVAILABLE_BITRATES
  });
});

app.post("/quality", (req, res) => {
  const { bitrate } = req.body;
  
  if (!bitrate) {
    return res.status(400).send({ 
      error: "Missing bitrate parameter",
      availableOptions: AVAILABLE_BITRATES,
      current: audioBitrate
    });
  }
  
  const normalizedBitrate = bitrate.toLowerCase().replace('kbps', 'k').replace('k', 'k');
  
  if (!AVAILABLE_BITRATES.includes(normalizedBitrate)) {
    return res.status(400).send({ 
      error: `Invalid bitrate. Available options: ${AVAILABLE_BITRATES.join(', ')}`,
      availableOptions: AVAILABLE_BITRATES,
      current: audioBitrate
    });
  }
  
  const oldBitrate = audioBitrate;
  audioBitrate = normalizedBitrate;
  
  saveSettings();
  
  console.log(`🎚️ Audio quality changed: ${oldBitrate} → ${audioBitrate}`);
  
  res.send({
    status: "ok",
    message: "Quality updated. Restart stream to apply new bitrate.",
    oldBitrate: oldBitrate,
    newBitrate: audioBitrate,
    note: "The encoder will use the new bitrate on next restart"
  });
});

app.post("/resolve", async (req, res) => {
  const { query } = req.body;
  
  if (!query) {
    return res.status(400).send({ error: "Missing query parameter" });
  }
  
  try {
    let metadata = null;
    
    if (isValidYouTubeURL(query)) {
      let videoId = null;
      try {
        const urlObj = new URL(query);
        if (urlObj.hostname.includes('youtu.be')) {
          videoId = urlObj.pathname.substring(1);
        } else {
          videoId = urlObj.searchParams.get('v');
        }
      } catch (e) {}
      
      if (videoId) {
        try {
          const results = await yts({ videoId: videoId });
          if (results && results.title) {
            metadata = {
              url: query,
              title: results.title,
              artist: results.author?.name || results.author || "Unknown Artist",
              duration: results.timestamp || "Unknown",
              durationSeconds: results.seconds || 0,
              views: results.views ? results.views.toLocaleString() : "0",
              thumbnail: results.thumbnail || results.image || "",
              ago: results.ago || "",
              videoId: videoId
            };
          }
        } catch (err) {}
      }
    } else {
      metadata = await searchYouTube(query);
    }
    
    if (!metadata) {
      return res.status(404).send({ error: "No results found", query: query });
    }
    
    res.send({ status: "resolved", metadata: metadata });
    
  } catch (err) {
    console.error("/resolve error:", err);
    res.status(500).send({ error: "Failed to resolve query", message: err.message });
  }
});

app.post("/restore", async (req, res) => {
  console.log("🔄 RESTORE command received");
  
  if (isPlaying || isPreparingTrack || isTransitioning) {
    return res.send({
      status: "already_playing",
      nowPlaying: currentTitle,
      queueLength: queue.length
    });
  }

  if (queue.length > 0) {
    await playNext();
    res.send({ 
      status: "restored",
      queueLength: queue.length,
      nowPlaying: currentTitle,
      message: "Playback restored from saved queue"
    });
  } else {
    res.send({
      status: "empty",
      message: "No saved queue to restore"
    });
  }
});

app.post("/clear", (req, res) => {
  const clearedCount = queue.length;
  queue = [];
  saveQueue();
  console.log(`🗑️ Queue cleared (${clearedCount} tracks removed)`);
  res.send({ 
    status: "cleared", 
    clearedCount,
    currentTitle 
  });
});

let isPlayNextLocked = false;
let playNextGeneration = 0;
async function playNext() {
  if (isPlayNextLocked) {
    console.log("⚠️ playNext already executing, skipping duplicate concurrent invocation");
    return;
  }
  const myLockId = ++playNextGeneration;
  isPlayNextLocked = true;
  try {
    while (true) {
      const next = queue.shift();
      saveQueue();
      console.log("playNext called. Next item:", next);

      if (!next) {
        isPreparingTrack = false;
        isTransitioning = false;
        softStopPlayback();

        // If a song was added to the queue while stopping, loop cleanly instead of recursing while locked
        if (queue.length > 0) {
          console.log("⚠️ Song was queued while stopping. Resuming playback!");
          continue;
        }
        return;
      }

      isPreparingTrack = true;
      isTransitioning = true;
      isPlaying = false;

      if (typeof next === 'string') {
        currentIsAutoplay = false;
        await startStream(next);
      } else {
        currentIsAutoplay = next.isAutoplay || false;
        await startStream(next.url, next.metadata?.title, next.metadata);
      }
      return;
    }
  } catch (err) {
    console.error("❌ Error in playNext:", err.message);
    isPreparingTrack = false;
    isTransitioning = false;
    softStopPlayback();
    setTimeout(() => {
      if (!isPlaying && !isTransitioning && !isPreparingTrack && queue.length > 0) playNext();
    }, 2000);
  } finally {
    if (playNextGeneration === myLockId) {
      isPlayNextLocked = false;
    }
  }
}

app.get(["/stream", "/STREAM"], (req, res) => {
  if (res.socket) {
    res.socket.setNoDelay(true);
  }
  
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "X-Accel-Buffering": "no",
    "X-Stream-Version": String(streamVersion),
    "X-Stream-Live": "true",
    "icy-name": "Highrise Music Stream",
    "icy-br": audioBitrate.replace('k', ''),
    "icy-pub": "1"
  });

  streamManager.addClient(res, req);
});

app.get("/", (req, res) => {
  const stats = streamManager.getStats();
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>🎵 Music Streaming Server</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          color: #fff;
        }
        .container { max-width: 900px; margin: 0 auto; }
        .header { text-align: center; margin-bottom: 40px; }
        .header h1 { font-size: 3em; margin-bottom: 10px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3); }
        .status-badge {
          display: inline-block;
          background: rgba(255,255,255,0.2);
          padding: 8px 20px;
          border-radius: 20px;
          backdrop-filter: blur(10px);
          font-size: 0.9em;
        }
        .pulse {
          display: inline-block;
          width: 10px;
          height: 10px;
          background: #4ade80;
          border-radius: 50%;
          margin-right: 8px;
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.1); }
        }
        .card {
          background: rgba(255, 255, 255, 0.15);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          padding: 30px;
          margin-bottom: 20px;
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
          border: 1px solid rgba(255, 255, 255, 0.18);
        }
        .now-playing { display: flex; align-items: center; gap: 20px; }
        .music-icon { font-size: 3em; animation: rotate 3s linear infinite; }
        @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .track-info h2 { font-size: 1.5em; margin-bottom: 5px; }
        .track-info p { opacity: 0.8; font-size: 0.95em; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 20px; }
        .stat-box {
          background: rgba(255, 255, 255, 0.1);
          padding: 20px;
          border-radius: 15px;
          text-align: center;
        }
        .stat-box .number { font-size: 2em; font-weight: bold; margin-bottom: 5px; }
        .stat-box .label { opacity: 0.8; font-size: 0.9em; }
        .stream-btn {
          display: inline-block;
          background: linear-gradient(45deg, #4ade80, #22c55e);
          color: white;
          padding: 15px 40px;
          border-radius: 30px;
          text-decoration: none;
          font-weight: bold;
          margin-top: 20px;
        }
        .persistent-badge {
          background: linear-gradient(45deg, #22c55e, #16a34a);
          padding: 5px 15px;
          border-radius: 20px;
          font-size: 0.8em;
          margin-left: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎵 Music Streaming Server</h1>
          <div class="status-badge">
            <span class="pulse"></span>
            Server Online
            <span class="persistent-badge">Persistent Stream</span>
          </div>
        </div>
        
        <div class="card">
          <div class="now-playing">
            <div class="music-icon">💿</div>
            <div class="track-info">
              <h2>Now Playing</h2>
              <p>${currentTitle || 'No track playing'}</p>
            </div>
          </div>
          
          <div class="stats">
            <div class="stat-box">
              <div class="number">${queue.length}</div>
              <div class="label">Tracks in Queue</div>
            </div>
            <div class="stat-box">
              <div class="number">${stats.activeListeners}</div>
              <div class="label">Active Listeners</div>
            </div>
            <div class="stat-box">
              <div class="number">${stats.encoderRunning ? '✓' : '✗'}</div>
              <div class="label">Encoder Status</div>
            </div>
          </div>
          
          <center>
            <a href="/stream" class="stream-btn">🎧 Listen Now</a>
          </center>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.post("/api/bot-command", async (req, res) => {
  try {
    const { command, ...data } = req.body;
    
    // Server-side validation for moderation commands
    if (command === "kick" || command === "teleport") {
      if (!data.userId) {
        return res.status(400).send({ error: "userId is required for this command" });
      }
      
      // Fetch roster to validate user exists
      const rosterRes = await fetch(`http://127.0.0.1:5001/api/roster`, {
        headers: { "X-IPC-Secret": process.env.IPC_SECRET }
      });
      const rosterData = await rosterRes.json();
      
      const userExists = rosterData.users?.some(u => u.id === data.userId || u.username.toLowerCase() === data.userId.toLowerCase());
      if (!userExists) {
        return res.status(404).send({ error: "User is not currently in the room." });
      }
      
      // If they provided a username, map it to ID for the bot
      if (userExists) {
        const matchedUser = rosterData.users.find(u => u.id === data.userId || u.username.toLowerCase() === data.userId.toLowerCase());
        data.userId = matchedUser.id; // Force using the ID
      }
      
      // Validate teleport coords
      if (command === "teleport") {
        data.x = parseFloat(data.x) || 0;
        data.y = parseFloat(data.y) || 0;
        data.z = parseFloat(data.z) || 0;
      }
    }
    
    const response = await fetch(`http://127.0.0.1:5001/api/${command}`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-IPC-Secret": process.env.IPC_SECRET
      },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to communicate with bot process" });
  }
});

app.get("/api/config", (req, res) => {
  res.send({
    roomIdSet: !!process.env.ROOM_ID,
    apiTokenSet: !!process.env.API_TOKEN,
    port: process.env.PORT || 30191
  });
});

app.post("/api/config", (req, res) => {
  try {
    const { ROOM_ID, API_TOKEN } = req.body;
    let envContent = fs.readFileSync('.env', 'utf8');
    if (ROOM_ID) {
      envContent = envContent.replace(/ROOM_ID=.*/g, `ROOM_ID=${ROOM_ID}`);
    }
    if (API_TOKEN) {
      envContent = envContent.replace(/API_TOKEN=.*/g, `API_TOKEN=${API_TOKEN}`);
    }
    fs.writeFileSync('.env', envContent);
    res.send({ status: "success", message: "Config saved. Restart required." });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.get("/api/access", (req, res) => {
  try {
    const adminsPath = path.join(__dirname, "systems/admin/data/admins.json");
    if (fs.existsSync(adminsPath)) {
      const data = JSON.parse(fs.readFileSync(adminsPath, 'utf8'));
      res.send(data);
    } else {
      res.send({ admins: [], vips: [], owner: "" });
    }
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

app.post("/api/access", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/access`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-IPC-Secret": process.env.IPC_SECRET
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to communicate with bot process" });
  }
});

app.get("/api/economy", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/economy`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get economy data" });
  }
});

app.post("/api/economy", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/economy`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-IPC-Secret": process.env.IPC_SECRET
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to update economy data" });
  }
});

app.post("/api/terminal", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/terminal`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-IPC-Secret": process.env.IPC_SECRET
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to execute terminal command" });
  }
});

app.post("/api/mode", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/mode`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "X-IPC-Secret": process.env.IPC_SECRET
      },
      body: JSON.stringify(req.body)
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to change mode" });
  }
});

app.delete("/api/queue/:index", (req, res) => {
  const index = /^\d+$/.test(req.params.index) ? parseInt(req.params.index, 10) : NaN;
  if (isNaN(index) || index < 0 || index >= queue.length) {
    return res.status(400).send({ error: "Invalid queue index" });
  }
  const removed = queue.splice(index, 1);
  saveQueue();
  broadcastEvent();
  res.send({ status: "success", removed: removed[0]?.metadata?.title || 'Track' });
});

app.get("/api/stats", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/stats`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get stats" });
  }
});

app.get("/api/playlists", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/playlists`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get playlists" });
  }
});

app.get("/api/outfits", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/outfits`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get outfits" });
  }
});

app.get("/api/locations", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/locations`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get locations" });
  }
});

app.get("/api/shop", async (req, res) => {
  try {
    const q = req.query.q || '';
    const response = await fetch(`http://127.0.0.1:5001/api/shop?q=${encodeURIComponent(q)}`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to query shop" });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/history`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to query history" });
  }
});

// Duplicate /api/bot-command removed; primary handler with moderation active

app.post("/api/broadcast", (req, res) => {
  if (req.body) {
    broadcastEventJSON(req.body);
  }
  res.send({ success: true });
});

app.get("/api/roster", async (req, res) => {
  try {
    const response = await fetch(`http://127.0.0.1:5001/api/roster`, {
      method: "GET",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    });
    const result = await response.json();
    res.status(response.status).send(result);
  } catch (e) {
    res.status(500).send({ error: "Failed to get roster" });
  }
});

app.post("/api/restart", async (req, res) => {
  console.log("🔄 FULL RESTART command received");
  
  res.send({ 
    status: "restarting",
    message: "System is restarting...",
    timestamp: Date.now()
  });
  
  savePlaybackState();
  saveQueue();
  
  try {
    // Try to restart Python bot via IPC
    await fetch(`http://127.0.0.1:5001/api/restart`, {
      method: "POST",
      headers: { "X-IPC-Secret": process.env.IPC_SECRET }
    }).catch(e => null);
  } catch(e) {}
  
  setTimeout(() => {
    process.exit(1);
  }, 500);
});

app.post("/restart", (req, res) => {
  console.log("🔄 RESTART command received");
  
  res.send({ 
    status: "restarting",
    message: "Music server is restarting...",
    timestamp: Date.now()
  });
  
  savePlaybackState();
  saveQueue();
  
  setTimeout(() => {
    process.exit(1);
  }, 500);
});

queue = loadQueue();
const playbackState = loadPlaybackState();

streamManager.startPersistentEncoder();

setInterval(() => {
  const health = streamManager.getHealthStatus();
  if (!health.encoderAlive) {
    console.error('⚠️ Health check: Encoder not alive, restarting...');
    streamManager.startPersistentEncoder();
  }
}, 30000);

// Periodic memory maintenance: sweep expired cache and invoke GC if exposed
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of metadataCache.entries()) {
    if (now - val.timestamp > CACHE_TTL) {
      metadataCache.delete(key);
    }
  }
  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch (e) {}
  }
}, 5 * 60 * 1000);


// 🛡️ Memory Guard - Periodically check memory without stalling the audio thread
setInterval(() => {
  const mem = process.memoryUsage();
  const rssMb = (mem.rss / 1024 / 1024).toFixed(1);
  const heapMb = (mem.heapUsed / 1024 / 1024).toFixed(1);
  // Only trigger GC and cache cleanup if memory is critically high (> 380MB RSS or > 160MB heap)
  if (mem.rss > 380 * 1024 * 1024 || mem.heapUsed > 160 * 1024 * 1024) {
    console.warn(`⚠️ [MemoryGuard] Critically elevated Node memory: RSS ${rssMb}MB, Heap ${heapMb}MB - running cleanup...`);
    pruneStaleCacheFiles(currentLocalFilePath);
    if (typeof global.gc === 'function') {
      try {
        global.gc();
      } catch (e) {}
    }
  }
}, 120000);

// 🧹 Periodic Disk Cache Guardian (Every 10 min: TTL purge TTS, LRU evict songs, keep size <= MAX_CACHE_SIZE_BYTES)
setInterval(async () => {
  try {
    await enforceGlobalCacheLimit();
  } catch (e) {
    console.warn("⚠️ [Cache Maintenance] Periodic sweep error:", e.message);
  }
}, 10 * 60 * 1000);

// registerLiveLogs(app); disabled for CPU optimization

const rawPort = process.env.PORT || process.env.SERVER_PORT || 30191;
const PORT = parseInt(String(rawPort).trim(), 10) || 30191;

function listenWithRetry(port, retriesLeft = 10) {
  const server = app.listen(port, "0.0.0.0", async () => {
    await ensureYtDlp();

    // Self-healing disk cache enforcement on startup
    try {
      await enforceGlobalCacheLimit();
    } catch (e) {
      console.warn("⚠️ [Cache Startup] Initial sweep error:", e.message);
    }

    console.log(`🚀 Music server running on port ${port}`);
    console.log("📡 Persistent streaming architecture active!");
    console.log("🔧 FFmpeg encoder runs continuously - no disconnections between songs");
    
    if (playbackState.isPlaying && playbackState.currentTitle && playbackState.currentMetadata) {
      console.log(`🔄 Restoring previously playing song: ${playbackState.currentTitle}`);
      
      const restoredVideoId = playbackState.currentMetadata.videoId;
      const alreadyInQueue = queue.some(item => 
        item.metadata?.videoId === restoredVideoId || 
        item.url === playbackState.currentMetadata.url
      );
      
      if (alreadyInQueue) {
        console.log(`⚠️ Song already in queue, not adding duplicate`);
        const existingIndex = queue.findIndex(item => 
          item.metadata?.videoId === restoredVideoId || 
          item.url === playbackState.currentMetadata.url
        );
        if (existingIndex > 0) {
          const [existingSong] = queue.splice(existingIndex, 1);
          queue.unshift(existingSong);
          console.log(`↩️ Moved existing song to front of queue`);
        }
      } else {
        queue.unshift({
          url: playbackState.currentMetadata.url,
          metadata: playbackState.currentMetadata,
          isAutoplay: playbackState.currentIsAutoplay || false
        });
        console.log(`✅ Restored 1 songs from previous session`);
      }
      saveQueue();
    }
    
    if (queue.length > 0) {
      console.log(`📋 Queue has ${queue.length} songs ready to play`);
      console.log("▶️ Auto-starting playback from saved queue...");
      
      setTimeout(() => {
        playNext();
      }, 2000);
    }
  });

  server.keepAliveTimeout = 120000;
  server.headersTimeout = 125000;
  server.timeout = 0;

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && retriesLeft > 0) {
      console.log(`⚠️ Port ${port} is in use (socket releasing). Retrying in 3 seconds... (${retriesLeft} retries left)`);
      setTimeout(() => {
        listenWithRetry(port, retriesLeft - 1);
      }, 3000);
    } else {
      console.error("❌ Music server error:", err);
    }
  });
}

listenWithRetry(PORT);


// ============================================================================
// 🛡️ Render 24/7 Keep-Alive Sentinel (Prevents Free-Tier Inactivity Sleep)
// ============================================================================
function armRenderKeepAlive() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL;
  if (!externalUrl || externalUrl.includes('127.0.0.1') || externalUrl.includes('localhost')) {
    return;
  }

  const pingEndpoint = externalUrl.replace(/\/+$/, '') + '/ping';
  console.log(`🛡️ [Keep-Alive Sentinel] Armed 24/7 anti-sleep pinger -> ${pingEndpoint}`);

  // Ping every 7 minutes (Render free tier spins down after 15 minutes of no HTTP traffic)
  setInterval(async () => {
    try {
      const res = await fetch(pingEndpoint, { 
        headers: { 'User-Agent': 'MusicEngine-KeepAlive/1.0' },
        timeout: 10000 
      });
      if (res.ok) {
        console.log(`💓 [Keep-Alive Sentinel] Ping successful at ${new Date().toISOString().slice(11, 19)} (Render sleep timer reset)`);
      }
    } catch (err) {
      console.warn(`⚠️ [Keep-Alive Sentinel] Ping attempt failed: ${err.message}`);
    }
  }, 7 * 60 * 1000);
}

armRenderKeepAlive();
