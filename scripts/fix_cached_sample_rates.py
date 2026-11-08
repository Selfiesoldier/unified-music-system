import urllib.request
import urllib.parse
import json
import time

API_KEY = 'ptlc_UDJ3zLc9mdsYEeMnEKbApVX3daRQYvfyWn0xc7Efqv9'
SERVER_ID = '6a95145f'
CONTROLLER_URL = 'http://2.56.246.119:30195'
WORKER_URL = 'http://92.118.206.201:30229'

def get_cached_songs():
    url = f'https://panel.orihost.com/api/client/servers/{SERVER_ID}/files/list?directory=%2Fcache'
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {API_KEY}', 'Accept': 'application/json'})
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode())
        return [f['attributes']['name'] for f in data['data'] if f['attributes']['name'].endswith('.mp3') and f['attributes']['name'].startswith('song_')]

def get_sample_rate_idx(filename):
    file_url = f'{CONTROLLER_URL}/api/audio-file/{filename}'
    r = urllib.request.Request(file_url, headers={'Range': 'bytes=0-4096'})
    with urllib.request.urlopen(r) as resp:
        buf = resp.read()
        for i in range(len(buf) - 4):
            if buf[i] == 0xff and (buf[i+1] & 0xe0) == 0xe0:
                return (buf[i+2] >> 2) & 3
    return -1

def transcode_to_44k(raw_mp3_bytes):
    req = urllib.request.Request(f'{WORKER_URL}/transcode', data=raw_mp3_bytes, headers={'Content-Type': 'application/octet-stream'}, method='POST')
    with urllib.request.urlopen(req) as resp:
        return resp.read()

def upload_to_controller_cache(filename, content_bytes):
    url = f'https://panel.orihost.com/api/client/servers/{SERVER_ID}/files/write?file=' + urllib.parse.quote(f'cache/{filename}')
    headers = {
        'Authorization': f'Bearer {API_KEY}',
        'Content-Type': 'text/plain',
        'Accept': 'application/json'
    }
    req = urllib.request.Request(url, data=content_bytes, headers=headers, method='POST')
    with urllib.request.urlopen(req) as resp:
        return resp.status

def main():
    songs = get_cached_songs()
    print(f'Checking {len(songs)} cached songs...')
    repaired = 0
    for s in songs:
        sr = get_sample_rate_idx(s)
        if sr == 1: # 48kHz
            print(f'🔄 [Repair] {s} is 48kHz! Downloading full file...')
            file_url = f'{CONTROLLER_URL}/api/audio-file/{s}'
            with urllib.request.urlopen(file_url) as resp:
                raw_bytes = resp.read()
            print(f'   ↳ Offloading {len(raw_bytes)} bytes to Worker /transcode (strict 44.1kHz CBR)...')
            t0 = time.time()
            transcoded_bytes = transcode_to_44k(raw_bytes)
            elapsed = time.time() - t0
            print(f'   ↳ Transcoded to {len(transcoded_bytes)} bytes in {elapsed:.2f}s!')
            # Verify 44.1k header
            for i in range(min(1000, len(transcoded_bytes) - 4)):
                if transcoded_bytes[i] == 0xff and (transcoded_bytes[i+1] & 0xe0) == 0xe0:
                    new_sr = (transcoded_bytes[i+2] >> 2) & 3
                    assert new_sr == 0, f'Expected 44.1k (0), got {new_sr}'
                    break
            print(f'   ↳ Uploading repaired 44.1kHz file to cache/{s}...')
            status = upload_to_controller_cache(s, transcoded_bytes)
            print(f'   ✅ Uploaded: HTTP {status}')
            repaired += 1
        elif sr == 0:
            print(f'✓ [OK] {s} is already 44.1kHz.')
        else:
            print(f'⚠️ [Warning] {s} has unexpected srIdx={sr}')

    print(f'\nDone! Repaired {repaired} tracks to strict 44.1kHz 96kbps CBR MP3.')

if __name__ == '__main__':
    main()

