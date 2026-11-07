import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const originalPath = path.join(__dirname, 'server.js.bak');
let code = fs.readFileSync(originalPath, 'utf8');

// 1. Replace State & Dashboard functions (around line 210 - 296)
const oldStateBlock = `// ==========================================
// 🎵 QUEUE & PLAYBACK STATE
// ==========================================
let queue = [];
let currentTrack = null;
let isPlaying = false;
let isPreparing = false;
let currentVolume = 100;
let history = [];
let announcementsEnabled = true;
let announcementVoice = 'en';
let sseClients = new Set();
let currentPlaybackSession = 0;

// Load persistent states if available
const QUEUE_FILE = path.join(CACHE_DIR, 'queue_state.json');
const PLAYBACK_FILE = path.join(CACHE_DIR, 'playback_state.json');

try {
  if (fs.existsSync(QUEUE_FILE)) {
    queue = (JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8')) || []).filter(item => !item?.isAutoplay);
  }
  if (fs.existsSync(PLAYBACK_FILE)) {
    currentTrack = JSON.parse(fs.readFileSync(PLAYBACK_FILE, 'utf8')) || null;
  }
} catch (_) {}

function saveState() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    fs.writeFileSync(PLAYBACK_FILE, JSON.stringify(currentTrack, null, 2));
  } catch (_) {}
}

function getDashboardState(type = 'state', extra = {}) {
  const elapsed = isPlaying && currentTrack?.addedAt ? Math.max(0, Date.now() - currentTrack.addedAt) : 0;
  const currentTitle = currentTrack?.metadata?.title || currentTrack?.title || 'No music playing';
  const currentMetadata = currentTrack?.metadata || (currentTrack ? {
    title: currentTrack.title,
    artist: 'Unknown Artist',
    duration: '0:00',
    durationSeconds: 0,
    thumbnail: ''
  } : null);

  const formattedQueue = queue.map((item, idx) => ({
    position: idx + 1,
    title: item.metadata?.title || item.title || 'Unknown Track',
    metadata: item.metadata || {
      title: item.title,
      artist: 'Unknown Artist',
      thumbnail: ''
    }
  }));

  return {
    type,
    isPlaying,
    isPreparing,
    isTransitioning: false,
    currentTitle,
    currentMetadata,
    currentTrack,
    queue: formattedQueue,
    startTime: currentTrack?.addedAt || 0,
    serverElapsed: elapsed,
    volume: currentVolume,
    announcementsEnabled,
    health: {
      encoderAlive: true,
      isSilent: !isPlaying
    },
    stats: {
      activeListeners: 1
    },
    ...extra
  };
}

function broadcastEvent(type = 'state', data = {}) {
  const payload = `data: ${JSON.stringify(getDashboardState(type, data))}\\n\\n`;

  for (const client of sseClients) {
    try { client.write(payload); } catch (_) { sseClients.delete(client); }
  }
}`;

const newStateBlock = `// ==========================================
// 🏨 MULTI-ROOM AUDIO & QUEUE CONFIGURATION
// ==========================================
const ROOMS_CONFIG = {
  room1: {
    id: 'room1',
    name: 'Room 1 (Main Lounge)',
    audioServerUrl: (process.env.AUDIO_SERVER_URL || 'http://92.118.206.166:30238').replace(/\\/+$/, ''),
    secret: process.env.AUDIO_SECRET || 'supersecret_audio_key_123'
  },
  room2: {
    id: 'room2',
    name: 'Room 2 (Party Room)',
    audioServerUrl: (process.env.AUDIO_SERVER_URL_ROOM2 || 'http://2.56.246.128:30289').replace(/\\/+$/, ''),
    secret: process.env.AUDIO_SECRET_ROOM2 || process.env.AUDIO_SECRET || 'supersecret_audio_key_123'
  }
};

class RoomState {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.audioServerUrl = config.audioServerUrl;
    this.secret = config.secret;
    this.queue = [];
    this.currentTrack = null;
    this.isPlaying = false;
    this.isPreparing = false;
    this.currentVolume = 100;
    this.history = [];
    this.announcementsEnabled = true;
    this.announcementVoice = 'en';
    this.currentPlaybackSession = 0;
    this.consecutiveIdleChecks = 0;
    this.loadState();
  }

  get queueFile() {
    return path.join(CACHE_DIR, \`queue_state_\${this.id}.json\`);
  }
  get playbackFile() {
    return path.join(CACHE_DIR, \`playback_state_\${this.id}.json\`);
  }

  loadState() {
    try {
      let qFile = this.queueFile;
      if (this.id === 'room1' && !fs.existsSync(qFile) && fs.existsSync(path.join(CACHE_DIR, 'queue_state.json'))) {
        qFile = path.join(CACHE_DIR, 'queue_state.json');
      }
      if (fs.existsSync(qFile)) {
        this.queue = (JSON.parse(fs.readFileSync(qFile, 'utf8')) || []).filter(item => !item?.isAutoplay);
      }
      let pFile = this.playbackFile;
      if (this.id === 'room1' && !fs.existsSync(pFile) && fs.existsSync(path.join(CACHE_DIR, 'playback_state.json'))) {
        pFile = path.join(CACHE_DIR, 'playback_state.json');
      }
      if (fs.existsSync(pFile)) {
        this.currentTrack = JSON.parse(fs.readFileSync(pFile, 'utf8')) || null;
      }
    } catch (_) {}
  }

  saveState() {
    try {
      fs.writeFileSync(this.queueFile, JSON.stringify(this.queue, null, 2));
      fs.writeFileSync(this.playbackFile, JSON.stringify(this.currentTrack, null, 2));
      if (this.id === 'room1') {
        fs.writeFileSync(path.join(CACHE_DIR, 'queue_state.json'), JSON.stringify(this.queue, null, 2));
        fs.writeFileSync(path.join(CACHE_DIR, 'playback_state.json'), JSON.stringify(this.currentTrack, null, 2));
      }
    } catch (_) {}
  }
}

const rooms = {};
for (const [id, cfg] of Object.entries(ROOMS_CONFIG)) {
  rooms[id] = new RoomState(cfg);
}

function getRoom(req) {
  const roomId = (req?.query?.room || req?.body?.room || req?.headers?.['x-room-id'] || 'room1').toLowerCase().trim();
  return rooms[roomId] || rooms.room1;
}

const sseClients = new Set();

function getDashboardState(room = rooms.room1, type = 'state', extra = {}) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const elapsed = targetRoom.isPlaying && targetRoom.currentTrack?.addedAt ? Math.max(0, Date.now() - targetRoom.currentTrack.addedAt) : 0;
  const currentTitle = targetRoom.currentTrack?.metadata?.title || targetRoom.currentTrack?.title || 'No music playing';
  const currentMetadata = targetRoom.currentTrack?.metadata || (targetRoom.currentTrack ? {
    title: targetRoom.currentTrack.title,
    artist: 'Unknown Artist',
    duration: '0:00',
    durationSeconds: 0,
    thumbnail: ''
  } : null);

  const formattedQueue = targetRoom.queue.map((item, idx) => ({
    position: idx + 1,
    title: item.metadata?.title || item.title || 'Unknown Track',
    metadata: item.metadata || {
      title: item.title,
      artist: 'Unknown Artist',
      thumbnail: ''
    }
  }));

  return {
    roomId: targetRoom.id,
    roomName: targetRoom.name,
    type,
    isPlaying: targetRoom.isPlaying,
    isPreparing: targetRoom.isPreparing,
    isTransitioning: false,
    currentTitle,
    currentMetadata,
    currentTrack: targetRoom.currentTrack,
    queue: formattedQueue,
    startTime: targetRoom.currentTrack?.addedAt || 0,
    serverElapsed: elapsed,
    volume: targetRoom.currentVolume,
    announcementsEnabled: targetRoom.announcementsEnabled,
    health: {
      encoderAlive: true,
      isSilent: !targetRoom.isPlaying
    },
    stats: {
      activeListeners: 1
    },
    ...extra
  };
}

function broadcastEvent(roomOrType = rooms.room1, type = 'state', data = {}) {
  let targetRoom = rooms.room1;
  let eventType = type;
  let eventData = data;

  if (typeof roomOrType === 'string') {
    eventType = roomOrType;
    eventData = type && typeof type === 'object' ? type : data;
    targetRoom = rooms.room1;
  } else if (roomOrType && roomOrType.id) {
    targetRoom = roomOrType;
  }

  const payload = \`data: \${JSON.stringify(getDashboardState(targetRoom, eventType, eventData))}\\n\\n\`;

  for (const client of sseClients) {
    if (!client._roomId || client._roomId === targetRoom.id) {
      try { client.write(payload); } catch (_) { sseClients.delete(client); }
    }
  }
}`;

