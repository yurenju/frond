# frond 是重新實作，不是 foliate-js 的 port

frond 要的是 foliate-js 的**渲染知識**，不是它的程式碼或 API 切法。foliate 的 API 是為它自己的多格式、多 renderer 場景設計的（EPUB/MOBI/FB2/CBZ/PDF 共用一組 book interface），而 frond 只做 EPUB、而且要服務 spine 的具體需求，沿用上游的切法沒有理由。因此 frond 用 TypeScript 重新設計、重新實作，foliate-js 只作為參考實作與教材，不進 dependency、不進 bundle。

## Considered Options

**完整 port（把 ~3,940 行 EPUB 子集逐檔改寫成 TypeScript）** —— 拒絕。改寫會連 API 形狀一起繼承，而那正是我們不想要的部分。

**vendor + typed facade（JS 原樣收進來，只補 `.d.ts`）** —— 拒絕。拿不到 TypeScript 的實質好處，真要修直排根因還是在改 JS。

**差分測試（拿 foliate-js 當測試 oracle，同書同 viewport 比對斷頁位置）** —— 拒絕，而且這個拒絕最需要留檔，因為它聽起來很有道理，六個月後一定會有人再提一次。拒絕的理由是**成本與權威性都不成立**：差分測試要能跑，測試環境得同時載入兩個實作並比對 DOM 幾何，基礎建設複雜度大約多一倍；而換得的保護只在「foliate 是對的」時候有效。frond 最在乎的格子（直排 × Firefox）恰恰是 foliate 沒有證據支撐的地方（見下方查證），拿一個在關鍵格子狀態未知的實作當 oracle，得到的可能是雜訊而不是保護。

### 對 foliate 直排狀態的查證（2026-07-25）

spine 的 `docs/research/epub-rendering-libraries.md` 記載「vertical writing 在 Firefox 上是壞的」並標注來源為官方文件／README。**此說法在 foliate-js repo 內查無實據**：

- README L363 明載 *"It aims to support the latest version of WebKitGTK, Firefox, and Chromium."*——Firefox 是宣稱支援的目標。
- `paginator.js` 內 4 處 Firefox 相關註解全是**已套用的 workaround**（`getBoundingClientRect` bug、computed style 需元素可見、ResizeObserver 失效、visualViewport scale 回報異常），不是未修的缺陷宣告。
- 兩處 `FIXME: vertical-rl only, not -lr` **都位於 scrolled mode 的程式路徑內**。frond v1 不做 scrolled mode，且 vertical-**lr** 用於蒙古文，中日文皆為 vertical-rl——對 frond v1 不適用。
- repo 內唯一明載的直排限制是 README L187：`max-column-count` 在 renderer 元素為 portrait（直排則為 landscape）時無效。這是明文限制而非 bug。

該說法可能源自線上文件頁（`johnfactotum.github.io/foliate-js/`），本機 egress 白名單無法連出核實，請求已投至 `/var/spool/egress-requests/`。**在核實前，foliate 的 Firefox 直排狀態應視為「未知」而非「已知損壞」。** frond 的跨瀏覽器測試套件建立後，第一件該回答的實證問題就是這一題。

> **已於 2026-07-26 實測結案（#7）。該說法撤回：foliate 的直排在 Firefox 沒有壞。** 把 foliate-js `78914ae` 放進本專案的測試映像、用 `tests/fixtures/vertical-japanese.epub` 跑三家，`writing-mode`、欄寬、頁數、頁長、起始 CFI 與 fraction、翻頁往返全部相同，字元往下、行往左，三家皆然，且無 `pageerror`。三家裡真正排錯東西的是 WebKit（直排標點沒換成直排字符），Firefox 在那一格是對的。量測與截圖見 `docs/browser-quirks.md` 的〈foliate-js 的直排在 Firefox 沒有壞〉。
>
> **這不改變本 ADR 的決定。** 拒絕差分測試的理由原本是「成本不成立，且 frond 最在乎的格子（直排 × Firefox）恰恰是 foliate 沒有證據支撐的地方」。後半段現在不成立了——那一格有證據了，而且是好的。但前半段（基礎建設複雜度大約多一倍）沒有變，**而且 #7 另外量到一件讓差分更不適合的事**：同一本書、同一 viewport、讀者字級放大之後，foliate 在 Chromium 排 4 頁、在 Firefox 與 WebKit 各排 3 頁。把一個自己就會因瀏覽器而分岔的實作當 oracle，得到的仍然是雜訊。這條也同時縮小了 ADR-0004 跨瀏覽器自我差分的適用範圍，見 `docs/browser-quirks.md` 的〈直排在讀者放大字級之後，三家的分頁位置不一致〉。

