try {
  await import('dotenv/config');
} catch (_) {}
import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target bot servers (default to active Main Controller on Node DE-05)
const rawBotUrls = process.env.BOT_SERVER_URLS || process.env.BOT_SERVER_URL || process.env.RENDER_BOT_URL || 'http://2.56.246.119:30195';
const BOT_SERVER_URLS = rawBotUrls.split(',').map(u => u.trim()).filter(Boolean);

function getCloudflaredPath() {
  if (process.platform === 'win32') {
    return path.join(__dirname, 'cloudflared.exe');
  }
  // Check system PATH first (e.g. native Termux package)
  try {
    execSync('which cloudflared', { stdio: 'ignore' });
    return 'cloudflared';
  } catch (_) {}
  
  if (fs.existsSync(path.join(__dirname, 'cloudflared'))) {
    return path.join(__dirname, 'cloudflared');
  }
  return 'cloudflared';
}

const CLOUDFLARED_PATH = getCloudflaredPath();
const BRIDGE_SCRIPT = path.join(__dirname, 'server.js');

console.log('======================================================');
console.log('🚀 Starting Residential Audio Bridge & Cloudflare Tunnel');
console.log(`📍 Using cloudflared: ${CLOUDFLARED_PATH}`);
console.log(`🎯 Registered Controllers: ${BOT_SERVER_URLS.join(', ')}`);
console.log('======================================================\n');

// 1. Start the local bridge HTTP server
const bridgeProcess = spawn('node', [BRIDGE_SCRIPT], {
  cwd: __dirname,
  stdio: 'inherit'
});

let currentTunnelUrl = null;
let cfProcess = null;
let isShuttingDown = false;
let isRecycling = false;
let failedProbeCount = 0;
let isInternetDown = false;

const bridgeName = process.env.BRIDGE_NAME || (process.platform === 'win32' ? 'Home PC' : 'Termux Phone');

function registerWithControllers(tunnelUrl) {
  currentTunnelUrl = tunnelUrl;
  failedProbeCount = 0;
  console.log(`\n======================================================`);
  console.log(`🎉 Cloudflare Tunnel Established: ${tunnelUrl}`);
  console.log(`📡 Registering bridge "${bridgeName}" with ${BOT_SERVER_URLS.length} controller(s)...`);
  console.log(`======================================================\n`);

  BOT_SERVER_URLS.forEach(botUrl => {
    const regHeaders = { 'Content-Type': 'application/json' };
    if (process.env.BRIDGE_SECRET) regHeaders['Authorization'] = 'Bearer ' + process.env.BRIDGE_SECRET;
    fetch(`${botUrl}/api/register-bridge`, {
      method: 'POST',
      headers: regHeaders,
      body: JSON.stringify({ url: tunnelUrl, name: bridgeName })
    })
      .then(r => r.json())
      .then(data => {
        console.log(`✅ Bridge successfully registered with [${botUrl}]:`, data);
      })
      .catch(err => {
        console.warn(`⚠️ Failed to register bridge with [${botUrl}]: ${err.message}`);
      });
  });
}

// Keep-alive heartbeat every 30s to all controller servers
setInterval(() => {
  if (currentTunnelUrl && !isShuttingDown && !isRecycling) {
    BOT_SERVER_URLS.forEach(botUrl => {
      const hbHeaders = { 'Content-Type': 'application/json' };
      if (process.env.BRIDGE_SECRET) hbHeaders['Authorization'] = 'Bearer ' + process.env.BRIDGE_SECRET;
      fetch(`${botUrl}/api/register-bridge`, {
        method: 'POST',
        headers: hbHeaders,
        body: JSON.stringify({ url: currentTunnelUrl, name: bridgeName })
      }).catch(() => {});
    });
  }
}, 30000);

