import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { vault } from './vault.js';
import { uploadAudioToTelegram, testTelegramConnection } from './telegram.js';
import {
  parseYouTubePlaylist,
  parseYouTubeVideo,
  parseTextList,
  resolveYouTubeQuery,
  downloadAndTranscode
} from './resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 4500;
const TEMP_DIR = path.join(__dirname, 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Clean old temp files on startup
try {
  const stale = fs.readdirSync(TEMP_DIR);
  for (const f of stale) {
    try { fs.unlinkSync(path.join(TEMP_DIR, f)); } catch (_) {}
  }
} catch (_) {}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 📡 SERVER-SENT EVENTS (SSE) BROADCASTER
// ==========================================
let sseClients = [];

function broadcastSSE(type, data) {
  const payload = `data: ${JSON.stringify({ type, data, timestamp: new Date().toISOString() })}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch (_) {
      sseClients.splice(i, 1);
    }
  }
}

function logToUI(msg, level = 'info') {
  console.log(`[Archiver] ${msg}`);
  broadcastSSE('log', { message: msg, level });
}

// ==========================================
// ⚙️ PARALLEL ARCHIVER QUEUE ENGINE (15-20 WORKERS)
// ==========================================
let activeJob = {
  isRunning: false,
  isPaused: false,
  total: 0,
  processed: 0,
  skipped: 0,
  uploaded: 0,
  failed: 0,
  concurrency: 15,
  tracks: [],
  startedAt: null
};

// Smooth Telegram upload pacing mutex to prevent 429 Too Many Requests
let uploadLock = Promise.resolve();
async function safeTelegramUpload(filePath, meta) {
  const prev = uploadLock;
  let release;
  uploadLock = new Promise(r => release = r);
  await prev;
  try {
    const res = await uploadAudioToTelegram(filePath, meta);
    // Small 120ms pacing between telegram requests
    await new Promise(r => setTimeout(r, 120));
    return res;
  } finally {
    release();
  }
}

async function runArchiverLoop() {
  const concurrency = Math.max(1, Math.min(30, activeJob.concurrency || 15));
  logToUI(`🚀 Starting Parallel Ingestion: ${concurrency} simultaneous workers active for ${activeJob.tracks.length} tracks!`);
  activeJob.isRunning = true;
  activeJob.isPaused = false;
  activeJob.startedAt = Date.now();

  const queue = [...activeJob.tracks];

  async function worker(workerId) {
    while (queue.length > 0 && activeJob.isRunning) {
      // Pause check
      while (activeJob.isPaused && activeJob.isRunning) {
        await new Promise(r => setTimeout(r, 300));
      }
      if (!activeJob.isRunning) break;

      const track = queue.shift();
      if (!track) break;

      // 0. Search & Resolve YouTube metadata if not already resolved
      if (!track.videoId || track.source === 'youtube_search') {
        track.status = 'searching';
        broadcastSSE('track_update', {
          index: track.index,
          status: 'searching',
          message: `Searching YouTube: "${track.query || track.title}"...`
        });

        const ytInfo = await resolveYouTubeQuery(track.query || track.title);
        if (ytInfo) {
          track.title = ytInfo.title;
          track.artist = ytInfo.artist;
          track.duration = ytInfo.duration;
          track.durationSeconds = ytInfo.durationSeconds;
          track.videoId = ytInfo.videoId;
          track.url = ytInfo.url;
          track.thumbnail = ytInfo.thumbnail;
          track.source = 'youtube';

          logToUI(`🔎 [#${track.index} W${workerId}] Resolved "${track.query}" ➔ "${track.title}" by ${track.artist}`);
          broadcastSSE('track_update', {
            index: track.index,
            title: track.title,
            artist: track.artist,
            duration: track.duration,
            thumbnail: track.thumbnail,
            message: 'Resolved via YouTube'
          });
        }
      }

      // 1. Check duplicate prevention with the REAL videoId & real title
      if (activeJob.skipDuplicates) {
        const dup = vault.checkDuplicate(track.title, track.artist, track.videoId);
        if (dup.isDuplicate) {
          track.status = 'skipped_vault';
          track.vaultEntry = dup.entry;
          activeJob.skipped++;
          activeJob.processed++;
          logToUI(`⏭️ [#${track.index} W${workerId}] In Vault (Skipped): "${track.title}" by ${track.artist}`, 'warning');
          broadcastSSE('track_update', {
            index: track.index,
            title: track.title,
            artist: track.artist,
            status: 'skipped_vault',
            message: 'Already in Vault',
            telegram_message_id: dup.entry.telegram_message_id
          });
          broadcastSSE('progress', {
            processed: activeJob.processed,
            total: activeJob.total,
            uploaded: activeJob.uploaded,
            skipped: activeJob.skipped,
            failed: activeJob.failed
          });
          continue;
        }
      }

      // 2. Download and transcode via yt-dlp in parallel
      track.status = 'downloading';
      logToUI(`⚡ [#${track.index} W${workerId}] Downloading: "${track.title}" by ${track.artist}`);
      broadcastSSE('track_update', {
        index: track.index,
        title: track.title,
        artist: track.artist,
        status: 'downloading',
        message: 'Downloading & Transcoding 96k...'
      });
      broadcastSSE('progress', {
        processed: activeJob.processed,
        total: activeJob.total,
        uploaded: activeJob.uploaded,
        skipped: activeJob.skipped,
        failed: activeJob.failed,
        activeTitle: track.title
      });

      let transcodeResult = null;
      try {
        transcodeResult = await downloadAndTranscode(track, TEMP_DIR, (msg) => {
          // Progress log
        });
      } catch (err) {
        logToUI(`❌ [#${track.index}] Download failed for "${track.title}": ${err.message}`, 'error');
        track.status = 'failed';
        track.error = err.message;
        activeJob.failed++;
        activeJob.processed++;
        broadcastSSE('track_update', { index: track.index, status: 'failed', error: err.message });
        broadcastSSE('progress', {
          processed: activeJob.processed,
          total: activeJob.total,
          uploaded: activeJob.uploaded,
          skipped: activeJob.skipped,
          failed: activeJob.failed
        });
        continue;
      }

      const finalTitle = transcodeResult.title || track.title;
      const finalArtist = transcodeResult.artist || track.artist;
      const finalVideoId = transcodeResult.videoId || track.videoId || null;

      // 3. Upload to Telegram Vault with REAL title and REAL artist
      track.status = 'uploading';
      broadcastSSE('track_update', {
        index: track.index,
        title: finalTitle,
        artist: finalArtist,
        status: 'uploading',
        message: 'Uploading to Telegram Vault...'
      });

      try {
        const tgRes = await safeTelegramUpload(transcodeResult.filePath, {
          title: finalTitle,
          performer: finalArtist,
          duration: transcodeResult.duration || track.durationSeconds
        });

        // 4. Save to Vault DB
        const vaultEntry = vault.addTrack({
          title: finalTitle,
          artist: finalArtist,
          duration: transcodeResult.durationFormatted || track.duration,
          durationSeconds: transcodeResult.duration || track.durationSeconds,
          source: 'youtube',
          videoId: finalVideoId,
          telegram_message_id: tgRes.message_id,
          telegram_file_id: tgRes.file_id
        });

        track.status = 'completed';
        track.title = finalTitle;
        track.artist = finalArtist;
        track.vaultEntry = vaultEntry;
        track.telegram_message_id = tgRes.message_id;
        activeJob.uploaded++;
        activeJob.processed++;

        logToUI(`✅ [#${track.index} W${workerId}] Saved to Telegram: "${finalTitle}" by ${finalArtist} (Msg #${tgRes.message_id})`, 'success');
        broadcastSSE('track_update', {
          index: track.index,
          title: finalTitle,
          artist: finalArtist,
          status: 'completed',
          telegram_message_id: tgRes.message_id,
          telegram_file_id: tgRes.file_id,
          message: 'Saved to Telegram'
        });
        broadcastSSE('progress', {
          processed: activeJob.processed,
          total: activeJob.total,
          uploaded: activeJob.uploaded,
          skipped: activeJob.skipped,
          failed: activeJob.failed
        });

      } catch (upErr) {
        logToUI(`❌ [#${track.index}] Telegram upload error: ${upErr.message}`, 'error');
        track.status = 'failed';
        track.error = upErr.message;
        activeJob.failed++;
        activeJob.processed++;
        broadcastSSE('track_update', { index: track.index, status: 'failed', error: upErr.message });
        broadcastSSE('progress', {
          processed: activeJob.processed,
          total: activeJob.total,
          uploaded: activeJob.uploaded,
          skipped: activeJob.skipped,
          failed: activeJob.failed
        });
      } finally {
        if (transcodeResult && transcodeResult.filePath) {
          try { fs.unlinkSync(transcodeResult.filePath); } catch (_) {}
        }
      }
    }
  }

  const numWorkers = Math.min(concurrency, activeJob.tracks.length);
  const workerPromises = [];
  for (let w = 1; w <= numWorkers; w++) {
    workerPromises.push(worker(w));
  }

  await Promise.all(workerPromises);

  activeJob.isRunning = false;
  activeJob.isPaused = false;
  const elapsedSec = Math.round((Date.now() - activeJob.startedAt) / 1000);

  // Auto-sync full vault to Main Server L2 cache
  try {
    const allTracks = vault.getAll();
    await fetch('http://2.56.246.119:30195/api/vault/sync-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: allTracks }),
      signal: AbortSignal.timeout(6000)
    });
    logToUI(`☁️ Auto-synced ${allTracks.length} tracks to Main Server L2 Cloud Vault!`, 'success');
  } catch (_) {}

  logToUI(`🏁 Parallel Ingestion Finished in ${elapsedSec}s! Uploaded: ${activeJob.uploaded}, Skipped: ${activeJob.skipped}, Failed: ${activeJob.failed}`, 'success');
  broadcastSSE('finished', {
    uploaded: activeJob.uploaded,
    skipped: activeJob.skipped,
    failed: activeJob.failed,
    total: activeJob.total,
    elapsedSec
  });
}

