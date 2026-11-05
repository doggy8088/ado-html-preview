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
  xlsx-core.js docx-core.js docx-runtime.js pptx-core.js pptx-runtime.js \
  vendor/marked.min.js vendor/purify.min.js vendor/highlight.min.js vendor/mermaid.min.js \
  vendor/xlsx.full.min.js \
  vendor/pptx-renderer/LICENSE vendor/pptx-renderer/THIRD_PARTY_NOTICES.md \
  vendor/pptx-renderer/mtx-decompressor-MPL-2.0.txt vendor/pptx-renderer/ECMA-text-copyright-notice.txt \
  icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png \
  _locales/en/messages.json _locales/zh_TW/messages.json

echo "packaged: $OUT"

# 自我檢查：manifest 引用到的檔案都必須在 zip 內
# （曾漏掉 xlsx-core / docx-core / docx-runtime / vendor-xlsx——殘缺 zip 送商店必被拒）
# 註：vendor/pptx-renderer/ 的原始 ESM 檔不必打包——執行期只用 pptx-runtime.js（由它產生的原始碼字串）；
#     但授權檔要隨附（Apache-2.0 要求附上授權；內含的 mtx-decompressor 為 MPL-2.0）
# 清單先存起來再比對：`unzip | grep -q` 在 pipefail 下會因 grep 提早結束、unzip 收到 SIGPIPE 而隨機誤報缺漏
ZIP_LIST="$(unzip -Z1 "$OUT")"
MISSING=""
for f in $(jq -r '[(.content_scripts[]?.js[]? // empty), (.web_accessible_resources[]?.resources[]? // empty), (.icons[]? // empty), (.background.service_worker? // empty), "_locales/en/messages.json", "_locales/zh_TW/messages.json"] | unique | .[]' manifest.json); do
  grep -qxF "$f" <<<"$ZIP_LIST" || MISSING="$MISSING $f"
done
if [ -n "$MISSING" ]; then
  echo "錯誤：zip 缺漏 manifest 引用的檔案:$MISSING" >&2
  exit 1
fi
echo "manifest 引用檔案全數在 zip 內 ✓"

unzip -l "$OUT"
