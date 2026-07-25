# 散佈方式與授權

公開 repo、MIT 授權。**暫不發佈 npm**——spine 以 git dependency（pin 住 commit）消費 frond，等 API 穩定後再發。

理由不是技術而是承諾：**發上 npm 等於隱含承諾 semver 與 API 穩定**，而 frond 第一個月的 API 一定會大改（整個專案的前提就是「不確定 foliate 的切法對不對」，那自己也不會第一次就切對）。foliate 正是為了不給這個承諾，至今拒發官方 npm，README 直接建議用 git submodule 引入。git dependency 提供同樣的安裝體驗而不附帶那個承諾。等 spine 實際跑順、API 半年沒有大動，再發 npm——那時候版本號才有意義。

**明確拒絕併入 spine 的 monorepo。** frond 的整個設計前提是「它不只服務 spine」（ADR-0002 拒收手勢即為此）。放進同一個 monorepo 會讓這個前提在第一個 sprint 就被侵蝕，因為抄近路會變得太容易。

**授權採 MIT**，與 foliate 一致。frond 會直接取用上游 `tests/epubcfi-tests.js` 的 280 行測試向量作為 CFI 驗收表（ADR-0001），那是實際的程式碼取用；MIT 對 MIT 最乾淨，attribution 照規矩標示。至於瀏覽器 quirk 知識（`docs/browser-quirks.md`）搬運的是知識而非程式碼，與授權無涉。
