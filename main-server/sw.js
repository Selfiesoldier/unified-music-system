
import { spawn } from 'child_process';
import { writeFileSync, appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';

// Detect platform for cross-platform compatibility
const isWindows = process.platform === 'win32';

console.log('🔧 Music Server Watchdog Started');
console.log('💡 Advanced restart protection enabled');
console.log(`💡 Platform: ${process.platform}`);
console.log('💡 Press Ctrl+C to stop the server\n');

let restartCount = 0;
let dailyRestartCount = 0;
let shutdownRequested = false;
let serverStartTime = null;
let currentProcess = null;
let lastResetDate = new Date().toDateString();

// Exponential backoff configuration - faster for local hosting
const backoffDelays = [1, 2, 3, 5, 10, 15, 30]; // seconds (reduced for local)
let currentDelayIndex = 0;

// Crash detection - more lenient for local hosting
const CRASH_WINDOW = 120000; // 2 minutes (increased from 60s)
const MAX_CRASHES_IN_WINDOW = 8; // (increased from 5)
let recentCrashTimes = [];

// Daily restart limit (memory leak protection)
const MAX_DAILY_RESTARTS = 200; // (increased for local development)

// System logging
const LOG_DIR = 'logs';
const SYSTEM_LOG = join(LOG_DIR, 'server_watchdog.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

function rotateLogIfNeeded() {
  try {
    if (!existsSync(SYSTEM_LOG)) return;
    
    const stats = statSync(SYSTEM_LOG);
    if (stats.size > MAX_LOG_SIZE) {
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const archiveName = join(LOG_DIR, `server_watchdog_${timestamp}.log`);
      renameSync(SYSTEM_LOG, archiveName);
      console.log(`📦 Rotated log file: ${archiveName}`);
      
      // Keep only last 5 rotated logs
      const logFiles = readdirSync(LOG_DIR)
        .filter(f => f.startsWith('server_watchdog_') && f.endsWith('.log'))
        .sort()
        .reverse();
      
      if (logFiles.length > 5) {
        for (let i = 5; i < logFiles.length; i++) {
          unlinkSync(join(LOG_DIR, logFiles[i]));
        }
      }
    }
  } catch (err) {
    console.error(`Log rotation failed: ${err.message}`);
  }
}

function writeSystemLog(message) {
  try {
    ensureLogDir();
    rotateLogIfNeeded();
    
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    
    appendFileSync(SYSTEM_LOG, logEntry);
  } catch (err) {
    console.error(`Failed to write system log: ${err.message}`);
  }
}

function checkDailyReset() {
  const today = new Date().toDateString();
  if (today !== lastResetDate) {
    console.log(`📅 New day - resetting daily restart counter (was ${dailyRestartCount})`);
    writeSystemLog(`Daily restart counter reset (was ${dailyRestartCount})`);
    dailyRestartCount = 0;
    lastResetDate = today;
  }
}

function getUptime() {
  if (!serverStartTime) return 'Unknown';
  
  const uptimeSeconds = Math.floor((Date.now() - serverStartTime) / 1000);
  const hours = Math.floor(uptimeSeconds / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const seconds = uptimeSeconds % 60;
  
  return `${hours}h ${minutes}m ${seconds}s`;
}

function isCrashLooping() {
  const now = Date.now();
  
  // Remove crashes older than the window
  recentCrashTimes = recentCrashTimes.filter(time => now - time < CRASH_WINDOW);
  
  // Add current crash
  recentCrashTimes.push(now);
  
  // Check if we've exceeded the crash threshold
  if (recentCrashTimes.length >= MAX_CRASHES_IN_WINDOW) {
    return true;
  }
  
  return false;
}

function killProcess(proc, signal = 'SIGTERM') {
  if (!proc) return;
  
  try {
    if (isWindows) {
      if (signal === 'SIGKILL') {
        // Force kill on Windows
        spawn('taskkill', ['/pid', proc.pid, '/f', '/t'], { stdio: 'ignore' });
      } else {
        // Graceful kill attempt on Windows (still uses taskkill but without /f)
        spawn('taskkill', ['/pid', proc.pid, '/t'], { stdio: 'ignore' });
      }
    } else {
      proc.kill(signal);
    }
  } catch (e) {
    console.error(`Failed to kill process: ${e.message}`);
  }
}

function startServer() {
  const startNum = restartCount === 0 ? '' : ` #${restartCount}`;
  console.log(`${'='.repeat(60)}`);
  console.log(`🚀 STARTING MUSIC SERVER${startNum}`);
  console.log(`${'='.repeat(60)}\n`);
  
  if (restartCount > 0) {
    writeSystemLog(`Server restart #${restartCount}`);
  } else {
    writeSystemLog('Music server watchdog started');
  }
  
  serverStartTime = Date.now();
  
  // Use shell option for better cross-platform compatibility
  currentProcess = spawn('node', ['server.js'], {
    stdio: 'inherit',
    env: process.env,
    shell: isWindows
  });

  currentProcess.on('exit', (code, signal) => {
    const uptime = getUptime();
    
    if (shutdownRequested) {
      console.log('\n✅ Music server stopped successfully');
      writeSystemLog('Music server stopped gracefully');
      process.exit(0);
    }

    // Check for daily reset BEFORE incrementing counters
    checkDailyReset();
    
    restartCount++;
    dailyRestartCount++;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`⚠️ MUSIC SERVER EXITED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Exit Code: ${code}`);
    console.log(`Signal: ${signal || 'None'}`);
    console.log(`Uptime: ${uptime}`);
    console.log(`Daily Restarts: ${dailyRestartCount}/${MAX_DAILY_RESTARTS}`);
    
    writeSystemLog(`Server exited - Code: ${code}, Signal: ${signal}, Uptime: ${uptime}, Daily restarts: ${dailyRestartCount}`);
    
    // Check daily restart limit (memory leak protection)
    if (dailyRestartCount >= MAX_DAILY_RESTARTS) {
      console.log(`\n❌ DAILY RESTART LIMIT REACHED!`);
      console.log(`Server has restarted ${dailyRestartCount} times today (limit: ${MAX_DAILY_RESTARTS})`);
      console.log(`This indicates a serious problem that requires manual intervention.`);
      console.log(`\n💡 The server will resume tomorrow, or restart manually after fixing the issue.`);
      
      writeSystemLog(`DAILY RESTART LIMIT REACHED - ${dailyRestartCount} restarts today - stopping watchdog`);
      process.exit(1);
    }
    
    // Check for crash looping
    if (isCrashLooping()) {
      console.log(`\n❌ CRASH LOOP DETECTED!`);
      console.log(`Server has crashed ${MAX_CRASHES_IN_WINDOW} times in ${CRASH_WINDOW/1000} seconds`);
      console.log(`This indicates a serious problem that requires manual intervention.`);
      console.log(`\n💡 Check the logs and fix the underlying issue before restarting.`);
      
      writeSystemLog(`CRASH LOOP DETECTED - ${MAX_CRASHES_IN_WINDOW} crashes in ${CRASH_WINDOW/1000}s - stopping watchdog`);
      process.exit(1);
    }
    
    // Determine restart delay with exponential backoff
    const delay = backoffDelays[Math.min(currentDelayIndex, backoffDelays.length - 1)];
    
    // Reset backoff if server ran for more than 5 minutes (successful run)
    const uptimeSeconds = (Date.now() - serverStartTime) / 1000;
    if (uptimeSeconds > 300) {
      currentDelayIndex = 0;
      console.log(`✅ Server ran successfully for ${uptime} - resetting backoff`);
      writeSystemLog(`Server ran successfully for ${uptime} - backoff reset`);
    } else {
      currentDelayIndex++;
    }
    
    console.log(`\n🔄 RESTARTING SERVER...`);
    console.log(`Restart count: ${restartCount}`);
    console.log(`Delay: ${delay} seconds (smart backoff)`);
    console.log(`Recent crashes: ${recentCrashTimes.length} in last ${CRASH_WINDOW/1000}s`);
    console.log(`${'='.repeat(60)}\n`);
    
    writeSystemLog(`Restarting in ${delay}s (attempt #${restartCount})`);
    
    setTimeout(() => {
      startServer();
    }, delay * 1000);
  });

  currentProcess.on('error', (err) => {
    console.error(`❌ Failed to start server: ${err.message}`);
    writeSystemLog(`Server start failed: ${err.message}`);
    
    if (!shutdownRequested) {
      console.log('🔄 Retrying in 3 seconds...');
      setTimeout(() => {
        startServer();
      }, 3000);
    }
  });
}

// Graceful shutdown function
function gracefulShutdown(signal) {
  console.log(`\n🛑 Shutdown signal received (${signal})`);
  console.log('⏹️ Stopping music server...');
  writeSystemLog(`Shutdown requested (${signal})`);
  shutdownRequested = true;
  
  if (currentProcess) {
    killProcess(currentProcess, 'SIGTERM');
    setTimeout(() => {
      if (currentProcess && !currentProcess.killed) {
        killProcess(currentProcess, 'SIGKILL');
      }
      process.exit(0);
    }, 5000);
  } else {
    process.exit(0);
  }
}

// Graceful shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Windows-specific handler
if (isWindows) {
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
}

// Uncaught exception handler
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception in watchdog:', err.message);
  writeSystemLog(`Uncaught exception: ${err.message}`);
  gracefulShutdown('uncaughtException');
});

// Start the server
writeSystemLog('='.repeat(60));
writeSystemLog('Music Server Watchdog v2.1 - Local Hosting Optimized');
writeSystemLog(`Platform: ${process.platform}`);
writeSystemLog('='.repeat(60));
startServer();
