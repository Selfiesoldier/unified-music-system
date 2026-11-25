import { EventEmitter } from 'events';
import fs from 'fs';
import { parseMp3Frames, getMp3FrameHeader } from './mp3FrameParser.js';
import { is96kCbrMp3Buffer } from './mp3Validator.js';

export class AudioPlayer extends EventEmitter {
  constructor(streamManager) {
    super();
    this.streamManager = streamManager;
    if (this.streamManager) {
      this.streamManager.audioPlayer = this;
    }
    this.currentTrack = null;
    this.isPlaying = false;
    this.isPreparing = false;
    this.isPaused = false;
    this.currentVolume = 100; // 0 - 150
    this.playSessionId = 0;
    this.currentAbortController = null;
  }

  setVolume(vol) {
    const parsed = Math.max(0, Math.min(150, Number(vol) || 100));
    this.currentVolume = parsed;
    console.log(`🔊 [AudioPlayer] Volume set to ${this.currentVolume}%`);
    return this.currentVolume;
  }

  pause() {
    if (this.isPlaying && !this.isPaused) {
      this.isPaused = true;
      console.log('⏸️ [AudioPlayer] Playback paused.');
    }
  }

  resume() {
    if (this.isPlaying && this.isPaused) {
      this.isPaused = false;
      if (this.streamManager && typeof this.streamManager.resetIdleClock === 'function') {
        this.streamManager.resetIdleClock();
      }
      console.log('▶️ [AudioPlayer] Playback resumed.');
    }
  }

