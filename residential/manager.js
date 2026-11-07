import { spawn, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '8888', 10);
const MAIN_SERVER_URL = (process.env.MAIN_SERVER_URL || process.env.BOT_SERVER_URL || '').replace(/\/+$/, '');

function getCloudflaredPath() {
  if (process.platform === 'win32') {
    const winExe = path.join(__dirname, 'cloudflared.exe');
    return fs.existsSync(winExe) ? winExe : 'cloudflared.exe';
  }
  try {
    execSync('which cloudflared', { stdio: 'ignore' });
    return 'cloudflared';
  } catch (_) {}

  const localBin = path.join(__dirname, 'cloudflared');
  if (fs.existsSync(localBin)) return localBin;

  return 'cloudflared';
}

const CLOUDFLARED_PATH = getCloudflaredPath();
const BRIDGE_SCRIPT = path.join(__dirname, 'server.js');

console.log('🚀 Starting Residential Audio Bridge & Cloudflare Tunnel...');
console.log(`📍 Using cloudflared: ${CLOUDFLARED_PATH}`);

// 1. Start the local bridge HTTP server
const bridgeProcess = spawn('node', [BRIDGE_SCRIPT], {
  cwd: __dirname,
  stdio: 'inherit'
});

let registered = false;
let currentTunnelUrl = null;
let cfProcess = null;
let isShuttingDown = false;

function registerWithMainServer(tunnelUrl) {
  if (currentTunnelUrl === tunnelUrl && registered) return;
  currentTunnelUrl = tunnelUrl;
  console.log(`\n======================================================`);
  console.log(`🎉 Cloudflare Tunnel Established/Updated: ${tunnelUrl}`);
  if (MAIN_SERVER_URL) {
    console.log(`📡 Registering bridge URL with Main Server (${MAIN_SERVER_URL})...`);
  }
  console.log(`======================================================\n`);

  if (!MAIN_SERVER_URL) return;

  fetch(`${MAIN_SERVER_URL}/api/register-bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: tunnelUrl })
  })
    .then(r => r.json())
    .then(data => {
      registered = true;
      console.log(`✅ Bridge successfully registered with Main Server:`, data);
    })
    .catch(err => {
      console.warn(`⚠️ Failed to register bridge automatically: ${err.message}`);
    });
}

// Keep-alive heartbeat every 60s
setInterval(() => {
  if (currentTunnelUrl && MAIN_SERVER_URL) {
    fetch(`${MAIN_SERVER_URL}/api/register-bridge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: currentTunnelUrl })
    }).catch(() => {});
  }
}, 60000);

function handleOutput(data) {
  const text = data.toString();
  process.stdout.write(text);

  const match = text.match(/https:\/\/([a-zA-Z0-9-]+)\.trycloudflare\.com/);
  if (match && match[1] !== 'api') {
    const detectedUrl = match[0];
    if (detectedUrl !== currentTunnelUrl) {
      registerWithMainServer(detectedUrl);
    }
  }
}

// 2. Start Cloudflare Tunnel with auto-respawn supervisor
function startCloudflared() {
  if (isShuttingDown) return;
  console.log('🔄 Spawning Cloudflare Tunnel process...');
  cfProcess = spawn(CLOUDFLARED_PATH, ['tunnel', '--edge-ip-version', '4', '--url', `http://127.0.0.1:${PORT}`], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  cfProcess.stdout.on('data', handleOutput);
  cfProcess.stderr.on('data', handleOutput);

  cfProcess.on('exit', (code, signal) => {
    if (isShuttingDown) return;
    console.warn(`⚠️ Cloudflare tunnel exited (code: ${code}, signal: ${signal}). Reconnecting in 5 seconds...`);
    registered = false;
    currentTunnelUrl = null;
    setTimeout(startCloudflared, 5000);
  });
}

startCloudflared();

process.on('SIGINT', () => {
  isShuttingDown = true;
  try { bridgeProcess.kill(); } catch (_) {}
  try { if (cfProcess) cfProcess.kill(); } catch (_) {}
  process.exit(0);
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  try { bridgeProcess.kill(); } catch (_) {}
  try { if (cfProcess) cfProcess.kill(); } catch (_) {}
  process.exit(0);
});
