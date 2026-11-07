import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import yts from 'yt-search';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FFMPEG_PATH = path.resolve(__dirname, '../node_modules/ffmpeg-static/ffmpeg.exe');
const YTDLP_PATH = path.resolve(__dirname, '../yt-dlp.exe');

// =========================================================================
// 🌐 100% PURE YOUTUBE PARSER & RESOLVER
// =========================================================================

/**
 * Resolve any search query or YouTube link into real title, artist, duration, videoId
 */
export async function resolveYouTubeQuery(rawQuery) {
  const q = (rawQuery || '').trim();
  if (!q) return null;

  try {
    const urlMatch = q.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/))([\w-]{11})/);
    if (urlMatch) {
      const videoId = urlMatch[1];
      const info = await yts({ videoId });
      if (info) {
        let artist = info.author?.name || '';
        if (!artist || artist === 'YouTube Creator') {
          const byM = (info.title || '').match(/\bby\s+([^|,\-]+)/i);
          artist = byM ? byM[1].trim() : 'YouTube';
        }
        return {
          title: info.title || 'YouTube Video',
          artist: artist.replace(/ - Topic$/, '').replace(/VEVO$/, '').trim(),
          duration: info.duration?.timestamp || '0:00',
          durationSeconds: info.duration?.seconds || 0,
          videoId: info.videoId,
          url: info.url,
          thumbnail: info.thumbnail
        };
      }
    }

    const searchRes = await yts(q);
    const v = searchRes.videos?.[0];
    if (v) {
      let artist = v.author?.name || '';
      const byMatch = q.match(/\bby\s+([^,]+)/i);
      if (byMatch && byMatch[1].trim()) {
        artist = byMatch[1].trim();
      } else if (artist) {
        artist = artist.replace(/ - Topic$/, '').replace(/VEVO$/, '').trim();
      }

      if (!artist || artist === 'YouTube Creator') {
        artist = 'YouTube';
      }

      return {
        title: v.title || q,
        artist,
        duration: v.duration?.timestamp || '0:00',
        durationSeconds: v.duration?.seconds || 0,
        videoId: v.videoId,
        url: v.url,
        thumbnail: v.thumbnail
      };
    }
  } catch (err) {
    console.warn(`[YouTubeSearch] Error resolving "${q}":`, err.message);
  }
  return null;
}

/**
 * YouTube Playlist Parser (via local yt-dlp)
 */
export async function parseYouTubePlaylist(url) {
  return new Promise((resolve, reject) => {
    const args = ['--no-config', '--flat-playlist', '--dump-single-json', '--no-warnings', url];
    const proc = spawn(YTDLP_PATH, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => stdout += chunk);
    proc.stderr.on('data', chunk => stderr += chunk);

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`yt-dlp failed (code ${code}): ${stderr.slice(0, 200)}`));
      }
      try {
        const data = JSON.parse(stdout);
        const entries = data.entries || [];
        resolve({
          title: data.title || 'YouTube Playlist',
          author: data.uploader || data.channel || 'YouTube',
          total: entries.length,
          tracks: entries.map((e, idx) => ({
            index: idx + 1,
            title: e.title || 'Unknown Track',
            artist: e.uploader || e.channel || 'YouTube Artist',
            duration: e.duration ? formatDuration(e.duration) : '0:00',
            durationSeconds: e.duration || 0,
            videoId: e.id,
            url: e.url || (e.id ? `https://www.youtube.com/watch?v=${e.id}` : null),
            source: 'youtube'
          }))
        });
      } catch (err) {
        reject(new Error(`Failed to parse yt-dlp JSON: ${err.message}`));
      }
    });
  });
}

/**
 * YouTube Single Video Parser
 */
export async function parseYouTubeVideo(url) {
  return new Promise((resolve, reject) => {
    const args = ['--no-config', '--dump-single-json', '--no-playlist', '--no-warnings', url];
    const proc = spawn(YTDLP_PATH, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => stdout += chunk);
    proc.stderr.on('data', chunk => stderr += chunk);

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`Failed to inspect video: ${stderr.slice(0, 200)}`));
      }
      try {
        const data = JSON.parse(stdout);
        resolve({
          title: data.title || 'YouTube Video',
          author: data.uploader || data.channel || 'YouTube',
          total: 1,
          tracks: [{
            index: 1,
            title: data.title || 'Unknown Track',
            artist: data.uploader || data.channel || 'YouTube Artist',
            duration: data.duration ? formatDuration(data.duration) : '0:00',
            durationSeconds: data.duration || 0,
            videoId: data.id,
            url: data.webpage_url || url,
            source: 'youtube'
          }]
        });
      } catch (err) {
        reject(new Error(`Failed to parse video metadata: ${err.message}`));
      }
    });
  });
}

/**
 * Plain Text Queries Parser (Maps each line to a YouTube search query)
 */
