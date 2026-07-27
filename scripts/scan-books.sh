#!/usr/bin/env bash
#
# 拿一批**實際流通的書**跑 Playwright，用來找「合成 fixture 上全綠、書上壞掉」
# 的那一類缺陷（CONTEXT.md 的「範本書」）。
#
# 用法：
#   FROND_BOOKS=/path/to/books npm run scan:books -- tests/browser/evidence/<名字>.spec.ts
#   FROND_BOOKS=/path/to/books npm run scan:books -- tests/browser/evidence/<名字>.spec.ts --project=webkit
#
# 書由 `FROND_BOOKS` 指定，掛進容器裡的 `tests/books/commercial`（`.gitignore`
# 已列，ADR-0007：商業書不進 repo）。**唯讀掛載而不是複製進映像**有兩個理由：
# 那些書有版權，不該進 build context 也不該落在 repo 樹裡；而幾百 MB 的書塞進
# 映像會讓每一次改一行 spec 都要重打包一次 context。
#
# 一次性的掃描 spec 放 `tests/browser/evidence/`（同樣已 gitignore，但 `COPY . .`
# 看的是檔案系統而不是 git，所以不必先 commit——同 capture-evidence.sh）。
set -euo pipefail

# 挑引擎、確認連得到 daemon、建置映像。三件事與另外兩支共用。
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

BOOKS="${FROND_BOOKS:-$REPO_ROOT/tests/books/commercial}"

if [[ ! -d "$BOOKS" ]]; then
    echo "找不到書的目錄：$BOOKS" >&2
    echo "用 FROND_BOOKS=<目錄> 指定，或把書放進 tests/books/commercial/。" >&2
    exit 2
fi

if [[ $# -eq 0 ]]; then
    echo "用法：FROND_BOOKS=<目錄> npm run scan:books -- <spec 路徑> [playwright 參數]" >&2
    exit 2
fi

container_build

# 網路照樣關掉（同 test-in-container.sh）：書由檔案系統供給，掃描不該需要連外。
exec "$ENGINE" run --rm --init --network=none \
    --volume "${BOOKS}:/work/tests/books/commercial:ro" \
    "$IMAGE_NAME" npx playwright test "$@"
