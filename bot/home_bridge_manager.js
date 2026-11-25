import { spawn, execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import fs from 'fs';

const RENDER_BOT_URL = process.env.BOT_SERVER_URL || process.env.RENDER_BOT_URL || 'http://92.118.206.166:30139';

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
const BRIDGE_SCRIPT = path.join(__dirname, 'residential_bridge.js');

console.log('🚀 Starting Residential Audio Bridge & Cloudflare Tunnel...');
console.log(`📍 Using cloudflared: ${CLOUDFLARED_PATH}`);

// 1. Start the local bridge HTTP server
const bridgeProcess = spawn('node', [BRIDGE_SCRIPT], {
  cwd: __dirname,
  stdio: 'inherit'
});

// 2. Start Cloudflare Tunnel pointing to local port 8888 (force IPv4 edge to avoid Termux IPv6 DNS issues)
const cfProcess = spawn(CLOUDFLARED_PATH, ['tunnel', '--edge-ip-version', '4', '--url', 'http://127.0.0.1:8888'], {
  cwd: __dirname,
  stdio: ['ignore', 'pipe', 'pipe']
});

let registered = false;
let currentTunnelUrl = null;

function registerWithRender(tunnelUrl) {
  currentTunnelUrl = tunnelUrl;
  if (!registered) {
    console.log(`\n======================================================`);
    console.log(`🎉 Cloudflare Tunnel Established: ${tunnelUrl}`);
    console.log(`📡 Registering bridge URL with Render bot (${RENDER_BOT_URL})...`);
    console.log(`======================================================\n`);
  }

  const regHeaders = { 'Content-Type': 'application/json' };
  if (process.env.BRIDGE_SECRET) regHeaders['Authorization'] = 'Bearer ' + process.env.BRIDGE_SECRET;
  fetch(`${RENDER_BOT_URL}/api/register-bridge`, {
    method: 'POST',
    headers: regHeaders,
    body: JSON.stringify({ url: tunnelUrl })
  })
    .then(r => r.json())
    .then(data => {
      if (!registered) {
        registered = true;
        console.log(`✅ Bridge successfully registered with Render:`, data);
        console.log(`🎵 Highrise bot will now fetch 100% of YouTube tracks via your residential IP!\n`);
      }
    })
    .catch(err => {
      console.warn(`⚠️ Failed to register bridge automatically: ${err.message}`);
    });
}

// Keep-alive heartbeat every 60s
setInterval(() => {
  if (currentTunnelUrl && registered) {
    const hbHeaders = { 'Content-Type': 'application/json' };
    if (process.env.BRIDGE_SECRET) hbHeaders['Authorization'] = 'Bearer ' + process.env.BRIDGE_SECRET;
    fetch(`${RENDER_BOT_URL}/api/register-bridge`, {
      method: 'POST',
      headers: hbHeaders,
      body: JSON.stringify({ url: currentTunnelUrl })
    }).catch(() => {});
  }
}, 60000);

function handleOutput(data) {
  const text = data.toString();
  process.stdout.write(text);

  // Match https://[subdomain].trycloudflare.com (exclude api.trycloudflare.com)
  const match = text.match(/https:\/\/([a-zA-Z0-9-]+)\.trycloudflare\.com/);
  if (match && match[1] !== 'api' && !registered) {
    registerWithRender(match[0]);
  }
}

cfProcess.stdout.on('data', handleOutput);
cfProcess.stderr.on('data', handleOutput);

cfProcess.on('close', (code) => {
  console.log(`Cloudflare tunnel exited with code ${code}`);
  bridgeProcess.kill();
  process.exit(code || 0);
});

bridgeProcess.on('close', (code) => {
  console.log(`Bridge server exited with code ${code}`);
  cfProcess.kill();
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  console.log('\nStopping Residential Bridge...');
  bridgeProcess.kill();
  cfProcess.kill();
  process.exit(0);
});
