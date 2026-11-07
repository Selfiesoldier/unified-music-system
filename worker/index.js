import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rawPort = process.env.PORT || process.env.SERVER_PORT || 3000;
const PORT = parseInt(String(rawPort).trim(), 10) || 3000;
const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, 'cache');
const MAX_CACHED_TRACKS = parseInt(process.env.MAX_CACHED_TRACKS, 10) || 10;
const MAX_CACHE_SIZE_BYTES = (parseInt(process.env.MAX_CACHE_MB, 10) || 250) * 1024 * 1024;

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// Clean up stale temp files on boot
try {
  const stale = fs.readdirSync(CACHE_DIR);
  for (const f of stale) {
    if (f.includes('.temp.') || f.endsWith('.tmp') || f.endsWith('.part') || f.startsWith('raw_') || f.startsWith('final_')) {
      try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch (_) {}
    }
  }
} catch (_) {}

let activeDownloads = 0;
let totalDownloadsServed = 0;

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCacheKey(targetUrl) {
  const normalized = (targetUrl || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return `track_${crypto.createHash('md5').update(normalized || 'unknown').digest('hex').slice(0, 16)}`;
}

async function pruneLRUCache() {
  try {
    const files = await fs.promises.readdir(CACHE_DIR);
    const trackFiles = [];
    let totalBytes = 0;

    for (const f of files) {
      if ((f.endsWith('.mp3') || f.endsWith('.m4a')) && !f.includes('.temp.') && !f.startsWith('final_') && !f.startsWith('raw_')) {
        const full = path.join(CACHE_DIR, f);
        try {
          const st = await fs.promises.stat(full);
          trackFiles.push({ path: full, size: st.size, mtime: st.mtimeMs });
          totalBytes += st.size;
        } catch (_) {}
      }
    }

    trackFiles.sort((a, b) => a.mtime - b.mtime);

    let evictedCount = 0;
    while ((trackFiles.length > MAX_CACHED_TRACKS || totalBytes > MAX_CACHE_SIZE_BYTES) && trackFiles.length > 0) {
      const oldest = trackFiles.shift();
      try {
        await fs.promises.unlink(oldest.path);
        totalBytes -= oldest.size;
        evictedCount++;
        console.log(`🧹 [Worker LRU] Evicted old track: ${path.basename(oldest.path)}`);
      } catch (_) {}
    }
    if (evictedCount > 0) {
      console.log(`🧹 [Worker LRU] Pruned ${evictedCount} track(s), retaining ${trackFiles.length} / ${MAX_CACHED_TRACKS} tracks`);
    }
  } catch (err) {
    console.error('LRU prune error:', err.message);
  }
}

// Initial prune and interval check every 10 minutes
pruneLRUCache();
setInterval(pruneLRUCache, 10 * 60 * 1000);

// =========================================================================
// 🔐 PURE JS DES-ECB DECRYPTOR (Zero external dependencies)
// Decrypts JioSaavn's encrypted_media_url to direct Akamai CDN MP4 stream
// =========================================================================
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const S = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]
];

function getBit(buf, pos) {
  const byteIdx = (pos - 1) >>> 3;
  const bitIdx = 7 - ((pos - 1) & 7);
  return (buf[byteIdx] >>> bitIdx) & 1;
}

function setBit(buf, pos, val) {
  const byteIdx = (pos - 1) >>> 3;
  const bitIdx = 7 - ((pos - 1) & 7);
  if (val) buf[byteIdx] |= (1 << bitIdx);
  else buf[byteIdx] &= ~(1 << bitIdx);
}

function permute(src, table, outBits) {
  const out = Buffer.alloc(Math.ceil(outBits / 8));
  for (let i = 0; i < outBits; i++) {
    const bit = getBit(src, table[i]);
    setBit(out, i + 1, bit);
  }
  return out;
}

function generateSubkeys(keyBuf) {
  const cd = permute(keyBuf, PC1, 56);
  let c = Buffer.alloc(4); let d = Buffer.alloc(4);
  for (let i = 1; i <= 28; i++) setBit(c, i, getBit(cd, i));
  for (let i = 1; i <= 28; i++) setBit(d, i, getBit(cd, i + 28));
  const subkeys = [];
  for (let round = 0; round < 16; round++) {
    const shift = SHIFTS[round];
    const shift28 = (buf, s) => {
      let val = 0;
      for (let i = 1; i <= 28; i++) val = (val << 1) | getBit(buf, i);
      val = ((val << s) | (val >>> (28 - s))) & 0x0FFFFFFF;
      const res = Buffer.alloc(4);
      for (let i = 28; i >= 1; i--) { setBit(res, i, val & 1); val >>>= 1; }
      return res;
    };
    c = shift28(c, shift); d = shift28(d, shift);
    const combined = Buffer.alloc(7);
    for (let i = 1; i <= 28; i++) setBit(combined, i, getBit(c, i));
    for (let i = 1; i <= 28; i++) setBit(combined, i + 28, getBit(d, i));
    subkeys.push(permute(combined, PC2, 48));
  }
  return subkeys;
}

