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

# 引擎在 PATH 上不等於連得到 daemon。少了這一步，設定沒接好的機器會一路走到
# build 才炸，而錯誤訊息是 socket 路徑不存在——看起來像沒裝，實際上是裝了但
# client 沒指對地方，兩者的處置完全不同。
#
# 這裡只**診斷**不代打：socket 位置屬於容器引擎的設定，不是測試腳本的責任
# （同 build 段那條 proxy 的理由）。腳本自己去猜 socket 在哪，會把一台設錯的
# 機器靜默修好，於是沒有人知道它是錯的。
if ! "$ENGINE" info >/dev/null 2>&1; then
    echo "找到 ${ENGINE} 但連不到 daemon。" >&2
    if [[ "$ENGINE" == docker && -S "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" ]]; then
        # rootless dockerd 跑著，但 client 還指著 rootful 的 /var/run/docker.sock。
        # dockerd-rootless-setuptool.sh 裝完會要求做這一步，漏掉不會有任何警告。
        echo "rootless 的 socket 在 ${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock，但 client 沒指過去。接上：" >&2
        echo "    docker context create rootless --docker host=unix://${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock" >&2
        echo "    docker context use rootless" >&2
    else
        echo "檢查 daemon 是否在跑，以及 client 指向何處（docker context ls / DOCKER_HOST）。" >&2
    fi
    echo "見 docs/test-environment.md。" >&2
    exit 1
fi

# --- build -----------------------------------------------------------------
#
# 這裡刻意不處理 proxy。
#
# 直覺的做法是把外面的 HTTP_PROXY 用 --build-arg 傳進去，但那是錯的：出口
# proxy 通常掛在 127.0.0.1 上，而那個位址在容器的 network namespace 裡指向
# 容器自己的 loopback，不是外面的 proxy。傳進去只會把引擎本來設對的值蓋掉，
# 讓 apt-get 撞上 connection refused。
#
# proxy 屬於容器引擎的設定而不是測試腳本的責任。rootless docker 會自行把
# daemon 的 proxy 設定注入每個容器（指向 slirp gateway 而非 loopback）。
# 沒有 proxy 的環境（例如 GitHub Actions）本來就不需要任何處理。
echo "==> 以 ${ENGINE} 建置 ${IMAGE_NAME}"
"$ENGINE" build --tag "$IMAGE_NAME" "$REPO_ROOT"

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