// ==========================================
// 📡 REST API ENDPOINTS
// ==========================================

// SSE Stream
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write(': connected\n\n');
  sseClients.push(res);
  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// Parse Playlist or Queries
app.post('/api/parse', async (req, res) => {
  const { url, text, type } = req.body;
  logToUI(`🔎 Parsing input source: ${url ? url.slice(0, 60) : 'Text list'}`);

  try {
    let result = null;
    const inputUrl = (url || '').trim();

    if (type === 'text' || (!inputUrl && text)) {
      result = parseTextList(text || '');
    } else if (inputUrl.includes('list=')) {
      result = await parseYouTubePlaylist(inputUrl);
    } else if (inputUrl.includes('watch?v=') || inputUrl.includes('youtu.be/')) {
      result = await parseYouTubeVideo(inputUrl);
    } else if (inputUrl.startsWith('http')) {
      result = await parseYouTubePlaylist(inputUrl);
    } else {
      result = parseTextList(inputUrl);
    }

    // Enrich with duplicate vault status
    let duplicateCount = 0;
    const enrichedTracks = result.tracks.map(t => {
      const dup = vault.checkDuplicate(t.title, t.artist, t.videoId);
      if (dup.isDuplicate) {
        duplicateCount++;
        return {
          ...t,
          isDuplicate: true,
          status: 'in_vault',
          vaultEntry: dup.entry
        };
      }
      return {
        ...t,
        isDuplicate: false,
        status: 'pending'
      };
    });

    logToUI(`📋 Extracted ${enrichedTracks.length} tracks (${duplicateCount} already in Vault)`, 'info');

    res.json({
      success: true,
      title: result.title,
      author: result.author,
      total: enrichedTracks.length,
      duplicateCount,
      readyCount: enrichedTracks.length - duplicateCount,
      tracks: enrichedTracks
    });
  } catch (err) {
    logToUI(`❌ Parse error: ${err.message}`, 'error');
    res.status(400).json({ success: false, error: err.message });
  }
});

