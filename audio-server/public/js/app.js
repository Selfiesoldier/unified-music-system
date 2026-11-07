let currentElapsedMs = 0;
let currentDurationMs = 0;
let progressInterval = null;
let eventSource = null;
let isRestarting = false;

const UI = {
  loginOverlay: document.getElementById('login-overlay'),
  dashboard: document.getElementById('dashboard'),
  loginForm: document.getElementById('login-form'),
  
  navLinks: document.querySelectorAll('.nav-links li'),
  views: document.querySelectorAll('.view'),
  
  npThumbnail: document.getElementById('np-thumbnail'),
  npTitle: document.getElementById('np-title'),
  npArtist: document.getElementById('np-artist'),
  timeCurrent: document.getElementById('time-current'),
  timeTotal: document.getElementById('time-total'),
  progressFill: document.getElementById('progress-fill'),
  
  queueCount: document.getElementById('queue-count'),
  queueList: document.getElementById('queue-list'),
  songUrlInput: document.getElementById('song-url'),
  
  volSlider: document.getElementById('volume-slider'),
  volLabel: document.getElementById('vol-label'),
  ttsToggle: document.getElementById('tts-toggle'),
  
  statListeners: document.getElementById('stat-listeners'),
  healthBadge: document.getElementById('health-badge'),
};

