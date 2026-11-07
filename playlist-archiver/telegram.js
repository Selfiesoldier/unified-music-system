import fs from 'fs';
import path from 'path';

const BOT_TOKEN = '9109239162:AAE01QXTy4LhP5o6MvJ7DUYL_4kzBbSp5k4';
const CHANNEL_ID = '-1004463400168'; // "My music" Vault channel
const TELEGRAM_API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

/**
 * Upload an MP3 file directly to Telegram channel
 * @param {string} filePath - Path to local .mp3 file
 * @param {object} meta - { title, performer, duration }
 * @returns {Promise<{ ok: boolean, message_id: number, file_id: string }>}
 */
export async function uploadAudioToTelegram(filePath, meta = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

  const formData = new FormData();
  formData.append('chat_id', CHANNEL_ID);
  formData.append('audio', blob, fileName);
  if (meta.title) formData.append('title', meta.title);
  if (meta.performer) formData.append('performer', meta.performer);
  if (meta.duration) formData.append('duration', String(Math.round(meta.duration)));
  
  const caption = `🎵 ${meta.title || 'Track'}${meta.performer ? ' — ' + meta.performer : ''}\n📦 Vault Archive (96kbps MP3)`;
  formData.append('caption', caption);

  const res = await fetch(`${TELEGRAM_API_BASE}/sendAudio`, {
    method: 'POST',
    body: formData
  });

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API Error: ${data.description || 'Unknown error'}`);
  }

  const audio = data.result?.audio;
  return {
    ok: true,
    message_id: data.result?.message_id,
    file_id: audio?.file_id,
    file_unique_id: audio?.file_unique_id,
    duration: audio?.duration,
    file_size: audio?.file_size,
    chat_id: CHANNEL_ID
  };
}

/**
 * Check bot connectivity and channel permissions
 */
export async function testTelegramConnection() {
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/getMe`);
    const data = await res.json();
    return { ok: data.ok, bot: data.result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