// 2. Replace callAudioServer
const oldAudioServerCall = `async function callAudioServer(endpoint, body = {}, method = 'POST') {
  try {
    const url = \`\${AUDIO_SERVER_URL}\${endpoint}\`;
    // /announce can take up to 20s (TTS decode + PCM drain); others 5s
    const timeoutMs = endpoint === '/health' ? 3000
                    : endpoint === '/announce' ? 20000
                    : 5000;
    const opts = {
      method,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${AUDIO_SECRET}\`
      }
    };
    if (method !== 'GET') {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      console.warn(\`⚠️ [AudioServerCall] Timeout calling \${endpoint} (\${e.name})\`);
    } else {
      console.error(\`❌ [AudioServerCall] Failed to call \${endpoint}:\`, e.message);
    }
    return { error: e.message };
  }
}`;

const newAudioServerCall = `async function callAudioServer(roomOrId, endpoint, body = {}, method = 'POST') {
  let room = rooms.room1;
  let actualEndpoint = endpoint;
  let actualBody = body;
  let actualMethod = method;

  if (typeof roomOrId === 'string' && roomOrId.startsWith('/')) {
    actualEndpoint = roomOrId;
    actualBody = endpoint || {};
    actualMethod = body || 'POST';
    room = rooms.room1;
  } else if (typeof roomOrId === 'string') {
    room = rooms[roomOrId] || rooms.room1;
  } else if (roomOrId && roomOrId.id && rooms[roomOrId.id]) {
    room = roomOrId;
  }

  try {
    const url = \`\${room.audioServerUrl}\${actualEndpoint}\`;
    const timeoutMs = actualEndpoint === '/health' ? 3000
                    : actualEndpoint === '/announce' ? 20000
                    : 5000;
    const opts = {
      method: actualMethod,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Content-Type': 'application/json',
        'Authorization': \`Bearer \${room.secret}\`
      }
    };
    if (actualMethod !== 'GET') {
      opts.body = JSON.stringify(actualBody);
    }
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') {
      console.warn(\`⚠️ [AudioServerCall:\${room.id}] Timeout calling \${actualEndpoint} (\${e.name})\`);
    } else {
      console.error(\`❌ [AudioServerCall:\${room.id}] Failed to call \${actualEndpoint}:\`, e.message);
    }
    return { error: e.message };
  }
}`;

// 3. Replace stopPlayback, prefetchNextTrack, playNext, /api/track-end and watchdog
const oldPlayNextBlock = `async function stopPlayback() {
  currentPlaybackSession++;
  isPlaying = false;
  isPreparing = false;
  currentTrack = null;
  saveState();
  broadcastEvent();
  await callAudioServer('/stop');
}

function prefetchNextTrack() {
  if (queue.length > 0) {
    const nextTrack = queue[0];
    downloadTrackToFile(nextTrack).catch(() => {});
  }
}

// Play Next Track In Queue
async function playNext() {
  const sessionId = ++currentPlaybackSession;

  if (queue.length === 0) {
    isPlaying = false;
    isPreparing = false;
    currentTrack = null;
    saveState();
    broadcastEvent();
    await callAudioServer('/stop');
    console.log('⏹️ Queue is empty, audio server set to idle loop.');
    return;
  }

  // Immediately stop any previous audio and speech announcement on audio-server
  await callAudioServer('/stop');
  if (sessionId !== currentPlaybackSession) return;

  const track = queue.shift();
  currentTrack = track;
  isPlaying = true;
  isPreparing = true;
  saveState();
  broadcastEvent();

  console.log(\`▶️ [MainController] Preparing [Session \${sessionId}]: "\${track.title}"\`);

  const isBridgeAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));

  // --- 1. If Termux is available and announcements enabled: Send TTS first! ---
  let ttsPlayedPromise = null;
  if (isBridgeAlive && announcementsEnabled && (track.title || track.metadata?.title)) {
    const { cleanTitle, cleanArtist } = cleanForTTS(track.title, track.metadata?.artist);
    const requester = track.metadata?.requesterUsername;
    const dedicatedTo = track.metadata?.dedicatedTo;
    const dedicatedBy = track.metadata?.dedicatedBy;

    let text = '';
    if (dedicatedTo && dedicatedBy) {
      text = \`Dedicated to \${dedicatedTo} by \${dedicatedBy}. Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    } else if (requester) {
      text = \`Requested by \${requester}. Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    } else {
      text = \`Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    }

    try {
      console.log(\`🎙️ [TTS] Offloading announcement first to Termux bridge: "\${text}"\`);
      const ttsUrl = \`\${activeResidentialBridgeUrl}/tts?text=\${encodeURIComponent(text)}&lang=\${encodeURIComponent(announcementVoice)}\`;
      if (sessionId === currentPlaybackSession) {
        console.log('📡 [TTS] Playing Termux TTS announcement on Audio Server...');
        ttsPlayedPromise = callAudioServer('/announce', { url: ttsUrl, wait: true });
      }
    } catch (ttsErr) {
      console.warn('⚠️ [TTS] Warning:', ttsErr.message);
    }
  } else if (!isBridgeAlive) {
    console.log('🎙️ [TTS] Termux bridge offline. Pausing TTS announcements to save worker resources.');
  }

  // --- 2. Download the music track (Termux YouTube or Cloud Worker 2-phase fallback) ---
  console.log(\`📥 [MainController] Downloading audio track for [Session \${sessionId}]: "\${track.title}"\`);
  let readyFile = await downloadTrackToFile(track).catch(err => {
    console.warn(\`⚠️ [MainController] Download failed for "\${track.title}": \${err.message}\`);
    return null;
  });

  if (sessionId !== currentPlaybackSession) {
    console.log(\`⏹️ [MainController] Session \${sessionId} superseded after download, cancelling.\`);
    return;
  }

  // If TTS announcement was launched, await its completion before song playback
  if (ttsPlayedPromise) {
    try { await ttsPlayedPromise; } catch (_) {}
  }

  if (sessionId !== currentPlaybackSession) {
    console.log(\`⏹️ [MainController] Session \${sessionId} superseded after announcement, cancelling.\`);
    return;
  }

  // If track download failed or file is unavailable
  if (!readyFile) {
    console.warn(\`⚠️ [MainController] Track "\${track.title}" is unavailable. Announcing and skipping in 10s...\`);
    currentTrack = {
      ...track,
      title: \`\${track.title} (Unavailable)\`
    };
    broadcastEvent('track_unavailable', { track });

    if (isBridgeAlive) {
      try {
        const unavailableMsg = 'The song is currently unavailable. The next song will start in 10 seconds.';
        const ttsUrl = \`\${activeResidentialBridgeUrl}/tts?text=\${encodeURIComponent(unavailableMsg)}&lang=\${encodeURIComponent(announcementVoice)}\`;
        if (sessionId === currentPlaybackSession) {
          await callAudioServer('/announce', { url: ttsUrl });
        }
      } catch (e) {
        console.warn('⚠️ [TTS] Unavailable announcement error:', e.message);
      }
    }

    if (sessionId !== currentPlaybackSession) return;

    const waitMs = 10000;
    const interval = 500;
    let elapsed = 0;
    while (elapsed < waitMs) {
      if (sessionId !== currentPlaybackSession) return;
      await new Promise(r => setTimeout(r, Math.min(interval, waitMs - elapsed)));
      elapsed += interval;
    }

    if (sessionId === currentPlaybackSession) {
      console.log('⏭️ [MainController] Advancing to next song after unavailable track wait.');
      await playNext();
    }
    return;
  }

  // 3. Immediately start the track on the audio server (0s gap from SSD cache)
  let audioFileUrl = readyFile;
  if (!readyFile.startsWith('http://') && !readyFile.startsWith('https://')) {
    audioFileUrl = \`\${CONTROLLER_URL}/api/audio-file/\${path.basename(readyFile)}\`;
  }
  const webhookUrl = \`\${CONTROLLER_URL}/api/track-end\`;

  console.log(\`🎶 [MainController] Sending track to Audio Server [Session \${sessionId}]: "\${track.title}" (URL: \${audioFileUrl})\`);
  await callAudioServer('/play', {
    url: audioFileUrl,
    title: track.title,
    volume: currentVolume,
    webhookUrl: webhookUrl
  });

  if (sessionId === currentPlaybackSession) {
    isPreparing = false;
    broadcastEvent();
  }

  // 4. Pre-fetch the next track in queue in background so it's already cached on SSD
  prefetchNextTrack();

  // Keep history
  history.unshift({
    title: track.title,
    playedAt: Date.now(),
    requester: track.metadata?.requesterUsername || 'System'
  });
  if (history.length > 50) history.pop();
}

// Serve cached audio files for Audio Server streaming
app.get('/api/audio-file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio file not found');
  }
  res.sendFile(filePath);
});

// Webhook from Audio Server when track finishes naturally
app.post('/api/track-end', async (req, res) => {
  console.log('🏁 [TrackEnd] Song finished on Audio Server. Advancing queue...');
  res.json({ status: 'ok' });
  if (isPlaying) {
    await playNext();
  }
});

// Periodic Audio Server Watchdog: Keeps Main Controller and Audio Server in 100% lockstep sync
let consecutiveIdleChecks = 0;

setInterval(async () => {
  if (!isPlaying || isPreparing) {
    consecutiveIdleChecks = 0;
    return;
  }
  try {
    const status = await callAudioServer('/status', {}, 'GET');
    const isAudioBusy = Boolean(
      status?.player?.isPlaying ||
      status?.isAnnouncing ||
      status?.stream?.isAnnouncing
    );
    if (status && !isAudioBusy && isPlaying && !isPreparing) {
      consecutiveIdleChecks++;
      if (consecutiveIdleChecks >= 2) {
        console.warn('⚠️ [AudioWatchdog] Audio Server verified idle for 10s while Controller is in play state (not preparing). Advancing queue...');
        consecutiveIdleChecks = 0;
        await playNext();
      }
    } else {
      consecutiveIdleChecks = 0;
    }
  } catch (_) {
    consecutiveIdleChecks = 0;
  }
}, 5000);`;

