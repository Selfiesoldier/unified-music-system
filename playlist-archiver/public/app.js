let currentTracks = [];
let isArchiving = false;
let isPaused = false;
let eventSource = null;

// DOM Elements
const urlTabBtn = document.querySelector('[data-tab="urlTab"]');
const textTabBtn = document.querySelector('[data-tab="textTab"]');
const urlTab = document.getElementById('urlTab');
const textTab = document.getElementById('textTab');

const playlistUrlInput = document.getElementById('playlistUrl');
const textListInput = document.getElementById('textList');
const fetchBtn = document.getElementById('fetchBtn');
const fetchTextBtn = document.getElementById('fetchTextBtn');
const syncVaultBtn = document.getElementById('syncVaultBtn');
const skipDuplicatesToggle = document.getElementById('skipDuplicatesToggle');
const concurrencySelect = document.getElementById('concurrencySelect');

const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const stopBtn = document.getElementById('stopBtn');

const statTotal = document.getElementById('statTotal');
const statReady = document.getElementById('statReady');
const statSkipped = document.getElementById('statSkipped');
const statUploaded = document.getElementById('statUploaded');
const statFailed = document.getElementById('statFailed');
const statPlaylistTitle = document.getElementById('statPlaylistTitle');

const progressBar = document.getElementById('progressBar');
const progressPercent = document.getElementById('progressPercent');
const progressCount = document.getElementById('progressCount');
const currentSongLabel = document.getElementById('currentSongLabel');

const tracksTbody = document.getElementById('tracksTbody');
const searchFilter = document.getElementById('searchFilter');
const statusFilter = document.getElementById('statusFilter');
const tableCountBadge = document.getElementById('tableCountBadge');

const terminalBody = document.getElementById('terminalBody');
const clearLogBtn = document.getElementById('clearLogBtn');
const vaultCount = document.getElementById('vaultCount');
const botName = document.getElementById('botName');

// ==========================================
// 🚀 INITIALIZATION & SSE CONNECTION
// ==========================================
function init() {
  setupTabs();
  setupEventListeners();
  connectSSE();
  fetchVaultInfo();
  checkTelegramHealth();
}

function setupTabs() {
  urlTabBtn.addEventListener('click', () => {
    urlTabBtn.classList.add('active');
    textTabBtn.classList.remove('active');
    urlTab.classList.add('active');
    textTab.classList.remove('active');
  });

  textTabBtn.addEventListener('click', () => {
    textTabBtn.classList.add('active');
    urlTabBtn.classList.remove('active');
    textTab.classList.add('active');
    urlTab.classList.remove('active');
  });
}

function setupEventListeners() {
  fetchBtn.addEventListener('click', () => parseInput('url'));
  fetchTextBtn.addEventListener('click', () => parseInput('text'));
  playlistUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') parseInput('url');
  });

  startBtn.addEventListener('click', startArchiving);
  pauseBtn.addEventListener('click', togglePause);
  stopBtn.addEventListener('click', stopArchiving);
  syncVaultBtn.addEventListener('click', syncVault);
  clearLogBtn.addEventListener('click', () => terminalBody.innerHTML = '');

  searchFilter.addEventListener('input', renderTable);
  statusFilter.addEventListener('change', renderTable);
  skipDuplicatesToggle.addEventListener('change', () => {
    updateStatsFromTracks();
  });
}

// ==========================================
// 📡 SERVER-SENT EVENTS (SSE)
// ==========================================
function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');

  eventSource.onopen = () => {
    appendLog('Connected to Live Server Event stream', 'info');
  };

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleSSEEvent(data);
    } catch (_) {}
  };

  eventSource.onerror = () => {
    setTimeout(connectSSE, 4000);
  };
}

