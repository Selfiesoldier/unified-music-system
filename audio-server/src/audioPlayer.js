import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import http from 'http';
import https from 'https';
import os from 'os';
import { validateMp3FileHeader } from './mp3Validator.js';

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    const req = protocol.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch (_) {}
        return reject(new Error(`Download failed with HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(resolve);
      });
      file.on('error', (err) => {
        try { fs.unlinkSync(destPath); } catch (_) {}
        reject(err);
      });
    });
    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(err);
    });
    req.setTimeout(30000, () => {
      req.abort();
      file.close();
      try { fs.unlinkSync(destPath); } catch (_) {}
      reject(new Error('Download timed out after 30s'));
    });
  });
}

export class AudioPlayer extends EventEmitter {
  constructor(streamManager) {
    super();
    this.streamManager = streamManager;
    if (this.streamManager) {
      this.streamManager.audioPlayer = this;
    }
    this.currentTranscoder = null;
    this.currentTrack = null;
    this.isPlaying = false;
    this.currentVolume = 100; // 0 - 100
    this.playSessionId = 0;
    this.currentFd = null;
    this.tempFilesToClean = new Set();
    this.isAnnouncementPaused = false;
    this.announcementPauseStartTime = null;
    this.totalAnnouncementPauseNs = 0n;
  }

  pauseForAnnouncement() {
    if (!this.isAnnouncementPaused) {
      this.isAnnouncementPaused = true;
      this.announcementPauseStartTime = process.hrtime.bigint();
      console.log('⏸️ [AudioPlayer] Paused music frame streaming for announcement.');
    }
  }

  resumeAfterAnnouncement() {
    if (this.isAnnouncementPaused && this.announcementPauseStartTime) {
      const pausedNs = process.hrtime.bigint() - this.announcementPauseStartTime;
      this.totalAnnouncementPauseNs = (this.totalAnnouncementPauseNs || 0n) + pausedNs;
      this.isAnnouncementPaused = false;
      this.announcementPauseStartTime = null;
      console.log(`▶️ [AudioPlayer] Resumed music streaming after announcement (offset adjusted by ${(Number(pausedNs) / 1e6).toFixed(0)}ms, zero burst).`);
    }
  }

  setVolume(vol) {
    const parsed = Math.max(0, Math.min(150, Number(vol) || 100));
    this.currentVolume = parsed;
    console.log(`🔊 [AudioPlayer] Volume set to ${this.currentVolume}%`);
    return this.currentVolume;
  }

  cleanTempFiles() {
    for (const filePath of this.tempFilesToClean) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }
    this.tempFilesToClean.clear();
  }

  async play(trackInfo) {
    const { source, title = 'Unknown Track', durationSeconds = 0, volume, webhookUrl } = trackInfo;

    if (!source) {
      throw new Error('Missing "source" parameter (must be URL or file path)');
    }

    // Stop previous track cleanly, but KEEP SILENCE STREAMING while new track downloads!
    this.stop(false, true);
    if (this.streamManager && typeof this.streamManager.stopAnnouncement === 'function') {
      this.streamManager.stopAnnouncement();
    }

    const sessionId = ++this.playSessionId;
    this.isPlaying = true;
    if (typeof volume === 'number') this.currentVolume = volume;

    this.currentTrack = {
      source,
      title,
      durationSeconds: Number(durationSeconds) || 0,
      startTime: Date.now(),
      webhookUrl
    };

    console.log(`▶️ [AudioPlayer] [Session ${sessionId}] Preparing: "${title}" (Vol: ${this.currentVolume}%)`);

    const tmpDir = os.tmpdir();
    let localInputPath = source;
    const isRemote = source.startsWith('http://') || source.startsWith('https://');

    if (isRemote) {
      let ext = '.m4a';
      try {
        const parsedUrl = new URL(source);
        const urlExt = path.extname(parsedUrl.pathname);
        if (urlExt && urlExt.length <= 5) ext = urlExt;
      } catch (_) {}

      localInputPath = path.join(tmpDir, `in_${sessionId}_${Date.now()}${ext}`);
      this.tempFilesToClean.add(localInputPath);
      console.log(`📥 [AudioPlayer] Downloading audio source to local disk (${ext})...`);
      try {
        await downloadFile(source, localInputPath);
        const downloadedBytes = fs.statSync(localInputPath).size;
        console.log(`✅ [AudioPlayer] Downloaded ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB to local disk.`);
      } catch (err) {
        console.error(`❌ [AudioPlayer] Download failed: ${err.message}`);
        this.stop(true, true);
        return;
      }
    }

    if (sessionId !== this.playSessionId || !this.isPlaying) {
      this.cleanTempFiles();
      return;
    }

    // Strict Zero-Load Architecture: Audio Server ONLY streams pre-encoded 96k CBR MP3
    if (!validateMp3FileHeader(localInputPath)) {
      console.error(`❌ [AudioPlayer] Rejected non-96k MP3 input: ${localInputPath}. Strict zero-CPU engine requires pre-encoded 96kbps CBR MP3.`);
      this.stop(true, true);
      this.cleanTempFiles();
      return;
    }

    console.log(`🚀 [AudioPlayer] Verified 96kbps CBR MP3! Direct monotonic frame streaming (0% CPU, 0 FFmpeg processes).`);
    const localOutputPath = localInputPath;

    // Stop silence right before music begins streaming
    this.streamManager.stopSilenceFeed();
    this.streamManager.streamVersion++;
    if (this.currentTrack) {
      this.currentTrack.startTime = Date.now();
    }

    console.log(`🚀 [AudioPlayer] Starting zero-CPU MP3 frame streaming at 12 KB/sec...`);

    // Stream the MP3 file at exact 12 KB/sec monotonic rate (100ms chunks = 1200 bytes)
    const CHUNK_SIZE = 1200; // 100ms at 96kbps (12000 * 0.1 = 1200 bytes)
    const CHUNK_NS = 100_000_000n; // 100ms in ns
    const LEAD_NS = 1_000_000_000n; // 1.0 second lead cushion

    const fd = fs.openSync(localOutputPath, 'r');
    this.currentFd = fd;
    const readBuffer = Buffer.allocUnsafe(CHUNK_SIZE);
    let fileOffset = 0;
    // Skip ID3v2 metadata header if present and scan forward to align on first MPEG sync word
    try {
      const probeHeader = Buffer.alloc(10);
      const readCount = fs.readSync(fd, probeHeader, 0, 10, 0);
      if (readCount >= 10 && probeHeader.subarray(0, 3).toString('ascii') === 'ID3') {
        const tagSize = ((probeHeader[6] & 0x7F) << 21) | ((probeHeader[7] & 0x7F) << 14) | ((probeHeader[8] & 0x7F) << 7) | (probeHeader[9] & 0x7F);
        const hasFooter = (probeHeader[5] & 0x10) !== 0;
        fileOffset = 10 + tagSize + (hasFooter ? 10 : 0);
        console.log(`⏩ [AudioPlayer] Skipped ID3v2 header (${fileOffset} bytes), scanning for audio frame 0`);
      }
      // Scan forward to ensure fileOffset lands exactly on 0xFF 0xEx
      const scanLimit = 4096;
      const scanBuf = Buffer.alloc(scanLimit);
      const scanCount = fs.readSync(fd, scanBuf, 0, scanLimit, fileOffset);
      for (let i = 0; i < scanCount - 1; i++) {
        if (scanBuf[i] === 0xFF && (scanBuf[i + 1] & 0xE0) === 0xE0) {
          if (i > 0) {
            fileOffset += i;
            console.log(`🎯 [AudioPlayer] Synced precisely to audio frame 0 at offset ${fileOffset}`);
          }
          break;
        }
      }
    } catch (_) {}
    const hrStart = process.hrtime.bigint();
    let chunksSent = 0;
    this.isAnnouncementPaused = false;
    this.announcementPauseStartTime = null;
    this.totalAnnouncementPauseNs = 0n;

    const totalFileSize = fs.statSync(localOutputPath).size;

    while (sessionId === this.playSessionId && this.isPlaying) {
      if (this.isAnnouncementPaused || (this.streamManager && this.streamManager.isAnnouncing)) {
        await new Promise(r => setTimeout(r, 40));
        continue;
      }

      const totalPause = this.totalAnnouncementPauseNs || 0n;
      const elapsedNs = (process.hrtime.bigint() - hrStart) - totalPause;
      const targetChunks = Number((elapsedNs + LEAD_NS) / CHUNK_NS);

      while (chunksSent < targetChunks) {
        let bytesRead = 0;
        try {
          bytesRead = fs.readSync(fd, readBuffer, 0, CHUNK_SIZE, fileOffset);
        } catch (e) {
          console.error('Read error:', e.message);
          bytesRead = 0;
        }

        if (bytesRead > 0) {
          // Clone slice so chunks in burst buffer are independent and never mutated in place
          const slice = Buffer.from(readBuffer.subarray(0, bytesRead));
          this.streamManager.broadcast(slice);
          fileOffset += bytesRead;
          chunksSent++;
          if (fileOffset >= totalFileSize) {
            break; // EOF
          }
        } else {
          break; // EOF
        }
      }

      if (fileOffset >= totalFileSize) {
        console.log(`🏁 [AudioPlayer] Track reached EOF naturally (${(fileOffset / 1024 / 1024).toFixed(2)} MB played).`);
        break;
      }

      await new Promise(r => setTimeout(r, 40));
    }

    if (this.currentFd === fd) {
      try { fs.closeSync(fd); } catch (_) {}
      this.currentFd = null;
    }

    if (sessionId === this.playSessionId) {
      console.log(`⏹️ [AudioPlayer] Finished track: "${title}"`);
      this.stop(true, true);
    }
  }

  stop(notifyFinished = false, resumeSilence = true) {
    this.isPlaying = false;
    this.playSessionId++;

    if (this.currentTranscoder) {
      try { this.currentTranscoder.kill('SIGKILL'); } catch (_) {}
      this.currentTranscoder = null;
    }

    if (this.currentFd) {
      try { fs.closeSync(this.currentFd); } catch (_) {}
      this.currentFd = null;
    }

    this.cleanTempFiles();

    if (!notifyFinished && this.streamManager && typeof this.streamManager.stopAnnouncement === 'function') {
      this.streamManager.stopAnnouncement();
    }

    const finishedTrack = this.currentTrack;
    this.currentTrack = null;

    if (resumeSilence && this.streamManager && typeof this.streamManager.resumeSilenceFeed === 'function') {
      this.streamManager.resumeSilenceFeed();
    }

    if (notifyFinished && finishedTrack) {
      this.emit('trackEnd', finishedTrack);
      if (finishedTrack.webhookUrl) {
        this.triggerWebhook(finishedTrack.webhookUrl, {
          event: 'trackEnd',
          track: finishedTrack
        });
      }
    }
  }

  async triggerWebhook(url, data) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
    } catch (e) {
      console.warn(`⚠️ [AudioPlayer] Webhook failed for ${url}:`, e.message);
    }
  }

  getStatus() {
    const elapsed = this.currentTrack ? Math.floor((Date.now() - this.currentTrack.startTime) / 1000) : 0;
    return {
      isPlaying: this.isPlaying,
      volume: this.currentVolume,
      currentTrack: this.currentTrack ? {
        title: this.currentTrack.title,
        durationSeconds: this.currentTrack.durationSeconds,
        elapsedSeconds: elapsed
      } : null
    };
  }
}