const newPlayNextBlock = `async function stopPlayback(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  targetRoom.currentPlaybackSession++;
  targetRoom.isPlaying = false;
  targetRoom.isPreparing = false;
  targetRoom.currentTrack = null;
  targetRoom.saveState();
  broadcastEvent(targetRoom);
  await callAudioServer(targetRoom, '/stop');
}

function prefetchNextTrack(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  if (targetRoom.queue.length > 0) {
    const nextTrack = targetRoom.queue[0];
    downloadTrackToFile(nextTrack).catch(() => {});
  }
}

// Play Next Track In Queue for a specific Room
async function playNext(room = rooms.room1) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const sessionId = ++targetRoom.currentPlaybackSession;

  if (targetRoom.queue.length === 0) {
    targetRoom.isPlaying = false;
    targetRoom.isPreparing = false;
    targetRoom.currentTrack = null;
    targetRoom.saveState();
    broadcastEvent(targetRoom);
    await callAudioServer(targetRoom, '/stop');
    console.log(\`⏹️ [\${targetRoom.id}] Queue is empty, audio server set to idle loop.\`);
    return;
  }

  // Immediately stop any previous audio and speech announcement on this room's audio-server
  await callAudioServer(targetRoom, '/stop');
  if (sessionId !== targetRoom.currentPlaybackSession) return;

  const track = targetRoom.queue.shift();
  targetRoom.currentTrack = track;
  targetRoom.isPlaying = true;
  targetRoom.isPreparing = true;
  targetRoom.saveState();
  broadcastEvent(targetRoom);

  console.log(\`▶️ [MainController:\${targetRoom.id}] Preparing [Session \${sessionId}]: "\${track.title}"\`);

  const isBridgeAlive = Boolean(activeResidentialBridgeUrl && (Date.now() - lastResidentialBridgeHeartbeat < 120000));

  // --- 1. If Termux is available and announcements enabled: Send TTS first! ---
  let ttsPlayedPromise = null;
  if (isBridgeAlive && targetRoom.announcementsEnabled && (track.title || track.metadata?.title)) {
    const { cleanTitle, cleanArtist } = cleanForTTS(track.title, track.metadata?.artist);
    const requester = track.metadata?.requesterUsername;
    const dedicatedTo = track.metadata?.dedicatedTo;
    const dedicatedBy = track.metadata?.dedicatedBy;

    let text = '';
    if (dedicatedTo && dedicatedBy) {
      text = \`Dedicated to \${dedicatedTo} by \${dedicatedBy}. Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    } else if (requester) {
      text = \`Requested by \${requester}. Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    } else {
      text = \`Now playing: \${cleanTitle}, by \${cleanArtist}\`;
    }

    try {
      console.log(\`🎙️ [TTS:\${targetRoom.id}] Offloading announcement first to Termux bridge: "\${text}"\`);
      const ttsUrl = \`\${activeResidentialBridgeUrl}/tts?text=\${encodeURIComponent(text)}&lang=\${encodeURIComponent(targetRoom.announcementVoice)}\`;
      if (sessionId === targetRoom.currentPlaybackSession) {
        console.log(\`📡 [TTS:\${targetRoom.id}] Playing Termux TTS announcement on Audio Server...\`);
        ttsPlayedPromise = callAudioServer(targetRoom, '/announce', { url: ttsUrl, wait: true });
      }
    } catch (ttsErr) {
      console.warn(\`⚠️ [TTS:\${targetRoom.id}] Warning:\`, ttsErr.message);
    }
  } else if (!isBridgeAlive) {
    console.log(\`🎙️ [TTS:\${targetRoom.id}] Termux bridge offline. Pausing TTS announcements to save worker resources.\`);
  }

  // --- 2. Download the music track (Termux YouTube or Cloud Worker 2-phase fallback) ---
  console.log(\`📥 [MainController:\${targetRoom.id}] Downloading audio track for [Session \${sessionId}]: "\${track.title}"\`);
  let readyFile = await downloadTrackToFile(track).catch(err => {
    console.warn(\`⚠️ [MainController:\${targetRoom.id}] Download failed for "\${track.title}": \${err.message}\`);
    return null;
  });

  if (sessionId !== targetRoom.currentPlaybackSession) {
    console.log(\`⏹️ [MainController:\${targetRoom.id}] Session \${sessionId} superseded after download, cancelling.\`);
    return;
  }

  // If TTS announcement was launched, await its completion before song playback
  if (ttsPlayedPromise) {
    try { await ttsPlayedPromise; } catch (_) {}
  }

  if (sessionId !== targetRoom.currentPlaybackSession) {
    console.log(\`⏹️ [MainController:\${targetRoom.id}] Session \${sessionId} superseded after announcement, cancelling.\`);
    return;
  }

  // If track download failed or file is unavailable
  if (!readyFile) {
    console.warn(\`⚠️ [MainController:\${targetRoom.id}] Track "\${track.title}" is unavailable. Announcing and skipping in 10s...\`);
    targetRoom.currentTrack = {
      ...track,
      title: \`\${track.title} (Unavailable)\`
    };
    broadcastEvent(targetRoom, 'track_unavailable', { track });

    if (isBridgeAlive) {
      try {
        const unavailableMsg = 'The song is currently unavailable. The next song will start in 10 seconds.';
        const ttsUrl = \`\${activeResidentialBridgeUrl}/tts?text=\${encodeURIComponent(unavailableMsg)}&lang=\${encodeURIComponent(targetRoom.announcementVoice)}\`;
        if (sessionId === targetRoom.currentPlaybackSession) {
          await callAudioServer(targetRoom, '/announce', { url: ttsUrl });
        }
      } catch (e) {
        console.warn(\`⚠️ [TTS:\${targetRoom.id}] Unavailable announcement error:\`, e.message);
      }
    }

    if (sessionId !== targetRoom.currentPlaybackSession) return;

    const waitMs = 10000;
    const interval = 500;
    let elapsed = 0;
    while (elapsed < waitMs) {
      if (sessionId !== targetRoom.currentPlaybackSession) return;
      await new Promise(r => setTimeout(r, Math.min(interval, waitMs - elapsed)));
      elapsed += interval;
    }

    if (sessionId === targetRoom.currentPlaybackSession) {
      console.log(\`⏭️ [MainController:\${targetRoom.id}] Advancing to next song after unavailable track wait.\`);
      await playNext(targetRoom);
    }
    return;
  }

  // 3. Immediately start the track on the audio server (0s gap from SSD cache)
  let audioFileUrl = readyFile;
  if (!readyFile.startsWith('http://') && !readyFile.startsWith('https://')) {
    audioFileUrl = \`\${CONTROLLER_URL}/api/audio-file/\${path.basename(readyFile)}\`;
  }
  const webhookUrl = \`\${CONTROLLER_URL}/api/track-end?room=\${targetRoom.id}\`;

  console.log(\`🎶 [MainController:\${targetRoom.id}] Sending track to Audio Server [Session \${sessionId}]: "\${track.title}" (URL: \${audioFileUrl})\`);
  await callAudioServer(targetRoom, '/play', {
    url: audioFileUrl,
    title: track.title,
    volume: targetRoom.currentVolume,
    webhookUrl: webhookUrl
  });

  if (sessionId === targetRoom.currentPlaybackSession) {
    targetRoom.isPreparing = false;
    broadcastEvent(targetRoom);
  }

  // 4. Pre-fetch the next track in queue in background so it's already cached on SSD
  prefetchNextTrack(targetRoom);

  // Keep history
  targetRoom.history.unshift({
    title: track.title,
    playedAt: Date.now(),
    requester: track.metadata?.requesterUsername || 'System'
  });
  if (targetRoom.history.length > 50) targetRoom.history.pop();
}

// Serve cached audio files for Audio Server streaming
app.get('/api/audio-file/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(CACHE_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('Audio file not found');
  }
  res.sendFile(filePath);
});

// Webhook from Audio Server when track finishes naturally
app.post('/api/track-end', async (req, res) => {
  const room = getRoom(req);
  console.log(\`🏁 [TrackEnd:\${room.id}] Song finished on Audio Server. Advancing queue...\`);
  res.json({ status: 'ok', room: room.id });
  if (room.isPlaying) {
    await playNext(room);
  }
});

// Periodic Audio Server Watchdog: Keeps Main Controller and Audio Servers in 100% lockstep sync
setInterval(async () => {
  for (const room of Object.values(rooms)) {
    if (!room.isPlaying || room.isPreparing) {
      room.consecutiveIdleChecks = 0;
      continue;
    }
    try {
      const status = await callAudioServer(room, '/status', {}, 'GET');
      const isAudioBusy = Boolean(
        status?.player?.isPlaying ||
        status?.isAnnouncing ||
        status?.stream?.isAnnouncing
      );
      if (status && !isAudioBusy && room.isPlaying && !room.isPreparing) {
        room.consecutiveIdleChecks++;
        if (room.consecutiveIdleChecks >= 2) {
          console.warn(\`⚠️ [AudioWatchdog:\${room.id}] Audio Server verified idle for 10s while Controller is in play state. Advancing queue...\`);
          room.consecutiveIdleChecks = 0;
          await playNext(room);
        }
      } else {
        room.consecutiveIdleChecks = 0;
      }
    } catch (_) {
      room.consecutiveIdleChecks = 0;
    }
  }
}, 5000);`;

