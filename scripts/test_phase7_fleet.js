async function main() {
  console.log('=== PROBING LIVE PRODUCTION FLEET ===');
  const endpoints = {
    'Audio Server 1 (Room 1)': 'http://92.118.206.166:30238/health',
    'Audio Server 2 (Room 2)': 'http://2.56.246.128:30289/health',
    'Central Controller': 'http://2.56.246.119:30195/health',
    'Cloud Worker': 'http://92.118.206.201:30229/health'
  };

  let allHealthy = true;
  for (const [name, url] of Object.entries(endpoints)) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await res.text();
      console.log(`[PASS] ${name} (${url}): HTTP ${res.status} in ${Date.now() - t0}ms`);
      console.log(`       Response: ${body.trim().slice(0, 160)}`);
    } catch (err) {
      console.error(`[FAIL] ${name} (${url}): ${err.message}`);
      allHealthy = false;
    }
  }

  return allHealthy;
}

main().then(ok => {
  if (!ok) process.exit(1);
  process.exit(0);
});
