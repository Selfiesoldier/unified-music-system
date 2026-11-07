# System Architecture: Highrise Music Fleet & Engine

```mermaid
flowchart TD
    subgraph Clients["🎧 Clients & Rooms"]
        HR1["Highrise Bot (Room 1)"]
        HR2["Highrise Bot (Room 2)"]
        WEB["Dashboard User (Browser)"]
    end

    subgraph AudioFleet["⚡ Zero-CPU Audio Servers (96kbps CBR)"]
        AS1["Audio Server 1 (DE-04: 30238)<br/>Station: pakmusic"]
        AS2["Audio Server 2 (DE-06: 30289)<br/>Station: kmrmusic"]
    end

    subgraph ControlPlane["🎛️ Central Controller (Node DE-05: 30195)"]
        CTRL["Main Controller (server.js)<br/>• Multi-Room Queue State<br/>• Web UI & SSE Events<br/>• Direct MP3 Upload API<br/>• LRU Cache Pruner (Max 10)"]
    end

    subgraph Ingestion["📥 Hierarchical Ingestion Pipeline"]
        L1["L1: Local Controller Cache<br/>(Max 10 Songs, 10 TTS)"]
        L2["L2: Telegram Cloud Vault CDN<br/>(857 Cached Songs, 0% CPU, 0s DL)"]
        L3A["L3 Residential: Termux Bridge<br/>(Cloudflare Tunnel - YouTube Bypass)"]
        L3B["L3 Cloud: Worker e42d70e7<br/>(JioSaavn Akamai Direct CDN)"]
    end

    HR1 -->|Streams audio| AS1
    HR2 -->|Streams audio| AS2
    WEB -->|Manages queue / uploads| CTRL

    CTRL -->|Feeds 96k CBR MP3 stream| AS1
    CTRL -->|Feeds 96k CBR MP3 stream| AS2

    CTRL -->|1. Check| L1
    CTRL -->|2. Check| L2
    CTRL -->|3. Fallback (YT)| L3A
    CTRL -->|3. Fallback (Saavn)| L3B

    L3A -.->|Upload to L2 Vault| L2
    L3B -.->|Upload to L2 Vault| L2
```

## Component Directory

| Component | Node / Host | Port | Key Role |
| :--- | :--- | :--- | :--- |
| **Main Controller** | Node DE-05 (`2.56.246.119`) | `30195` | Central coordinator, Web UI dashboard, state persistence, 10-track LRU cache. |
| **Audio Server 1** | Node DE-04 (`92.118.206.166`) | `30238` | Dedicated Icecast/ICY streamer for Room 1 (`pakmusic`). ~3% CPU. |
| **Audio Server 2** | Node DE-06 (`2.56.246.128`) | `30289` | Dedicated Icecast/ICY streamer for Room 2 (`kmrmusic`). ~2.9% CPU. |
| **Cloud Worker** | Node DE-09 (`176.100.37.77`) | `30229` | Pure JS DES decryption engine for JioSaavn CDN audio. Max 10 songs cache. |
| **Residential Bridge**| Android Mobile (Termux) | Cloudflare | YouTube anti-bot bypass via residential IP. Max 10 songs / 10 TTS. |
| **Telegram Cloud Vault**| Telegram CDN | Global | L2 storage for 857 pre-encoded tracks with zero download latency. |
| **Highrise Bot** | Server `bf9ef46f` | Internal | Connects to Audio Server stream and broadcasts into virtual room. |