// 4. Replace /stream route
const oldStreamRoute = `// Stream Proxy - Seamlessly pipes audio from the Dedicated Audio Server (Port 8000)
app.get(['/stream', '/STREAM'], async (req, res) => {
  try {
    const audioStreamUrl = \`\${AUDIO_SERVER_URL}/stream\`;
    const audioRes = await fetch(audioStreamUrl);

    if (res.socket) res.socket.setNoDelay(true);

    res.writeHead(audioRes.status || 200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Stream-Live': 'true'
    });

    audioRes.body.pipe(res);
    req.on('close', () => {
      try { audioRes.body.destroy(); } catch (_) {}
    });
  } catch (err) {
    console.error('⚠️ [StreamProxy] Error:', err.message);
    res.status(502).send('Audio Server Unreachable. Please ensure audio-server is running on port 8000.');
  }
});`;

const newStreamRoute = `// Stream Proxy - Seamlessly pipes audio from the Dedicated Audio Server for the requested room
app.get(['/stream', '/STREAM'], async (req, res) => {
  const room = getRoom(req);
  try {
    const audioStreamUrl = \`\${room.audioServerUrl}/stream\`;
    const audioRes = await fetch(audioStreamUrl);

    if (res.socket) res.socket.setNoDelay(true);

    res.writeHead(audioRes.status || 200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Stream-Live': 'true',
      'X-Room-Id': room.id
    });

    audioRes.body.pipe(res);
    req.on('close', () => {
      try { audioRes.body.destroy(); } catch (_) {}
    });
  } catch (err) {
    console.error(\`⚠️ [StreamProxy:\${room.id}] Error:\`, err.message);
    res.status(502).send(\`Audio Server [\${room.id}] Unreachable.\`);
  }
});

// Rooms Overview API
app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms).map(r => ({
    id: r.id,
    name: r.name,
    audioServerUrl: r.audioServerUrl,
    directStreamUrl: \`\${r.audioServerUrl}/stream\`,
    proxyStreamUrl: \`\${CONTROLLER_URL}/stream?room=\${r.id}\`,
    isPlaying: r.isPlaying,
    isPreparing: r.isPreparing,
    currentTrack: r.currentTrack?.title || null,
    queueLength: r.queue.length,
    volume: r.currentVolume
  }));
  res.json({
    totalRooms: list.length,
    rooms: list
  });
});`;

// 5. Replace /events
const oldEventsRoute = `// SSE Live Updates
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  sseClients.add(res);

  // Send initial state immediately
  res.write(\`data: \${JSON.stringify(getDashboardState('initial'))}\\n\\n\`);

  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\\n\\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});`;

const newEventsRoute = `// SSE Live Updates
app.get('/events', (req, res) => {
  const room = getRoom(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res._roomId = req.query.room || null;
  sseClients.add(res);

  // Send initial state immediately
  res.write(\`data: \${JSON.stringify(getDashboardState(room, 'initial'))}\\n\\n\`);

  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\\n\\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});`;

// 6. Replace /current & /queue
const oldCurrentQueueBlock = `// Current & Queue Info
app.get('/current', (req, res) => {
  res.json({
    title: currentTrack?.metadata?.title || currentTrack?.title || 'None',
    isPlaying,
    isTransitioning: false,
    isPreparing,
    metadata: currentTrack?.metadata || {},
    isAutoplay: currentTrack?.isAutoplay || false,
    queueLength: queue.length,
    streamVersion: 1,
    startTime: currentTrack?.addedAt || Date.now(),
    serverElapsed: isPlaying && currentTrack?.addedAt ? Math.max(0, Date.now() - currentTrack.addedAt) : 0
  });
});

app.get('/queue', (req, res) => {
  res.json({
    queue: queue.map((item, index) => ({
      position: index + 1,
      title: item.metadata?.title || item.title || 'Unknown',
      artist: item.metadata?.artist || 'Unknown',
      duration: item.metadata?.duration || 'Unknown',
      isAutoplay: item.isAutoplay || false,
      url: item.url,
      videoId: item.metadata?.videoId
    })),
    currentlyPlaying: {
      title: currentTrack?.metadata?.title || currentTrack?.title || 'None',
      metadata: currentTrack?.metadata || null,
      isAutoplay: currentTrack?.isAutoplay || false
    },
    queueLength: queue.length
  });
});`;

