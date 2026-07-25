# frond 的測試環境。
#
# 這不是 CI 的附屬設定，而是跨瀏覽器自我差分能否成立的物理前提（ADR-0004）。
# 差分的 oracle 是 frond 自己：同一本書、同一 viewport、同一組設定在三家瀏覽器
# 各跑一次互比，差異即紅燈。若三個環境解析到不同的系統字型，比對出的差異會
# 100% 是字型差異，真正的 bug 會被埋掉。
#
# 同樣的道理讓本機不能直接跑在開發者自己的作業系統上——那會製造「本機綠、
# CI 紅」這類最消耗人的落差，而落差的原因藏在字型層，極難查。所以 CI 與本機
# 共用這一個映像。

# 基底釘死到明確版本，不用 floating tag。
# 這裡的版本必須與 package.json 的 @playwright/test 一致，否則映像內的瀏覽器
# 與測試套件期待的版本會對不上。
FROM mcr.microsoft.com/playwright:v1.62.0-noble

# ---------------------------------------------------------------------------
# 字型
# ---------------------------------------------------------------------------
#
# CJK 字型統一使用 Noto CJK：繁體中文、簡體中文、日文共用同一個字型家族。
# 理由是避免各語系混用不同設計的字型——那會讓三家瀏覽器各自的 fallback 路徑
# 有機會分歧，而分歧點藏在字型層極難查。
#
# 版本釘死的理由不是一般的可重現性衛生，而是：字型更新會改變字形度量，字形
# 度量改變會改變斷行，斷行改變會改變斷頁。一次無意的更新可以讓整批不變量與
# 差分測試同時變色，而變色的原因與 frond 的程式碼無關。
#
# 只裝 fonts-noto-cjk（regular 與 bold，安裝後約 91 MB），不裝
# fonts-noto-cjk-extra（其餘字重，再多約 214 MB）。目前沒有任何 fixture 用到
# regular / bold 以外的字重；等真的有的時候再加，並在此記下原因。
ARG FONTS_NOTO_CJK_VERSION=1:20230817+repack1-3
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        "fonts-noto-cjk=${FONTS_NOTO_CJK_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# 把 generic family 與區域字面綁死。只是「裝了字型」不夠：serif 與 sans-serif
# 的解析順序仍可能因基底映像更新而改變，而區域字面（TC / SC / JP）的選用若
# 交給各家瀏覽器自己的語言比對，三家可能對同一本日文書選到不同字面。
COPY docker/fontconfig/10-frond-cjk.conf /etc/fonts/conf.d/10-frond-cjk.conf
RUN fc-cache --force --really-force

# 建置期驗證字型綁定確實生效。放在這裡而不是留給測試，是因為綁定失敗的失敗
# 模式是「靜默 fallback 到別的字型」——那不會報錯，只會讓後續每一個幾何數字
# 都建立在錯的字型上。寧可在 build 就炸掉。
COPY docker/verify-fonts.sh /usr/local/bin/frond-verify-fonts
RUN chmod +x /usr/local/bin/frond-verify-fonts && frond-verify-fonts

# ---------------------------------------------------------------------------
# 測試套件
# ---------------------------------------------------------------------------
WORKDIR /work

# 先只複製 manifest，讓相依層在原始碼變動時仍能命中 build cache。
COPY package.json package-lock.json ./
# 瀏覽器已經在基底映像裡，不需要再下載一次。
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

COPY . .

CMD ["npx", "playwright", "test"]
