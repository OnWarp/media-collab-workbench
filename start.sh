#!/bin/sh
# 自媒体协作工作台 —— 一键启动（macOS / Linux）
# 前置：安装 Node.js 16 或更高版本（推荐 18+）
# 使用：终端进入本目录后执行  ./start.sh
echo "========================================"
echo "  自媒体协作工作台 启动中..."
echo "  浏览器访问： http://localhost:3000"
echo "  局域网访问： http://<本机IP>:3000"
echo "  默认账号：  admin / admin123（管理员）"
echo "            xiaoming / member123（成员）"
echo "  按 Ctrl+C 停止服务"
echo "========================================"
node server.js
