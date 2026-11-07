import fs from 'fs';

/**
 * Pure Node.js MPEG-1 Layer 3 96kbps CBR 44.1kHz Audio Header Validator
 * Zero external dependencies, zero child_process invocations.
 */

/**
 * Checks whether a Buffer conforms to MPEG-1 Layer 3, 96 kbps CBR, 44.1 kHz, non-mono format.
 * Inspects ID3v2 tags (if present) to find frame offset, verifies first frame header parameters,
 * and validates second frame sync when sufficient bytes are available.
 *
 * @param {Buffer} buffer - Audio data buffer
 * @returns {boolean} True if buffer is valid 96k CBR MP3 audio
 */
export function is96kCbrMp3Buffer(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  let offset = 0;

  // Check for ID3v2 header at byte 0 ('ID3')
  if (
    buffer.length >= 10 &&
    buffer[0] === 0x49 && // 'I'
    buffer[1] === 0x44 && // 'D'
    buffer[2] === 0x33    // '3'
  ) {
    // ID3v2 tag size is encoded as a 4-byte syncsafe integer (7 bits per byte)
    const tagSize =
      ((buffer[6] & 0x7F) << 21) |
      ((buffer[7] & 0x7F) << 14) |
      ((buffer[8] & 0x7F) << 7) |
      (buffer[9] & 0x7F);

    const hasFooter = (buffer[5] & 0x10) !== 0;
    offset = 10 + tagSize + (hasFooter ? 10 : 0);

    if (offset > buffer.length - 4) {
      // Buffer does not contain audio frame header past ID3 tag
      return false;
    }
  }

  // Locate first MPEG audio frame sync word starting at offset
  // 11 sync bits: byte 0 == 0xFF and (byte 1 & 0xE0) == 0xE0
  let syncOffset = -1;
  const searchLimit = Math.min(buffer.length - 4, offset + 4096);
  for (let i = offset; i <= searchLimit; i++) {
    if (buffer[i] === 0xFF && (buffer[i + 1] & 0xE0) === 0xE0) {
      syncOffset = i;
      break;
    }
  }

  if (syncOffset === -1) {
    return false;
  }

  // Validate MPEG-1 Layer 3 parameters:
  const b1 = buffer[syncOffset + 1];
  const b2 = buffer[syncOffset + 2];
  const b3 = buffer[syncOffset + 3];

  // MPEG Audio Version ID: 3 = MPEG-1
  const mpegVersion = (b1 >> 3) & 3;
  if (mpegVersion !== 3) {
    return false;
  }

  // Layer Description: 1 = Layer III
  const layer = (b1 >> 1) & 3;
  if (layer !== 1) {
    return false;
  }

  // Bitrate Index: 7 = 96 kbps (in MPEG-1 Layer III)
  const bitrateIdx = (b2 >> 4) & 15;
  if (bitrateIdx !== 7) {
    return false;
  }

  // Sample Rate Index: 0 = 44.1 kHz
  const sampleRateIdx = (b2 >> 2) & 3;
  if (sampleRateIdx !== 0) {
    return false;
  }

  // Channel Mode: 0 = Stereo, 1 = Joint Stereo, 2 = Dual Channel, 3 = Mono
  // Strict non-mono required
  const channelMode = (b3 >> 6) & 3;
  if (channelMode === 3) {
    return false;
  }

  // Frame length calculation: Math.floor(144 * bitrate / sampleRate) + padding
  const padding = (b2 >> 1) & 1;
  const frameLength = Math.floor((144 * 96000) / 44100) + padding; // 313 or 314 bytes

  // Confirm next frame sync if buffer contains enough bytes
  const nextSync = syncOffset + frameLength;
  if (buffer.length >= nextSync + 4) {
    if (buffer[nextSync] !== 0xFF || (buffer[nextSync + 1] & 0xE0) !== 0xE0) {
      return false;
    }
    const nb1 = buffer[nextSync + 1];
    const nb2 = buffer[nextSync + 2];
    if (((nb1 >> 3) & 3) !== 3) return false; // MPEG-1
    if (((nb1 >> 1) & 3) !== 1) return false; // Layer III
    if (((nb2 >> 4) & 15) !== 7) return false; // 96 kbps
    if (((nb2 >> 2) & 3) !== 0) return false;  // 44.1 kHz
  }

  return true;
}

/**
 * Validates a file on disk by reading its initial chunk and checking for 96k CBR MP3 headers.
 * Safely handles large ID3v2 metadata tags by reading past them.
 *
 * @param {string} filePath - Path to file on disk
 * @returns {boolean} True if file is valid 96k CBR MP3 audio
 */
export function validateMp3FileHeader(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    const stat = fs.statSync(filePath);
    if (stat.size < 313) {
      return false;
    }

    const fd = fs.openSync(filePath, 'r');
    try {
      const headerBuf = Buffer.alloc(10);
      const read10 = fs.readSync(fd, headerBuf, 0, 10, 0);
      let readStart = 0;

      // Check if file starts with ID3v2 tag
      if (
        read10 >= 10 &&
        headerBuf[0] === 0x49 &&
        headerBuf[1] === 0x44 &&
        headerBuf[2] === 0x33
      ) {
        const tagSize =
          ((headerBuf[6] & 0x7F) << 21) |
          ((headerBuf[7] & 0x7F) << 14) |
          ((headerBuf[8] & 0x7F) << 7) |
          (headerBuf[9] & 0x7F);
        const hasFooter = (headerBuf[5] & 0x10) !== 0;
        readStart = 10 + tagSize + (hasFooter ? 10 : 0);
      }

      const available = stat.size - readStart;
      if (available < 4) {
        return false;
      }

      // Read up to 4096 bytes of audio data
      const readBytes = Math.min(available, 4096);
      const chunkBuf = Buffer.alloc(readBytes);
      fs.readSync(fd, chunkBuf, 0, readBytes, readStart);

      return is96kCbrMp3Buffer(chunkBuf);
    } finally {
      fs.closeSync(fd);
    }
  } catch (_) {
    return false;
  }
}
