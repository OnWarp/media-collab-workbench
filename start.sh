#!/bin/sh
# 自媒体协作工作台 —— 一键启动（macOS / Linux）
# 前置：安装 Node.js 16 或更高版本（推荐 18+）
# 使用：终端进入本目录后执行  ./start.sh
echo "========================================"
echo "  自媒体协作工作台 启动中..."
echo "  浏览器访问： http://localhost:3000"
echo "  局域网访问： http://<本机IP>:3000"
echo "  首次启动需初始化账号（默认不会自动创建）："
echo "  本地试用： 先执行  export ALLOW_INSECURE_DEMO_ACCOUNTS=true"
echo "            再运行本脚本，将自动创建 admin/admin123、xiaoming/member123"
echo "  生产环境： 设置 BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD"
echo "  按 Ctrl+C 停止服务"
echo "========================================"
node server.js