function handleSSEEvent({ type, data, timestamp }) {
  if (type === 'log') {
    appendLog(data.message, data.level, timestamp);
  } else if (type === 'progress') {
    currentSongLabel.textContent = `⚡ Parallel Pipeline: ${data.processed || 0}/${data.total} processed (${data.uploaded || 0} uploaded, ${data.skipped || 0} skipped, ${data.failed || 0} errors)`;
    updateProgress(data.processed || 0, data.total);
  } else if (type === 'track_update') {
    const track = currentTracks.find(t => t.index === data.index);
    if (track) {
      track.status = data.status;
      if (data.telegram_message_id) track.telegram_message_id = data.telegram_message_id;
      if (data.error) track.error = data.error;
      renderTable();
      updateStatsFromTracks();
    }
  } else if (type === 'status_change') {
    if (data.status === 'paused') {
      isPaused = true;
      pauseBtn.textContent = '▶️ Resume';
      pauseBtn.classList.replace('btn-warning', 'btn-success');
    } else if (data.status === 'running') {
      isPaused = false;
      pauseBtn.textContent = '⏸️ Pause';
      pauseBtn.classList.replace('btn-success', 'btn-warning');
    } else if (data.status === 'stopped') {
      isArchiving = false;
      updateControlButtons();
    }
  } else if (type === 'finished') {
    isArchiving = false;
    currentSongLabel.textContent = `Ingestion Finished! Uploaded: ${data.uploaded}, Skipped: ${data.skipped}, Failed: ${data.failed}`;
    updateControlButtons();
    fetchVaultInfo();
  }
}

// ==========================================
// 🔍 PARSE PLAYLIST
// ==========================================
async function parseInput(mode) {
  const url = playlistUrlInput.value.trim();
  const text = textListInput.value.trim();

  if (mode === 'url' && !url) {
    alert('Please enter a valid YouTube playlist or video URL!');
    return;
  }
  if (mode === 'text' && !text) {
    alert('Please enter at least one song query in the text box!');
    return;
  }

  fetchBtn.disabled = true;
  fetchTextBtn.disabled = true;
  fetchBtn.querySelector('.spinner')?.classList.remove('hidden');

  try {
    const res = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: mode === 'url' ? url : '', text, type: mode })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    currentTracks = data.tracks;
    statPlaylistTitle.textContent = `${data.title} (${data.author || 'Curator'})`;

    updateStatsFromTracks();
    renderTable();
    startBtn.disabled = false;
    appendLog(`✅ Loaded "${data.title}" with ${data.total} tracks (${data.duplicateCount} in Vault)`, 'success');

  } catch (err) {
    alert(`Failed to parse playlist: ${err.message}`);
    appendLog(`Parse failed: ${err.message}`, 'error');
  } finally {
    fetchBtn.disabled = false;
    fetchTextBtn.disabled = false;
    fetchBtn.querySelector('.spinner')?.classList.add('hidden');
  }
}

// ==========================================
// 🚀 ARCHIVE CONTROLS
// ==========================================
async function startArchiving() {
  if (!currentTracks.length) return;

  const skipDuplicates = skipDuplicatesToggle.checked;
  const concurrency = parseInt(concurrencySelect?.value, 10) || 15;
  isArchiving = true;
  isPaused = false;
  updateControlButtons();

  try {
    const res = await fetch('/api/archive/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracks: currentTracks, skipDuplicates, concurrency })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    appendLog(`🚀 Parallel ingestion started: ${concurrency} parallel workers for ${data.total} tracks!`, 'info');
  } catch (err) {
    alert(`Could not start archiver: ${err.message}`);
    isArchiving = false;
    updateControlButtons();
  }
}

async function togglePause() {
  if (!isArchiving) return;
  const endpoint = isPaused ? '/api/archive/resume' : '/api/archive/pause';
  await fetch(endpoint, { method: 'POST' });
}

async function stopArchiving() {
  if (!isArchiving) return;
  await fetch('/api/archive/stop', { method: 'POST' });
  isArchiving = false;
  updateControlButtons();
}

function updateControlButtons() {
  startBtn.disabled = isArchiving;
  pauseBtn.disabled = !isArchiving;
  stopBtn.disabled = !isArchiving;
}

// ==========================================
// 📊 STATS & PROGRESS
// ==========================================
function updateStatsFromTracks() {
  const skipDuplicates = skipDuplicatesToggle.checked;
  let total = currentTracks.length;
  let skipped = 0;
  let uploaded = 0;
  let failed = 0;

  for (const t of currentTracks) {
    if (t.status === 'in_vault' || t.status === 'skipped_vault') {
      if (skipDuplicates) skipped++;
    } else if (t.status === 'completed') {
      uploaded++;
    } else if (t.status === 'failed') {
      failed++;
    }
  }

  const ready = Math.max(0, total - skipped - uploaded - failed);

  statTotal.textContent = total;
  statReady.textContent = ready;
  statSkipped.textContent = skipped;
  statUploaded.textContent = uploaded;
  statFailed.textContent = failed;
  tableCountBadge.textContent = `${total} tracks`;
}

function updateProgress(current, total) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  progressBar.style.width = `${pct}%`;
  progressPercent.textContent = `${pct}%`;
  progressCount.textContent = `${current} / ${total} tracks`;
}

