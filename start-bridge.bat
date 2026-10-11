@echo off
rem One-click launcher for the Gemma 4 Figma MCP bridge daemon.
rem Double-click this file, leave the window open while working with Figma.
cd /d "%~dp0"
title Gemma 4 Figma MCP Bridge (close this window to stop)
echo.
echo Starting bridge daemon on ws://localhost:7575 ...
echo In Figma: Plugins ^> Development ^> Gemma 4 MCP Bridge  (click Reconnect if needed)
echo.
node dist\daemon.js
echo.
echo Bridge stopped.
pause
