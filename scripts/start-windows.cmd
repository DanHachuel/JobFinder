@echo off
REM ============================================================
REM  JobFinder - execucao em background no Windows (duplo clique)
REM  Chama o script PowerShell, que sobe o servidor DETACHED do
REM  terminal. Use start-windows.cmd stop para encerrar.
REM ============================================================
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" %*
exit /b %ERRORLEVEL%