function feistel(r, subkey) {
  const er = permute(r, E, 48);
  const xored = Buffer.alloc(6);
  for (let i = 0; i < 6; i++) xored[i] = er[i] ^ subkey[i];
  const sOut = Buffer.alloc(4);
  for (let i = 0; i < 8; i++) {
    const bitOffset = i * 6 + 1;
    const b1 = getBit(xored, bitOffset);
    const b2 = getBit(xored, bitOffset + 1);
    const b3 = getBit(xored, bitOffset + 2);
    const b4 = getBit(xored, bitOffset + 3);
    const b5 = getBit(xored, bitOffset + 4);
    const b6 = getBit(xored, bitOffset + 5);
    const row = (b1 << 1) | b6;
    const col = (b2 << 3) | (b3 << 2) | (b4 << 1) | b5;
    const val = S[i][row * 16 + col];
    const outBitOffset = i * 4 + 1;
    setBit(sOut, outBitOffset, (val >> 3) & 1);
    setBit(sOut, outBitOffset + 1, (val >> 2) & 1);
    setBit(sOut, outBitOffset + 2, (val >> 1) & 1);
    setBit(sOut, outBitOffset + 3, val & 1);
  }
  return permute(sOut, P, 32);
}

function desDecryptBlock(block, subkeys) {
  const ip = permute(block, IP, 64);
  let l = Buffer.alloc(4); let r = Buffer.alloc(4);
  for (let i = 1; i <= 32; i++) { setBit(l, i, getBit(ip, i)); setBit(r, i, getBit(ip, i + 32)); }
  for (let round = 15; round >= 0; round--) {
    const f = feistel(r, subkeys[round]);
    const nextR = Buffer.alloc(4);
    for (let i = 0; i < 4; i++) nextR[i] = l[i] ^ f[i];
    l = r; r = nextR;
  }
  const combined = Buffer.alloc(8);
  for (let i = 1; i <= 32; i++) { setBit(combined, i, getBit(r, i)); setBit(combined, i + 32, getBit(l, i)); }
  return permute(combined, FP, 64);
}

function decryptSaavnUrl(base64Cipher) {
  try {
    const cipherBytes = Buffer.from(base64Cipher, 'base64');
    const subkeys = generateSubkeys(Buffer.from('38346591', 'utf8'));
    const decryptedBlocks = [];
    for (let i = 0; i < cipherBytes.length; i += 8) {
      decryptedBlocks.push(desDecryptBlock(cipherBytes.subarray(i, i + 8), subkeys));
    }
    const full = Buffer.concat(decryptedBlocks);
    const padLen = full[full.length - 1];
    if (padLen >= 1 && padLen <= 8) return full.subarray(0, full.length - padLen).toString('utf8');
    return full.toString('utf8');
  } catch (e) {
    return null;
  }
}

// =========================================================================
// 🎯 SMART JIOSAAVN RESOLVER (80M+ Studio Tracks, Akamai Direct CDN)
// =========================================================================
const JIO_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Forwarded-For': '106.51.72.100',
  'Client-IP': '106.51.72.100',
  'Cookie': 'L=english; geo=in; DL=english'
};

