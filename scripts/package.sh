#!/usr/bin/env bash
# 把擴充功能打包成 Chrome Web Store 可上傳的 zip。
# 只收錄執行期需要的檔案；文件、工作流程、1024 母檔圖示一律排除。
# 用法：scripts/package.sh            → dist/ado-html-preview-<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v jq >/dev/null || { echo "需要 jq（brew install jq）" >&2; exit 1; }
VERSION="$(jq -r .version manifest.json)"
NAME="ado-html-preview"
OUT="dist/${NAME}-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

zip -X -r "$OUT" \
  manifest.json \
  background.js \
  content.js \
  preview.html \
  preview.js \
  sandbox.html \
  md-core.js md-shell.js md-theme.js \
  vendor/marked.min.js vendor/purify.min.js vendor/highlight.min.js vendor/mermaid.min.js \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  _locales/en/messages.json _locales/zh_TW/messages.json

echo "packaged: $OUT"
unzip -l "$OUT"
