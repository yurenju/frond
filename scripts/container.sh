#!/usr/bin/env bash
#
# 容器引擎的共用前置：挑引擎、確認連得到、建置映像。
#
# **這支不是拿來執行的，是給其他腳本 `source` 的**——`test-in-container.sh`
# （跑測試）與 `capture-evidence.sh`（取截圖）都要在同一個映像裡跑，而「怎麼跟
# 容器引擎講話」只能有一個答案。各寫一份的話，兩邊對 rootless socket 的診斷、
# 對 proxy 的處置遲早會漂開，而漂開的那一天，兩支腳本會在同一台機器上一支能跑
# 一支不能——那種症狀很難查到根因是「有兩份設定」。
#
# source 之後可以用：
#   ENGINE           podman 或 docker
#   REPO_ROOT        repo 根目錄的絕對路徑
#   IMAGE_NAME       映像名稱
#   container_build  建置映像
#
# 需要新的容器跑法時**加一支腳本並 source 這一支**，不要在文件或提交訊息裡留
# 一行裸的 docker 指令（AGENTS.md）。

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
container_build() {
    echo "==> 以 ${ENGINE} 建置 ${IMAGE_NAME}"
    "$ENGINE" build --tag "$IMAGE_NAME" "$REPO_ROOT"
}