async function resolveJioSaavnTrack(query, reqTitle, reqArtist, reqDuration) {
  const cleanSearch = (query || reqTitle || '')
    .replace(/^scsearch\d*:/i, '')
    .replace(/^ytsearch\d*:/i, '')
    .trim();

  console.log(`[Worker Saavn] 🔍 Searching JioSaavn: "${cleanSearch}"...`);

  // Primary: search.getResults API with Indian catalog context
  let results = [];
  try {
    const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&cc=in&n=15&p=1&q=${encodeURIComponent(cleanSearch)}`;
    const res = await fetch(searchUrl, {
      headers: JIO_HEADERS,
      signal: AbortSignal.timeout(8000)
    });
    if (res.ok) {
      const data = await res.json();
      results = data.results || [];
    }
  } catch (err) {
    console.warn(`[Worker Saavn] Search API warning: ${err.message}`);
  }

  // Fallback: autocomplete.get + song.getDetails if search returned 0
  if (results.length === 0) {
    try {
      const acUrl = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(cleanSearch)}`;
      const res = await fetch(acUrl, {
        headers: JIO_HEADERS,
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        const songs = data.songs?.data || [];
        if (songs.length > 0) {
          const pids = songs.slice(0, 5).map(s => s.id).join(',');
          const detUrl = `https://www.jiosaavn.com/api.php?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=${pids}`;
          const detRes = await fetch(detUrl, { headers: JIO_HEADERS });
          if (detRes.ok) {
            const detData = await detRes.json();
            results = Object.values(detData).filter(v => v && v.encrypted_media_url).map(v => ({
              ...v,
              title: v.song || v.title,
              subtitle: v.primary_artists || v.singers,
              more_info: {
                encrypted_media_url: v.encrypted_media_url,
                duration: v.duration,
                primary_artists: v.primary_artists
              }
            }));
          }
        }
      }
    } catch (_) {}
  }

  if (results.length === 0) {
    console.warn(`[Worker Saavn] No results found for: "${cleanSearch}"`);
    return null;
  }

  const cleanReqTitle = (reqTitle || cleanSearch).toLowerCase().trim();
  const titleTokens = (reqTitle || cleanSearch).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const artistTokens = (reqArtist || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2);

  const wantsRemix = /remix/i.test(cleanSearch);
  const wantsKaraoke = /karaoke/i.test(cleanSearch);
  const wantsInstrumental = /instrumental/i.test(cleanSearch);
  const wantsLive = /live/i.test(cleanSearch);

  const scored = [];
  for (const item of results) {
    const enc = item.more_info?.encrypted_media_url || item.encrypted_media_url;
    if (!enc) continue;

    const title = (item.title || item.song || '').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, '&');
    const artist = (item.subtitle || item.primary_artists || item.more_info?.primary_artists || '').replace(/&amp;/g, '&');
    const duration = parseInt(item.more_info?.duration || item.duration || '0', 10);

    let score = 0;
    const lowerTitle = title.toLowerCase().trim();
    const lowerArtist = artist.toLowerCase().trim();

    // 1. Exact Title Match Bonus
    if (lowerTitle === cleanReqTitle) {
      score += 60;
    }

    // 2. Title Token Matching
    titleTokens.forEach(t => {
      if (lowerTitle.includes(t)) score += 25;
      const boundary = new RegExp(`\\b${t}\\b`, 'i');
      if (boundary.test(lowerTitle)) score += 15;
    });

    // 3. Artist Token Matching
    if (artistTokens.length > 0) {
      artistTokens.forEach(a => {
        if (lowerArtist.includes(a) || lowerTitle.includes(a)) {
          score += 35;
        }
      });
    }

    // 4. Duration Proximity Matching
    if (reqDuration > 0 && duration > 0) {
      const diff = Math.abs(duration - reqDuration);
      if (diff <= 8) score += 40;
      else if (diff <= 20) score += 25;
      else if (diff <= 45) score += 10;
      else if (diff > 90) score -= 40;
    }

    // 5. Hard Anti-Noise Penalties (disqualifies karaoke, instrumentals, covers, parodies)
    if (!wantsKaraoke && /karaoke/i.test(lowerTitle)) score -= 400;
    if (!wantsInstrumental && /instrumental/i.test(lowerTitle)) score -= 400;
    if (!wantsRemix && /remix/i.test(lowerTitle)) score -= 150;
    if (!wantsLive && /live/i.test(lowerTitle)) score -= 80;
    if (/tribute|cover|parody/i.test(lowerTitle) && !/cover/i.test(cleanSearch)) score -= 300;

    // 6. Play count popularity bonus
    const playCount = parseInt(item.play_count || '0', 10);
    if (playCount > 1000000) score += 20;
    else if (playCount > 100000) score += 10;

    scored.push({ title, artist, duration, enc, score });
  }

  scored.sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (winner && winner.score > 0) {
    const dec = decryptSaavnUrl(winner.enc);
    if (dec && dec.startsWith('http')) {
      const streamUrl = dec.replace(/_(?:320|160|96|48)\.(?:mp4|m4a|mp3)/i, '_96.mp4');
      console.log(`[Worker Saavn] 🎯 Best Match: "${winner.title}" by "${winner.artist}" (${winner.duration}s, score: ${winner.score})`);
      return {
        title: winner.title,
        artist: winner.artist,
        duration: winner.duration,
        score: winner.score,
        streamUrl
      };
    }
  }

  return null;
}