// Start Ingestion
app.post('/api/archive/start', (req, res) => {
  if (activeJob.isRunning) {
    return res.status(400).json({ error: 'An archiving job is already in progress' });
  }

  const { tracks, skipDuplicates = true, concurrency = 15 } = req.body;
  if (!tracks || !tracks.length) {
    return res.status(400).json({ error: 'No tracks provided' });
  }

  activeJob = {
    isRunning: true,
    isPaused: false,
    total: tracks.length,
    processed: 0,
    skipped: 0,
    uploaded: 0,
    failed: 0,
    concurrency: parseInt(concurrency, 10) || 15,
    skipDuplicates: Boolean(skipDuplicates),
    tracks: tracks.map(t => ({ ...t })),
    startedAt: Date.now()
  };

  // Run in background without blocking HTTP response
  runArchiverLoop().catch(err => {
    logToUI(`Fatal queue runner error: ${err.message}`, 'error');
    activeJob.isRunning = false;
  });

  res.json({ status: 'started', total: tracks.length });
});

// Pause / Resume / Stop
app.post('/api/archive/pause', (req, res) => {
  if (!activeJob.isRunning) return res.json({ status: 'not_running' });
  activeJob.isPaused = true;
  logToUI('⏸️ Archiving paused by user');
  broadcastSSE('status_change', { status: 'paused' });
  res.json({ status: 'paused' });
});

