import urllib.request
import urllib.parse
import os
import json
import time

SERVER_ID = "e42d70e7"
API_KEY = "ptlc_xH3DUb27dLGERsgqHo1qsearZNuPUu65nFvUMWAY1RQ"
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

worker_js_path = r"c:\Users\sanif\OneDrive\Desktop\unified-music-system\worker\index.js"
with open(worker_js_path, "r", encoding="utf-8") as f:
    worker_js_content = f.read()

print("Uploading index.js to Cloud Worker (e42d70e7)...")
send_file("index.js", worker_js_content)

print("Restarting Cloud Worker...")
restart_server()
print("Cloud Worker deployment completed!")