function formatTime(ms) {
  if (!ms || isNaN(ms)) return "0:00";
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${isError ? 'error' : ''}`;
  t.textContent = message;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideIn 0.3s ease-in reverse forwards';
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

async function fetchApi(endpoint, method = 'POST', body = null) {
  const token = localStorage.getItem('admin_token') || '';
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  try {
    const res = await fetch(endpoint, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : null
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && !isRestarting) {
        UI.loginOverlay.classList.add('active');
        UI.dashboard.classList.add('hidden');
        if (eventSource) {
          try { eventSource.close(); } catch (e) {}
          eventSource = null;
        }
      }
      throw new Error(data.error || data.message || `HTTP ${res.status}`);
    }
    return data;
  } catch (err) {
    toast(err.message, true);
    throw err;
  }
}

// ----------------------
// INITIALIZATION & AUTH
// ----------------------

UI.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pwd = document.getElementById('password').value.trim() || 'changeme';
  try {
    localStorage.setItem('admin_token', pwd);
    const data = await fetchApi('/api/login', 'POST', { password: pwd });
    if (data.token) localStorage.setItem('admin_token', data.token);
    UI.loginOverlay.classList.remove('active');
    UI.dashboard.classList.remove('hidden');
    startSSE();
    loadDashboardData();
  } catch (err) {
    localStorage.removeItem('admin_token');
  }
});

// Check if already authenticated via a quick API ping (supports localStorage token, defaults to 'changeme')
const existingToken = localStorage.getItem('admin_token') || 'changeme';
const pingHeaders = { 'Authorization': `Bearer ${existingToken}` };
fetch('/api/config', { headers: pingHeaders, credentials: 'include' })
  .then(res => {
    if (res.ok) {
      localStorage.setItem('admin_token', existingToken);
      UI.loginOverlay.classList.remove('active');
      UI.dashboard.classList.remove('hidden');
      startSSE();
      loadDashboardData();
    }
  }).catch(() => {});

function startSSE() {
  if (eventSource) return;
  const token = localStorage.getItem('admin_token') || '';
  const sseUrl = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  eventSource = new EventSource(sseUrl);
  
  eventSource.onmessage = (e) => {
    if (e.data === ':heartbeat') return; // ignore keepalive
    try {
      const state = JSON.parse(e.data);
      
      // Handle special event types
      if (state.type === 'chat') {
        appendLiveChat(state.user, state.message);
        return;
      }
      
      // Default: music dashboard state
      updateMusicDashboard(state);
    } catch (err) {
      console.error("Failed to parse SSE data", err);
    }
  };
  
  eventSource.onerror = () => {
    UI.healthBadge.textContent = "Connecting...";
    UI.healthBadge.className = "badge unhealthy";
    // EventSource auto-reconnects natively. If we were restarting, this is expected.
    if (isRestarting) {
      setTimeout(() => {
        window.location.reload();
      }, 5000);
    }
  };
}

// ----------------------
// NAVIGATION LOGIC
// ----------------------
UI.navLinks.forEach(link => {
  link.addEventListener('click', () => {
    UI.navLinks.forEach(l => l.classList.remove('active'));
    UI.views.forEach(v => v.classList.remove('active'));
    
    link.classList.add('active');
    document.getElementById(`view-${link.dataset.view}`).classList.add('active');
    
    if (link.dataset.view === 'moderation') {
      loadRoster();
      loadLocations();
    }
    if (link.dataset.view === 'analytics') loadAnalytics();
    if (link.dataset.view === 'playlists') loadPlaylists();
    if (link.dataset.view === 'wardrobe') loadOutfits();
    if (link.dataset.view === 'database') loadHistory();
    // Shop doesn't auto-load, user must search
  });
});

// ----------------------
// API FETCHERS
// ----------------------

async function loadDashboardData() {
  // Load Room Info
  fetch('/api/room-info').then(r => r.json()).then(info => {
    if (info && info.roomName) {
      document.title = `${info.roomName} | Audio Dashboard`;
      const brandElem = document.getElementById('brand-room-title');
      if (brandElem) {
        brandElem.innerHTML = `${info.roomName} <span>Live</span>`;
      }
    }
  }).catch(()=>{});

  // Load Config
  fetchApi('/api/config', 'GET').then(data => {
    document.getElementById('cfg-token-status').textContent = data.apiTokenSet ? 'Token is set' : 'Token is NOT set';
    document.getElementById('cfg-room-status').textContent = data.roomIdSet ? 'Room ID is set' : 'Room ID is NOT set';
  }).catch(()=>{});
  
  // Load Access
  fetchApi('/api/access', 'GET').then(data => {
    const adminList = document.getElementById('list-admins');
    const vipList = document.getElementById('list-vips');
    
    if (adminList) {
      adminList.innerHTML = `<li style="color:var(--primary)">${data.owner || 'None'} (Owner)</li>`;
      data.admins?.forEach(a => {
        adminList.innerHTML += `<li>${a} <button class="danger" style="padding: 2px 5px; font-size: 10px; margin-left: 10px;" onclick="removeAccess('admin', '${a}')">Revoke</button></li>`;
      });
      if(!data.admins?.length && !data.owner) adminList.innerHTML = `<li>No admins set</li>`;
    }
    
    if (vipList) {
      vipList.innerHTML = '';
      data.vips?.forEach(v => {
        vipList.innerHTML += `<li>${v} <button class="danger" style="padding: 2px 5px; font-size: 10px; margin-left: 10px;" onclick="removeAccess('vip', '${v}')">Revoke</button></li>`;
      });
      if(!data.vips?.length) vipList.innerHTML = `<li>No VIPs set</li>`;
    }
  }).catch(()=>{});

  // Load Economy
  loadEconomyData();
}



window.removeFromQueue = async function(index) {
  try {
    const res = await fetchApi(`/api/queue/${index}`, 'DELETE');
    toast(`Removed: ${res.removed}`);
  } catch (e) {}
};

async function loadHistory() {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="padding: 10px; color: #888;">Loading history...</td></tr>';
  
  try {
    const data = await fetchApi('/api/history', 'GET');
    if (!data.history || Object.keys(data.history).length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="padding: 10px; color: #888;">No history found.</td></tr>';
      return;
    }
    
    // Convert object to array and sort by last seen
    const historyArray = Object.entries(data.history).map(([id, stats]) => ({
      id, ...stats
    })).sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
    
    tbody.innerHTML = historyArray.map(user => {
      const firstSeen = new Date(user.first_seen).toLocaleString();
      const lastSeen = new Date(user.last_seen).toLocaleString();
      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 10px; font-weight: bold; color: var(--primary);">${user.username}</td>
          <td style="padding: 10px; font-size: 12px; color: #aaa;">${firstSeen}</td>
          <td style="padding: 10px; font-size: 12px; color: #aaa;">${lastSeen}</td>
          <td style="padding: 10px;">${user.joins || 1}</td>
          <td style="padding: 10px;">${user.messages_sent || 0}</td>
        </tr>
      `;
    }).join('');
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="5" style="padding: 10px; color: var(--danger);">Failed to load history</td></tr>';
  }
}