// =========================================================================
// 🚀 HTTP SERVER & ROUTING (Pure JioSaavn Engine - Zero SoundCloud)
// =========================================================================
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // Health Endpoint
  if (reqUrl.pathname === '/health') {
    let cachedFilesCount = 0;
    let cachedBytes = 0;
    try {
      const files = fs.readdirSync(CACHE_DIR);
      for (const f of files) {
        if (f.endsWith('.mp3')) {
          cachedFilesCount++;
          cachedBytes += fs.statSync(path.join(CACHE_DIR, f)).size;
        }
      }
    } catch (_) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      status: 'ok',
      service: 'download_worker',
      architecture: '100% JioSaavn Studio Engine (Akamai Direct CDN, Zero SoundCloud)',
      uptimeSeconds: Math.floor(process.uptime()),
      activeDownloads,
      totalDownloadsServed,
      cache: {
        files: cachedFilesCount,
        sizeMB: (cachedBytes / 1024 / 1024).toFixed(2),
        maxSizeMB: MAX_CACHE_SIZE_BYTES / 1024 / 1024
      },
      memory: {
        rssMB: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
        heapUsedMB: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1)
      }
    }, null, 2));
  }

  // Ping Endpoint
  if (reqUrl.pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('pong');
  }

  // Diagnostic Candidate Match Endpoint
  if (reqUrl.pathname === '/resolve') {
    const query = reqUrl.searchParams.get('q') || reqUrl.searchParams.get('url') || '';
    const title = reqUrl.searchParams.get('title') || '';
    const artist = reqUrl.searchParams.get('artist') || '';
    const duration = parseInt(reqUrl.searchParams.get('duration') || '0', 10);

    const match = await resolveJioSaavnTrack(query, title, artist, duration);
    if (match) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, match }, null, 2));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'No match found' }, null, 2));
    }
  }

  // Raw search debug endpoint
  if (reqUrl.pathname === '/debug-search') {
    const q = reqUrl.searchParams.get('q') || 'Starboy The Weeknd';
    const testUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&cc=in&n=5&p=1&q=${encodeURIComponent(q)}`;
    try {
      const apiRes = await fetch(testUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-Forwarded-For': '106.51.72.100',
          'Client-IP': '106.51.72.100',
          'Cookie': 'L=english; geo=in; DL=english'
        },
        signal: AbortSignal.timeout(8000)
      });
      const data = await apiRes.json();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: apiRes.status, total: data.total, results: data.results?.map(r => ({ title: r.title, artist: r.subtitle, dur: r.more_info?.duration })) }));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: e.message, stack: e.stack }));
    }
  }

  // TTS Endpoint (Google Translate TTS + Strict 96kbps CBR Transcode on Worker)
  if (reqUrl.pathname === '/tts') {
    const text = reqUrl.searchParams.get('text');
    const lang = reqUrl.searchParams.get('lang') || 'en';
    if (!text) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?text= parameter' }));
    }

    const ttsHash = crypto.createHash('md5').update(`${text}_${lang}`).digest('hex').slice(0, 16);
    const cachedTts = path.join(CACHE_DIR, `tts_${ttsHash}.mp3`);

    if (fs.existsSync(cachedTts)) {
      try {
        const stats = fs.statSync(cachedTts);
        if (stats.size > 1000) {
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Worker-Source': 'tts-cache'
          });
          return fs.createReadStream(cachedTts).pipe(res);
        }
      } catch (_) {}
    }

    const tempRawTts = path.join(CACHE_DIR, `raw_tts_${Date.now()}_${ttsHash}.mp3`);
    const tempFinalTts = path.join(CACHE_DIR, `final_tts_${Date.now()}_${ttsHash}.mp3`);

    try {
      const gUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
      const ttsRes = await fetch(gUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(10000)
      });
      if (!ttsRes.ok) throw new Error(`Google TTS HTTP ${ttsRes.status}`);

      const ttsBuf = Buffer.from(await ttsRes.arrayBuffer());
      if (ttsBuf.length < 500) throw new Error('Google TTS payload too small');

      await fs.promises.writeFile(tempRawTts, ttsBuf);

      // Transcode using FFmpeg on Worker strictly to 96kbps CBR 44.1kHz stereo MP3
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y',
          '-threads', '1',
          '-i', tempRawTts,
          '-vn',
          '-c:a', 'libmp3lame',
          '-b:a', '96k',
          '-ar', '44100',
          '-ac', '2',
          '-write_xing', '0',
          '-id3v2_version', '0',
          tempFinalTts
        ], { stdio: ['ignore', 'ignore', 'pipe'] });

        let errBuf = '';
        ff.stderr.on('data', d => errBuf += d.toString());
        ff.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg TTS failed (code ${code}): ${errBuf.slice(-200)}`));
        });
        ff.on('error', reject);
      });

      try { fs.unlinkSync(tempRawTts); } catch (_) {}

      const st = fs.statSync(tempFinalTts);
      if (st.size < 1000) {
        try { fs.unlinkSync(tempFinalTts); } catch (_) {}
        throw new Error('Normalized TTS MP3 file too small');
      }

      await fs.promises.rename(tempFinalTts, cachedTts);

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': st.size,
        'Cache-Control': 'public, max-age=86400',
        'X-Worker-Source': 'tts-normalized-96k'
      });
      return fs.createReadStream(cachedTts).pipe(res);
    } catch (ttsErr) {
      console.error(`[Worker] ❌ TTS transcode error: ${ttsErr.message}`);
      try { if (fs.existsSync(tempRawTts)) fs.unlinkSync(tempRawTts); } catch (_) {}
      try { if (fs.existsSync(tempFinalTts)) fs.unlinkSync(tempFinalTts); } catch (_) {}
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: ttsErr.message }));
    }
  }

  // Audio Transcode Endpoint (Offloads arbitrary audio normalization from Controller to Worker)
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

      // Transcode via Worker's FFmpeg strictly to 96kbps CBR 44.1kHz stereo MP3
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
      stream.on('close', cleanUp);
      return;
    } catch (trErr) {
      cleanUp();
      console.error(`[Worker] ❌ Transcode error: ${trErr.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: trErr.message }));
    }
  }

  // =========================================================================
  // 🎵 AUDIO STREAM PIPELINE: JioSaavn Akamai Fetch -> Single-Thread Transcode
  // =========================================================================
  if (reqUrl.pathname === '/stream') {
    const rawTarget = reqUrl.searchParams.get('url');
    if (!rawTarget) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Missing ?url= parameter' }));
    }

    const reqTitle = reqUrl.searchParams.get('title') || '';
    const reqArtist = reqUrl.searchParams.get('artist') || '';
    const reqDuration = parseInt(reqUrl.searchParams.get('duration') || '0', 10);

    console.log(`[Worker] 📥 Incoming stream request: "${rawTarget}" | Title: "${reqTitle}" | Artist: "${reqArtist}" (${reqDuration}s)`);

    // 1. Instant Cache Hit Check
    const initialKey = getCacheKey(rawTarget);
    const initialCachedMp3 = path.join(CACHE_DIR, `${initialKey}.mp3`);
    if (fs.existsSync(initialCachedMp3)) {
      try {
        const stats = fs.statSync(initialCachedMp3);
        if (stats.size > 50000) {
          console.log(`[Worker] ⚡ Instant Cache Hit for "${rawTarget}" (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
          res.writeHead(200, {
            'Content-Type': 'audio/mpeg',
            'Content-Length': stats.size,
            'Cache-Control': 'public, max-age=86400',
            'X-Worker-Source': 'jiosaavn-cache',
            'X-Worker-Cache': 'HIT'
          });
          totalDownloadsServed++;
          try { fs.utimesSync(initialCachedMp3, new Date(), new Date()); } catch (_) {}
          return fs.createReadStream(initialCachedMp3).pipe(res);
        }
      } catch (_) {}
    }

    activeDownloads++;
    const uniqueSession = `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const tempRawPath = path.join(CACHE_DIR, `raw_${uniqueSession}.m4a`);
    const tempFinalMp3 = path.join(CACHE_DIR, `final_${uniqueSession}.mp3`);

    let clientDisconnected = false;
    let activeFfmpeg = null;

    req.on('close', () => {
      clientDisconnected = true;
      if (activeFfmpeg) try { activeFfmpeg.kill('SIGKILL'); } catch (_) {}
    });

    try {
      const t0 = Date.now();

      // Step 1: Resolve track on JioSaavn
      const saavnTrack = await resolveJioSaavnTrack(rawTarget, reqTitle, reqArtist, reqDuration);
      if (!saavnTrack || !saavnTrack.streamUrl) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          error: 'Song not found on JioSaavn catalog',
          query: rawTarget,
          title: reqTitle,
          artist: reqArtist
        }));
      }

      // Step 2: High-speed download directly from Akamai CDN (~0.6s)
      console.log(`[Worker] ⚡ Downloading from Akamai CDN: ${saavnTrack.streamUrl}`);
      const cdnRes = await fetch(saavnTrack.streamUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(15000)
      });
      if (!cdnRes.ok) {
        throw new Error(`Akamai CDN returned HTTP ${cdnRes.status}`);
      }

      const rawBuffer = Buffer.from(await cdnRes.arrayBuffer());
      if (rawBuffer.length < 50000) {
        throw new Error(`Akamai CDN stream too small (${rawBuffer.length} bytes)`);
      }

      await fs.promises.writeFile(tempRawPath, rawBuffer);
      const dlSec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Worker] ✅ JioSaavn Akamai fetch complete in ${dlSec}s (${(rawBuffer.length / 1024 / 1024).toFixed(2)} MB)!`);

      if (clientDisconnected) {
        try { fs.unlinkSync(tempRawPath); } catch (_) {}
        return;
      }

      // Step 3: CPU Breather Pause (1.0s cooldown to reset Linux cgroup quota)
      await wait(1000);
      if (clientDisconnected) {
        try { fs.unlinkSync(tempRawPath); } catch (_) {}
        return;
      }

      // Step 4: Single-thread FFmpeg transcode strictly within 50% CPU quota
      console.log(`[Worker] 🎛️ Transcoding to 96kbps CBR MP3 (-threads 1) for "${saavnTrack.title}"...`);
      const tFf = Date.now();

      await new Promise((resolve, reject) => {
        activeFfmpeg = spawn('ffmpeg', [
          '-y',
          '-threads', '1',
          '-i', tempRawPath,
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
        activeFfmpeg.stderr.on('data', d => errBuf += d.toString());
        activeFfmpeg.on('close', code => {
          activeFfmpeg = null;
          if (code === 0) resolve(code);
          else reject(new Error(`FFmpeg exit code ${code}: ${errBuf.slice(-200)}`));
        });
        activeFfmpeg.on('error', err => { activeFfmpeg = null; reject(err); });
      });

      try { fs.unlinkSync(tempRawPath); } catch (_) {}

      if (clientDisconnected) {
        try { fs.unlinkSync(tempFinalMp3); } catch (_) {}
        return;
      }

      const ffSec = ((Date.now() - tFf) / 1000).toFixed(1);
      const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[Worker] ✅ Transcode complete in ${ffSec}s! Total pipeline: ${totalSec}s (JioSaavn)`);

      const st = fs.statSync(tempFinalMp3);
      if (st.size < 50000) {
        try { fs.unlinkSync(tempFinalMp3); } catch (_) {}
        throw new Error('Produced MP3 file was too small');
      }

      await fs.promises.rename(tempFinalMp3, initialCachedMp3);

      totalDownloadsServed++;
      pruneLRUCache();

      res.writeHead(200, {
        'Content-Type': 'audio/mpeg',
        'Content-Length': st.size,
        'Cache-Control': 'public, max-age=86400',
        'X-Worker-Source': 'jiosaavn',
        'X-Worker-Cache': 'MISS',
        'X-Worker-Time': `${totalSec}s`,
        'X-Track-Title': encodeURIComponent(saavnTrack.title),
        'X-Track-Artist': encodeURIComponent(saavnTrack.artist)
      });
      return fs.createReadStream(initialCachedMp3).pipe(res);

    } catch (pipelineErr) {
      console.error(`[Worker] ❌ Pipeline failed: ${pipelineErr.message}`);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: pipelineErr.message }));
      }
    } finally {
      activeDownloads = Math.max(0, activeDownloads - 1);
    }
    return;
  }

  // 404 Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    error: 'Not found',
    availableEndpoints: ['/health', '/ping', '/resolve?q=...', '/stream?url=...', '/tts?text=...']
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('======================================================');
  console.log(`🚀 Dedicated Music Worker running on port ${PORT}`);
  console.log(`📁 Cache Directory: ${CACHE_DIR} (Max ${MAX_CACHED_TRACKS} tracks / ${MAX_CACHE_SIZE_BYTES / 1024 / 1024} MB)`);
  console.log('⚡ Engine: 100% JioSaavn Studio Engine (Akamai Direct CDN)');
  console.log('🎧 Output: Single-Thread 96kbps CBR MP3 (0% CPU on Audio Server)');
  console.log('======================================================');
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
process.on('SIGINT', () => { server.close(() => process.exit(0)); });
