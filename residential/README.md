# 🏠 Residential Audio Bridge (v2)

A lightweight residential audio streaming bridge designed to bypass datacenter IP restrictions (e.g. YouTube rate limits or blocks) by routing audio downloads through your home residential IP connection or Android Termux.

## Features
- **Zero-Dependency Native Server**: Built using native Node.js HTTP and child processes.
- **Smart LRU Cache**: Automatically caches downloaded tracks to disk (`bridge_cache/`) and evicts oldest tracks when cache limits are reached.
- **Client Disconnection Guard**: Immediately terminates `yt-dlp` if a client aborts or disconnects early, saving bandwidth and CPU.
- **Cloudflare Tunnel Support**: `manager.js` creates a zero-config tunnel and registers the bridge URL with your main controller.

## Quick Start

### Windows
1. Make sure `yt-dlp.exe` is in this folder or in your Windows `PATH`.
2. Run `start.bat` or:
   ```cmd
   node server.js
   ```

### Termux (Android) / Linux
1. Run:
   ```bash
   chmod +x start.sh
   ./start.sh
   ```

### With Cloudflare Tunnel (Automatic External Access)
```bash
node manager.js
```