function appendLiveChat(username, message) {
  const container = document.getElementById('live-chat-messages');
  if (!container) return;
  
  const div = document.createElement('div');
  div.style.padding = "5px";
  div.style.background = "rgba(255,255,255,0.05)";
  div.style.borderRadius = "4px";
  
  const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
  div.innerHTML = `<span style="color:#888; font-size:10px;">[${time}]</span> <strong style="color:var(--primary);">${username}:</strong> <span style="word-break: break-word;">${message}</span>`;
  
  container.appendChild(div);
  
  // Keep max 50 messages
  while (container.children.length > 50) {
    container.removeChild(container.firstChild);
  }
  
  // Scroll to bottom
  container.scrollTop = container.scrollHeight;
}

async function loadAnalytics() {
  const btn = document.getElementById('btn-refresh-stats');
  if (btn) btn.textContent = "Loading...";
  try {
    const data = await fetchApi('/api/stats', 'GET');
    
    // Vitals
    document.getElementById('stat-uptime').textContent = data.diagnostics.uptime;
    document.getElementById('stat-cpu').textContent = data.diagnostics.cpu_usage ? data.diagnostics.cpu_usage + '%' : 'N/A';
    document.getElementById('stat-mem').textContent = data.diagnostics.memory_usage ? data.diagnostics.memory_usage + '%' : 'N/A';
    document.getElementById('stat-queue-len').textContent = data.diagnostics.queue_length;
    document.getElementById('stat-playlists-len').textContent = data.diagnostics.active_playlists;
    
    // BTM
    const btmList = document.getElementById('list-btm');
    btmList.innerHTML = '';
    data.btm.forEach(t => {
      const color = t.status === 'Running' ? '#0f0' : '#f00';
      btmList.innerHTML += `
        <li style="display: flex; justify-content: space-between; align-items: center;">
          <span>${t.name}</span>
          <div>
            <span style="color: #aaa; font-size: 11px; margin-right: 10px;">Crashes: ${t.crashes}</span>
            <span style="color: ${color};">${t.status}</span>
          </div>
        </li>
      `;
    });
  } catch(e) {}
  if (btn) btn.textContent = "Refresh Analytics";
}