// ==========================================
// 🎨 TABLE RENDERING
// ==========================================
function renderTable() {
  const search = searchFilter.value.toLowerCase().trim();
  const filter = statusFilter.value;

  const filtered = currentTracks.filter(t => {
    // Search
    if (search) {
      const match = (t.title || '').toLowerCase().includes(search) || (t.artist || '').toLowerCase().includes(search);
      if (!match) return false;
    }
    // Filter
    if (filter === 'all') return true;
    if (filter === 'pending') return t.status === 'pending';
    if (filter === 'in_vault') return t.status === 'in_vault' || t.status === 'skipped_vault';
    if (filter === 'completed') return t.status === 'completed';
    if (filter === 'failed') return t.status === 'failed';
    return true;
  });

  if (!filtered.length) {
    tracksTbody.innerHTML = `
      <tr class="empty-row">
        <td colspan="6">
          <div class="empty-state">
            <div class="empty-text">No tracks matching current filter.</div>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tracksTbody.innerHTML = filtered.map(t => {
    const badge = getStatusBadge(t.status);
    const tgMsgId = t.telegram_message_id || t.vaultEntry?.telegram_message_id;
    const tgLink = tgMsgId
      ? `<a class="tg-link" href="https://t.me/c/4463400168/${tgMsgId}" target="_blank">💬 Msg #${tgMsgId}</a>`
      : `<span style="color:var(--text-muted);font-size:11px;">—</span>`;

    return `
      <tr>
        <td style="color:var(--text-muted);font-family:var(--font-mono);font-size:12px;">${t.index}</td>
        <td>
          <div class="track-info">
            <div class="title">${escapeHtml(t.title)}</div>
            <div class="artist">${escapeHtml(t.artist)}</div>
          </div>
        </td>
        <td><span class="source-tag">${t.source || 'web'}</span></td>
        <td style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted);">${t.duration || '0:00'}</td>
        <td>${badge}</td>
        <td>${tgLink}</td>
      </tr>
    `;
  }).join('');
}

function getStatusBadge(status) {
  switch (status) {
    case 'in_vault':
    case 'skipped_vault':
      return `<span class="badge badge-in_vault">📦 In Vault (Skipped)</span>`;
    case 'downloading':
      return `<span class="badge badge-downloading">⚡ Transcoding 96k...</span>`;
    case 'uploading':
      return `<span class="badge badge-uploading">☁️ Uploading...</span>`;
    case 'completed':
      return `<span class="badge badge-completed">✅ Saved to Telegram</span>`;
    case 'failed':
      return `<span class="badge badge-failed">❌ Error</span>`;
    case 'pending':
    default:
      return `<span class="badge badge-pending">⏳ Pending</span>`;
  }
}

// ==========================================
// 📦 VAULT & TELEGRAM METRICS
// ==========================================
async function fetchVaultInfo() {
  try {
    const res = await fetch('/api/vault');
    const data = await res.json();
    vaultCount.textContent = data.total || 0;
  } catch (_) {}
}

async function syncVault() {
  syncVaultBtn.disabled = true;
  syncVaultBtn.textContent = '🔄 Syncing...';
  try {
    const res = await fetch('/api/vault/sync', { method: 'POST' });
    const data = await res.json();
    appendLog(`Synced vault from Main Server: ${data.added || 0} tracks added (Total: ${data.total || 0})`, 'success');
    fetchVaultInfo();
  } catch (err) {
    appendLog(`Vault sync failed: ${err.message}`, 'error');
  } finally {
    syncVaultBtn.disabled = false;
    syncVaultBtn.textContent = '🔄 Sync Vault';
  }
}

async function checkTelegramHealth() {
  try {
    const res = await fetch('/api/telegram/health');
    const data = await res.json();
    if (data.ok && data.bot) {
      botName.textContent = `@${data.bot.username}`;
    }
  } catch (_) {}
}

// ==========================================
// 📝 LOGGING & HELPERS
// ==========================================
function appendLog(msg, level = 'info', ts = null) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  const timeStr = ts ? new Date(ts).toLocaleTimeString() : new Date().toLocaleTimeString();
  line.innerHTML = `<span class="timestamp">[${timeStr}]</span> ${escapeHtml(msg)}`;
  terminalBody.appendChild(line);
  terminalBody.scrollTop = terminalBody.scrollHeight;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

window.addEventListener('DOMContentLoaded', init);

