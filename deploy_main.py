import urllib.request
import urllib.parse
import os
import time

SERVER_ID = "6a95145f"
API_KEY = "ptlc_UDJ3zLc9mdsYEeMnEKbApVX3daRQYvfyWn0xc7Efqv9"
BASE_URL = "https://panel.orihost.com/api/client/servers/" + SERVER_ID

def send_file(filename, content):
    url = f"{BASE_URL}/files/write?file=" + urllib.parse.quote(filename)
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "text/plain",
        "Accept": "application/json"
    }
    req = urllib.request.Request(url, data=content.encode("utf-8"), headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        print(f"Uploaded {filename}: HTTP {resp.status}")

def restart_server():
    url = f"{BASE_URL}/power"
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    payload = b'{"signal":"restart"}'
    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    with urllib.request.urlopen(req) as resp:
        print(f"Restart signal sent: HTTP {resp.status}")

env_content = """PORT=30195
ADMIN_PASSWORD=changeme
SESSION_SECRET=main_server_session_secret_key_123
CONTROLLER_URL=http://2.56.246.119:30195
AUDIO_SERVER_URL=http://92.118.206.166:30238
AUDIO_SERVER_URL_ROOM2=http://2.56.246.128:30289
AUDIO_SECRET=supersecret_audio_key_123
DOWNLOAD_WORKER_URL=http://92.118.206.201:30229
BOT_IPC_URL=http://127.0.0.1:5001
IPC_SECRET=highrise_music_secret_2026
CACHE_DIR=/home/container/cache
NODE_ENV=production
TELEGRAM_BOT_TOKEN=9109239162:AAE01QXTy4LhP5o6MvJ7DUYL_4kzBbSp5k4
TELEGRAM_VAULT_CHAT_ID=-1004463400168"""

send_file(".env", env_content)

validator_js_path = r"c:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\src\mp3Validator.js"
with open(validator_js_path, "r", encoding="utf-8") as f:
    validator_content = f.read()
send_file("src/mp3Validator.js", validator_content)

server_js_path = r"c:\Users\sanif\OneDrive\Desktop\unified-music-system\main-server\server.js"
with open(server_js_path, "r", encoding="utf-8") as f:
    server_js_content = f.read()

send_file("server.js", server_js_content)

print("Restarting server...")
restart_server()
print("Deployment completed!")

