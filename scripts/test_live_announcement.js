const sid = '00f50ae1';
const key = 'ptlc_xH3DUb27dLGERsgqHo1qsearZNuPUu65nFvUMWAY1RQ';

async function main() {
  console.log('Connecting to Audio Server 1 WebSocket logs...');
  const res = await fetch(`https://panel.orihost.com/api/client/servers/${sid}/websocket`, {
    headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
  });
  const json = await res.json();
  const { token, socket } = json.data;

  const ws = new WebSocket(socket, { headers: { 'Origin': 'https://panel.orihost.com' } });
  
  ws.onopen = () => {
    ws.send(JSON.stringify({ event: 'auth', args: [token] }));
  };

  ws.onmessage = async (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'auth success') {
      ws.send(JSON.stringify({ event: 'send logs', args: [null] }));
      console.log('Authenticated to WebSocket! Triggering live announcement in 1 second...');
      setTimeout(triggerAnnouncement, 1000);
    } else if (msg.event === 'console output') {
      const line = msg.args[0];
      if (line.includes('Announcement') || line.includes('AudioPlayer') || line.includes('Client') || line.includes('StreamManager')) {
        console.log('LOG:', line);
      }
    }
  };

  async function triggerAnnouncement() {
    console.log('📡 Sending /announce request to Audio Server 1...');
    const t0 = Date.now();
    const announceRes = await fetch('http://92.118.206.166:30238/announce', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer supersecret_audio_key_123'
      },
      body: JSON.stringify({
        url: 'http://2.56.246.119:30195/api/audio-file/tts_2f967d976f65da7b.mp3',
        wait: true
      })
    });
    const body = await announceRes.json();
    console.log(`Announcement finished in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, body);
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 2000);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