app.post('/api/archive/resume', (req, res) => {
  if (!activeJob.isRunning) return res.json({ status: 'not_running' });
  activeJob.isPaused = false;
  logToUI('▶️ Archiving resumed');
  broadcastSSE('status_change', { status: 'running' });
  res.json({ status: 'resumed' });
});

app.post('/api/archive/stop', (req, res) => {
  activeJob.isRunning = false;
  activeJob.isPaused = false;
  logToUI('⏹️ Archiving stopped');
  broadcastSSE('status_change', { status: 'stopped' });
  res.json({ status: 'stopped' });
});

// Status
app.get('/api/archive/status', (req, res) => {
  res.json({
    isRunning: activeJob.isRunning,
    isPaused: activeJob.isPaused,
    total: activeJob.total,
    currentIndex: activeJob.currentIndex,
    processed: activeJob.processed,
    skipped: activeJob.skipped,
    uploaded: activeJob.uploaded,
    failed: activeJob.failed,
    currentTrack: activeJob.currentTrack
  });
});

// Vault Database
app.get('/api/vault', (req, res) => {
  res.json({
    total: vault.getCount(),
    tracks: vault.getAll()
  });
});

app.post('/api/vault/sync', async (req, res) => {
  const result = await vault.syncFromMainServer();
  res.json(result);
});

// Telegram Health
app.get('/api/telegram/health', async (req, res) => {
  const status = await testTelegramConnection();
  res.json(status);
});

// Boot and sync vault
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🎧 Telegram Playlist Archiver & Cloud Ingester`);
  console.log(`🌐 Dashboard running at: http://localhost:${PORT}`);
  console.log(`📁 Local Temp Directory: ${TEMP_DIR}`);
  console.log(`======================================================\n`);

  // Sync vault cache from Main Server
  const syncResult = await vault.syncFromMainServer();
  console.log(`📦 Telegram Vault Loaded: ${vault.getCount()} tracks (Synced: ${syncResult.synced})`);
});

