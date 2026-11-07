import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VAULT_FILE = path.join(__dirname, 'vault_db.json');
const MAIN_SERVER_VAULT_URL = 'http://2.56.246.119:30195/api/vault';
const MAIN_SERVER_ADD_URL = 'http://2.56.246.119:30195/api/vault/add';

class VaultManager {
  constructor() {
    this.vault = new Map();
    this.loadLocal();
  }

  normalizeKey(title, artist = '') {
    const clean = (s) => (s || '')
      .toLowerCase()
      .replace(/(\(|\[).*?(\)|\])/g, '') // remove (feat. ...), [official video]
      .replace(/[^a-z0-9]/g, '')
      .trim();
    const cTitle = clean(title);
    const cArtist = clean(artist);
    return `${cTitle}_${cArtist}`.slice(0, 80);
  }

  loadLocal() {
    try {
      if (fs.existsSync(VAULT_FILE)) {
        const data = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
        if (Array.isArray(data)) {
          for (const item of data) {
            const key = item.key || this.normalizeKey(item.title, item.artist);
            this.vault.set(key, item);
          }
        }
      }
    } catch (e) {
      console.error('⚠️ [Vault] Error loading local vault_db.json:', e.message);
    }
  }

  saveLocal() {
    try {
      const arr = Array.from(this.vault.values());
      fs.writeFileSync(VAULT_FILE, JSON.stringify(arr, null, 2), 'utf8');
    } catch (e) {
      console.error('⚠️ [Vault] Error saving vault_db.json:', e.message);
    }
  }

  async syncFromMainServer() {
    try {
      const res = await fetch(MAIN_SERVER_VAULT_URL, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return { synced: false, count: this.vault.size };
      const remote = await res.json();
      let added = 0;
      if (Array.isArray(remote)) {
        for (const item of remote) {
          const key = item.key || this.normalizeKey(item.title, item.artist);
          if (!this.vault.has(key)) {
            this.vault.set(key, item);
            added++;
          }
        }
      }
      if (added > 0) this.saveLocal();
      return { synced: true, added, total: this.vault.size };
    } catch (e) {
      console.log('ℹ️ [Vault] Main server vault unreachable, using local vault:', e.message);
      return { synced: false, total: this.vault.size };
    }
  }

  async syncToMainServer(entry) {
    try {
      await fetch(MAIN_SERVER_ADD_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(4000)
      });
    } catch (_) {}
  }

  checkDuplicate(title, artist = '', videoId = '') {
    const key = this.normalizeKey(title, artist);
    if (this.vault.has(key)) {
      return { isDuplicate: true, entry: this.vault.get(key), matchType: 'exact_key' };
    }

    // VideoId check
    if (videoId) {
      for (const item of this.vault.values()) {
        if (item.videoId && item.videoId.toLowerCase() === videoId.toLowerCase()) {
          return { isDuplicate: true, entry: item, matchType: 'videoId' };
        }
      }
    }

    // Fuzzy title match
    const clean = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanT = clean(title);
    if (cleanT.length >= 8) {
      for (const item of this.vault.values()) {
        const itemT = clean(item.title);
        if (itemT && (cleanT === itemT || (cleanT.length >= 12 && itemT.includes(cleanT)) || (itemT.length >= 12 && cleanT.includes(itemT)))) {
          return { isDuplicate: true, entry: item, matchType: 'fuzzy_title' };
        }
      }
    }

    return { isDuplicate: false };
  }

  addTrack(entry) {
    const key = entry.key || this.normalizeKey(entry.title, entry.artist);
    const fullEntry = {
      key,
      title: entry.title,
      artist: entry.artist || 'Unknown Artist',
      duration: entry.duration || '0:00',
      durationSeconds: entry.durationSeconds || 0,
      source: entry.source || 'unknown',
      videoId: entry.videoId || null,
      telegram_message_id: entry.telegram_message_id,
      telegram_file_id: entry.telegram_file_id,
      archived_at: new Date().toISOString()
    };
    this.vault.set(key, fullEntry);
    this.saveLocal();
    this.syncToMainServer(fullEntry);
    return fullEntry;
  }

  getAll() {
    return Array.from(this.vault.values());
  }

  getCount() {
    return this.vault.size;
  }
}

export const vault = new VaultManager();

