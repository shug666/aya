#!/bin/bash

# 确保脚本在正确的目录下执行
cd "$(dirname "$0")"

echo "🚀 [1/3] 检查并清理可能被占用的 8080 端口..."
fuser -k 8080/tcp 2>/dev/null || true

# 当脚本退出时（比如关闭了 Electron 客户端），自动杀掉后台的 npm run dev
trap 'echo "🛑 应用已关闭，正在清理后台服务..."; kill $(jobs -p) 2>/dev/null || true; fuser -k 8080/tcp 2>/dev/null || true' EXIT

# 为了避免读取到旧文件，先删除历史构建产物
rm -f dist/main/index.js

echo "🚀 [2/3] 后台启动 Vite 开发服务器 (npm run dev)..."
npm run dev &

echo "⏳ 等待 Vite 和主进程构建完成 (正在等待文件生成)..."
# 循环等待，直到 index.js 文件生成（由于 Vite 初次构建可能需要 5-8 秒）
while [ ! -f "dist/main/index.js" ]; do
  sleep 1
done
# 额外等待1秒确保文件完全写入磁盘
sleep 1

echo "🚀 [3/3] 启动 Electron 客户端..."
npm start