  async play(trackInfo) {
    const { source, title = 'Unknown Track', durationSeconds = 0, volume, webhookUrl } = trackInfo;

    if (!source) {
      throw new Error('Missing "source" parameter (must be URL or file path)');
    }

    // Stop previous track cleanly without killing silence feed
    this.stop(false, false);
    if (this.streamManager && typeof this.streamManager.stopAnnouncement === 'function') {
      this.streamManager.stopAnnouncement();
    }

    const sessionId = ++this.playSessionId;
    this.isPreparing = true;
    this.isPlaying = false;
    this.isPaused = false;

    if (typeof volume === 'number') this.currentVolume = volume;

    this.currentTrack = {
      source,
      title,
      durationSeconds: Number(durationSeconds) || 0,
      startTime: Date.now(),
      webhookUrl
    };

    console.log(`▶️ [AudioPlayer] [Session ${sessionId}] Preparing: "${title}" (Vol: ${this.currentVolume}%)`);

    // Keep zero-reservoir silence feeding while fetching audio so stream never starves
    if (!this.streamManager.isSendingSilence && typeof this.streamManager.startSilenceFeed === 'function') {
      this.streamManager.startSilenceFeed();
    }

    const MAX_TRACK_BYTES = 50 * 1024 * 1024; // 50 MB safety cap
    let rawMp3Buffer = null;
    const isRemote = source.startsWith('http://') || source.startsWith('https://');

    if (isRemote) {
      const abortCtrl = new AbortController();
      this.currentAbortController = abortCtrl;
      const timeoutId = setTimeout(() => {
        try { abortCtrl.abort(); } catch (_) {}
      }, 30000);

      try {
        console.log(`📥 [AudioPlayer] Fetching audio source directly into memory...`);
        const fetchRes = await fetch(source, { signal: abortCtrl.signal });
        if (!fetchRes.ok) {
          throw new Error(`HTTP ${fetchRes.status} ${fetchRes.statusText}`);
        }
        const contentLen = Number(fetchRes.headers.get('content-length') || 0);
        if (contentLen > MAX_TRACK_BYTES) {
          throw new Error(`Track exceeds 50 MB limit (${(contentLen / 1024 / 1024).toFixed(1)} MB)`);
        }
        const arrayBuf = await fetchRes.arrayBuffer();
        if (arrayBuf.byteLength > MAX_TRACK_BYTES) {
          throw new Error(`Track exceeds 50 MB limit (${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        }
        rawMp3Buffer = Buffer.from(arrayBuf);
        console.log(`✅ [AudioPlayer] Fetched ${(rawMp3Buffer.length / 1024 / 1024).toFixed(2)} MB into memory.`);
      } catch (err) {
        if (sessionId === this.playSessionId) {
          console.error(`❌ [AudioPlayer] Fetch failed: ${err.message}`);
          this.isPreparing = false;
          this.stop(true, true);
        }
        return;
      } finally {
        clearTimeout(timeoutId);
        this.currentAbortController = null;
      }
    } else {
      // Local file path: 100% non-blocking async stat + read
      try {
        const stat = await fs.promises.stat(source);
        if (stat.size > MAX_TRACK_BYTES) {
          throw new Error(`Local track exceeds 50 MB limit (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
        }
        rawMp3Buffer = await fs.promises.readFile(source);
      } catch (err) {
        if (sessionId === this.playSessionId) {
          if (err.code === 'ENOENT') {
            console.error(`❌ [AudioPlayer] Source file not found: "${source}"`);
          } else {
            console.error(`❌ [AudioPlayer] Local read failed: ${err.message}`);
          }
          this.isPreparing = false;
          this.stop(true, true);
        }
        return;
      }
    }

    if (sessionId !== this.playSessionId) {
      return;
    }

    if (!rawMp3Buffer || rawMp3Buffer.length < 4) {
      console.error(`❌ [AudioPlayer] Received empty audio payload.`);
      if (sessionId === this.playSessionId) {
        this.isPreparing = false;
        this.stop(true, true);
      }
      return;
    }

    // Strict Zero-Load Architecture: Audio Server ONLY streams pre-encoded 96k CBR MP3
    if (!is96kCbrMp3Buffer(rawMp3Buffer)) {
      console.error(`❌ [AudioPlayer] Strict Zero-Load: Audio payload failed 96k CBR MP3 validation. Refusing playback.`);
      if (sessionId === this.playSessionId) {
        this.isPreparing = false;
        this.stop(true, true);
      }
      return;
    }

    let songFrames = null;
    try {
      songFrames = parseMp3Frames(rawMp3Buffer, { zeroCopy: true });
    } catch (err) {
      console.error(`❌ [AudioPlayer] Failed to parse MP3 frames: ${err.message}`);
      if (sessionId === this.playSessionId) {
        this.isPreparing = false;
        this.stop(true, true);
      }
      return;
    }

    if (!songFrames || songFrames.length === 0) {
      console.error(`❌ [AudioPlayer] Parsed 0 intact MPEG Layer 3 frames from "${title}".`);
      if (sessionId === this.playSessionId) {
        this.isPreparing = false;
        this.stop(true, true);
      }
      return;
    }

    if (sessionId !== this.playSessionId) {
      return;
    }

    // Detect actual track sample rate from first frame header
    let trackSampleRate = 44100;
    const h = getMp3FrameHeader(songFrames[0], 0);
    if (h && h.sampleRate) {
      trackSampleRate = h.sampleRate;
    }
    this.streamManager.currentSampleRate = trackSampleRate;

    console.log(`🚀 [AudioPlayer] Verified 96kbps CBR MP3 (${trackSampleRate}Hz)! Parsed ${songFrames.length} intact whole frames (0% disk, 0% FFmpeg).`);

    // Transition state from preparing to playing
    this.isPreparing = false;
    this.isPlaying = true;
    this.isPaused = false;

    // Stop silence right before first whole song frame enters stream
    this.streamManager.stopSilenceFeed();
    this.streamManager.streamVersion++;
    if (this.currentTrack) {
      this.currentTrack.startTime = Date.now();
    }

    let frameIdx = 0;
    let totalBytesSent = 0;
    const useSharedClock = typeof this.streamManager.getPendingFrameCount === 'function';

    try {
      while (sessionId === this.playSessionId && this.isPlaying && frameIdx < songFrames.length) {
        if (this.isPaused) {
          // Responsive 50ms pause poll (cuts idle CPU by 90% while providing instant unpause)
          await new Promise(r => setTimeout(r, 50));
          continue;
        }

        let due = 0;
        if (useSharedClock) {
          due = this.streamManager.getPendingFrameCount(trackSampleRate);
        } else {
          due = 1;
        }

        for (let i = 0; i < due && frameIdx < songFrames.length; i++) {
          if (sessionId !== this.playSessionId || !this.isPlaying || this.isPaused) break;
          const frame = songFrames[frameIdx++];
          this.streamManager.broadcast(frame);
          totalBytesSent += frame.length;
        }

        if (frameIdx >= songFrames.length) {
          console.log(`🏁 [AudioPlayer] Track reached clean EOF on frame boundary (${songFrames.length} frames, ${(totalBytesSent / 1024 / 1024).toFixed(2)} MB played).`);
          break;
        }

        // Sub-frame 20ms pacer sleep (Nyquist-Shannon oversampling prevents burst stutter)
        await new Promise(r => setTimeout(r, 20));
      }
    } finally {
      songFrames = null;
      rawMp3Buffer = null;
    }

    if (sessionId === this.playSessionId && !this.isPaused) {
      console.log(`⏹️ [AudioPlayer] Finished track: "${title}"`);
      this.stop(true, true);
    }
  }

  stop(notifyFinished = false, resumeSilence = true, stopAnnouncement = true) {
    this.isPlaying = false;
    this.isPreparing = false;
    this.isPaused = false;
    this.playSessionId++;

    if (this.currentAbortController) {
      try { this.currentAbortController.abort(); } catch (_) {}
      this.currentAbortController = null;
    }

    if (!notifyFinished && stopAnnouncement && this.streamManager) {
      this.streamManager.stopAnnouncement();
    }

    const finishedTrack = this.currentTrack;
    this.currentTrack = null;

    if (resumeSilence && this.streamManager) {
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
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        console.warn(`⚠️ [AudioPlayer] Rejected non-HTTP(S) webhook URL: ${url}`);
        return;
      }
      await fetch(parsed.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(5000) // Clean 5s socket timeout
      });
    } catch (e) {
      console.warn(`⚠️ [AudioPlayer] Webhook failed for ${url}:`, e.message);
    }
  }

  getStatus() {
    const elapsed = this.currentTrack && this.isPlaying ? Math.floor((Date.now() - this.currentTrack.startTime) / 1000) : 0;
    return {
      isPlaying: this.isPlaying,
      isPreparing: this.isPreparing,
      isPaused: this.isPaused,
      volume: this.currentVolume,
      currentTrack: this.currentTrack ? {
        title: this.currentTrack.title,
        durationSeconds: this.currentTrack.durationSeconds,
        elapsedSeconds: elapsed
      } : null
    };
  }
}
