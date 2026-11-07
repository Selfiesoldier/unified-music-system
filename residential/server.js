import http from 'http';
import https from 'https';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8888', 10);
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'bridge_cache');
const MAX_CACHE_TRACKS = parseInt(process.env.MAX_CACHE_TRACKS || '30', 10);
const MAX_CACHE_MB = parseInt(process.env.MAX_CACHE_MB || '200', 10);

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

function getCacheKey(targetUrl) {
  const ytMatch = (targetUrl || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `yt_${ytMatch[1]}`;
  return crypto.createHash('md5').update(targetUrl || 'unknown').digest('hex');
}

function pruneBridgeCache() {
  try {
    const files = fs.readdirSync(CACHE_DIR);
    const m4aFiles = [];
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
        if (f.endsWith('.m4a') && !f.includes('.temp.')) {
          m4aFiles.push({ path: full, size: st.size, mtime: st.mtimeMs });
          totalBytes += st.size;
        }
      } catch (_) {}
    }

    m4aFiles.sort((a, b) => a.mtime - b.mtime);
    const maxBytes = MAX_CACHE_MB * 1024 * 1024;

    while ((m4aFiles.length > MAX_CACHE_TRACKS || totalBytes > maxBytes) && m4aFiles.length > 5) {
      const oldest = m4aFiles.shift();
      try {
        fs.unlinkSync(oldest.path);
        totalBytes -= oldest.size;
        console.log(`[ResidentialBridge] 🧹 Evicted LRU cached track: ${path.basename(oldest.path)}`);
      } catch (_) {}
    }
  } catch (_) {}
}

// Initial cleanup & periodic maintenance sweep
pruneBridgeCache();
setInterval(pruneBridgeCache, 15 * 60 * 1000);

