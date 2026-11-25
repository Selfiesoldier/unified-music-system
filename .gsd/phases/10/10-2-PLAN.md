---
phase: 10
plan: 2
wave: 1
gap_closure: false
---

# Plan 10.2: Audio Server Security Hardening & Dead Code Cleanup

## Objective
Fix spoofable `X-Forwarded-For` DDoS/whitelist bypass, remove query-string secret leakage, restrict local file access on `/play` and `/announce`, and remove unused imports in `audio-server/server.js`.

## Context
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\.gsd\SPEC.md`
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\server.js`
- `C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\public\js\cockpit.js`

## Tasks

<task type="auto">
  <name>Fix getClientIp spoofing, remove query-string secret auth, and validate local/remote paths</name>
  <files>
    audio-server/server.js
  </files>
  <action>
    1. In `getClientIp(req)` (`server.js:105-115`):
       - Read `rawIp` from `req.socket?.remoteAddress || req.ip || 'unknown'` (stripping `::ffff:`).
       - Only trust `X-Forwarded-For` / `CF-Connecting-IP` when `rawIp` is a trusted local/loopback proxy (`127.0.0.1` or `::1`), preventing external callers from spoofing `X-Forwarded-For: 127.0.0.1` to bypass DDoS limits and `WHITELIST_IPS`.
    2. In `requireSecretCheck(req)` (`server.js:277-299`):
       - Remove `req.query.secret` / `req.query.token` query-string authentication so secrets never appear in URLs or logs (`cockpit.js` and `main-server` already use `Authorization` / `x-admin-key` headers).
    3. In `POST /play` and `POST /announce`:
       - For local file paths, resolve with `path.resolve(...)` and reject any path containing `..` traversal or outside `assetsDir` / `process.cwd()` (while keeping `http://` and `https://` URLs working normally).
       - For `webhookUrl` in `POST /play`, reject non-HTTP(S) URLs with `400`.
    4. Remove unused `readline` and `pipeline` imports from `server.js:7,9`.
  </action>
  <verify>
    node --check "C:\Users\sanif\OneDrive\Desktop\unified-music-system\audio-server\server.js"
    # Verify X-Forwarded-For from non-loopback socket cannot spoof WHITELIST_IPS and ?secret= returns 401
  </verify>
  <done>
    `server.js` passes `node --check`, `getClientIp` ignores spoofed `X-Forwarded-For` from external sockets, query-string secrets are rejected, local path traversal is blocked, and unused imports are removed.
  </done>
</task>

## Success Criteria
- [ ] External `X-Forwarded-For: 127.0.0.1` spoofing no longer bypasses rate limits or `WHITELIST_IPS`
- [ ] `?secret=` / `?token=` query-string auth is removed without breaking `cockpit.js` or `main-server`
- [ ] Local path traversal (`..`) is blocked on `/play` and `/announce`
- [ ] Unused `readline` and `pipeline` imports are removed