const newCurrentQueueBlock = `// Current & Queue Info
app.get('/current', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    title: room.currentTrack?.metadata?.title || room.currentTrack?.title || 'None',
    isPlaying: room.isPlaying,
    isTransitioning: false,
    isPreparing: room.isPreparing,
    metadata: room.currentTrack?.metadata || {},
    isAutoplay: room.currentTrack?.isAutoplay || false,
    queueLength: room.queue.length,
    streamVersion: 1,
    startTime: room.currentTrack?.addedAt || Date.now(),
    serverElapsed: room.isPlaying && room.currentTrack?.addedAt ? Math.max(0, Date.now() - room.currentTrack.addedAt) : 0
  });
});

app.get('/queue', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    queue: room.queue.map((item, index) => ({
      position: index + 1,
      title: item.metadata?.title || item.title || 'Unknown',
      artist: item.metadata?.artist || 'Unknown',
      duration: item.metadata?.duration || 'Unknown',
      isAutoplay: item.isAutoplay || false,
      url: item.url,
      videoId: item.metadata?.videoId
    })),
    currentlyPlaying: {
      title: room.currentTrack?.metadata?.title || room.currentTrack?.title || 'None',
      metadata: room.currentTrack?.metadata || null,
      isAutoplay: room.currentTrack?.isAutoplay || false
    },
    queueLength: room.queue.length
  });
});`;

// 7. Replace duplicate track detection and /play, /insert, /next, /stop, /restore
const oldPlaybackControlBlock = `// Duplicate track detection helper
function checkDuplicateTrack(newTitle, newVideoId, newUrl) {
  const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
  const cTitle = clean(newTitle);
  if (!cTitle && !newVideoId && !newUrl) return null;

  const matches = (track) => {
    if (!track) return false;
    const tTitle = clean(track.title || track.metadata?.title);
    const tVideoId = track.metadata?.videoId || track.videoId;
    const tUrl = track.url || track.metadata?.url;

    if (newVideoId && tVideoId && String(newVideoId).toLowerCase() === String(tVideoId).toLowerCase()) return true;
    if (newUrl && tUrl && String(newUrl).toLowerCase() === String(tUrl).toLowerCase()) return true;
    if (cTitle && tTitle) {
      if (cTitle === tTitle) return true;
      if (cTitle.length >= 8 && tTitle.length >= 8) {
        if (cTitle.includes(tTitle) || tTitle.includes(cTitle)) return true;
      }
    }
    return false;
  };

  if (isPlaying && currentTrack && matches(currentTrack)) {
    return { isDuplicate: true, location: 'currently playing', track: currentTrack };
  }

  const qIdx = queue.findIndex(matches);
  if (qIdx !== -1) {
    return { isDuplicate: true, location: \`already in queue (#\${qIdx + 1})\`, position: qIdx + 1, track: queue[qIdx] };
  }

  return null;
}

// Add Song to Queue / Play
app.all('/play', async (req, res) => {
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const isAutoplay = req.body?.isAutoplay || req.query?.isAutoplay || false;
  const requesterUsername = req.body?.requesterUsername || req.query?.requesterUsername;
  const dedicatedTo = req.body?.dedicatedTo || req.query?.dedicatedTo;
  const dedicatedBy = req.body?.dedicatedBy || req.query?.dedicatedBy;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;

  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername,
          dedicatedTo,
          dedicatedBy
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: \`Track "\${metadata.title}" is too long (\${metadata.duration}). Maximum allowed duration is 15 minutes.\`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being queued
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(\`⚠️ [DuplicateBlocked] "\${metadata?.title || title}" is \${dup.location}\`);
      return res.status(409).json({
        error: \`Track "\${metadata?.title || title}" is \${dup.location}!\`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position
      });
    }
  }

  // If this is an autoplay request, ONLY allow it if player is idle AND queue is empty
  if (isAutoplay && (isPlaying || isPreparing || queue.length > 0)) {
    console.log(\`🤖 [AutoplayBlocked] Blocked autoplay request for "\${metadata?.title || title || url}" because player is active or queue is not empty (isPlaying=\${isPlaying}, isPreparing=\${isPreparing}, queueLength=\${queue.length})\`);
    return res.json({
      status: 'ignored',
      message: 'Autoplay blocked: track already playing or queue not empty',
      isPlaying,
      queueLength: queue.length
    });
  }

  // Real user request: Purge any lingering autoplay tracks from queue so user requests always have strict precedence
  if (!isAutoplay) {
    const prevQueueLen = queue.length;
    queue = queue.filter(item => !item?.isAutoplay);
    if (queue.length !== prevQueueLen) {
      console.log(\`🧹 [Queue] Cleared \${prevQueueLen - queue.length} lingering autoplay track(s) from queue in favor of user request.\`);
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist', requesterUsername, dedicatedTo, dedicatedBy },
    isAutoplay: Boolean(isAutoplay),
    addedAt: Date.now()
  };

  if (isPlaying) {
    queue.push(songItem);
    saveState();
    broadcastEvent('queue_update');
    prefetchNextTrack();
    res.json({
      status: 'queued',
      position: queue.length,
      url: videoUrl,
      currentTitle: currentTrack?.title || '',
      queuedTitle: songItem.title
    });
  } else {
    queue.push(songItem);
    playNext();
    res.json({
      status: 'playing',
      url: videoUrl,
      queuedTitle: songItem.title,
      currentTitle: songItem.title,
      currentMetadata: metadata
    });
  }
});

// Insert Song Next in Queue
app.all('/insert', async (req, res) => {
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;
  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  // Real user insert: purge any lingering autoplay tracks
  const prevQueueLen = queue.length;
  queue = queue.filter(item => !item?.isAutoplay);
  if (queue.length !== prevQueueLen) {
    console.log(\`🧹 [Queue] Cleared \${prevQueueLen - queue.length} lingering autoplay track(s) from queue for insert.\`);
  }

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: \`Track "\${metadata.title}" is too long (\${metadata.duration}). Maximum allowed duration is 15 minutes.\`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being inserted
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(\`⚠️ [DuplicateBlocked] "\${metadata?.title || title}" is \${dup.location}\`);
      return res.status(409).json({
        error: \`Track "\${metadata?.title || title}" is \${dup.location}!\`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position
      });
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist' },
    isAutoplay: false,
    addedAt: Date.now()
  };

  if (!isPlaying) {
    queue.unshift(songItem);
    playNext();
    res.json({
      status: 'playing',
      insertedTitle: songItem.title,
      currentTitle: songItem.title,
      position: 1
    });
  } else {
    queue.unshift(songItem);
    saveState();
    broadcastEvent('queue_update');
    res.json({
      status: 'inserted',
      insertedTitle: songItem.title,
      position: 1
    });
  }
});

// Skip to Next Song
app.all('/next', async (req, res) => {
  const skippedTitle = currentTrack?.metadata?.title || currentTrack?.title || 'Current Track';
  console.log(\`⏭️ [Skip] Skipping "\${skippedTitle}"...\`);
  await playNext();
  const nextTitle = currentTrack?.metadata?.title || currentTrack?.title || null;
  res.json({
    status: 'ok',
    skippedTitle,
    current: currentTrack,
    nowPlaying: nextTitle,
    queueLength: queue.length,
    isPlaying: Boolean(isPlaying && currentTrack)
  });
});

// Stop Playback
app.all('/stop', async (req, res) => {
  console.log('⏹️ [Stop] Stopping playback...');
  await stopPlayback();
  res.json({ status: 'stopped' });
});

// Resolve Query / URL metadata (used by bot autoplay & search)
app.post('/resolve', async (req, res) => {
  const query = req.body.query || req.body.url;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    const results = await cachedYts(query);
    const first = results.videos?.[0];
    if (!first) return res.status(404).json({ error: 'No results found', query });

    const metadata = {
      url: first.url,
      title: first.title,
      artist: first.author?.name || 'Unknown Artist',
      duration: first.timestamp || 'Unknown',
      durationSeconds: first.seconds || 0,
      thumbnail: first.thumbnail || '',
      videoId: first.videoId
    };

    res.json({ status: 'resolved', metadata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore Playback
app.post('/restore', async (req, res) => {
  if (isPlaying) {
    return res.json({
      status: 'already_playing',
      nowPlaying: currentTrack?.title || '',
      queueLength: queue.length
    });
  }

  if (queue.length > 0) {
    playNext();
    return res.json({
      status: 'restored',
      queueLength: queue.length,
      message: 'Playback restored from saved queue'
    });
  }

  res.json({ status: 'empty', message: 'No saved queue to restore' });
});`;

