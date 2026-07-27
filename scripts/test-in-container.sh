#!/usr/bin/env bash
#
# 在測試容器內跑測試。CI 與本機共用同一個映像——這是刻意的，見
# docs/test-environment.md。
#
# 兩個 runner 都在這裡跑（ADR-0009）：先 Vitest 的 Node 測試，再 Playwright 的
# 三瀏覽器測試。Node 那半邊不依賴字型或瀏覽器，但仍然放進容器——一個入口、
# 一套版本，本機與 CI 對「測試全綠」的定義才會是同一件事。
#
# 用法：
#   ./scripts/test-in-container.sh                     # 兩個 runner 全跑
#   ./scripts/test-in-container.sh --project=firefox   # 其餘參數原樣傳給 playwright
#
# 要的是截圖而不是紅綠燈時，用 ./scripts/capture-evidence.sh：這一支以 --rm
# 執行、也不掛任何可寫的目錄，容器裡產出的檔案跟著容器一起消失。
set -euo pipefail

# 挑引擎、確認連得到 daemon、建置映像。三件事與 capture-evidence.sh 共用。
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build

# --- run -------------------------------------------------------------------
#
# 測試期完全不需要網路：所有頁面都由 page.setContent 供給，沒有外部資源。
# 明確關掉網路，順便保證沒有測試偷偷依賴外部連線——那種依賴會在別人的環境
# 變成無法重現的紅燈。
run_args=(--rm --init --network=none)

# CI 要進得去容器，否則 playwright.config.ts 裡看 process.env.CI 的分支
# （forbidOnly、github reporter、html reporter）在 CI 上全都是死的。
# 報告寫在容器內，不掛出來的話 --rm 一收就沒了，CI 的 artifact 會永遠是空的。
if [[ -n "${CI:-}" ]]; then
    mkdir -p "$REPO_ROOT/playwright-report"
    run_args+=(
        --env CI
        --volume "${REPO_ROOT}/playwright-report:/work/playwright-report"
    )
fi

# Node 測試先跑。它幾秒就結束，而且蓋的是瀏覽器測試所依賴的東西（例如合成
# fixture 的結構）——那一層壞掉時，先看到「fixture 不是一本合規的書」比先看到
# 三家瀏覽器一起紅要好查得多。
echo "==> 執行 Node 測試（Vitest）"
"$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx vitest run

echo "==> 執行瀏覽器測試（Playwright）"
exec "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx playwright test "$@"