async function loadPlaylists() {
  const grid = document.getElementById('playlists-grid');
  grid.innerHTML = '<div style="color: #888;">Loading playlists...</div>';
  try {
    const data = await fetchApi('/api/playlists', 'GET');
    if (!data.playlists || data.playlists.length === 0) {
      grid.innerHTML = '<div style="color: #888;">No playlists found. Create one in-game using !playlist create.</div>';
      return;
    }
    
    grid.innerHTML = data.playlists.map(p => `
      <div class="glass-card" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <h3 style="margin: 0; color: var(--primary);">${p.name}</h3>
          <p style="font-size: 12px; color: #aaa; margin: 5px 0;">Owner: ${p.owner}</p>
          <p style="font-size: 14px; margin-bottom: 15px;">${p.songCount} Songs</p>
        </div>
        <button class="primary" onclick="playPlaylist('${p.name}')" style="width: 100%;">Play Playlist</button>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color: var(--danger);">Failed to load playlists.</div>';
  }
}

window.playPlaylist = async function(name) {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: `playlist play ${name}` });
    toast(`Queued playlist: ${name}`);
  } catch(e) {}
};

async function loadOutfits() {
  const select = document.getElementById('outfit-select');
  try {
    const data = await fetchApi('/api/outfits', 'GET');
    if (!data.presets || data.presets.length === 0) {
      select.innerHTML = '<option value="">No presets found</option>';
      return;
    }
    
    select.innerHTML = '<option value="">-- Choose an outfit --</option>' + 
      data.presets.map(p => `<option value="${p}">${p}</option>`).join('');
  } catch(e) {
    select.innerHTML = '<option value="">Error loading presets</option>';
  }
}

document.getElementById('btn-refresh-stats')?.addEventListener('click', loadAnalytics);

document.getElementById('btn-wear-outfit')?.addEventListener('click', async () => {
  const select = document.getElementById('outfit-select');
  const preset = select.value;
  if (!preset) return;
  try {
    await fetchApi('/api/bot-command', 'POST', { command: `outfit ${preset}` });
    toast(`Outfit applied: ${preset}`);
  } catch(e) {}
});

async function loadEconomyData() {
  fetchApi('/api/economy', 'GET').then(data => {
    const list = document.getElementById('economy-list');
    list.innerHTML = '';
    const balances = data.balances || {};
    const entries = Object.entries(balances).sort((a,b) => b[1] - a[1]);
    
    if (entries.length === 0) {
      list.innerHTML = '<div class="roster-item">No economy data found.</div>';
      return;
    }
    
    entries.forEach(([user, points]) => {
      list.innerHTML += `
        <div class="roster-item" style="cursor: pointer;" onclick="document.getElementById('economy-target').value = '${user}'">
          <strong>${user}</strong>
          <span class="id">${points} pts</span>
        </div>
      `;
    });
  }).catch(()=>{});
}

// Global scope for onclicks
window.removeAccess = async function(role, username) {
  if (confirm(`Remove ${role} privileges from ${username}?`)) {
    try {
      await fetchApi('/api/access', 'POST', { action: 'remove', role, username });
      toast(`Revoked ${role} from ${username}`);
      loadDashboardData();
    } catch(e) {}
  }
};

async function loadRoster() {
  const list = document.getElementById('roster-list');
  list.innerHTML = 'Loading...';
  try {
    const data = await fetchApi('/api/roster', 'GET');
    if (!data.users || data.users.length === 0) {
      list.innerHTML = '<div class="roster-item">Room is empty or bot not fully joined.</div>';
      return;
    }
    list.innerHTML = data.users.map(u => `
      <div class="roster-item">
        <strong>${u.username}</strong>
        <span class="id">${u.id}</span>
      </div>
    `).join('');
  } catch (e) {
    list.innerHTML = '<div class="roster-item" style="color:var(--danger)">Failed to load roster (Is bot running?)</div>';
  }
}
document.getElementById('btn-refresh-roster').onclick = loadRoster;

async function loadLocations() {
  const container = document.getElementById('locations-list');
  try {
    const data = await fetchApi('/api/locations', 'GET');
    if (!data.locations || data.locations.length === 0) {
      container.innerHTML = '<span style="color: #888;">No saved locations. Save one in-game using !savepos &lt;name&gt;</span>';
      return;
    }
    
    container.innerHTML = data.locations.map(loc => `
      <button class="secondary" onclick="teleportToLocation('${loc.name}')">${loc.name}</button>
    `).join('');
  } catch(e) {
    container.innerHTML = '<span style="color: var(--danger);">Failed to load locations</span>';
  }
}

window.teleportToLocation = async function(name) {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: `goto ${name}` });
    toast(`Teleporting to ${name}`);
  } catch(e) {}
};

// Quick Actions
document.getElementById('btn-come')?.addEventListener('click', async () => {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: 'setmusicbot me' });
    toast('Command dispatched: come to me');
  } catch(e) {}
});

document.getElementById('btn-follow')?.addEventListener('click', async () => {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: 'follow' });
    toast('Command dispatched: follow');
  } catch(e) {}
});

document.getElementById('btn-stop-follow')?.addEventListener('click', async () => {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: 'stop' });
    toast('Command dispatched: stop');
  } catch(e) {}
});

// Emotes
window.sendEmote = async function(emoteId) {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: `emote ${emoteId}` });
    toast(`Triggered emote: ${emoteId}`);
  } catch(e) {}
};

// Shop Logic
document.getElementById('btn-search-shop')?.addEventListener('click', async () => {
  const query = document.getElementById('shop-search-input').value;
  const grid = document.getElementById('shop-results-grid');
  
  if (!query) return;
  grid.innerHTML = '<div style="color: #888;">Searching catalog...</div>';
  
  try {
    const data = await fetchApi(`/api/shop?q=${encodeURIComponent(query)}`, 'GET');
    if (!data.results || data.results.length === 0) {
      grid.innerHTML = '<div style="color: #888;">No items found.</div>';
      return;
    }
    
    grid.innerHTML = data.results.map(item => `
      <div class="glass-card" style="display: flex; flex-direction: column; align-items: center; text-align: center;">
        <h4 style="margin: 0; color: var(--primary); font-size: 14px;">${item.item_name}</h4>
        <p style="font-size: 12px; color: #aaa; margin: 5px 0;">ID: ${item.item_id}</p>
        <button class="primary" onclick="buyItem('${item.item_id}')" style="margin-top: 10px; width: 100%;">Buy Item</button>
      </div>
    `).join('');
  } catch(e) {
    grid.innerHTML = '<div style="color: var(--danger);">Failed to search shop.</div>';
  }
});

window.buyItem = async function(itemId) {
  try {
    await fetchApi('/api/bot-command', 'POST', { command: `buy ${itemId}` });
    toast(`Purchase initiated for ${itemId}. Check terminal/bot for confirmation.`);
  } catch(e) {}
};


// ----------------------
// MODERATION ACTIONS
// ----------------------

document.getElementById('btn-announce').onclick = async () => {
  const msg = document.getElementById('announce-msg').value.trim();
  if (!msg) return;
  try {
    await fetchApi('/api/bot-command', 'POST', { command: 'say', message: msg });
    document.getElementById('announce-msg').value = '';
    toast("Announcement sent!");
  } catch(e) {}
};

document.getElementById('btn-kick').onclick = async () => {
  const target = document.getElementById('mod-target').value.trim();
  if (!target) return;
  
  if (confirm(`Are you sure you want to KICK ${target} from the room?`)) {
    try {
      await fetchApi('/api/bot-command', 'POST', { command: 'kick', userId: target });
      document.getElementById('mod-target').value = '';
      toast(`User ${target} kicked.`);
      setTimeout(loadRoster, 2000);
    } catch(e) {}
  }
};

document.getElementById('btn-teleport').onclick = async () => {
  const target = document.getElementById('mod-target').value.trim();
  const x = document.getElementById('mod-x').value;
  const y = document.getElementById('mod-y').value;
  const z = document.getElementById('mod-z').value;
  
  if (!target) return;
  try {
    await fetchApi('/api/bot-command', 'POST', { 
      command: 'teleport', 
      userId: target,
      x: x || 0, y: y || 0, z: z || 0
    });
    toast(`User ${target} teleported.`);
  } catch(e) {}
};

// ----------------------
// CONFIG & RESTART
// ----------------------

document.getElementById('btn-save-config').onclick = async () => {
  const token = document.getElementById('cfg-token').value.trim();
  const room = document.getElementById('cfg-room').value.trim();
  
  if (!token && !room) {
    toast("No changes to save.");
    return;
  }
  
  try {
    await fetchApi('/api/config', 'POST', { API_TOKEN: token, ROOM_ID: room });
    document.getElementById('cfg-token').value = '';
    document.getElementById('cfg-room').value = '';
    toast("Config updated! Click Restart Stack to apply.");
    loadDashboardData();
  } catch(e) {}
};

let restartClicks = 0;
document.getElementById('btn-restart').onclick = async (e) => {
  if (restartClicks === 0) {
    e.target.textContent = "Are you sure? Click again.";
    e.target.style.background = "#991b1b";
    restartClicks++;
    setTimeout(() => {
      restartClicks = 0;
      e.target.textContent = "Restart Stack";
      e.target.style.background = "var(--danger)";
    }, 4000);
    return;
  }
  
  try {
    isRestarting = true;
    UI.healthBadge.textContent = "RESTARTING...";
    UI.healthBadge.className = "badge unhealthy";
    e.target.textContent = "Restarting...";
    e.target.disabled = true;
    toast("Restarting stack! Please wait...");
    await fetchApi('/api/restart', 'POST');
  } catch(e) {
    if(isRestarting) {
      toast("Restart initiated, waiting for reconnect...");
    }
  }
};


// ----------------------
// NEW FEATURE BINDINGS
// ----------------------

// Access Control
document.getElementById('btn-add-admin').onclick = async () => {
  const username = document.getElementById('add-admin-input').value.trim();
  if(!username) return;
  try {
    await fetchApi('/api/access', 'POST', { action: 'add', role: 'admin', username });
    document.getElementById('add-admin-input').value = '';
    toast(`Added ${username} as Admin`);
    loadDashboardData();
  } catch(e) {}
};

document.getElementById('btn-add-vip').onclick = async () => {
  const username = document.getElementById('add-vip-input').value.trim();
  if(!username) return;
  try {
    await fetchApi('/api/access', 'POST', { action: 'add', role: 'vip', username });
    document.getElementById('add-vip-input').value = '';
    toast(`Added ${username} as VIP`);
    loadDashboardData();
  } catch(e) {}
};

// Terminal
document.getElementById('btn-terminal-send').onclick = async () => {
  const input = document.getElementById('terminal-input');
  const command = input.value.trim();
  if(!command) return;
  
  const output = document.getElementById('terminal-output');
  output.innerHTML += `\n<span style="color: #fff">> ${command}</span>`;
  input.value = '';
  
  try {
    await fetchApi('/api/terminal', 'POST', { command });
    output.innerHTML += `\n<span style="color: #aaa">[Command dispatched to Bot Process. Bot responses will appear in-game]</span>`;
    output.scrollTop = output.scrollHeight;
  } catch(e) {
    output.innerHTML += `\n<span style="color: var(--danger)">[Error: ${e.message}]</span>`;
  }
};
document.getElementById('terminal-input').addEventListener('keypress', function (e) {
    if (e.key === 'Enter') document.getElementById('btn-terminal-send').click();
});

// Economy
document.getElementById('btn-eco-add').onclick = async () => {
  const user = document.getElementById('economy-target').value.trim();
  const amt = document.getElementById('economy-amount').value;
  if(!user || !amt) return;
  try {
    const res = await fetchApi('/api/economy', 'POST', { action: 'add', username: user, amount: parseInt(amt) });
    toast(`Added points. New balance: ${res.new_balance}`);
    loadEconomyData();
  } catch(e) {}
};

document.getElementById('btn-eco-set').onclick = async () => {
  const user = document.getElementById('economy-target').value.trim();
  const amt = document.getElementById('economy-amount').value;
  if(!user || !amt) return;
  try {
    const res = await fetchApi('/api/economy', 'POST', { action: 'set', username: user, amount: parseInt(amt) });
    toast(`Set points. New balance: ${res.new_balance}`);
    loadEconomyData();
  } catch(e) {}
};

document.getElementById('btn-eco-reset').onclick = async () => {
  const user = document.getElementById('economy-target').value.trim();
  if(!user) return;
  if(confirm(`Are you sure you want to reset ${user}'s points to 0?`)) {
    try {
      await fetchApi('/api/economy', 'POST', { action: 'reset', username: user });
      toast(`Points reset for ${user}`);
      loadEconomyData();
    } catch(e) {}
  }
};

// Music Mode
document.getElementById('btn-save-mode')?.addEventListener('click', async () => {
  const mode = document.getElementById('mode-select').value;
  try {
    await fetchApi('/api/mode', 'POST', { mode });
    toast(`Music mode updated to ${mode}`);
  } catch(e) {}
});

// ----------------------
// MUSIC CONTROLS
// ----------------------

document.getElementById('btn-skip').onclick = async () => {
  try {
    const res = await fetchApi('/next');
    toast(`Skipped: ${res.skippedTitle}`);
  } catch (e) {}
};

document.getElementById('btn-stop').onclick = async () => {
  try {
    await fetchApi('/stop');
    toast("Playback stopped.");
  } catch (e) {}
};

document.getElementById('btn-queue').onclick = async () => {
  const url = UI.songUrlInput.value.trim();
  if (!url) return;
  UI.songUrlInput.value = '';
  try {
    const res = await fetchApi('/play', 'POST', { url });
    toast(`Queued: ${res.queuedTitle || 'Song'}`);
  } catch (e) {}
};

document.getElementById('btn-insert').onclick = async () => {
  const url = UI.songUrlInput.value.trim();
  if (!url) return;
  UI.songUrlInput.value = '';
  try {
    const res = await fetchApi('/insert', 'POST', { url });
    toast(`Inserted Next: ${res.insertedTitle || 'Song'}`);
  } catch (e) {}
};

UI.volSlider.onchange = async (e) => {
  const level = e.target.value;
  UI.volLabel.textContent = `${level}%`;
  try {
    await fetchApi('/volume', 'POST', { level });
  } catch (e) {}
};
UI.volSlider.oninput = (e) => {
  UI.volLabel.textContent = `${e.target.value}%`;
};

UI.ttsToggle.onchange = async (e) => {
  const enabled = e.target.checked;
  try {
    await fetchApi('/announcements', 'POST', { enabled });
    toast(enabled ? "Announcements Enabled" : "Announcements Disabled");
  } catch (err) {
    e.target.checked = !enabled;
  }
};

// ----------------------
// PROGRESS BAR & STATE
// ----------------------

function startProgressLoop() {
  if (progressInterval) clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    if (currentDurationMs > 0 && currentElapsedMs < currentDurationMs) {
      currentElapsedMs += 1000;
      updateProgressBar();
    }
  }, 1000);
}