function startTunnel() {
  if (isShuttingDown) return;
  isRecycling = false;

  console.log('📡 Requesting Cloudflare Quick Tunnel (http2/IPv4)...');

  const cfArgs = [
    'tunnel',
    '--protocol', 'http2',
    '--edge-ip-version', '4',
    '--url', 'http://127.0.0.1:8888'
  ];

  cfProcess = spawn(CLOUDFLARED_PATH, cfArgs, {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  function handleOutput(data) {
    const text = data.toString();
    process.stdout.write(text);

    // Match https://[subdomain].trycloudflare.com (exclude api.trycloudflare.com)
    const match = text.match(/https:\/\/([a-zA-Z0-9-]+)\.trycloudflare\.com/);
    if (match && match[1] !== 'api') {
      const detectedUrl = match[0];
      if (detectedUrl !== currentTunnelUrl) {
        registerWithControllers(detectedUrl);
      }
    }
  }

  cfProcess.stdout.on('data', handleOutput);
  cfProcess.stderr.on('data', handleOutput);

  cfProcess.on('error', (err) => {
    console.error(`❌ Failed to start cloudflared (${CLOUDFLARED_PATH}): ${err.message}`);
  });

  cfProcess.on('close', (code) => {
    if (isShuttingDown || isRecycling) return;
    console.log(`⚠️ Cloudflare tunnel process exited (code ${code}). Reconnecting in 3 seconds...`);
    currentTunnelUrl = null;
    setTimeout(startTunnel, 3000);
  });
}

function restartCloudflaredTunnel(reason = 'watchdog trigger') {
  if (isRecycling || isShuttingDown) return;
  isRecycling = true;
  currentTunnelUrl = null;

  console.warn(`\n🔄 [TunnelWatchdog] Restarting cloudflared tunnel (${reason})...`);
  if (cfProcess) {
    try { cfProcess.kill('SIGKILL'); } catch (_) {}
    cfProcess = null;
  }

  setTimeout(() => {
    startTunnel();
  }, 2500);
}

// 🛡️ SELF-HEALING INTERNET & TUNNEL WATCHDOG (Every 15 Seconds)
// =============================================================
async function checkInternetConnectivity() {
  try {
    const res = await fetch('https://1.1.1.1', { signal: AbortSignal.timeout(4000) });
    return res.ok || res.status > 0;
  } catch (_) {
    return false;
  }
}

async function runWatchdog() {
  if (isShuttingDown || isRecycling) return;

  const hasInternet = await checkInternetConnectivity();

  if (!hasInternet) {
    if (!isInternetDown) {
      isInternetDown = true;
      console.warn('⚠️ [Watchdog] Internet connectivity lost. Pausing tunnel checks until network returns...');
    }
    return;
  }

  // Network just returned after an outage
  if (isInternetDown) {
    isInternetDown = false;
    console.log('🌐 [Watchdog] Internet connection restored! Probing Cloudflare tunnel health...');
  }

  // If tunnel is not running yet, nothing to probe
  if (!currentTunnelUrl) return;

  // Probe the public tunnel endpoint from the outside world
  try {
    const probeRes = await fetch(`${currentTunnelUrl}/health`, { signal: AbortSignal.timeout(8000) });
    if (probeRes.ok) {
      failedProbeCount = 0;
      return; // Tunnel is 100% alive and routing traffic!
    } else {
      failedProbeCount++;
      console.warn(`⚠️ [Watchdog] Public tunnel probe returned HTTP ${probeRes.status} (${failedProbeCount}/2)`);
    }
  } catch (err) {
    failedProbeCount++;
    console.warn(`⚠️ [Watchdog] Public tunnel probe failed: ${err.message} (${failedProbeCount}/2)`);
  }

  // If 2 probes fail while general internet is definitely online -> Cloudflare tunnel session is dead
  if (failedProbeCount >= 2) {
    console.error('❌ [Watchdog] Cloudflare quick tunnel is dead/unroutable after network blip.');
    failedProbeCount = 0;
    restartCloudflaredTunnel('Public tunnel probe failed 2 consecutive times');
  }
}

// Start watchdog loop
setInterval(runWatchdog, 15000);

// Start initial tunnel
startTunnel();

bridgeProcess.on('close', (code) => {
  if (isShuttingDown) return;
  console.log(`Bridge server exited with code ${code}`);
  isShuttingDown = true;
  if (cfProcess) cfProcess.kill('SIGKILL');
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  console.log('\nStopping Residential Bridge...');
  isShuttingDown = true;
  if (bridgeProcess) bridgeProcess.kill();
  if (cfProcess) cfProcess.kill('SIGKILL');
  process.exit(0);
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  if (bridgeProcess) bridgeProcess.kill();
  if (cfProcess) cfProcess.kill('SIGKILL');
  process.exit(0);
});