## Consequences

**放棄 oracle 意味著放棄「期望值」。** 沒有參考實作，就沒有「這本書在 800×600、16px、直排下應該斷在第 4,213 個字元」這種具體數字。分頁測試因此不能寫成期望值比對，必須改用三種不需要知道正確答案的驗證手段，組成測試金字塔：

1. **純邏輯單元測試**（底層，Node，不開瀏覽器）—— 解析層與 CFI。這一層的 oracle 是 **EPUB 與 CFI 規格本身**，foliate 沒有特殊知識。foliate 的 `tests/epubcfi-tests.js`（280 行，上游唯一的測試）可作為驗收表使用。
2. **headless browser 不變量 + 跨瀏覽器自我差分**（中層）—— 不變量是自我一致性，不需參考實作：翻到底再翻回位置不變、相鄰頁邊界字元在文件順序上相連（無內容遺失或重複）、CFI → page → CFI 為 identity、字級變動後用 CFI 能回到同一段文字。跨瀏覽器差分的 oracle 是 frond 自己：同書同 viewport 在 Chromium / Firefox / WebKit 三邊互比，差異即紅燈。
3. **agent 視覺判讀**（頂層，數量最少）—— 由 VLM 而非人類判讀截圖，抓 layout 級的嚴重缺陷。這一層不可省略，因為它是**唯一抓得到「書寫方向渲染錯誤」這類缺陷的一層**：其形態是 computed style 老實回報 `vertical-rl`、內容也確實被切成 N 頁且無重複遺失，但畫出來的 pixel 是橫的——DOM 斷言與幾何不變量都會綠燈，只有看畫面才抓得到。為了對抗 LLM 判讀的非決定性，提問必須是封閉式缺陷清單、輸出結構化欄位（溢出／重疊／書寫方向／空白頁／裁切／severity），判讀落在欄位上。**這一層跑在開 PR 之前、由寫 PR 的 agent 執行，不是 CI 閘門**——見下方修訂與 `docs/agents/pull-requests.md`。

> **修訂（2026-07-26）：第 3 層從 CI 閘門改為開 PR 前的作者側檢查。** 原文是「只有 `severe` 擋 CI」，現在改成：跟視覺有關的變更，開 PR 前在三家各跑一次，由寫 PR 的 agent 照封閉式清單判讀，結果寫進 PR 說明。
>
> 理由是**省掉一整串基礎建設換同一件事**：判讀的 agent 就是寫 PR 的那個，它本來就看得到圖。要把這層搬進 CI，得在 CI 裡呼叫 VLM——API key、額度、以及這台 instance 白名單制的網路出口，三樣都要處理，而換到的判讀品質並沒有比較高。
>
> **代價要講清楚，因為它是真的。** 作者側判讀**不擋任何東西**；實作者與判讀者是同一個 agent，等於自己批改自己的作業；而且它只在有人開 PR 時發生，**不守回歸**。本節說這一層「唯一抓得到書寫方向渲染錯誤這類缺陷」，那個缺陷類別因此在回歸上沒有自動化的守門員——守它的是「每一次動到版面的 PR 都照規則跑過三家」這個習慣。要收回這個取捨，補的形式是把判讀搬進 CI，不是把 PR 規則寫鬆。

**foliate 的瀏覽器 quirk 知識必須被刻意搬運，不會自己出現。** `paginator.js` 裡有十二處瀏覽器 bug 的補丁（Firefox 的 `getBoundingClientRect`、Firefox ResizeObserver 失效、WebKit bug 218086 迫使 iframe 開 `allow-scripts`、WebKit 字符裁切、Chromium/WebKit 各自需要 `requestAnimationFrame` 等），幾乎全在 Firefox 與 WebKit。重新實作不會繼承這些補丁，只會重新撞上一次。因此以 `docs/browser-quirks.md` 逐條登記（瀏覽器／症狀／foliate 的繞法／frond 是否需要／哪個測試會抓到），這張表就是「以 foliate 為參考實作」的實體產出物——搬運的是知識而非程式碼，與 MIT 授權無涉。