const newPlaybackControlBlock = `// Duplicate track detection helper per room
function checkDuplicateTrack(room, newTitle, newVideoId, newUrl) {
  const targetRoom = (room && room.id && rooms[room.id]) ? room : rooms.room1;
  const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
  const cTitle = clean(newTitle);
  if (!cTitle && !newVideoId && !newUrl) return null;

  const matches = (track) => {
    if (!track) return false;
    const tTitle = clean(track.title || track.metadata?.title);
    const tVideoId = track.metadata?.videoId || track.videoId;
    const tUrl = track.url || track.metadata?.url;

    if (newVideoId && tVideoId && String(newVideoId).toLowerCase() === String(tVideoId).toLowerCase()) return true;
    if (newUrl && tUrl && String(newUrl).toLowerCase() === String(tUrl).toLowerCase()) return true;
    if (cTitle && tTitle) {
      if (cTitle === tTitle) return true;
      if (cTitle.length >= 8 && tTitle.length >= 8) {
        if (cTitle.includes(tTitle) || tTitle.includes(cTitle)) return true;
      }
    }
    return false;
  };

  if (targetRoom.isPlaying && targetRoom.currentTrack && matches(targetRoom.currentTrack)) {
    return { isDuplicate: true, location: 'currently playing', track: targetRoom.currentTrack };
  }

  const qIdx = targetRoom.queue.findIndex(matches);
  if (qIdx !== -1) {
    return { isDuplicate: true, location: \`already in queue (#\${qIdx + 1})\`, position: qIdx + 1, track: targetRoom.queue[qIdx] };
  }

  return null;
}

// Add Song to Queue / Play
app.all('/play', async (req, res) => {
  const room = getRoom(req);
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const isAutoplay = req.body?.isAutoplay || req.query?.isAutoplay || false;
  const requesterUsername = req.body?.requesterUsername || req.query?.requesterUsername;
  const dedicatedTo = req.body?.dedicatedTo || req.query?.dedicatedTo;
  const dedicatedBy = req.body?.dedicatedBy || req.query?.dedicatedBy;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;

  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername,
          dedicatedTo,
          dedicatedBy
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: \`Track "\${metadata.title}" is too long (\${metadata.duration}). Maximum allowed duration is 15 minutes.\`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being queued
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(room, metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(\`⚠️ [DuplicateBlocked:\${room.id}] "\${metadata?.title || title}" is \${dup.location}\`);
      return res.status(409).json({
        error: \`Track "\${metadata?.title || title}" is \${dup.location}!\`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position,
        room: room.id
      });
    }
  }

  // If this is an autoplay request, ONLY allow it if player is idle AND queue is empty
  if (isAutoplay && (room.isPlaying || room.isPreparing || room.queue.length > 0)) {
    console.log(\`🤖 [AutoplayBlocked:\${room.id}] Blocked autoplay request for "\${metadata?.title || title || url}" because player is active or queue is not empty (isPlaying=\${room.isPlaying}, isPreparing=\${room.isPreparing}, queueLength=\${room.queue.length})\`);
    return res.json({
      status: 'ignored',
      message: 'Autoplay blocked: track already playing or queue not empty',
      isPlaying: room.isPlaying,
      queueLength: room.queue.length,
      room: room.id
    });
  }

  // Real user request: Purge any lingering autoplay tracks from queue so user requests always have strict precedence
  if (!isAutoplay) {
    const prevQueueLen = room.queue.length;
    room.queue = room.queue.filter(item => !item?.isAutoplay);
    if (room.queue.length !== prevQueueLen) {
      console.log(\`🧹 [Queue:\${room.id}] Cleared \${prevQueueLen - room.queue.length} lingering autoplay track(s) from queue in favor of user request.\`);
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist', requesterUsername, dedicatedTo, dedicatedBy },
    isAutoplay: Boolean(isAutoplay),
    addedAt: Date.now()
  };

  if (room.isPlaying) {
    room.queue.push(songItem);
    room.saveState();
    broadcastEvent(room, 'queue_update');
    prefetchNextTrack(room);
    res.json({
      status: 'queued',
      room: room.id,
      position: room.queue.length,
      url: videoUrl,
      currentTitle: room.currentTrack?.title || '',
      queuedTitle: songItem.title
    });
  } else {
    room.queue.push(songItem);
    playNext(room);
    res.json({
      status: 'playing',
      room: room.id,
      url: videoUrl,
      queuedTitle: songItem.title,
      currentTitle: songItem.title,
      currentMetadata: metadata
    });
  }
});

// Insert Song Next in Queue
app.all('/insert', async (req, res) => {
  const room = getRoom(req);
  const url = req.body?.url || req.query?.url || req.body?.q || req.query?.q;
  const title = req.body?.title || req.query?.title;
  const allowDuplicate = req.body?.allowDuplicate || req.query?.allowDuplicate || false;
  if (!url) return res.status(400).json({ error: 'Missing "url" parameter' });

  // Real user insert: purge any lingering autoplay tracks
  const prevQueueLen = room.queue.length;
  room.queue = room.queue.filter(item => !item?.isAutoplay);
  if (room.queue.length !== prevQueueLen) {
    console.log(\`🧹 [Queue:\${room.id}] Cleared \${prevQueueLen - room.queue.length} lingering autoplay track(s) from queue for insert.\`);
  }

  let videoUrl = url;
  let metadata = req.body?.metadata || null;

  if (!metadata) {
    try {
      const results = await cachedYts(url);
      const first = results.videos?.[0];
      if (first) {
        videoUrl = first.url;
        metadata = {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId
        };
      }
    } catch (_) {}
  }

  if (metadata && metadata.durationSeconds > 900) {
    return res.status(400).json({
      error: \`Track "\${metadata.title}" is too long (\${metadata.duration}). Maximum allowed duration is 15 minutes.\`,
      status: 'rejected_too_long'
    });
  }

  // Prevent duplicate tracks from being inserted
  if (!allowDuplicate) {
    const dup = checkDuplicateTrack(room, metadata?.title || title, metadata?.videoId, videoUrl);
    if (dup) {
      console.log(\`⚠️ [DuplicateBlocked:\${room.id}] "\${metadata?.title || title}" is \${dup.location}\`);
      return res.status(409).json({
        error: \`Track "\${metadata?.title || title}" is \${dup.location}!\`,
        status: 'duplicate',
        location: dup.location,
        position: dup.position,
        room: room.id
      });
    }
  }

  const songItem = {
    url: videoUrl,
    requestedQuery: url,
    title: metadata?.title || title || 'Requested Track',
    metadata: metadata || { title: title || 'Requested Track', artist: 'Unknown Artist' },
    isAutoplay: false,
    addedAt: Date.now()
  };

  if (!room.isPlaying) {
    room.queue.unshift(songItem);
    playNext(room);
    res.json({
      status: 'playing',
      room: room.id,
      insertedTitle: songItem.title,
      currentTitle: songItem.title,
      position: 1
    });
  } else {
    room.queue.unshift(songItem);
    room.saveState();
    broadcastEvent(room, 'queue_update');
    res.json({
      status: 'inserted',
      room: room.id,
      insertedTitle: songItem.title,
      position: 1
    });
  }
});

// Skip to Next Song
app.all('/next', async (req, res) => {
  const room = getRoom(req);
  const skippedTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || 'Current Track';
  console.log(\`⏭️ [Skip:\${room.id}] Skipping "\${skippedTitle}"...\`);
  await playNext(room);
  const nextTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || null;
  res.json({
    status: 'ok',
    room: room.id,
    skippedTitle,
    current: room.currentTrack,
    nowPlaying: nextTitle,
    queueLength: room.queue.length,
    isPlaying: Boolean(room.isPlaying && room.currentTrack)
  });
});

// Stop Playback
app.all('/stop', async (req, res) => {
  const room = getRoom(req);
  console.log(\`⏹️ [Stop:\${room.id}] Stopping playback...\`);
  await stopPlayback(room);
  res.json({ status: 'stopped', room: room.id });
});

// Resolve Query / URL metadata (used by bot autoplay & search)
app.post('/resolve', async (req, res) => {
  const query = req.body.query || req.body.url;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  try {
    const results = await cachedYts(query);
    const first = results.videos?.[0];
    if (!first) return res.status(404).json({ error: 'No results found', query });

    const metadata = {
      url: first.url,
      title: first.title,
      artist: first.author?.name || 'Unknown Artist',
      duration: first.timestamp || 'Unknown',
      durationSeconds: first.seconds || 0,
      thumbnail: first.thumbnail || '',
      videoId: first.videoId
    };

    res.json({ status: 'resolved', metadata });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restore Playback
app.post('/restore', async (req, res) => {
  const room = getRoom(req);
  if (room.isPlaying) {
    return res.json({
      status: 'already_playing',
      room: room.id,
      nowPlaying: room.currentTrack?.title || '',
      queueLength: room.queue.length
    });
  }

  if (room.queue.length > 0) {
    playNext(room);
    return res.json({
      status: 'restored',
      room: room.id,
      queueLength: room.queue.length,
      message: 'Playback restored from saved queue'
    });
  }

  res.json({ status: 'empty', room: room.id, message: 'No saved queue to restore' });
});`;

