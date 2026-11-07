@echo off
title Telegram Music Vault Archiver (Local Laptop Engine)
color 0A
cls
echo ========================================================
echo    TELEGRAM PLAYLIST ARCHIVER & CLOUD INGESTER
echo ========================================================
echo  * Local Engine: 96kbps CBR MP3 Single-Thread Studio Transcode
echo  * Cloud Destination: Telegram Vault Channel (-1004463400168)
echo  * Deduplication: Active (Zero Duplicate Uploads)
echo ========================================================
echo.
echo Starting local archiver server on http://localhost:4500 ...
timeout /t 2 /nobreak >nul
start http://localhost:4500
node server.js
pause

