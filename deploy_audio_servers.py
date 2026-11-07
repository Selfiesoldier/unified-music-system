import urllib.request
import urllib.parse
import os
import json
import time

AUDIO_SERVERS = [
    {
        "id": "00f50ae1",
        "key": "ptlc_xH3DUb27dLGERsgqHo1qsearZNuPUu65nFvUMWAY1RQ",
        "port": "30238",
        "room_id": "room1",
        "room_name": "Room 1 (Main Lounge)"
    },
    {
        "id": "4c1b3907",
        "key": "ptlc_UDJ3zLc9mdsYEeMnEKbApVX3daRQYvfyWn0xc7Efqv9",
        "port": "30289",
        "room_id": "room2",
        "room_name": "Room 2 (Party Room)"
    }
]

base_dir = r"c:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server"
files_to_deploy = [
    ("server.js", os.path.join(base_dir, "server.js")),
    ("src/persistentStreamManager.js", os.path.join(base_dir, "src", "persistentStreamManager.js")),
    ("src/audioPlayer.js", os.path.join(base_dir, "src", "audioPlayer.js")),
    ("src/mp3Validator.js", os.path.join(base_dir, "src", "mp3Validator.js")),
    ("assets/silence_96k.mp3", os.path.join(base_dir, "assets", "silence_96k.mp3")),
    ("public/index.html", os.path.join(base_dir, "public", "index.html")),
    ("public/css/style.css", os.path.join(base_dir, "public", "css", "style.css")),
    ("public/js/app.js", os.path.join(base_dir, "public", "js", "app.js"))
]

def upload_file(server_id, api_key, remote_path, content_bytes):
    url = f"https://panel.orihost.com/api/client/servers/{server_id}/files/write?file=" + urllib.parse.quote(remote_path)
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "text/plain",
        "Accept": "application/json"
    }
    req = urllib.request.Request(url, data=content_bytes, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status

def delete_file(server_id, api_key, root_dir, file_list):
    url = f"https://panel.orihost.com/api/client/servers/{server_id}/files/delete"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = json.dumps({"root": root_dir, "files": file_list}).encode("utf-8")
    try:
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
        with urllib.request.urlopen(req) as resp:
            return resp.status
    except Exception as e:
        return str(e)

def restart_server(server_id, api_key):
    url = f"https://panel.orihost.com/api/client/servers/{server_id}/power"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = json.dumps({"signal": "restart"}).encode("utf-8")
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        return resp.status

for s in AUDIO_SERVERS:
    sid = s["id"]
    key = s["key"]
    print(f"\n🚀 Deploying Dashboard & Proxy to Audio Server {sid} ({s['room_name']})...")

    # 1. Update .env
    env_content = f"""PORT={s['port']}
AUDIO_SECRET=supersecret_audio_key_123
AUDIO_BITRATE=96k
CONTROLLER_URL=http://2.56.246.119:30195
ROOM_ID={s['room_id']}
ROOM_NAME={s['room_name']}
ENABLE_TRANSITION_MUSIC=false
NODE_ENV=production
"""
    st = upload_file(sid, key, ".env", env_content.encode("utf-8"))
    print(f"  ✅ Uploaded .env (HTTP {st})")

    # 2. Upload files
    for remote_name, local_path in files_to_deploy:
        with open(local_path, "rb") as f:
            data = f.read()
        st = upload_file(sid, key, remote_name, data)
        print(f"  ✅ Uploaded {remote_name} (HTTP {st})")

    # 3. Purge legacy ffmpegHelper.js if present
    del_st = delete_file(sid, key, "/src", ["ffmpegHelper.js"])
    print(f"  🗑️ Purged legacy ffmpegHelper.js ({del_st})")

    # 4. Restart
    rst = restart_server(sid, key)
    print(f"  🔄 Restart signal sent to {sid} (HTTP {rst})")

print("\n🎉 Deployment completed for all Audio Servers!")