// 8. Replace /volume, /announcements, /clear, /health, /api/audio-health
const oldVolumeHealthBlock = `app.get('/volume', (req, res) => res.json({ volume: currentVolume }));
app.post('/volume', async (req, res) => {
  const vol = Math.max(0, Math.min(150, Number(req.body.volume) || 100));
  currentVolume = vol;
  await callAudioServer('/volume', { volume: currentVolume });
  broadcastEvent('volume_change');
  res.json({ status: 'ok', volume: currentVolume });
});

// Announcements Configuration
app.get('/announcements', (req, res) => {
  res.json({
    enabled: announcementsEnabled,
    voice: announcementVoice
  });
});
app.post('/announcements', (req, res) => {
  if (req.body.enabled !== undefined) announcementsEnabled = Boolean(req.body.enabled);
  if (req.body.voice) announcementVoice = String(req.body.voice);
  broadcastEvent('announcements_change');
  res.json({ status: 'ok', enabled: announcementsEnabled, voice: announcementVoice });
});

// Clear Queue
app.post('/clear', (req, res) => {
  queue = [];
  saveState();
  broadcastEvent('queue_cleared');
  res.json({ status: 'cleared' });
});

// Health Status — non-blocking: respond immediately, probe audio server in background
app.get('/health', (req, res) => {
  // Respond instantly so panel/bot health checks never get stuck
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    isPlaying,
    queueLength: queue.length,
    audioServer: { note: 'check /api/audio-health for live audio server status' }
  });
});

// Separate endpoint that actually probes audio server health (can be slow)
app.get('/api/audio-health', async (req, res) => {
  const audioHealth = await callAudioServer('/health', {}, 'GET');
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    audioServer: audioHealth
  });
});`;

const newVolumeHealthBlock = `app.get('/volume', (req, res) => {
  const room = getRoom(req);
  res.json({ room: room.id, volume: room.currentVolume });
});
app.post('/volume', async (req, res) => {
  const room = getRoom(req);
  const vol = Math.max(0, Math.min(150, Number(req.body.volume) || 100));
  room.currentVolume = vol;
  await callAudioServer(room, '/volume', { volume: room.currentVolume });
  broadcastEvent(room, 'volume_change');
  res.json({ status: 'ok', room: room.id, volume: room.currentVolume });
});

// Announcements Configuration
app.get('/announcements', (req, res) => {
  const room = getRoom(req);
  res.json({
    room: room.id,
    enabled: room.announcementsEnabled,
    voice: room.announcementVoice
  });
});
app.post('/announcements', (req, res) => {
  const room = getRoom(req);
  if (req.body.enabled !== undefined) room.announcementsEnabled = Boolean(req.body.enabled);
  if (req.body.voice) room.announcementVoice = String(req.body.voice);
  broadcastEvent(room, 'announcements_change');
  res.json({ status: 'ok', room: room.id, enabled: room.announcementsEnabled, voice: room.announcementVoice });
});

// Clear Queue
app.post('/clear', (req, res) => {
  const room = getRoom(req);
  room.queue = [];
  room.saveState();
  broadcastEvent(room, 'queue_cleared');
  res.json({ status: 'cleared', room: room.id });
});

// Health Status — non-blocking: respond immediately with summary for all rooms
app.get('/health', (req, res) => {
  const roomSummary = {};
  for (const [id, r] of Object.entries(rooms)) {
    roomSummary[id] = {
      isPlaying: r.isPlaying,
      isPreparing: r.isPreparing,
      queueLength: r.queue.length,
      currentTrack: r.currentTrack?.title || null
    };
  }
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    rooms: roomSummary
  });
});

// Probes all audio servers' health
app.get('/api/audio-health', async (req, res) => {
  const results = {};
  for (const [id, r] of Object.entries(rooms)) {
    results[id] = await callAudioServer(r, '/health', {}, 'GET');
  }
  res.json({
    status: 'healthy',
    controllerUptime: Math.floor(process.uptime()),
    audioServers: results
  });
});`;

// 9. Replace /api/queue/:index and /api/bot-command
const oldBotCommandBlock = `app.delete('/api/queue/:index', (req, res) => {
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= queue.length) {
    return res.status(400).json({ error: 'Invalid queue index' });
  }
  const removed = queue.splice(idx, 1);
  saveState();
  broadcastEvent('queue_update');
  res.json({ status: 'success', removed: removed[0]?.title });
});

// ==========================================
// 🤖 HIGHRISE BOT API COMPATIBILITY
// ==========================================
app.post('/api/bot-command', async (req, res) => {
  const { command, args, user, metadata, message, userId, x, y, z } = req.body;
  console.log(\`🤖 [BotCommand] \${user?.username || 'Dashboard/User'}: \${command} \${args || ''}\`);

  if (command === 'play') {
    const query = args || req.body.url || req.body.query;
    if (!query) return res.json({ response: 'Please specify a song title or URL!' });
    try {
      const results = await cachedYts(query);
      const first = results.videos?.[0];
      if (!first) return res.json({ response: 'No song found for that query!' });

      if (first.seconds && first.seconds > 900) {
        return res.json({ response: \`Song is too long (\${first.timestamp}). Maximum duration is 15 minutes.\`, status: 'rejected_too_long' });
      }

      // Check duplicate
      const dup = checkDuplicateTrack(first.title, first.videoId, first.url);
      if (dup) {
        return res.json({
          response: \`⚠️ "\${first.title}" is already \${dup.location}!\`,
          status: 'duplicate',
          title: first.title
        });
      }

      const songItem = {
        url: first.url,
        title: first.title,
        metadata: {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername: user?.username || 'Highrise Player',
          ...metadata
        },
        addedAt: Date.now()
      };

      if (!isPlaying) {
        queue.push(songItem);
        playNext();
        return res.json({ response: \`Now playing: \${first.title}\`, status: 'playing', title: first.title });
      } else {
        queue.push(songItem);
        saveState();
        broadcastEvent('queue_update');
        return res.json({ response: \`Added to queue (#\${queue.length}): \${first.title}\`, status: 'queued', title: first.title });
      }
    } catch (e) {
      return res.json({ response: \`Error searching for song: \${e.message}\`, error: e.message });
    }
  }

  if (command === 'skip' || command === 'next') {
    const skippedTitle = currentTrack?.metadata?.title || currentTrack?.title || 'Track';
    console.log(\`⏭️ [BotCommand] Skipping "\${skippedTitle}"...\`);
    await playNext();
    return res.json({ response: currentTrack ? \`Skipped! Now playing: \${currentTrack.title}\` : 'Queue is empty.', skippedTitle });
  }

  if (command === 'stop') {
    console.log('⏹️ [BotCommand] Stopping playback...');
    await stopPlayback();
    return res.json({ response: 'Playback stopped.', status: 'stopped' });
  }

  if (command === 'queue') {
    if (queue.length === 0) return res.json({ response: 'The queue is currently empty.' });
    const list = queue.slice(0, 5).map((s, i) => \`\${i + 1}. \${s.title}\`).join('\\n');
    return res.json({ response: \`Next up:\\n\${list}\` });
  }`;