export function parseTextList(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));
  return {
    title: 'Custom YouTube Search List',
    author: 'User',
    total: lines.length,
    tracks: lines.map((line, idx) => {
      let title = line;
      let artist = '';
      if (line.includes(' - ')) {
        const parts = line.split(' - ');
        artist = parts[0].trim();
        title = parts.slice(1).join(' - ').trim();
      }
      return {
        index: idx + 1,
        title,
        artist,
        duration: '0:00',
        durationSeconds: 0,
        query: line,
        source: 'youtube_search'
      };
    })
  };
}

// =========================================================================
// 🚀 100% YOUTUBE DOWNLOAD & TRANSCODE PIPELINE (96kbps MP3)
// =========================================================================

/**
 * Download directly from YouTube and transcode to 96kbps MP3
 * @param {object} track - Track object
 * @param {string} tempDir - Directory to store output
 * @param {function} logCallback - Function to log progress strings
 * @returns {Promise<{ filePath: string, title: string, artist: string, duration: number, durationFormatted: string, sizeBytes: number }>}
 */
export async function downloadAndTranscode(track, tempDir, logCallback = () => {}) {
  const target = track.url || (track.videoId ? `https://www.youtube.com/watch?v=${track.videoId}` : `ytsearch1:${track.query || track.title}`.trim());
  const safeId = `${track.index || '0'}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const outTemplate = path.join(tempDir, `yt_${safeId}_%(id)s.%(ext)s`);

  logCallback(`[#${track.index}] 🎬 Searching YouTube & Ingesting: "${track.query || track.title}" via yt-dlp...`);

  return new Promise((resolve, reject) => {
    const args = [
      '--no-config',
      '--print', 'METADATA:%(title)s\t%(uploader)s\t%(duration)s\t%(id)s',
      '--no-simulate',
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '96k',
      '--ffmpeg-location', FFMPEG_PATH,
      '--postprocessor-args', 'ExtractAudio:-nostdin -y',
      '--no-playlist',
      '--force-overwrites',
      '--no-warnings',
      '-o', outTemplate,
      target
    ];

    const proc = spawn(YTDLP_PATH, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      // Extract download progress
      const match = text.match(/\[download\]\s+(\d+\.?\d*%) of/);
      if (match) {
        logCallback(`   ↳ YouTube Download: ${match[1]}`);
      }
    });

    proc.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`YouTube download failed (code ${code}): ${stderr.slice(-300) || stdout.slice(-300)}`));
      }

      // Extract resolved YouTube metadata from --print output
      let resolvedTitle = track.title;
      let resolvedArtist = '';
      let resolvedDuration = track.durationSeconds || 0;
      let resolvedVideoId = track.videoId || null;

      const metaLine = stdout.split('\n').find(l => l.startsWith('METADATA:'));
      if (metaLine) {
        const parts = metaLine.replace('METADATA:', '').trim().split('\t');
        if (parts[0] && parts[0].trim()) resolvedTitle = parts[0].trim();
        if (parts[1] && parts[1].trim() && parts[1] !== 'NA') resolvedArtist = parts[1].trim();
        if (parts[2]) resolvedDuration = parseInt(parts[2], 10) || 0;
        if (parts[3] && parts[3].trim()) resolvedVideoId = parts[3].trim();
      }

      // Check if query had 'by <artist>' (e.g. "o mere khuda by Atif Aslam")
      const queryStr = track.query || track.title || '';
      const byMatch = queryStr.match(/\bby\s+([^,]+)/i);
      if (byMatch && byMatch[1].trim()) {
        resolvedArtist = byMatch[1].trim();
      } else if (resolvedArtist) {
        resolvedArtist = resolvedArtist.replace(/ - Topic$/, '').replace(/VEVO$/, '').trim();
      }

      if (!resolvedArtist || resolvedArtist === 'NA' || resolvedArtist === 'YouTube Creator') {
        resolvedArtist = 'YouTube';
      }

      // Find the generated .mp3 file
      try {
        const files = fs.readdirSync(tempDir);
        const match = files.find(f => f.startsWith(`yt_${safeId}_`) && f.endsWith('.mp3'));
        if (!match) {
          return reject(new Error('Downloaded MP3 file not found in temp directory'));
        }

        const fullPath = path.join(tempDir, match);
        const stat = fs.statSync(fullPath);

        logCallback(`📦 Transcode complete: "${resolvedTitle}" by ${resolvedArtist} (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);

        resolve({
          filePath: fullPath,
          title: resolvedTitle,
          artist: resolvedArtist,
          videoId: resolvedVideoId,
          duration: resolvedDuration,
          durationFormatted: formatDuration(resolvedDuration),
          source: 'youtube',
          sizeBytes: stat.size
        });
      } catch (err) {
        reject(new Error(`File read error: ${err.message}`));
      }
    });
  });
}

function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