const server = http.createServer(async (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (reqUrl.pathname === '/health' || reqUrl.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', service: 'residential_bridge', timestamp: Date.now() }));
  }

  if (reqUrl.pathname === '/tts') {
    const text = reqUrl.searchParams.get('text');
    const lang = reqUrl.searchParams.get('lang') || 'en';
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?text= query parameter' }));
    }
    const clean = text.slice(0, 200);
    const ttsHash = crypto.createHash('md5').update(`${clean}_${lang}`).digest('hex').slice(0, 16);
    const cachedTts = path.join(CACHE_DIR, `tts_${ttsHash}.mp3`);

    if (fs.existsSync(cachedTts)) {
      try {
        const stats = fs.statSync(cachedTts);
        if (stats.size > 1000) {
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Bridge-Source': 'tts-cache'
          });
          return fs.createReadStream(cachedTts).pipe(res);
        }
      } catch (_) {}
    }

    // Proxy to Cloud Worker's dedicated FFmpeg transcode engine for 96k CBR MP3
    const workerUrl = `http://92.118.206.201:30229/tts?text=${encodeURIComponent(clean)}&lang=${encodeURIComponent(lang)}`;
    http.get(workerUrl, (wRes) => {
      if (wRes.statusCode === 200) {
        res.writeHead(200, {
          'Content-Type': 'audio/mpeg',
          'Cache-Control': 'public, max-age=86400',
          'X-Bridge-Source': 'tts-worker-proxy'
        });
        const fileOut = fs.createWriteStream(cachedTts);
        wRes.pipe(fileOut);
        return wRes.pipe(res);
      }
      res.writeHead(wRes.statusCode || 502, { 'Content-Type': 'application/json' });
      wRes.pipe(res);
    }).on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `TTS worker proxy error: ${err.message}` }));
    });
    return;
  }

  if (reqUrl.pathname === '/transcode') {
    const uniqueSession = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempRawInput = path.join(CACHE_DIR, `raw_trans_${uniqueSession}.raw`);
    const tempFinalMp3 = path.join(CACHE_DIR, `final_trans_${uniqueSession}.mp3`);

    const cleanUp = () => {
      try { if (fs.existsSync(tempRawInput)) fs.unlinkSync(tempRawInput); } catch (_) {}
      try { if (fs.existsSync(tempFinalMp3)) fs.unlinkSync(tempFinalMp3); } catch (_) {}
    };

    try {
      if (req.method === 'POST') {
        const fileStream = fs.createWriteStream(tempRawInput);
        await new Promise((resolve, reject) => {
          req.pipe(fileStream);
          req.on('error', reject);
          fileStream.on('finish', resolve);
          fileStream.on('error', reject);
        });
      } else {
        const sourceUrl = reqUrl.searchParams.get('url');
        if (!sourceUrl) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Missing POST body or ?url= parameter' }));
        }
        const srcRes = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) });
        if (!srcRes.ok) throw new Error(`Source audio returned HTTP ${srcRes.status}`);
        const buf = Buffer.from(await srcRes.arrayBuffer());
        await fs.promises.writeFile(tempRawInput, buf);
      }

      if (fs.statSync(tempRawInput).size < 1000) {
        throw new Error('Uploaded audio payload too small');
      }

      // Transcode via Termux's single-thread FFmpeg strictly to 96kbps CBR 44.1kHz stereo MP3
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-threads', '1',
          '-i', tempRawInput,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          '-ar', '44100',
          '-ac', '2',
          '-write_xing', '0',
          '-id3v2_version', '0',
          tempFinalMp3
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let errBuf = '';
        ff.stderr.on('data', d => errBuf += d.toString());
        ff.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg transcode failed (code ${code}): ${errBuf.slice(-200)}`));
        });
        ff.on('error', reject);
      });

      const st = fs.statSync(tempFinalMp3);
      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache'
      });
      const stream = fs.createReadStream(tempFinalMp3);
      stream.pipe(res);
      stream.on('finish', cleanUp);
      stream.on('error', cleanUp);
      return;
    } catch (err) {
      cleanUp();
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Transcode error', details: err.message }));
    }
  }

  if (reqUrl.pathname === '/stream') {
    const targetUrl = reqUrl.searchParams.get('url');
    if (!targetUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?url= query parameter' }));
    }

    const key = getCacheKey(targetUrl);
    const cachedFile = path.join(CACHE_DIR, `${key}.mp3`);

    console.log(`[ResidentialBridge] 📥 [Client: ${clientIp}] Request for: ${targetUrl}`);

    // Instant Cache Hit (0s latency)
    if (fs.existsSync(cachedFile)) {
      try {
        const stats = fs.statSync(cachedFile);
        if (stats.size > 50000) {
          console.log(`[ResidentialBridge] ⚡ Serving cached 96k CBR MP3 (${(stats.size / 1024 / 1024).toFixed(2)} MB)...`);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Bridge-Source': 'residential-cache'
          });
          return fs.createReadStream(cachedFile).pipe(res);
        }
      } catch (_) {}
    }

    // Download audio via residential IP
    const tempRaw = path.join(CACHE_DIR, `${key}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.raw`);
    const tempMp3 = path.join(CACHE_DIR, `${key}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.mp3`);

    const currentArgs = [
      '-f', 'ba[ext=m4a]/ba[ext=webm]/bestaudio/ba/b/best',
      '-o', tempRaw,
      '--no-video',
      '--no-playlist',
      '--no-warnings',
      '--force-ipv4',
      '--extractor-args', 'youtube:player_client=android,web,tv,visionos',
      targetUrl
    ];

    console.log(`[ResidentialBridge] 🚀 Downloading track via residential IP...`);

    const ytProcess = spawn(YTDLP_PATH, currentArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errBuffer = '';
    ytProcess.stderr.on('data', (d) => { errBuffer += d.toString(); });

    ytProcess.on('close', async (code, signal) => {
      if (code !== 0 || !fs.existsSync(tempRaw)) {
        console.error(`[ResidentialBridge] ❌ Download failed (code ${code}, signal ${signal}): ${errBuffer.slice(0, 200)}`);
        try { if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw); } catch (_) {}
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Download failed', code, signal, details: errBuffer.slice(-300) }));
        }
        return;
      }

      // Transcode downloaded audio directly to 96kbps CBR 44.1kHz stereo MP3
      try {
        console.log(`[ResidentialBridge] 🔄 Transcoding downloaded track to 96k CBR MP3...`);
        await new Promise((resolve, reject) => {
          const ff = spawn('ffmpeg', [
            '-y',
            '-threads', '1',
            '-i', tempRaw,
            '-vn',
            '-c:a', 'libmp3lame',
            '-b:a', '96k',
            '-ar', '44100',
            '-ac', '2',
            '-write_xing', '0',
            '-id3v2_version', '0',
            tempMp3
          ], { stdio: ['ignore', 'ignore', 'pipe'] });

          let ffErr = '';
          ff.stderr.on('data', d => ffErr += d.toString());
          ff.on('close', c => {
            if (c === 0 && fs.existsSync(tempMp3)) resolve();
            else reject(new Error(`FFmpeg transcode failed (code ${c}): ${ffErr.slice(-200)}`));
          });
          ff.on('error', reject);
        });

        try { fs.unlinkSync(tempRaw); } catch (_) {}
        try { fs.renameSync(tempMp3, cachedFile); } catch (_) {}

        const fileToStream = fs.existsSync(cachedFile) ? cachedFile : tempMp3;
        const stats = fs.statSync(fileToStream);

        pruneBridgeCache();

        console.log(`[ResidentialBridge] ✅ Completed 96k CBR transcode (${(stats.size / 1024 / 1024).toFixed(2)} MB). Streaming to client...`);
        if (!res.headersSent) {
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Bridge-Source': 'residential-direct'
          });
          fs.createReadStream(fileToStream).pipe(res);
        }
      } catch (trErr) {
        console.error(`[ResidentialBridge] Transcode error:`, trErr.message);
        try { if (fs.existsSync(tempRaw)) fs.unlinkSync(tempRaw); } catch (_) {}
        try { if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3); } catch (_) {}
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Transcode failed', details: trErr.message }));
        }
      }
    });

    req.on('close', () => {
      if (!ytProcess.killed && ytProcess.exitCode === null) {
        console.log(`🛑 [Client: ${clientIp}] disconnected before stream could be delivered.`);
        try { ytProcess.kill('SIGKILL'); } catch (_) {}
      }
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
║         🏠 RESIDENTIAL AUDIO BRIDGE ACTIVE                    ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:           ${PORT}                                         ║
║  Endpoint:       http://127.0.0.1:${PORT}/stream?url=...         ║
║  yt-dlp:         ${YTDLP_PATH}
║  Cache Dir:      ${CACHE_DIR}
╚═══════════════════════════════════════════════════════════════╝
  `);
});
