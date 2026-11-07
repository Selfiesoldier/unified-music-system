/**
 * Telegram Vault Rescanner & Database Generator
 * Scans your private Telegram Music Vault channel, retrieves every audio track's
 * file_id, title, performer, and duration, and regenerates telegram_vault.json locally.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '9109239162:AAE01QXTy4LhP5o6MvJ7DUYL_4kzBbSp5k4';
const CHANNEL_ID = process.env.TELEGRAM_VAULT_CHAT_ID || '-1004463400168';
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const OUTPUT_VAULT_FILE = path.join(__dirname, 'telegram_vault.json');
const OUTPUT_ARCHIVER_DB = path.join(__dirname, 'playlist-archiver', 'vault_db.json');
const CLOUD_CONTROLLER_URL = 'http://2.56.246.119:30195';

function getSongCacheKey(url, title = '') {
  const ytMatch = (url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `yt_${ytMatch[1]}`;
  const normalized = (title || url || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 40);
  return `sc_${crypto.createHash('md5').update(normalized || 'unknown').digest('hex').slice(0, 16)}`;
}

async function tgCall(method, body = {}) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function probeHighestMessageId() {
  console.log('📡 Probing channel for highest message ID...');
  const res = await tgCall('sendMessage', {
    chat_id: CHANNEL_ID,
    text: '🔍 Vault recovery probe',
    disable_notification: true
  });
  if (!res.ok) {
    throw new Error(`Telegram API Probe Failed: ${res.description}`);
  }
  const maxId = res.result.message_id;
  await tgCall('deleteMessage', { chat_id: CHANNEL_ID, message_id: maxId }).catch(() => {});
  return maxId;
}

async function checkMessageForAudio(messageId) {
  try {
    const fwd = await tgCall('forwardMessage', {
      chat_id: CHANNEL_ID,
      from_chat_id: CHANNEL_ID,
      message_id: messageId,
      disable_notification: true
    });

    if (!fwd.ok) {
      if (fwd.error_code === 429) {
        const retryAfter = fwd.parameters?.retry_after || 2;
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return await checkMessageForAudio(messageId);
      }
      return null;
    }

    const forwardedId = fwd.result.message_id;
    const audio = fwd.result.audio;

    // Immediately clean up the forwarded message
    await tgCall('deleteMessage', {
      chat_id: CHANNEL_ID,
      message_id: forwardedId
    }).catch(() => {});

    if (audio) {
      return {
        messageId: messageId,
        fileId: audio.file_id,
        fileUniqueId: audio.file_unique_id,
        title: audio.title || 'Unknown Track',
        artist: audio.performer || 'Unknown Artist',
        duration: audio.duration ? `${Math.floor(audio.duration / 60)}:${String(audio.duration % 60).padStart(2, '0')}` : '0:00',
        durationSeconds: audio.duration || 0,
        fileSize: audio.file_size || 0,
        fileName: audio.file_name || ''
      };
    }
  } catch (err) {
    // Network or parse issue
  }
  return null;
}

async function runRescan() {
  console.log('====================================================');
  console.log('🔄 TELEGRAM VAULT RESCANNER & DATABASE GENERATOR');
  console.log('====================================================\n');

  const maxId = await probeHighestMessageId();
  console.log(`🎯 Channel latest message ID is: #${maxId}`);
  console.log(`🚀 Starting scan across messages #1 to #${maxId}...\n`);

  const recoveredAudio = [];
  const concurrency = 4;
  let scannedCount = 0;

  for (let start = 1; start <= maxId; start += concurrency) {
    const chunk = [];
    for (let i = start; i < start + concurrency && i <= maxId; i++) {
      chunk.push(i);
    }

    const results = await Promise.all(chunk.map(id => checkMessageForAudio(id)));
    for (const item of results) {
      if (item) {
        recoveredAudio.push(item);
        console.log(`🎵 [#${item.messageId}] "${item.title}" by ${item.artist} (${item.duration})`);
      }
    }

    scannedCount += chunk.length;
    process.stdout.write(`⏳ Progress: ${scannedCount}/${maxId} messages scanned | Recovered: ${recoveredAudio.length} songs\r`);

    // Pacing delay to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 60));
  }

  console.log('\n\n====================================================');
  console.log(`✅ Scan Finished! Recovered ${recoveredAudio.length} total audio tracks.`);
  console.log('====================================================\n');

  // Load existing metadata (like videoId) if available
  let existingDb = {};
  if (fs.existsSync(OUTPUT_ARCHIVER_DB)) {
    try {
      const raw = JSON.parse(fs.readFileSync(OUTPUT_ARCHIVER_DB, 'utf8'));
      if (Array.isArray(raw)) {
        raw.forEach(item => { if (item.telegram_file_id) existingDb[item.telegram_file_id] = item; });
      } else if (typeof raw === 'object') {
        Object.values(raw).forEach(item => { if (item.telegram_file_id) existingDb[item.telegram_file_id] = item; });
      }
    } catch (_) {}
  }

  // 1. Build telegram_vault.json (Server L2 dictionary format)
  const vaultDict = {};
  const archiverDb = {};

  for (let idx = 0; idx < recoveredAudio.length; idx++) {
    const item = recoveredAudio[idx];
    const match = existingDb[item.fileId];
    const videoId = match?.videoId || null;

    const entry = {
      fileId: item.fileId,
      messageId: item.messageId,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      durationSeconds: item.durationSeconds,
      fileSize: item.fileSize,
      videoId: videoId,
      savedAt: match?.archived_at || new Date().toISOString()
    };

    // Index by primary cache key (normalized title)
    const titleKey = getSongCacheKey('', item.title);
    vaultDict[titleKey] = entry;

    // Index by YouTube Video ID if known
    if (videoId) {
      vaultDict[`yt_${videoId}`] = entry;
    }

    // Index for archiver format
    archiverDb[idx] = {
      key: titleKey,
      title: item.title,
      artist: item.artist,
      duration: item.duration,
      durationSeconds: item.durationSeconds,
      source: 'telegram_vault_rescan',
      videoId: videoId,
      telegram_message_id: item.messageId,
      telegram_file_id: item.fileId,
      archived_at: entry.savedAt
    };
  }

  // Save telegram_vault.json in root
  fs.writeFileSync(OUTPUT_VAULT_FILE, JSON.stringify(vaultDict, null, 2), 'utf8');
  console.log(`💾 Saved server L2 dictionary (${Object.keys(vaultDict).length} keys) to:`);
  console.log(`   ➔ ${OUTPUT_VAULT_FILE}`);

  // Save archiver vault_db.json
  const archiverDir = path.dirname(OUTPUT_ARCHIVER_DB);
  if (!fs.existsSync(archiverDir)) fs.mkdirSync(archiverDir, { recursive: true });
  fs.writeFileSync(OUTPUT_ARCHIVER_DB, JSON.stringify(archiverDb, null, 2), 'utf8');
  console.log(`💾 Saved archiver database (${recoveredAudio.length} tracks) to:`);
  console.log(`   ➔ ${OUTPUT_ARCHIVER_DB}\n`);

  // Prompt or auto-sync to cloud server
  const shouldSync = process.argv.includes('--sync') || process.argv.includes('-s');
  if (shouldSync) {
    console.log(`☁️ Syncing recovered tracks directly to Cloud Controller (${CLOUD_CONTROLLER_URL})...`);
    try {
      const tracks = Object.values(archiverDb);
      const batchSize = 40;
      for (let i = 0; i < tracks.length; i += batchSize) {
        const batch = tracks.slice(i, i + batchSize);
        await fetch(`${CLOUD_CONTROLLER_URL}/api/vault/sync-bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tracks: batch })
        });
      }
      console.log('🎉 Successfully synced all tracks to Cloud Main Controller!');
    } catch (syncErr) {
      console.warn(`⚠️ Cloud sync failed: ${syncErr.message}`);
    }
  } else {
    console.log('💡 Tip: Run `node rescan_vault.js --sync` to automatically push the recovered database to the cloud server!');
  }

  console.log('\n🏁 Recovery process completed successfully!');
}

runRescan().catch(err => {
  console.error('\n❌ Fatal error during rescan:', err.message);
  process.exit(1);
});

