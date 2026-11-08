const sid = '00f50ae1';
const key = 'ptlc_xH3DUb27dLGERsgqHo1qsearZNuPUu65nFvUMWAY1RQ';

async function main() {
  const res = await fetch(`https://panel.orihost.com/api/client/servers/${sid}/websocket`, {
    headers: { 'Authorization': 'Bearer ' + key, 'Accept': 'application/json' }
  });
  const json = await res.json();
  const { token, socket } = json.data;

  const ws = new WebSocket(socket, { headers: { 'Origin': 'https://panel.orihost.com' } });
  ws.onopen = () => {
    ws.send(JSON.stringify({ event: 'auth', args: [token] }));
  };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.event === 'auth success') {
      ws.send(JSON.stringify({ event: 'send logs', args: [null] }));
    } else if (msg.event === 'console output') {
      const line = msg.args[0];
      if (line.includes('Announcement') || line.includes('AudioPlayer') || line.includes('Client')) {
        console.log(line);
      }
    }
  };
  setTimeout(() => { ws.close(); process.exit(0); }, 3000);
}

main().catch(console.error);