function updateProgressBar() {
  UI.timeCurrent.textContent = formatTime(currentElapsedMs);
  if (currentDurationMs > 0) {
    const pct = Math.min((currentElapsedMs / currentDurationMs) * 100, 100);
    UI.progressFill.style.width = `${pct}%`;
  } else {
    UI.progressFill.style.width = `0%`;
  }
}

function updateMusicDashboard(state) {
  if (isRestarting) return;
  
  // Now Playing
  if ((state.isPlaying || state.isTransitioning) && state.currentMetadata) {
    UI.npTitle.textContent = state.isTransitioning && !state.isPlaying
      ? `⏳ ${state.currentTitle}`
      : state.currentTitle;
    UI.npArtist.textContent = state.currentMetadata.artist || 'Unknown';
    UI.npThumbnail.src = state.currentMetadata.thumbnail || '';
    
    currentElapsedMs = state.serverElapsed || 0;
    currentDurationMs = (state.currentMetadata.durationSeconds || 0) * 1000;
    UI.timeTotal.textContent = state.currentMetadata.duration || "0:00";
    
    if (state.isPlaying) {
      startProgressLoop();
    } else {
      if (progressInterval) clearInterval(progressInterval);
    }
    updateProgressBar();
  } else {
    UI.npTitle.textContent = "No music playing";
    UI.npArtist.textContent = "-";
    UI.npThumbnail.src = "";
    currentElapsedMs = 0;
    currentDurationMs = 0;
    UI.timeCurrent.textContent = "0:00";
    UI.timeTotal.textContent = "0:00";
    UI.progressFill.style.width = "0%";
    if (progressInterval) clearInterval(progressInterval);
  }

  // Settings
  if (document.activeElement !== UI.volSlider) {
    UI.volSlider.value = state.volume;
    UI.volLabel.textContent = `${state.volume}%`;
  }
  UI.ttsToggle.checked = state.announcementsEnabled;

  // Queue
  const qLen = state.queue ? state.queue.length : 0;
  UI.queueCount.textContent = `${qLen} songs`;
  document.getElementById('queue-count').textContent = qLen;
  
  if (state.queue) {
    UI.queueList.innerHTML = state.queue.map((item, idx) => `
      <div class="q-item">
        <div class="q-pos">${idx + 1}</div>
        <img src="${item.metadata?.thumbnail || ''}" class="q-thumb" alt="thumb">
        <div class="q-info">
          <div class="q-title">${item.metadata?.title || 'Unknown Track'}</div>
          <div class="q-artist">${item.metadata?.artist || 'Unknown'}</div>
        </div>
      </div>
    `).join('');
  }

  // Stats & Health
  if (state.stats) {
    UI.statListeners.textContent = state.stats.activeListeners;
  }
  
  if (state.health) {
    if (state.health.encoderAlive) {
      UI.healthBadge.textContent = "ONLINE & HEALTHY";
      UI.healthBadge.className = "badge";
    } else {
      UI.healthBadge.textContent = "ENCODER DOWN";
      UI.healthBadge.className = "badge unhealthy";
    }
  }
}

