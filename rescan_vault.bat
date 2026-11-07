@echo off
title Telegram Vault Rescanner
cd /d "%~dp0"
echo ====================================================
echo Telegram Vault Rescanner
echo ====================================================
echo.
node rescan_vault.js %*
echo.
pause

