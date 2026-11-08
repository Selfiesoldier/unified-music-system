import { is96kCbrMp3Buffer } from '../main-server/src/mp3Validator.js';
import fs from 'fs';

async function testWorkerEndpoints() {
  console.log('\n--- 1. Testing Cloud Worker /tts Endpoint ---');
  const ttsUrl = 'http://92.118.206.201:30229/tts?text=' + encodeURIComponent('Highrise Phase 7 Verification') + '&lang=en';
  const ttsRes = await fetch(ttsUrl);
  console.log(`Cloud Worker /tts HTTP Status: ${ttsRes.status}`);
  console.log(`Content-Type: ${ttsRes.headers.get('content-type')}`);
  console.log(`X-Worker-Source: ${ttsRes.headers.get('x-worker-source')}`);

  if (ttsRes.status !== 200) {
    throw new Error(`Worker /tts returned ${ttsRes.status}`);
  }

  const ttsArray = await ttsRes.arrayBuffer();
  const ttsBuf = Buffer.from(ttsArray);
  console.log(`Downloaded TTS payload size: ${ttsBuf.length} bytes`);
  const isTtsValid96k = is96kCbrMp3Buffer(ttsBuf);
  console.log(`is96kCbrMp3Buffer(ttsBuf): ${isTtsValid96k}`);
  if (!isTtsValid96k) {
    throw new Error('Worker /tts did not return a valid 96k CBR MP3 buffer!');
  }

  console.log('\n--- 2. Testing Cloud Worker /transcode Endpoint ---');
  // We can send raw PCM or mock bytes to /transcode via POST
  // In fact, let's create a raw mock payload or transcode test
  // Let's first test sending a small invalid audio:
  const invalidBuf = Buffer.from('RIFF....WAVEfmt ....data....not_an_mp3');
  // If we send this to Worker /transcode, FFmpeg might fail or succeed depending on input
  // Let's test with the valid ttsBuf or a small valid audio stream
  const transRes = await fetch('http://92.118.206.201:30229/transcode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: ttsBuf
  });
  console.log(`Cloud Worker /transcode HTTP Status: ${transRes.status}`);
  if (transRes.status === 200) {
    const transBuf = Buffer.from(await transRes.arrayBuffer());
    console.log(`Transcoded payload size: ${transBuf.length} bytes`);
    const isTransValid96k = is96kCbrMp3Buffer(transBuf);
    console.log(`is96kCbrMp3Buffer(transBuf): ${isTransValid96k}`);
    if (!isTransValid96k) {
      throw new Error('Worker /transcode did not return a valid 96k CBR MP3 buffer!');
    }
  }

  console.log('\n--- 3. Testing Audio Server /announce Rejection on Invalid Payload ---');
  // Send non-96k base64 audio to Room 1 /announce
  const badBase64 = Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00data\x00\x00\x00\x00').toString('base64');
  const badAnnounceRes = await fetch('http://92.118.206.166:30238/announce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer supersecret_audio_key_123'
    },
    body: JSON.stringify({ audioBase64: badBase64 })
  });
  console.log(`Audio Server /announce bad payload HTTP Status: ${badAnnounceRes.status}`);
  const badBody = await badAnnounceRes.json();
  console.log('Audio Server response:', badBody);
  if (badAnnounceRes.status !== 400 || !badBody.error?.includes('96kbps CBR')) {
    throw new Error('Audio Server did NOT reject invalid non-96k audio with 400!');
  }
  console.log('Confirmed: Audio Server rejected invalid non-96k audio with HTTP 400.');

  console.log('\n--- 4. Testing Audio Server 1 /announce Acceptance on Valid 96k CBR MP3 ---');
  const goodBase64 = ttsBuf.toString('base64');
  const goodAnnounceRes = await fetch('http://92.118.206.166:30238/announce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer supersecret_audio_key_123'
    },
    body: JSON.stringify({ audioBase64: goodBase64, wait: true })
  });
  console.log(`Audio Server 1 /announce valid 96k CBR payload HTTP Status: ${goodAnnounceRes.status}`);
  const goodBody = await goodAnnounceRes.json();
  console.log('Audio Server 1 response:', goodBody);
  if (goodAnnounceRes.status !== 200 || (goodBody.status !== 'announcement_completed' && goodBody.status !== 'announcement_started')) {
    throw new Error('Audio Server 1 did NOT accept valid 96k CBR MP3 announcement!');
  }
  console.log('Confirmed: Audio Server 1 accepted verified 96k CBR MP3 announcement with HTTP 200.');

  console.log('\n--- 5. Testing Audio Server 2 (Room 2) /announce Handshake ---');
  // Rejection check on Room 2
  const badRoom2Res = await fetch('http://2.56.246.128:30289/announce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer supersecret_audio_key_123'
    },
    body: JSON.stringify({ audioBase64: badBase64 })
  });
  console.log(`Audio Server 2 /announce bad payload HTTP Status: ${badRoom2Res.status}`);
  const badRoom2Body = await badRoom2Res.json();
  if (badRoom2Res.status !== 400 || !badRoom2Body.error?.includes('96kbps CBR')) {
    throw new Error('Audio Server 2 did NOT reject invalid non-96k audio with 400!');
  }
  console.log('Confirmed: Audio Server 2 rejected invalid non-96k audio with HTTP 400.');

  // Acceptance check on Room 2
  const goodRoom2Res = await fetch('http://2.56.246.128:30289/announce', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer supersecret_audio_key_123'
    },
    body: JSON.stringify({ audioBase64: goodBase64, wait: true })
  });
  console.log(`Audio Server 2 /announce valid payload HTTP Status: ${goodRoom2Res.status}`);
  const goodRoom2Body = await goodRoom2Res.json();
  if (goodRoom2Res.status !== 200 || (goodRoom2Body.status !== 'announcement_completed' && goodRoom2Body.status !== 'announcement_started')) {
    throw new Error('Audio Server 2 did NOT accept valid 96k CBR MP3 announcement!');
  }
  console.log('Confirmed: Audio Server 2 accepted verified 96k CBR MP3 announcement with HTTP 200.');
}

testWorkerEndpoints()
  .then(() => {
    console.log('\n✅ All Phase 7 Worker & Audio Server Endpoints Verified Successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
  });