// ==========================================
// 📁 DIRECT MP3 FILE UPLOAD & DROPZONE
// ==========================================
let selectedMp3File = null;
const mp3FileInput = document.getElementById('mp3-file-input');
const uploadMp3Card = document.getElementById('upload-mp3-card');
const uploadIdleState = document.getElementById('upload-idle-state');
const uploadReadyState = document.getElementById('upload-ready-state');
const btnChooseFile = document.getElementById('btn-choose-file');
const btnUploadDirect = document.getElementById('btn-upload-direct');
const selectedFileName = document.getElementById('selected-file-name');
const selectedFileSize = document.getElementById('selected-file-size');
const btnUploadNext = document.getElementById('btn-upload-next');
const btnUploadLast = document.getElementById('btn-upload-last');
const btnUploadCancel = document.getElementById('btn-upload-cancel');

function openMp3Picker() {
  if (mp3FileInput) mp3FileInput.click();
}

if (btnUploadDirect) {
  btnUploadDirect.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMp3Picker();
  };
}

if (btnChooseFile) {
  btnChooseFile.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openMp3Picker();
  };
}

if (uploadIdleState) {
  uploadIdleState.onclick = (e) => {
    if (e.target.closest('#btn-choose-file')) return;
    openMp3Picker();
  };
}

