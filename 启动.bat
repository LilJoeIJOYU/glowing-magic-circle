@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 正在启动本地服务器…
echo.
echo 浏览器将自动打开 http://127.0.0.1:8123/
echo 关闭此窗口即可停止服务。
echo.
start "" http://127.0.0.1:8123/
python -m http.server 8123 --bind 127.0.0.1 2>nul || py -m http.server 8123 --bind 127.0.0.1
pause
