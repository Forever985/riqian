@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Requesting administrator privileges...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','%~dp0cleanup-android-c-parts.ps1' -Verb RunAs"