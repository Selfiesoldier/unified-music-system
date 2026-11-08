import { is96kCbrMp3Buffer } from '../main-server/src/mp3Validator.js';
import assert from 'assert';

console.log('=== UNIT TESTING MP3 VALIDATOR ===');

// Helper to synthesize a valid MPEG-1 Layer 3 frame
function makeMp3Frame({ bitrateKbps = 96, sampleRate = 44100, channelMode = 1 }) {
  const buf = Buffer.alloc(400);
  // Byte 0: 0xFF
  buf[0] = 0xFF;
  // Byte 1: 111 (sync) + 11 (MPEG-1) + 01 (Layer III) + 1 (no CRC) = 0xFB
  buf[1] = 0xFB;
  // Byte 2: bitrate index (4 bits) + sample rate index (2 bits) + padding (1 bit) + private (1 bit)
  const bitrateIdxMap = { 32: 1, 40: 2, 48: 3, 56: 4, 64: 5, 80: 6, 96: 7, 112: 8, 128: 9, 160: 10, 192: 11, 224: 12, 256: 13, 320: 14 };
  const bIdx = bitrateIdxMap[bitrateKbps] || 7;
  const srIdx = sampleRate === 44100 ? 0 : sampleRate === 48000 ? 1 : 2;
  buf[2] = (bIdx << 4) | (srIdx << 2);
  // Byte 3: channel mode (2 bits: 0=stereo, 1=joint, 2=dual, 3=mono)
  buf[3] = (channelMode << 6);

  // Second frame sync at frame length
  const frameLen = Math.floor((144 * bitrateKbps * 1000) / sampleRate);
  if (frameLen + 4 <= buf.length) {
    buf[frameLen] = 0xFF;
    buf[frameLen + 1] = 0xFB;
    buf[frameLen + 2] = (bIdx << 4) | (srIdx << 2);
    buf[frameLen + 3] = (channelMode << 6);
  }
  return buf;
}

// 1. Valid 96k CBR 44.1kHz Joint Stereo
const frame96k44 = makeMp3Frame({ bitrateKbps: 96, sampleRate: 44100, channelMode: 1 });
assert.strictEqual(is96kCbrMp3Buffer(frame96k44), true, 'Valid 96k 44.1k should pass');
console.log('[PASS] Valid 96k 44.1kHz Joint Stereo accepted');

// 2. Reject 48kHz (Strict fleet standard requires 44.1kHz to prevent mid-stream decoder bursts)
const frame96k48 = makeMp3Frame({ bitrateKbps: 96, sampleRate: 48000, channelMode: 0 });
assert.strictEqual(is96kCbrMp3Buffer(frame96k48), false, '48kHz sample rate must be rejected');
console.log('[PASS] 48kHz frame rejected (fleet standard requires strict 44.1kHz)');

// 3. Invalid 128kbps (Must Reject)
const frame128k = makeMp3Frame({ bitrateKbps: 128, sampleRate: 44100, channelMode: 1 });
assert.strictEqual(is96kCbrMp3Buffer(frame128k), false, '128kbps must be rejected');
console.log('[PASS] Invalid 128kbps frame rejected');

// 4. Invalid Mono (channelMode = 3, Must Reject)
const frameMono = makeMp3Frame({ bitrateKbps: 96, sampleRate: 44100, channelMode: 3 });
assert.strictEqual(is96kCbrMp3Buffer(frameMono), false, 'Mono audio must be rejected');
console.log('[PASS] Invalid Mono channel rejected');

// 5. Invalid 32kHz sample rate (srIdx = 2, Must Reject)
const frame32k = makeMp3Frame({ bitrateKbps: 96, sampleRate: 32000, channelMode: 1 });
assert.strictEqual(is96kCbrMp3Buffer(frame32k), false, '32kHz sample rate must be rejected');
console.log('[PASS] Invalid 32kHz sample rate rejected');

// 6. Non-audio buffer (Must Reject)
const trashBuf = Buffer.from('hello world this is not mp3 audio data at all');
assert.strictEqual(is96kCbrMp3Buffer(trashBuf), false, 'Random non-audio buffer must be rejected');
console.log('[PASS] Non-audio buffer rejected');

// 7. Empty / small buffer
assert.strictEqual(is96kCbrMp3Buffer(Buffer.alloc(0)), false);
assert.strictEqual(is96kCbrMp3Buffer(null), false);
console.log('[PASS] Empty / null buffer safely rejected');

console.log('\n✅ All unit tests in mp3Validator.js passed successfully!');
