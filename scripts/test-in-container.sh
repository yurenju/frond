#!/usr/bin/env bash
#
# 在測試容器內跑測試。CI 與本機共用同一個映像——這是刻意的，見
# docs/test-environment.md。
#
# 用法：
#   ./scripts/test-in-container.sh                     # 三家瀏覽器跑全部測試
#   ./scripts/test-in-container.sh --project=firefox   # 其餘參數原樣傳給 playwright
#
set -euo pipefail

IMAGE_NAME="${FROND_TEST_IMAGE:-frond-test}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# podman 優先。理由不是偏好，是權限模型：docker 的 socket 等同 host root，
# 把開發者或 agent 加進 docker 群組等於開一條升權路徑。rootless podman 跑在
# 一般 uid 底下，沒有 daemon 也沒有等同 root 的 socket。
if command -v podman >/dev/null 2>&1; then
    ENGINE=podman
elif command -v docker >/dev/null 2>&1; then
    ENGINE=docker
else
    echo "找不到 podman 或 docker。安裝方式見 docs/test-environment.md。" >&2
    exit 1
fi

# --- build -----------------------------------------------------------------
#
# build 期的網路有一個容易踩的坑：映像的 RUN 步驟（apt-get、npm ci）跑在容器
# 自己的 network namespace，那裡的 127.0.0.1 是容器的 loopback，不是外面的
# proxy。在有 proxy 的環境下若不處理，RUN 會直接連不出去。
#
# 解法是讓 build 走 host 的 network namespace，並把 proxy 設定傳進去。沒有
# proxy 的環境（例如 GitHub Actions）這些變數是空的，兩個參數都不會加上去。
build_args=()
if [[ -n "${HTTPS_PROXY:-${https_proxy:-}}" ]]; then
    proxy="${HTTPS_PROXY:-${https_proxy:-}}"
    build_args+=(
        --network=host
        --build-arg "https_proxy=${proxy}"
        --build-arg "http_proxy=${HTTP_PROXY:-${http_proxy:-$proxy}}"
        --build-arg "no_proxy=${NO_PROXY:-${no_proxy:-localhost,127.0.0.1}}"
    )
fi

echo "==> 以 ${ENGINE} 建置 ${IMAGE_NAME}"
"$ENGINE" build "${build_args[@]}" --tag "$IMAGE_NAME" "$REPO_ROOT"

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

echo "==> 執行測試"
exec "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx playwright test "$@"
