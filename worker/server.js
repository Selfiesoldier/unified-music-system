import http from 'http';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '30033', 10);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'worker_cache');
const MAX_CACHE_TRACKS = parseInt(process.env.MAX_CACHE_TRACKS || '60', 10);
const MAX_CACHE_MB = parseInt(process.env.MAX_CACHE_MB || '500', 10);

function getYTPath() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) {
    return process.env.YTDLP_PATH;
  }
  if (process.platform === 'win32') {
    const localExe = path.join(__dirname, 'yt-dlp.exe');
    return fs.existsSync(localExe) ? localExe : 'yt-dlp.exe';
  }
  const localBin = path.join(__dirname, 'yt-dlp');
  return fs.existsSync(localBin) ? localBin : 'yt-dlp';
}

const YTDLP_PATH = getYTPath();

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCacheKey(targetUrl, title = '') {
  const ytMatch = (targetUrl || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `yt_${ytMatch[1]}`;
  const raw = `${targetUrl || ''}_${title || ''}`;
  return crypto.createHash('md5').update(raw).digest('hex').slice(0, 20);
}

function pruneWorkerCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const audioFiles = [];
    let totalBytes = 0;
    const now = Date.now();

    for (const f of files) {
      const full = path.join(CACHE_DIR, f);
      try {
        const st = fs.statSync(full);
        // Clean interrupted temp files older than 10 minutes
        if (f.includes('.temp.') && (now - st.mtimeMs > 10 * 60 * 1000)) {
          try { fs.unlinkSync(full); } catch (_) {}
          continue;
        }
        if ((f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.webm')) && !f.includes('.temp.')) {
          audioFiles.push({ path: full, size: st.size, mtime: st.mtimeMs });
          totalBytes += st.size;
        }
      } catch (_) {}
    }

    audioFiles.sort((a, b) => a.mtime - b.mtime);
    const maxBytes = MAX_CACHE_MB * 1024 * 1024;

    while ((audioFiles.length > MAX_CACHE_TRACKS || totalBytes > maxBytes) && audioFiles.length > 5) {
      const oldest = audioFiles.shift();
      try {
        fs.unlinkSync(oldest.path);
        totalBytes -= oldest.size;
        console.log(`[Worker] 🧹 Evicted LRU cached track: ${path.basename(oldest.path)}`);
      } catch (_) {}
    }
  } catch (_) {}
}

pruneWorkerCache();
setInterval(pruneWorkerCache, 15 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health / Ping
  if (reqUrl.pathname === '/health' || reqUrl.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'download_worker',
      uptime: Math.floor(process.uptime()),
      cacheDir: CACHE_DIR
    }));
  }

  // Stream / Download Endpoint
  if (reqUrl.pathname === '/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    const title = reqUrl.searchParams.get('title') || '';
    const artist = reqUrl.searchParams.get('artist') || '';

    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?url= query parameter' }));
    }

    const key = getCacheKey(targetUrl, title);
    const cachedFile = path.join(CACHE_DIR, `${key}.m4a`);

    console.log(`[Worker] 📥 [Client: server_${clientIp}] Request for: "${title || targetUrl}" (${targetUrl})`);

    // 1. Instant Cache Hit (0s response directly from disk)
    if (fs.existsSync(cachedFile)) {
      try {
        const stats = fs.statSync(cachedFile);
        if (stats.size > 50000) {
          console.log(`[Worker] ⚡ Instant Cache Hit (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
          res.writeHead(200, {
            'Content-Type': 'audio/mp4',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Worker-Source': 'cache'
          });
          return fs.createReadStream(cachedFile).pipe(res);
        }
      } catch (_) {}
    }

    // 2. Download via yt-dlp
    const tempFile = path.join(CACHE_DIR, `${key}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.temp.m4a`);

    const currentArgs = [
      '-f', 'ba[ext=m4a]/ba[ext=webm]/bestaudio/ba/b/best',
      '-o', tempFile,
      '--no-video',
      '--no-playlist',
      '--no-warnings',
      '--force-ipv4',
      targetUrl
    ];

    console.log(`[Worker] 🚀 Downloading track via yt-dlp...`);

    const ytProcess = spawn(YTDLP_PATH, currentArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuffer = '';
    ytProcess.stderr.on('data', (d) => { errBuffer += d.toString(); });

    // downloadComplete is set at the TOP of ytProcess.on('close') so req.on('close')
    // can tell the difference even if both events fire in the same tick.
    let downloadComplete = false;
    let streamDelivered  = false;

    ytProcess.on('close', (code, signal) => {
      downloadComplete = true; // mark BEFORE any async I/O so req.on('close') sees it

      if (code !== 0 || !fs.existsSync(tempFile)) {
        console.error(`[Worker] ❌ Download failed (code ${code}, signal ${signal}): ${errBuffer.slice(0, 200)}`);
        try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Download failed', code, signal, details: errBuffer.slice(-300) }));
        }
        return;
      }

      try { fs.renameSync(tempFile, cachedFile); } catch (_) {}

      const fileToStream = fs.existsSync(cachedFile) ? cachedFile : tempFile;
      const stats = fs.statSync(fileToStream);

      pruneWorkerCache();

      // Client may have already disconnected — only stream if connection is still alive
      if (res.destroyed || res.headersSent) {
        console.log(`[Worker] 📦 Track cached (${(stats.size / 1024 / 1024).toFixed(2)} MB) — client already left, will serve on next request.`);
        return;
      }

      console.log(`[Worker] ✅ Track downloaded & cached (${(stats.size / 1024 / 1024).toFixed(2)} MB): ${path.basename(fileToStream)}`);
      streamDelivered = true;

      res.writeHead(200, {
        'Content-Type': 'audio/mp4',
        'Content-Length': stats.size,
        'Cache-Control': 'public, max-age=86400',
        'X-Worker-Source': 'direct'
      });
      fs.createReadStream(fileToStream).pipe(res);
    });

    req.on('close', () => {
      if (streamDelivered) return; // stream already in flight — nothing to do

      if (downloadComplete) {
        // yt-dlp finished and cached the file, client just left before we could pipe
        // The file is safely on disk — next request will get an instant cache hit
        console.log(`[Worker] 📦 [Client: ${clientIp}] disconnected after download — track cached for next request.`);
        return; // do NOT delete — the rename already moved it to cachedFile
      }

      // yt-dlp was still running when client disconnected — truly interrupted
      console.log(`[Worker] 🛑 [Client: ${clientIp}] disconnected mid-download — aborting yt-dlp.`);
      try { ytProcess.kill('SIGKILL'); } catch (_) {}
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (_) {}
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔═══════════════════════════════════════════════════════════════╗
║         ☁️ HIGH-PERFORMANCE DOWNLOAD WORKER ACTIVE           ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:           ${PORT}                                        ║
║  Endpoint:       http://0.0.0.0:${PORT}/stream?url=...          ║
║  yt-dlp:         ${YTDLP_PATH}
║  Cache Dir:      ${CACHE_DIR}
╚═══════════════════════════════════════════════════════════════╝
  `);
});
