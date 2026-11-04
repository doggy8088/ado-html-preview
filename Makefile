# ado-html-preview — 常用開發指令
# Run `make help` to list available targets.
# 堆疊：無套件管理器的 Chrome MV3 擴充功能（第三方函式庫內建於 vendor/），加上 bash / node 腳本。

.DEFAULT_GOAL := help

# --- variables (override on the command line: `make userscript USERSCRIPT=<path>`) ---
NODE ?= node
JQ ?= jq
USERSCRIPT ?=

.PHONY: help install build userscript test lint fmt clean

help: ## 顯示這份說明
	@awk 'BEGIN {FS = ":.*##"; printf "Usage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## 檢查必要工具（依賴已內建於 vendor/，無需安裝套件）
	@command -v $(NODE) >/dev/null || { echo "缺少 node" >&2; exit 1; }
	@command -v $(JQ) >/dev/null || { echo "缺少 jq（brew install jq）" >&2; exit 1; }
	@command -v zip >/dev/null || { echo "缺少 zip" >&2; exit 1; }
	@echo "第三方函式庫已內建於 vendor/，無需安裝依賴。"

build: ## 打包 Chrome Web Store 上架 zip（scripts/package.sh → dist/）
	./scripts/package.sh

userscript: ## 同步 md 模組到 Tampermonkey userscript（USERSCRIPT=<path> 可指定路徑）
	$(NODE) scripts/build-userscript.mjs $(USERSCRIPT)

test: ## 執行測試套件（xlsx-core 解析/渲染＋視覺驗證：紙張語意、WCAG 對比）
	$(NODE) scripts/test-xlsx-core.mjs

lint: ## 語法與靜態檢查（node --check、bash -n、JSON、appDesc 長度）
	@for f in content.js background.js preview.js md-core.js md-shell.js md-theme.js xlsx-core.js scripts/build-userscript.mjs scripts/test-xlsx-core.mjs; do \
		echo "node --check $$f"; \
		$(NODE) --check "$$f" || exit 1; \
	done
	@echo "bash -n scripts/package.sh"
	@bash -n scripts/package.sh
	@$(JQ) empty manifest.json _locales/en/messages.json _locales/zh_TW/messages.json
	@$(NODE) -e 'const fs=require("fs");let bad=0;for(const l of ["en","zh_TW"]){const m=JSON.parse(fs.readFileSync("_locales/"+l+"/messages.json","utf8"));const d=(m.appDesc&&m.appDesc.message)||"";if(d.length>132){console.error(l+" appDesc "+d.length+" 字元 > 132");bad=1;}else{console.log(l+" appDesc: "+d.length+"/132 字元");}}process.exit(bad);'

fmt: ## 套用程式碼格式化（未配置 formatter，目前僅提示）
	@echo "此專案未配置 formatter（無 package.json / linters）；如需格式化請先引入工具。"

clean: ## 移除建置產物（dist/）
	rm -rf dist
