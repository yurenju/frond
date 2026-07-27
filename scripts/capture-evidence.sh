#!/usr/bin/env bash
#
# 把一支一次性的 Playwright spec 產出的截圖帶出容器，落在 `docs/evidence/` 底下。
#
# 開 PR 前跟視覺有關的變更要三家都跑過、由 agent 判讀，判讀結果與圖一起寫進 PR
# 說明（ADR-0001、docs/agents/pull-requests.md）。而**圖是在容器裡產生的**——
# 三家瀏覽器與釘死的字型只存在於測試映像裡，在 host 上截出來的圖字型不對，量到
# 的東西也就不是 CI 會看到的東西。
#
# 用法：
#   npm run evidence -- tests/browser/evidence/<名字>.spec.ts
#   npm run evidence -- tests/browser/evidence/<名字>.spec.ts --project=webkit
#
# 第一個參數以後原樣傳給 playwright。**至少要給一個路徑**：不給的話就會用一個
# 可寫的掛載跑完整套測試，那不是任何人想要的。
#
# ## 一次性的 spec 放哪裡、為什麼進得了容器
#
# 放 `tests/browser/evidence/`（該目錄已 gitignore——這種 spec 不留在 repo，
# 見 docs/agents/pull-requests.md）。要放在 `tests/browser/` 底下是因為
# playwright.config.ts 的 testDir 指著它，外面的檔案不會被收進來。
#
# 那個目錄被 git 忽略，但**映像照樣拿得到**：build context 看的是檔案系統而不是
# git，`Dockerfile` 的 `COPY . .` 會把未追蹤的檔案一起帶進去。所以流程是「寫
# spec → 跑這一支（它會重建映像）」，不需要先 commit。
set -euo pipefail

# 挑引擎、確認連得到 daemon、建置映像。三件事與 test-in-container.sh 共用。
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

if [[ $# -eq 0 ]]; then
    echo "用法：npm run evidence -- <spec 路徑> [playwright 參數]" >&2
    echo "例：  npm run evidence -- tests/browser/evidence/vertical.spec.ts --project=webkit" >&2
    exit 2
fi

EVIDENCE_DIR="$REPO_ROOT/docs/evidence"

# 先在 host 上建好。掛載點若不存在，引擎會**代為建立**一個 root 擁有的目錄，
# 而那是一個要 sudo 才刪得掉的殘骸。
mkdir -p "$EVIDENCE_DIR"

container_build

# --- run -------------------------------------------------------------------
#
# ## 為什麼是掛一個目錄，而不是事後 `cp` 出來
#
# 容器以 `--rm` 收掉，寫在裡面的檔案跟著消失；不加 `--rm` 再 `docker cp`
# 也可以，但那要多管一個「容器有沒有被收乾淨」的狀態，而漏收的容器會靜靜地
# 佔著幾 GB。掛載是同一件事的無狀態版本，也與 CI 掛 playwright-report 出去的
# 做法一致（test-in-container.sh）。
#
# ## 只掛 docs/evidence，不掛整個 repo
#
# 把 repo 掛進去看起來更方便（不必重建映像），但那會讓「容器裡跑的是哪一份程式
# 碼」變成兩個答案：build 進去的那一份，與掛進來的那一份。它們在 npm ci 的產物
# 上必然不同——`node_modules` 是在映像裡裝的。而且掛整個 repo 等於讓容器有機會
# 改寫原始碼。
#
# ## 檔案會是誰的
#
# rootless 引擎下，容器的 root 對應到 host 上你自己的 uid，所以寫出來的檔案就是
# 你的。**rootful docker 會產出 root 擁有的 PNG**，之後 git 動不了它——那是
# docs/test-environment.md 建議 rootless 的又一個具體理由。
#
# ## 網路照樣關掉
#
# 截圖與測試同一個要求：頁面由 page.setContent 供給。一張需要連外才截得出來的
# 圖，換一台機器就截不出來了。
exec "$ENGINE" run --rm --init --network=none \
    --volume "${EVIDENCE_DIR}:/work/docs/evidence" \
    "$IMAGE_NAME" npx playwright test "$@"