const newBotCommandBlock = `app.delete('/api/queue/:index', (req, res) => {
  const room = getRoom(req);
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= room.queue.length) {
    return res.status(400).json({ error: 'Invalid queue index' });
  }
  const removed = room.queue.splice(idx, 1);
  room.saveState();
  broadcastEvent(room, 'queue_update');
  res.json({ status: 'success', room: room.id, removed: removed[0]?.title });
});

// ==========================================
// 🤖 HIGHRISE BOT API COMPATIBILITY
// ==========================================
app.post('/api/bot-command', async (req, res) => {
  const room = getRoom(req);
  const { command, args, user, metadata, message, userId, x, y, z } = req.body;
  console.log(\`🤖 [BotCommand:\${room.id}] \${user?.username || 'Dashboard/User'}: \${command} \${args || ''}\`);

  if (command === 'play') {
    const query = args || req.body.url || req.body.query;
    if (!query) return res.json({ response: 'Please specify a song title or URL!' });
    try {
      const results = await cachedYts(query);
      const first = results.videos?.[0];
      if (!first) return res.json({ response: 'No song found for that query!' });

      if (first.seconds && first.seconds > 900) {
        return res.json({ response: \`Song is too long (\${first.timestamp}). Maximum duration is 15 minutes.\`, status: 'rejected_too_long' });
      }

      // Check duplicate
      const dup = checkDuplicateTrack(room, first.title, first.videoId, first.url);
      if (dup) {
        return res.json({
          response: \`⚠️ "\${first.title}" is already \${dup.location}!\`,
          status: 'duplicate',
          title: first.title,
          room: room.id
        });
      }

      const songItem = {
        url: first.url,
        title: first.title,
        metadata: {
          url: first.url,
          title: first.title,
          artist: first.author?.name || 'Unknown Artist',
          duration: first.timestamp || 'Unknown',
          durationSeconds: first.seconds || 0,
          thumbnail: first.thumbnail || '',
          videoId: first.videoId,
          requesterUsername: user?.username || 'Highrise Player',
          ...metadata
        },
        addedAt: Date.now()
      };

      if (!room.isPlaying) {
        room.queue.push(songItem);
        playNext(room);
        return res.json({ response: \`Now playing: \${first.title}\`, status: 'playing', title: first.title, room: room.id });
      } else {
        room.queue.push(songItem);
        room.saveState();
        broadcastEvent(room, 'queue_update');
        return res.json({ response: \`Added to queue (#\${room.queue.length}): \${first.title}\`, status: 'queued', title: first.title, room: room.id });
      }
    } catch (e) {
      return res.json({ response: \`Error searching for song: \${e.message}\`, error: e.message });
    }
  }

  if (command === 'skip' || command === 'next') {
    const skippedTitle = room.currentTrack?.metadata?.title || room.currentTrack?.title || 'Track';
    console.log(\`⏭️ [BotCommand:\${room.id}] Skipping "\${skippedTitle}"...\`);
    await playNext(room);
    return res.json({ response: room.currentTrack ? \`Skipped! Now playing: \${room.currentTrack.title}\` : 'Queue is empty.', skippedTitle, room: room.id });
  }

  if (command === 'stop') {
    console.log(\`⏹️ [BotCommand:\${room.id}] Stopping playback...\`);
    await stopPlayback(room);
    return res.json({ response: 'Playback stopped.', status: 'stopped', room: room.id });
  }

  if (command === 'queue') {
    if (room.queue.length === 0) return res.json({ response: 'The queue is currently empty.', room: room.id });
    const list = room.queue.slice(0, 5).map((s, i) => \`\${i + 1}. \${s.title}\`).join('\\n');
    return res.json({ response: \`Next up:\\n\${list}\`, room: room.id });
  }`;

// 10. Replace listen banner
const oldListenBlock = `app.listen(PORT, '0.0.0.0', () => {
  console.log(\`
╔═══════════════════════════════════════════════════════════════╗
║          🎮 HIGHRISE MAIN CONTROLLER ACTIVE                   ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:             \${PORT}                                       ║
║  Dashboard URL:    http://localhost:\${PORT}/                     ║
║  Audio Server:     \${AUDIO_SERVER_URL}                           ║
║  Status:           Connected & Ready                          ║
╚═══════════════════════════════════════════════════════════════╝
  \`);
});`;

const newListenBlock = `app.listen(PORT, '0.0.0.0', () => {
  console.log(\`
╔═══════════════════════════════════════════════════════════════╗
║          🎮 MULTI-ROOM HIGHRISE MAIN CONTROLLER ACTIVE        ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:             \${PORT}                                       ║
║  Dashboard URL:    http://localhost:\${PORT}/                     ║
║  Rooms Active:     \${Object.keys(rooms).join(', ')}                     ║
║  Room 1 Audio:     \${rooms.room1?.audioServerUrl}            ║
║  Room 2 Audio:     \${rooms.room2?.audioServerUrl}            ║
║  Status:           Connected & Ready                          ║
╚═══════════════════════════════════════════════════════════════╝
  \`);
});`;

// Execute replacements with validation
function applyReplace(name, oldText, newText) {
  // Normalize line endings to avoid CRLF / LF mismatches
  const normCode = code.replace(/\\r\\n/g, '\\n');
  const normOld = oldText.replace(/\\r\\n/g, '\\n');
  if (!normCode.includes(normOld)) {
    throw new Error(\`Failed to match block for: \${name}\`);
  }
  code = normCode.replace(normOld, newText.replace(/\\r\\n/g, '\\n'));
  console.log(\`✅ Applied replacement: \${name}\`);
}

applyReplace('State & Dashboard', oldStateBlock, newStateBlock);
applyReplace('callAudioServer', oldAudioServerCall, newAudioServerCall);
applyReplace('Playback Logic & Watchdog', oldPlayNextBlock, newPlayNextBlock);
applyReplace('Stream Route & Rooms API', oldStreamRoute, newStreamRoute);
applyReplace('Events Route', oldEventsRoute, newEventsRoute);
applyReplace('Current & Queue Route', oldCurrentQueueBlock, newCurrentQueueBlock);
applyReplace('Playback Control Routes', oldPlaybackControlBlock, newPlaybackControlBlock);
applyReplace('Volume & Health Routes', oldVolumeHealthBlock, newVolumeHealthBlock);
applyReplace('Bot Command & Queue Delete', oldBotCommandBlock, newBotCommandBlock);
applyReplace('Listen Banner', oldListenBlock, newListenBlock);

fs.writeFileSync(path.join(__dirname, 'server.js'), code, 'utf8');
console.log('🎉 Successfully wrote updated server.js!');