if (uploadMp3Card) {
  uploadMp3Card.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadMp3Card.classList.add('dragover');
  });

  uploadMp3Card.addEventListener('dragleave', () => {
    uploadMp3Card.classList.remove('dragover');
  });

  uploadMp3Card.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadMp3Card.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectedMp3(e.dataTransfer.files[0]);
    }
  });
}

if (mp3FileInput) {
  mp3FileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleSelectedMp3(e.target.files[0]);
    }
  });
}

function handleSelectedMp3(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.mp3') && !file.type.includes('mpeg') && !file.type.includes('mp3')) {
    toast('⚠️ Please select a valid .mp3 file', true);
    return;
  }
  selectedMp3File = file;
  if (selectedFileName) selectedFileName.textContent = file.name;
  if (selectedFileSize) selectedFileSize.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} MB)`;

  if (uploadIdleState) uploadIdleState.style.display = 'none';
  if (uploadReadyState) uploadReadyState.style.display = 'flex';
}

function resetMp3Upload() {
  selectedMp3File = null;
  if (mp3FileInput) mp3FileInput.value = '';
  if (uploadIdleState) uploadIdleState.style.display = 'flex';
  if (uploadReadyState) uploadReadyState.style.display = 'none';
}

if (btnUploadCancel) {
  btnUploadCancel.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    resetMp3Upload();
  };
}

if (btnUploadNext) {
  btnUploadNext.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedMp3File) uploadMp3Binary(selectedMp3File, 'next');
  };
}

if (btnUploadLast) {
  btnUploadLast.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (selectedMp3File) uploadMp3Binary(selectedMp3File, 'last');
  };
}

function uploadMp3Binary(file, position) {
  const cleanTitle = file.name.replace(/\.[^/.]+$/, '').trim();
  const progressBar = document.getElementById('upload-progress-bar');
  const progressFill = document.getElementById('upload-progress-fill');
  const progressText = document.getElementById('upload-progress-text');

  if (progressBar) progressBar.classList.remove('hidden');
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = `Uploading ${file.name}... 0%`;

  const token = localStorage.getItem('admin_token') || '';
  const xhr = new XMLHttpRequest();
  const uploadUrl = `/api/upload-mp3?position=${position}&title=${encodeURIComponent(cleanTitle)}`;
  
  xhr.open('POST', uploadUrl, true);
  xhr.setRequestHeader('Content-Type', 'audio/mpeg');
  if (token) {
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  }

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      if (progressText) progressText.textContent = `Uploading ${file.name}... ${pct}%`;
    }
  };

  xhr.onload = () => {
    if (progressBar) progressBar.classList.add('hidden');
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const resp = JSON.parse(xhr.responseText);
        const actionLabel = position === 'next' ? 'Plays next when song ends (0s gap)' : 'Queued at end';
        toast(`✅ "${resp.title || cleanTitle}" uploaded! ${actionLabel}`);
      } catch (_) {
        toast(`✅ "${cleanTitle}" uploaded!`);
      }
      resetMp3Upload();
    } else {
      let errMsg = 'Upload failed';
      try {
        const errJson = JSON.parse(xhr.responseText);
        errMsg = errJson.error || errMsg;
      } catch (_) {}
      toast(`❌ ${errMsg}`, true);
    }
  };

  xhr.onerror = () => {
    if (progressBar) progressBar.classList.add('hidden');
    toast('❌ Network error uploading MP3', true);
  };

  xhr.send(file);
}
