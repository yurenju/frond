#!/bin/sh
#
# 建置期的字型綁定驗證。
#
# 為什麼在 build 就檢查而不是留給測試：字型綁定失敗的失敗模式是「靜默 fallback
# 到別的字型」。那不會報錯，也不會讓任何斷言變紅——只會讓後續每一個幾何數字都
# 建立在錯的字型上，而且三家瀏覽器可能各自 fallback 到不同的地方，於是跨瀏覽器
# 差分開始亮起與 frond 程式碼無關的紅燈。寧可在這裡炸掉。
#
# 這支腳本同時回答一個 issue #3 開票時還沒確認的問題：Ubuntu 的 fonts-noto-cjk
# 到底有沒有涵蓋 Noto Serif CJK。套件描述只寫 "CJK regular and bold"，沒說
# Sans / Serif 的分佈。如果沒有涵蓋，下面第一組斷言就會失敗，而不是讓 serif
# 靜默 fallback。

set -eu

failed=0

report_failure() {
    echo "  ✗ $1"
    echo "      期待包含: $2"
    echo "      實際解析: $3"
    failed=1
}

# 斷言某個 fontconfig pattern 解析到預期的字面。
assert_face() {
    pattern="$1"
    expected="$2"

    actual="$(fc-match --format='%{family}' "$pattern")"

    case "$actual" in
        *"$expected"*)
            echo "  ✓ $pattern → $actual"
            ;;
        *)
            report_failure "$pattern" "$expected" "$actual"
            ;;
    esac
}

echo "frond 字型綁定驗證"
echo

echo "generic family 的預設解析（無 lang 資訊）"
assert_face 'serif'      'Noto Serif CJK TC'
assert_face 'sans-serif' 'Noto Sans CJK TC'
echo

echo "區域字面依 lang 的解析"
assert_face 'serif:lang=ja'         'Noto Serif CJK JP'
assert_face 'sans-serif:lang=ja'    'Noto Sans CJK JP'
assert_face 'serif:lang=zh-tw'      'Noto Serif CJK TC'
assert_face 'sans-serif:lang=zh-tw' 'Noto Sans CJK TC'
assert_face 'serif:lang=zh-cn'      'Noto Serif CJK SC'
assert_face 'sans-serif:lang=zh-cn' 'Noto Sans CJK SC'
echo

if [ "$failed" -ne 0 ]; then
    cat <<'EOF'

字型綁定驗證失敗。

映像內實際安裝的 Noto CJK 字面如下，用來對照上面「實際解析」的落點：

EOF
    fc-list : family | tr ',' '\n' | grep -i 'noto.*cjk' | sort -u | sed 's/^/  /'

    cat <<'EOF'

常見原因與處置：

  * 清單裡完全沒有 Noto Serif CJK
    → fonts-noto-cjk 這個版本沒有涵蓋 Serif。需要另外取得 Noto Serif CJK 並
      同樣釘死版本。不可讓 serif 靜默 fallback 到別的字型（issue #3）。

  * 清單裡的字面名稱與預期不同（例如帶有不同的區域後綴或改成可變字型命名）
    → Noto CJK 的發佈形式隨版本變動過。對照實際名稱更新
      docker/fontconfig/10-frond-cjk.conf 與本檔的預期值，並在 commit
      訊息記下版本與名稱的對應。

  * 名稱都在、但解析落到別的字面
    → fontconfig 的 match 順序有問題。通則要寫在語言特化之前，因為
      mode="prepend" 是後者蓋前者。

EOF
    exit 1
fi

echo "字型綁定驗證通過。"
