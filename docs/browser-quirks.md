# 瀏覽器 quirks

逐條登記三家瀏覽器的行為差異：症狀、繞法、frond 是否需要處理、哪個測試會抓到。

這份表是「以 foliate 為參考實作」的實體產出物——搬運的是知識而非程式碼（ADR-0001）。重新實作不會繼承 foliate 已經套好的補丁，只會重新撞上一次，所以每撞到一條就登記一條。最後一欄直接構成測試套件的需求清單。

登記的門檻是**實測**。從別人的原始碼或文件推得的行為要標明未經本專案驗證，不要與量測結果混在一起。

## 讀每一條之前先看：這個數字是誰排的

本檔的量測分兩類，而它們**能外推的範圍不同**：

- **純瀏覽器**——`page.setContent` 餵一份手寫的 HTML／CSS，沒有任何 library 參與。量到的是瀏覽器本身的行為，換渲染器仍然成立。
- **有渲染器參與**——把 foliate-js 放進測試映像渲染真的 fixture。量到的數字綁在**那一版 foliate 的設定**上（例如 `column-width: 466px`、`column-fill: auto`，全部 `!important` 寫在 `documentElement` 上），frond 自己的設定不見得一樣，重測時要重新量。

**預設是純瀏覽器。有渲染器參與的條目，會在標題或〈環境〉欄註明渲染器與 commit。** 這個軸與上面那條「實測 vs 從原始碼讀來」是**兩件不同的事**：一條量測可以是紮實的實測，同時只在某個渲染器的設定下成立。

沒有這個標示，很容易從一條 quirk 外推出比它實際範圍更大的結論——而本檔已經有一條就是為了撤回那種外推而存在的（〈foliate-js 的直排在 Firefox 沒有壞〉）。

## 這份文件裡的「墨水像素」是什麼

底下有十幾處拿墨水像素數當證據（「總墨水差 0.01%」「752 對 1086」），所以定義寫在這裡，否則那些數字重量不出來——換一個門檻值，整批數字全部會變，而且是安靜地變。

把截圖用 pngjs 解碼後逐像素數：**alpha 為 0 的不算；亮度 `0.299R + 0.587G + 0.114B` 小於 200 的算一點墨水。** 重心是所有墨水像素座標的算術平均，除以圖寬圖高正規化到 [0, 1]。

門檻取 200 是為了把 CJK 字型的反鋸齒邊緣算進來——CJK 字符的筆畫細，門檻訂太嚴會把細筆畫整條漏掉，而那正是明體／黑體之類的差異所在。這個值是這份文件所有墨水數字的共同前提，改了就要全部重量。

---

## WebKit 在直排下不自動套用 `vert`

**症狀**

`writing-mode: vertical-rl` 下，CJK 標點沒有換成直排字符。日文句點應該移到字面方框的右上，實測 WebKit 把它留在左下。

以 `。`（U+3002，Noto Serif CJK JP，200px 方框，墨水重心正規化到 [0, 1]）量測：

| 瀏覽器 | 橫排 | 直排（預設） | 直排 + `font-feature-settings: "vert" 1` |
| --- | --- | --- | --- |
| Chromium | (0.180, 0.863) | **(0.780, 0.210)** 右上 | (0.780, 0.210) |
| Firefox | (0.181, 0.865) | **(0.778, 0.210)** 右上 | (0.778, 0.210) |
| WebKit | (0.181, 0.865) | **(0.251, 0.887)** 左下 | **(0.848, 0.330)** 右上 |

WebKit 預設的直排渲染除了位置不對，墨水像素數也較少（752 對 1086）——從圖上看得出原因：**句點被字面方框的下緣裁掉了**。取到的不只是位置不同，而是不同的字符。

`。`（Noto Serif CJK JP，200px 方框，灰框為方框邊界）：

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 直排（預設） | ![](evidence/3/chromium-vertical-default.png) | ![](evidence/3/firefox-vertical-default.png) | ![](evidence/3/webkit-vertical-default.png) |
| 直排 + `"vert" 1` | ![](evidence/3/chromium-vertical-vert-forced.png) | ![](evidence/3/firefox-vertical-vert-forced.png) | ![](evidence/3/webkit-vertical-vert-forced.png) |

橫排三家一致，都在左下，作為對照：![](evidence/3/chromium-horizontal.png)

圖以 `docs/evidence/3/` 保存。產生方式：`tests/browser/support/glyph.ts` 的同一組參數，加上 1px 邊框以顯示方框邊界。

**繞法**

顯式 `font-feature-settings: "vert" 1`。實測強制之後 WebKit 移到右上，且 Chromium 與 Firefox 的結果不受影響——三家可以共用同一條規則，不需要分支。

**foliate 沒有補這一條**（#7 實測）

foliate-js 的 `paginator.js` 不注入任何 `font-feature-settings`，所以它在 WebKit 上照樣是錯的——這一格 frond 必須自己做，不能指望「照 foliate 抄就好」。

量法是**同一家瀏覽器內的對照**：把 `vertical-japanese.epub` 交給 foliate 渲染、讀者字級覆寫成 64px，截下第一個 `。` 的字面方框；再用同一組參數但額外加上 `font-feature-settings: "vert" 1` 跑一次，比對兩張圖的解碼像素。跨瀏覽器的絕對數字在這裡不可比（三家給的 range rect 寬度不同，WebKit 的還比字面方框高出 0.98px，裁進來的鄰字墨水量不一樣），可比的是同一家內的那兩張。

| 瀏覽器 | 預設 vs 強制 `"vert" 1` | 預設的墨水重心／像素 | 強制後 |
| --- | --- | --- | --- |
| Chromium | **逐位元組相同** | (0.768, 0.203) ／ 121 px | 同左 |
| Firefox | **逐位元組相同** | (0.770, 0.203) ／ 125 px | 同左 |
| WebKit | **不同** | (0.447, 0.447) ／ 157 px | (0.765, 0.224) ／ 196 px |

| | WebKit 預設 | WebKit 強制 `"vert" 1` | Chromium 預設 | Firefox 預設 |
| --- | --- | --- | --- | --- |
| foliate 渲染的 `。`（64px） | ![](evidence/7/webkit-fullstop.png) | ![](evidence/7/webkit-fullstop-vert-forced.png) | ![](evidence/7/chromium-fullstop.png) | ![](evidence/7/firefox-fullstop.png) |

右邊三格的句點都在右上，只有第一格在左下。WebKit 那兩格裁進了上一個字的一角（原因見上一段），另外兩格沒有——所以**不要拿第一格的墨水像素數去和第三、四格比**，那條比法在這裡不成立。

**frond 是否需要處理**

需要。直排是 frond 的硬需求，標點位置錯誤是讀者一眼看得到的缺陷，而 DOM 斷言與幾何不變量都抓不到——全形標點的字面寬相同，斷行與斷頁完全不受影響。

**注入的層級已經決定了（#32）：Renderer 一律注入，三家不分支，而且不帶 `!important`。**

一律注入的理由是分支的代價比較高——「現在是哪一家」的判斷會在瀏覽器修好之後變成沒有人記得要拿掉的東西，而實測強制之後 Chromium 與 Firefox 的結果**逐位元組不變**，所以分支買不到任何東西。

歸類的問題（「內容讀不到」還是根本不算介入）也一併決定了：**兩者都不是，它是第三類**——`syntax-translation`，與「Firefox 不認前綴的 `writing-mode`」同一格。`writing-mode: vertical-rl` 本身就蘊含了「標點要換成直排字符」這件事，兩家瀏覽器自動照做，WebKit 沒有；注入等於把書已經表達過的意圖講給沒有照做的那一家聽，不是新增書沒有要求的效果。

不帶 `!important` 是這個歸類的直接後果：書自己宣告 `font-feature-settings` 時仍然是書贏。四種介入理由的分法見 `src/renderer/interventions.ts`。

**哪個測試會抓到**

兩條，分別守兩件不同的事：

- `tests/browser/smoke/vertical-writing.spec.ts` 的「標點取到直排字符」守的是**環境**——那套字型有直排字符且畫得出來。它自己注入 `"vert" 1`，所以與 Renderer 無關。
- `tests/browser/renderer/rendering.spec.ts` 的「直排時注入直排標點的字符設定」守的是 **Renderer 本身有做這件事**，並且橫排時不做。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`、`fonts-noto-cjk` `1:20230817+repack1-3`）。Playwright 的 WebKit 是 Linux 上的建置，文字塑形走 HarfBuzz + Fontconfig，真 Safari 走 CoreText——**這條在 iOS 上的行為未經驗證**（ADR-0004 明列不做 iOS 驗證）。

---

## 三家對 generic family 的 CJK 解析不一致

**症狀**

書宣告 `font-family: serif` 或 `sans-serif`，三家瀏覽器對 CJK 字元各挑各的字面。fontconfig 的綁定（`docker/fontconfig/75-frond-cjk.conf`）在容器內的 `fc-match` 上完全正確，三家的分歧發生在**送進 fontconfig 之前**：各家決定「拿什麼去問」的方式不同。

以 `。`（U+3002）量測實際落到的字面（容器 locale `C.UTF-8`，每次量測用全新的 page）：

| 宣告 | 瀏覽器 | `lang=ja` | `lang=zh-TW` | 與另外兩家一致？ |
| --- | --- | --- | --- | --- |
| `serif` | Firefox | Noto Serif CJK JP | Noto Serif CJK TC | 這一家是對的 |
| `serif` | WebKit | Noto Serif CJK **TC** | Noto Serif CJK TC | `lang=ja` 拿到 TC |
| `serif` | Chromium | Noto **Sans** CJK JP | Noto **Sans** CJK TC | 區域對，但畫出來是黑體 |
| `sans-serif` | Firefox | Noto Sans CJK JP | Noto Sans CJK TC | 這一家是對的 |
| `sans-serif` | WebKit | Noto Sans CJK **TC** | Noto Sans CJK TC | `lang=ja` 拿到 TC |
| `sans-serif` | Chromium | Noto Sans CJK JP | Noto Sans CJK TC | 字面對，但主字型是拉丁字型 |

`sans-serif` 那三列說明分歧不會因為換一個 generic family 就消失：Chromium 的 `sans-serif` 剛好挑到正確的區域字面，但**主字型仍然是 Liberation Sans**——行高與基線由拉丁字型決定，斷行與另外兩家不同。三家一致的只有指名字面的情況。

**看得到的樣子**

書宣告 `serif`、`lang="ja"`，句點（唯一有鑑別力的字）落在哪：

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 書宣告 `serif` | ![](evidence/4/chromium-fullstop-serif-ja.png) | ![](evidence/4/firefox-fullstop-serif-ja.png) | ![](evidence/4/webkit-fullstop-serif-ja.png) |
| 對照：指名 `Noto Serif CJK JP` | ![](evidence/4/chromium-fullstop-named-jp-ja.png) | ![](evidence/4/firefox-fullstop-named-jp-ja.png) | ![](evidence/4/webkit-fullstop-named-jp-ja.png) |

JP 字面的句點在左下，TC 字面置中。**只有 Firefox 的兩格相同**——它的 `serif` 解析到了 JP。WebKit 的第一格置中，是 TC。逐位元組比對：Firefox 的 `serif+ja` 與指名 JP 截圖 hash 相同，Chromium 與 WebKit 都不同。

明體／黑體那一軸換漢字看（漢字鑑別不了字面，但看得出筆畫）：

| | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| 書宣告 `serif` | ![](evidence/4/chromium-kanji-serif-ja.png) | ![](evidence/4/firefox-kanji-serif-ja.png) | ![](evidence/4/webkit-kanji-serif-ja.png) |

Chromium 的 `日` 沒有起筆收筆——書要的是明體，畫出來是黑體。

圖以 `docs/evidence/4/` 保存。產生方式：`tests/browser/support/glyph.ts` 的同一組參數（單字元、200px 方框、每次量測用全新的 page），加上 1px 邊框以顯示方框邊界。**不要換成看起來比較有說服力的字串**：漢字的區域字形由 `lang` 驅動，樣本裡混進漢字會讓 WebKit 的 `serif+ja` 與指名 JP 的截圖變得逐位元組相同，看起來像 WebKit 是對的。

**各家的機制**（以下每一條都由介入實驗確認，不是從原始碼推的）

*Firefox*：拿文件的 `lang` 去問 fontconfig 要 generic family，等同 `fc-match serif:lang=ja`。綁定完全生效。文件沒有 `lang` 時才落到行程 locale 的預設。

*WebKit*：有問 fontconfig 要 generic family（證據：`serif` 底下的拉丁字母畫出來的是 Noto Serif CJK 的拉丁字符，也就是本專案綁定的結果，不是基底映像的 Liberation Serif），**但不帶文件的 `lang`**。缺的那格由 fontconfig 用行程的 locale 補上，於是整個行程共用一個區域字面。證據是把容器的 `LANG` 換成 `ja_JP.UTF-8`：WebKit 的 `serif` 從頭到尾變成 JP，連 `lang=zh-TW` 的文件也是。`C.UTF-8` 落在本專案綁定的通則，所以看起來像「一律選 TC」。

*Chromium*：**根本沒問 fontconfig 要 generic family。** 它問的是一個具名的拉丁字型——`serif` 問的是 `Times New Roman`。證據是掛一份只改寫 `Times New Roman`（`qual="first"`，不動 `serif`）的 fontconfig 設定進去：Chromium 的 `serif` 立刻跟著改，而同一份設定裡針對 `lang=ja` 的那條規則沒有生效——所以它問的是 `Times New Roman` 而且不帶文件的 `lang`。該名稱解析到 Liberation Serif，沒有 CJK 字符，CJK 字元接著走逐字元 fallback，落到 fontconfig 對該碼位的最佳字面 Noto **Sans** CJK。

`sans-serif` 走同一條路，只是問的名字不同：拉丁字母落在 Liberation Sans 上，而 `fc-match Arial` 正是 Liberation Sans。**「那個名字就是 `Arial`」這一格沒有做介入實驗，是從落點推的**，與 `serif` 那條的證據強度不同。

也就是說 Chromium 的 generic family 是兩段式的：**主字型（Liberation Serif／Sans）決定行高與基線，CJK 字符由另一套字型補上**。書宣告 serif，CJK 畫出來是黑體。

**繞法**

沒有。三家的分歧都發生在 CSS 管不到的層級：

- WebKit 的 `lang` 從來沒進到查詢裡，任何 fontconfig 設定都補不回來。唯一能動的是行程 locale，而那是一個全域值——沒辦法讓同一個行程裡的日文書與中文書各拿各的字面。
- Chromium 的 generic family 由瀏覽器偏好決定，網頁改不了；把 fontconfig 的 `Times New Roman` 綁到 CJK serif 可以救回 serif／sans 這一軸，但區域字面那一軸救不回來（該查詢同樣不帶 `lang`），而且那是拿一個特定瀏覽器版本的內部預設值當設定介面用。

唯一能讓三家一致的做法是**指名字面**——而那在 frond 裡屬於讀者設定，見下。

**frond 是否需要處理**

不需要，而且**不可以**。對照 ADR-0003 的介入門檻：介入只有兩個理由，內容讀不到、或讀者設定被書擋住。這裡兩個都不成立——每個字都在，只是字面不是最合適的那一個，屬於「書醜」。

**「三家渲染不一致」本身不是介入理由**：不一致的是平台的字型解析，不是書的宣告有問題，也不是 frond 有 bug。為了讓自己的差分測試好比對而改寫書的宣告，是把測試工具的需求偷渡成產品行為——那正是 ADR-0003 明確從 spine 移出來的 `rewriteGenericFonts`。

代價要明講：**跨瀏覽器自我差分（ADR-0004）在「書用 generic family 且讀者沒設字型」的情況下不成立**。此時三家會因為挑到不同字面而斷行不同、斷頁不同，比出來的差異與 frond 的程式碼無關。所以差分的 oracle 有一個前提條件：**跑差分時必須由讀者設定指名字面**。讀者設定本來就贏過書的宣告，這條路不需要任何新的介入項目；ADR-0003 已經要求 frond 提供字型覆寫面，這裡只是說明那個 API 同時是差分測試的前提。

> **ADR-0004 已依本條的量測修訂。** 它原本要求測試環境「確保書的 `serif` / `sans-serif` 在測試中解析到它們」——三家裡有兩家做不到，且無法從環境端補救，該句已移除，改以「差分必須在讀者設定指名字面的前提下執行」取代。見 ADR-0004 的〈差分要成立，字面必須由讀者設定指名〉。

**哪個測試會抓到**

`tests/browser/smoke/regional-faces.spec.ts` 的「generic family 依 lang 的解析」，`serif` 與 `sans-serif` 各兩條。它不再期待三家一致，改成把每一家的實際落點釘住——分歧是這個環境的性質，它變了要有人知道。已驗證有牙齒：把容器的 `LANG` 換成 `ja_JP.UTF-8`，WebKit 那幾條立刻紅。

`Dockerfile` 因此顯式釘死 `LANG` / `LC_ALL`（今天與基底映像相同，是 no-op），理由是這個變數實際上是字型設定的一部分。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`、`fonts-noto-cjk` `1:20230817+repack1-3`）。三家瀏覽器都是 Linux 建置，走 HarfBuzz + Fontconfig。**真 Safari 走 CoreText，這一條在 iOS 上的行為未經驗證**（ADR-0004 明列不做 iOS 驗證）；Windows 與 macOS 上的 Chromium / Firefox 也沒有 fontconfig，落點必然不同，同樣未驗證。

**還沒查到的**

「為什麼 Blink 的 headless 預設就是 `Times New Roman`」「WebKit 是在哪一層丟掉 `lang` 的」這兩件事只有行為證據，沒有原始碼佐證——本機的出口白名單連不到 `source.chromium.org` 與 WebKit 的原始碼瀏覽器。要補的話從 Blink 的 `web_preferences` 與 WebKit 的 `FontCacheFreeType` 下手。

---

## Chromium 的字元 fallback 是一頁一次的

**症狀**

某個碼位第一次需要 fallback 時解析出來的字面，會被**那一頁**記住，之後同一頁裡的文件即使宣告不同的 `lang`，也拿到同一個字面。快取以碼位為單位，不看 `lang`。

這不是實驗室裡的細節：frond 一個 Section 一個 iframe、整本書共用一頁，所以**先渲染的 Section 決定後面所有 Section 的區域字面**。同一頁放兩個 iframe，各自宣告 `serif` 與自己的 `lang`：

| 順序 | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| `ja` 先 | 兩個都 JP | 各自正確 | 兩個都 TC |
| `zh-TW` 先 | 兩個都 TC | 各自正確 | 兩個都 TC |

Chromium 那一欄的意思是：**同一份 `lang=zh-TW` 的內容，只因為排在一份日文內容後面，字面就變了。** WebKit 兩欄相同是另一個原因——它從頭到尾沒看 `lang`。

同一頁內換頁（`setContent`）不會清掉快取，開新的 page 會。

**繞法**

量測時一次一個全新的 page（`screenshotGlyphInIsolation`）。這是測試方法上的繞法，不是產品上的——實際的書渲染時 frond 沒辦法一個 Section 開一個 page。

**frond 是否需要處理**

這一條只在「書用 generic family」時才碰得到，因為指名字面根本不會走 fallback。所以處置與上一條相同：不介入，差分測試靠讀者設定指名字面。但登記在這裡，因為它會讓上一條的量測結果看起來像另一回事——共用一個 page 連續量好幾個 `lang`，量到的全是第一個 `lang` 的答案，於是很容易得出「Chromium 完全不理會 `lang`」這個錯誤結論。

**哪個測試會抓到**

`tests/browser/smoke/regional-faces.spec.ts` 的「同一頁的兩個 iframe」。三家的簽名互不相同，一條測試分得出來是誰變了。該測試把兩個 iframe **先後**掛上去而不是一次寫進 `setContent`：主題就是「誰先渲染」，同時掛的話誰先跑完並不保證。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。快取的存續範圍是實測的（同頁換文件仍在、開新 page 就沒了），沒有查過它在 Chromium 內部是掛在哪一層，所以**別的 Chromium 版本上範圍可能不同**。

---

## 量測方法：漢字不能用來鑑別字面

**症狀**

「骨」「直」這類漢字統一的代表字，其區域字形由 `lang` 經 OpenType `locl` 驅動——**同一字面換 `lang` 會變，不同字面同一 `lang` 不變**（三家一致）。拿漢字問「解析到哪個字面」永遠得到「看不出來」，而測試會在字型綁定完全失效的環境下照樣變綠。

**繞法**

用標點。實測 `。` 分得出 TC／HK 與 JP／SC／KR，`：` 分得出 SC 與其餘；兩者合起來足以區分 TC／SC／JP。TC 與 HK、JP 與 KR 目前沒有找到分得開的字——需要用到那兩組時要另外找。

**frond 是否需要處理**

不需要——這一條是量測方法，不是渲染行為。登記在這裡是因為它決定了本檔其餘每一條的可信度：用錯字量，整批結論會在綁定完全失效的環境下照樣看起來是綠的。

**哪個測試會抓到**

`tests/browser/smoke/regional-faces.spec.ts` 的「字形選擇的兩條路徑」。那一組把這兩條性質本身釘成測試，因為它們是同檔案裡其他斷言能夠成立的前提。

**環境**

`Dockerfile` 的映像（`fonts-noto-cjk` `1:20230817+repack1-3`）。哪些字分得開哪些字面是**這一版字型**的性質，換字型或換版本要重新量。

---

## foliate-js 的直排在 Firefox 沒有壞（#7 的答案）

這一條不是 quirk，是一個**被撤回的宣稱**。登記在這裡是因為它曾經被當成事實寫進規劃文件，而且被當成 frond 最大的技術風險。

**宣稱**：spine 的 `docs/research/epub-rendering-libraries.md` 記載「vertical writing 在 Firefox 上是壞的」，來源標為 foliate 的官方文件／README。ADR-0001 查過 foliate repo，查無實據，結論是「在核實前應視為未知」。#1 的 Further Notes 據此把「若屬實則是 frond 最主要的技術挑戰」寫進了工作排序。

**實測**：把 foliate-js（`78914ae`）放進 `Dockerfile` 的映像，用 `tests/fixtures/vertical-japanese.epub` 在三家各跑一次，800×600、`deviceScaleFactor` 1、書自己的樣式（不覆寫讀者設定）。

| 量到的東西 | Chromium 149.0.7827.0 | Firefox 151.0 | WebKit 26.5 |
| --- | --- | --- | --- |
| `documentElement` 的 `writing-mode` | `vertical-rl` | `vertical-rl` | `vertical-rl` |
| `column-width` | 466px | 466px | 466px |
| 頁長 `size` ／ 總長 `viewSize` | 504 ／ 1512 | 504 ／ 1512 | 504 ／ 1512 |
| 頁數（含 foliate 的 2 個補白頁） | 3 | 3 | 3 |
| 字元推進（下一個字相對前一個） | dx 0、**dy +32** | dx 0、**dy +32** | dx 0、**dy +32** |
| 行推進（下一區塊相對前一區塊） | dx **−46.3** | dx **−50.3** | dx **−46.8** |
| 起始 CFI | `epubcfi(/6/2!/4,/2,/8/1:27)` | 同左 | 同左 |
| 起始 fraction | 0.35532407407407407 | 同左 | 同左 |
| 翻到書末再翻回來 | 2 步到底，回程 CFI 與起點**相同** | 同左 | 同左 |
| `pageerror` | 無 | 無 | 無 |

字元往下、行往左，三家一致——那就是直排。位置與進度的數字三家逐位數相同。翻頁往返回得到原位。

**行推進那一列只有符號可以跨瀏覽器比，數值不行**，理由與 foliate 無關：三家對「單一字元的 range」回傳的矩形不是同一個框。同樣是 32px 的 `h1`，Chromium 與 WebKit 回 46px 寬（= 字型的 ascent + descent 決定的 inline 內容區，Noto Serif CJK 約 1.44 em），Firefox 回 32px（= 字面方框，1.0 em）；16px 的 `p` 對應 23px 與 16px，比例相同。量的框不一樣，起點自然差。**這一格是量測方法的陷阱**：拿單字元 range 的 `left` 去做跨瀏覽器差分，會得到一組與版面無關的差異。

| Chromium | Firefox | WebKit |
| --- | --- | --- |
| ![](evidence/7/chromium-foliate-vertical.png) | ![](evidence/7/firefox-foliate-vertical.png) | ![](evidence/7/webkit-foliate-vertical.png) |

**答案：沒有壞。** 三家都排得出直排、翻得動、回得去原位，而且**每一個會影響讀者的量都相同**：欄寬、頁數、頁長、位置、進度。表裡唯一有數值差異的那一列是量測方法造成的（見上），不是版面差異。三家裡真正排錯東西的是 **WebKit**——直排標點沒有換成直排字符（本檔第一條），Firefox 在那一格是對的。

**這句宣稱因此撤回**，#1 的 Further Notes 已據此改寫。要注意的邊界：Playwright 的 Firefox 與 WebKit 都是 Linux 建置，文字塑形走 HarfBuzz + Fontconfig；真 Safari 走 CoreText，**iOS 未驗證**（ADR-0004 明列不做）。「foliate 在 Firefox 上直排是好的」這句話的範圍就是這個環境。

> **這條撤回容易被別的條目重新推翻掉，實際發生過一次。** 本檔另有〈`-epub-` 與 `-webkit-` 前綴的 `writing-mode`，Firefox 不認〉，單看那條的標題與截圖，很自然會得出「Firefox 直排有問題」——但那條量的是**屬性名的前綴**，同一個 Firefox 換成標準寫法就正常。兩條講的不是同一件事。往後新增任何「Firefox + 直排」的條目時，都要回來確認它有沒有讓這個撤回失效；如果沒有，就在那一條裡明講。

**對排序的影響**：#1 原本說「若 Firefox 真的壞 → 那是 frond 最主要的技術挑戰」。那個分支不成立，`Renderer` 直排不再是存亡問題。取而代之的風險小得多也具體得多：WebKit 的 `vert`（已有繞法）與下一條的分頁分歧（沒有繞法，但只影響差分測試的適用範圍）。

---

## 直排在讀者放大字級之後，三家的分頁位置不一致

**症狀**

同一本書、同一 viewport、同一組讀者設定，直排下三家排出來的**頁數不同**。書自己的字級（16px）下三家完全一致，讀者把字級覆寫成 64px 之後就分岔了。

以 `tests/fixtures/vertical-japanese.epub` 的第一個 Section 量（800×600、`deviceScaleFactor` 1、讀者字級 `html { font-size: 64px !important }`，渲染器是 foliate-js）：

| 瀏覽器 | 文字頁數 | 每頁墨水像素 | 合計 | 內容在 block 軸上的總長 |
| --- | --- | --- | --- | --- |
| Chromium | **4** | 24,265 ／ 14,640 ／ 20,904 ／ 4,618 | 64,427 | **1,914.14px** |
| Firefox | 3 | 27,650 ／ 19,097 ／ 17,687 | 64,434 | 1,410.07px |
| WebKit | 3 | 28,255 ／ 19,917 ／ 18,298 | 66,470 | 1,410.13px |

頁長三家都是 504px，所以 `ceil(1914.14 / 504) = 4` 對上 `ceil(1410.07 / 504) = 3`。差距 504.07px，剛好**一整頁**。

**內容沒有遺失也沒有重複**：Chromium 與 Firefox 的總墨水差 7 px（0.01%）。分岔的是斷頁位置——Chromium 每頁少排一行。WebKit 多出來的 2,043 px（3.2%）是另一回事，那是本檔第一條的 `vert` 沒生效造成的字符差異，與分頁無關。

| | Chromium 第 2 頁（5 行） | Firefox 第 2 頁（6 行） |
| --- | --- | --- |
| 直排 64px | ![](evidence/7/chromium-64px-page2.png) | ![](evidence/7/firefox-64px-page2.png) |

Chromium 的左側空出約一個行框寬（115.2px），第 2 頁從「が差しこんで」開始而 Firefox 已經到「いた。」。Chromium 多出來的第 4 頁不是空白頁，有 4,618 px 的墨水：

![Chromium 直排 64px 的第 4 頁](evidence/7/chromium-64px-page4.png)

**繞法**

沒有。這是三家的分欄 fragmentation 差異，不是誰的設定寫錯。

**frond 是否需要處理**

需要，但它不是「修一個 bug」，而是**跨瀏覽器自我差分（ADR-0004）的 oracle 在「直排 × 讀者放大字級」這一格上會自己紅**。ADR-0004 的前提是「同書、同 viewport、同設定，三家的數字該一樣，差異即紅燈」；這條實測說明那個前提在直排多欄下不成立，而且與字型無關——fixture 指名 `Noto Serif CJK JP`，三家解析到同一個字面。

差分測試因此需要一條明確的規則：**頁數與斷頁位置這類量在直排下不能拿來跨瀏覽器互比**，可比的是自我一致性的不變量（翻到底再翻回位置不變、相鄰頁邊界字元相連、CFI → page → CFI 為 identity）。這與 #4 那條的處置是同一個形狀：差分的適用範圍要縮，不是把行為改掉去迎合差分。

> **ADR-0004 已依本條的量測修訂。** #4 那次把差分的前提改成「必須由讀者設定指名字面」；這次再縮一格——直排下頁數與斷頁位置不列入互比。見 ADR-0004 的〈直排下，頁數與斷頁位置不能拿來互比〉。

**根因未查。** 只有行為證據，沒有原始碼佐證。候選是三家對 `column-fill: auto` 加 `overflow: hidden` 的分欄斷點差異，以及 fixture 的 `p { margin: 0 0 1em }` 在 `vertical-rl` 下屬於實體邊界（落在 inline 軸上）這件事。要查的話從各家的 multicol fragmentation 下手。

**哪個測試會抓到**

規則已經寫進測試套件了（#32），而且是**分成兩邊**寫的：

- `tests/browser/renderer/cross-browser.spec.ts` 只比與分頁無關的量（書寫方向、每節第一頁的 CFI、字元數與 fraction、算出來的欄寬）。它有一條刻意永遠通過的測試把各家的頁數記進 annotation——**記錄但不互比**，讓那個數字看得見而不是只寫在這份文件裡。
- `tests/browser/renderer/invariants.spec.ts` 守本條點名的那四個自我一致性不變量，每一家各自成立。

（`agent 視覺判讀`不是這裡的承接對象——它改成開 PR 前的作者側檢查，見 ADR-0001 的修訂。）

**frond 自己的分欄設定下，這條分歧沒有重現（#32）**

同一本 `vertical-japanese`、同一個 800×600 viewport、同樣把讀者字級設成 64px，改由 frond 渲染：**三家都排成 3 頁**（`docs/evidence/32/` 的 `*-vertical-64px.png`）。

這**不推翻**上面那組量測，也不放寬 ADR-0004 的規則，理由是本檔開頭〈這個數字是誰排的〉那一條：上面那組是在 **foliate 的分欄設定**下量到的（`column-width: 466px`、`width: 744px`、`padding` 28px，全部 `!important` 寫在 `documentElement` 上），而 frond 的設定不一樣——欄寬取整數、邊界在 iframe 外面、`column-gap` 40px。同一個 fixture 換一組設定就換一組斷點，所以兩組數字本來就不該相等。

真正的結論是：**「三家頁數會不會分岔」是設定的函數，不是可以一次驗完的性質。** 今天沒有分岔不代表換一本書、換一個 viewport 或讀者調一次字級之後也不會。硬把「三家頁數應該相同」寫成斷言，等於賭一個沒有理由成立的巧合。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5。渲染器是 foliate-js `78914ae`——**這一條是在 foliate 的分欄設定下量到的**（`column-width: 466px`、`column-fill: auto`、`overflow: hidden`、`width: 744px`，全部 `!important` 寫在 `documentElement` 上）。frond 自己的分欄設定不見得一樣，重測時要重新量。

---

## foliate-js `paginator.js` 的十二處瀏覽器補丁（#7）

frond 以 foliate-js 為參考實作，取用它的**瀏覽器 quirk 知識**，不 port 程式碼、不進 dependency（ADR-0001）。重新實作不會繼承這些補丁，只會重新撞上一次，所以在寫任何 `Renderer` 之前先把它們變成一張表。

> **Attribution.** 以下對症狀與繞法的描述整理自 [foliate-js](https://github.com/johnfactotum/foliate-js) 的 `paginator.js`，commit `78914aef4466eb960965702401634c2cb348e9b1`，作者 John Factotum，MIT License。搬運的是知識而非程式碼；行號指向該 commit。

### 這一節分兩張表，界線是證據

**第一張表的每一條都跑過探針，第二張表的每一條都只從原始碼讀來。** 後者是**待驗證的線索，不是已知的事實**——照著它改程式碼等於相信一段別人寫在註解裡、可能已經過期的話。兩張表不合併，也不用一個欄位混在一起，因為欄位讀起來太容易被略過。

探針跑在 `Dockerfile` 的映像內（Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5），以 `tests/fixtures/vertical-japanese.epub` 為主、`tests/fixtures/huge-single-section.epub`（橫排、80 頁）為輔。

<details>
<summary>怎麼把這一節的數字重新量一次</summary>

量測用的一次性腳本**沒有留在 repo 裡**。它需要 foliate-js 的原始碼才能跑，而 foliate-js 不進 repo、不進 dependency、不進 bundle（ADR-0001）；留著一支 CI 不跑、又依賴外部原始碼的腳本，只會爛掉。表一每一條的探針做法在下面〈已重現的兩條，量到的東西〉與各列的「探針結果」欄裡有敘述，重寫得出來。

重寫時有三件事會踩到，記在這裡：

- **foliate-js 的 commit 要釘死**在 `78914aef4466eb960965702401634c2cb348e9b1`（本節每一條的行號都指向這一版）。foliate 官方明說 API 隨時會變，用浮動的 `main` 會讓「量到的是哪一版」無法回答。取原始碼用 `gh api repos/johnfactotum/foliate-js/tarball/<commit>`——走 `api.github.com`，本機出口白名單通常放行，`codeload.github.com` 不一定。
- **要在測試映像內跑**，理由與其他測試相同（`docs/test-environment.md`）：分頁是字型的函數，本機的字型解析與映像不同，量到的數字不可比。掛 volume 時要掛在 `/work` 底下（例如 `/work/spike`），因為腳本要從 `/work/node_modules` 解析 `@playwright/test` 與 `pngjs`；掛在 repo 根目錄以外會找不到套件。
- **`--network=none` 是刻意的**。腳本自己在 loopback 起一個靜態伺服器餵頁面，容器的 loopback 在 `--network=none` 下仍然存在，關掉外部網路可以保證量到的東西不依賴任何外部連線。

量測參數散在各條裡（viewport 800×600、`deviceScaleFactor` 1、讀者字級 `html { font-size: 64px !important }`），墨水像素的定義見本檔開頭。

</details>

### 表一：本次 spike 跑過探針的六條

| # | 瀏覽器 | 症狀（foliate 的說法） | foliate 的繞法 | 探針結果 | frond 是否需要 | 哪個測試會抓到 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | WebKit | iframe 的 `sandbox` 少了 `allow-scripts` 就收不到事件（[bug 218086](https://bugs.webkit.org/show_bug.cgi?id=218086)）。`paginator.js` L242–244 | 永遠帶 `allow-scripts` | **已重現，WebKit 限定** | 需要——ADR-0006 已據此決定開 `allow-scripts` 並不支援 scripted content，這次是那個決定的實證 | `tests/browser/renderer/rendering.spec.ts`（iframe 載得起來、內容進得去） |
| 2 | Firefox | iframe `display: none` 時讀不到 computed style。L260–264 | 讀之前把 iframe 切成 `display: block`，讀完切回 `none` | **已重現，Firefox 限定** | **不需要，但要防禦**——frond 不預載隱藏的 iframe，讀書寫方向時那一份文件已經在畫面上，所以前提不出現 | 尚無（前提在 frond 的設計裡不出現）。防禦在 `src/renderer/writing-mode.ts`：讀到空字串時回 `unreadable` 而不是當成橫排，由 `section-view.ts` 丟 `WritingModeUnreadableError` |
| 3 | Firefox | `body` 上的 `ResizeObserver` 不會觸發（[bugzilla 1832939](https://bugzilla.mozilla.org/show_bug.cgi?id=1832939)）。L275–278、L1115–1116 | 改掛 `doc.fonts.ready.then(() => expand())` | **未重現**（Firefox 151 的回呼有觸發） | **不適用**——frond 觀察的是外層文件裡的**容器元素**，不是 iframe 的 `body`。`doc.fonts.ready` 照樣有等，理由是「分頁是字型的函數」，與 `ResizeObserver` 可不可靠無關 | 尚無直接測試（前提不出現）。等字型那一步在 `section-view.ts` 的 `mount` |
| 4 | Chromium | `setStyles()` 之後要隔一個 frame 才讀得到新的背景色。L1111–1113 | 讀之前包一層 `requestAnimationFrame` | **未重現** | **不適用**——frond 換讀者設定時整節重建（改寫發生在文件還是文字的時候），不在既有文件上改樣式再讀回來 | `tests/browser/renderer/reader-settings.spec.ts` 的主題那一組會間接踩到：它在 `applySettings` 之後立刻讀 computed 的顏色 |
| 5 | Firefox | `getBoundingClientRect()` 漏掉零寬非零高的 rect，使可見範圍在欄邊界多含一個空白。L79–92 | 自己用 `getClientRects()` 的聯集算 bounding rect | **前提未出現**——三家一次都沒產生零寬非零高的 rect，探針等於沒踩到 | **未知**，不可當成「Firefox 沒這個 bug」。frond 一律走 `getClientRects()` 並濾掉沒有面積的，從不叫 `getBoundingClientRect()` 量位置，所以這一格繞過去了 | 尚無針對這個症狀的測試（前提未出現）。走的那條路徑由 `invariants.spec.ts` 的位置不變量覆蓋 |
| 6 | WebKit | 頁首的分欄斷點造成位移，「只有 WebKit 支援、且只在橫排」。L369–372 | `expand()` 把 `contentStart` 加進內容總長 | **前提未出現**——三家的 `contentStart` 都等於 foliate 自己設的左內距 28px，沒有分歧 | **不適用**——frond 的分欄容器沒有內距（版面的邊界在 iframe 外面），所以根本沒有 `contentStart` 這個量 | 不適用 |

### 表二：只從 foliate 原始碼讀來的六條（待驗證線索）

**以下每一條的「症狀」都沒有本專案的量測支撐。** 它們是查問題時的起點，不是可以直接寫進程式碼的結論。（#8 是唯一有一半量測的：症狀本身沒驗，但它的繞法造成的副作用量到了，見下。）

| # | 瀏覽器 | 症狀（foliate 的說法） | foliate 的繞法 | frond 是否需要 | 哪個測試會抓到 |
| --- | --- | --- | --- | --- | --- |
| 7 | 未指名 | collapsed range「有時候（還是每次？）」不回傳 client rect。L39–53 | `uncollapse()`：把 collapsed range 換成非 collapsed 的 range 或元素 | **需要，已做**——但踩到的是另一個症狀：矩形有回傳，只是回傳了**上一欄結尾**的那一個（見本檔〈長度為零的 range 在欄邊界上〉）。兩者剛好共用同一個繞法 | `tests/browser/renderer/invariants.spec.ts` 的「CFI → 跳過去 → CFI 是 identity，每一頁都是」 |
| 8 | WebKit | 字符被行框裁切。L330–331 | 無條件寫 `-webkit-line-box-contain: block glyphs replaced` | **frond 沒有採用這條繞法**（#32）。理由見下方〈這條繞法本身有代價〉：它讓 WebKit 的行框比另外兩家寬 12.5%，是 foliate 自己製造出來的跨瀏覽器分歧，而它要修的症狀本專案一次都沒有量到 | 尚無——**這一格仍然是開著的**：要採用它之前得先量「不加它的時候 WebKit 到底裁掉了什麼」 |
| 9 | WebKit | `focusin` 之後立刻捲到 anchor 會失敗。L617–619 | 包一層 `requestAnimationFrame` | v1 未定——鍵盤焦點導覽不在 #1 的 user story 內 | 尚無 |
| 10 | 三家 | `page-break-*` 在分欄版面下無效。L659–663 | 改寫書的 CSS：`page-break-*` → `-webkit-column-break-*`、`break-*: page` → `break-*: column` | 需要，已做。對照過 ADR-0003 的門檻之後歸在 `syntax-translation`——補一條等價宣告、不動原本那條，書的意圖沒有被改變（`src/renderer/interventions.ts` 的 `column-break`） | `tests/node/renderer/css.test.ts` 的〈page-break-*〉那一組。**症狀本身仍未驗證**：本專案沒有量過「不補的話書要求換頁的地方會不會真的接著排下去」 |
| 11 | Firefox | `visualViewport.scale`「有時候」回報 1。L857–863 | 包 `requestAnimationFrame`，並只在 `scale === 1` 時才 snap | 不需要——捏合縮放與 snap 屬於手勢，ADR-0002 明列在消費端 | 不適用 |
| 12 | 未指名 | range 起點緊接在前一欄的連字號之後時，那一欄會多出一個零寬 rect。L926–929 | 取第一個寬高皆非零的 rect | 未定——CJK 不斷字，橫排的西文書會踩到。frond 一律取第一個有面積的 rect（`section-view.ts` 的 `firstVisibleRect`），所以就算踩到也已經繞過去了 | 尚無針對這個症狀的測試——合成 fixture 全是 CJK，前提不出現 |

### 已重現的兩條，量到的東西

**#1 WebKit bug 218086。** 造一個 `sandbox="allow-same-origin"`（**不**給 `allow-scripts`）的 iframe，從 parent 對 `iframe.contentDocument` 掛 `click` 與一個自訂事件的 listener，然後派送。

| 瀏覽器 | 無 `allow-scripts` | 有 `allow-scripts` |
| --- | --- | --- |
| Chromium | 兩種事件都收到 | 兩種事件都收到 |
| Firefox | 兩種事件都收到 | 兩種事件都收到 |
| WebKit | **兩種都收不到** | 兩種事件都收到 |

WebKit 同時在 console 留下 `Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.`——也就是說被擋掉的不只是書內的 script，連 parent 掛上去的 listener 都一起沒了。這正是 ADR-0006 那個「隔離價值大幅喪失」的代價的來源，現在它有量測支撐而不只是引用上游註解。

**#2 Firefox 在 `display: none` 的 iframe 上讀不到 computed style。** 造一個隱藏的 iframe，文件宣告 `writing-mode: vertical-rl`、`direction: rtl`、`background: rgb(9, 8, 7)`，然後在 `display: none` → `display: block` → `display: none` 三個狀態各讀一次 `getComputedStyle(doc.body)`。

| 瀏覽器 | 隱藏時 | 顯示時 | 再次隱藏 |
| --- | --- | --- | --- |
| Chromium | `vertical-rl` / `rtl` / `rgb(9, 8, 7)` | 同左 | 同左 |
| Firefox | **`""` / `""` / `""`** | `vertical-rl` / `rtl` / `rgb(9, 8, 7)` | **`""` / `""` / `""`** |
| WebKit | `vertical-rl` / `rtl` / `rgb(9, 8, 7)` | 同左 | 同左 |

Firefox 回的是空字串而不是預設值——**它不會報錯，也不會給出一個看起來合理的錯答案**，所以下游若沒有檢查空字串，症狀會變成「書寫方向偵測不出來」而不是「computed style 讀失敗」。

### 這條繞法本身有代價（表二 #8）

foliate 對 WebKit 字符裁切的繞法是無條件寫進 `documentElement` 的 `-webkit-line-box-contain: block glyphs replaced`。**字符裁切這個症狀本次沒有驗證**（沒有拿掉繞法再看畫面），但介入實驗量到了它的副作用：把那條宣告從 `documentElement` 的 inline style 拿掉，再量 `vertical-japanese.epub` 的 `h1` 行框。

| 瀏覽器 | 宣告有沒有活下來 | 有這條時的 `h1` 行框 | 拿掉之後 |
| --- | --- | --- | --- |
| Chromium | 沒有（不認得，宣告被丟掉） | 44.8px | 44.8px |
| Firefox | 沒有 | 44.8px | 44.8px |
| WebKit | `block glyphs replaced` | **50.39px** | **44.8px** |

44.8px 正是 `line-height: 1.4 × 32px` 算出來的值——**拿掉之後 WebKit 就和另外兩家一致了**。也就是說這條繞法讓 WebKit 的行框比另外兩家寬 5.59px（12.5%），而行框寬度會改變斷行、斷行會改變斷頁。在這本 fixture 上還沒有改變頁數（該節單欄放得下，內容總長三家都是 466.09px），但這是 **foliate 自己製造出來的跨瀏覽器分歧**，frond 若照抄會一起繼承。

處置：這條進封閉清單之前要先量「不加它的時候 WebKit 到底裁掉了什麼」。`tests/browser/renderer/rendering.spec.ts` 的分頁幾何那一組。

### `paginator.js` 裡相鄰、但不算瀏覽器補丁的幾處

登記在這裡是為了讓「十二處」這個數字有邊界——以下這些看起來也像補丁，但它們不是為了繞過瀏覽器 bug：

- **`column-width` 取整數像素**（L316，`Math.trunc(columnWidth)`）。spine 踩過的「直排欄寬必須取整數否則一屏疊出好幾頁」就是這件事，但 foliate 沒有把它註記成瀏覽器 bug。frond 需要，承接「`Renderer`：直排單欄幾何、整數像素、分數 DPI 邊界」。
- **改寫書的 CSS：把 `vw`／`vh` 換成 px**（L655–658）。「viewport 單位在分欄容器裡意義不對」，不是瀏覽器 bug。
  同一段程式碼另外會**去掉 `-epub-` 前綴**，那一項原本也列在這裡、理由寫「EPUB 規格的歷史包袱」——**那個歸類是錯的，已據實測移出**：它是一條真的瀏覽器補丁，見本檔〈`-epub-` 與 `-webkit-` 前綴的 `writing-mode`，Firefox 不認〉。
- **`overflow-wrap: break-word`**（L324–325）與圖片的 `break-inside: avoid`（L356–358）。版面政策，不是繞法。
- **兩處 `FIXME: vertical-rl only, not -lr`**（L718、L899）。都在 scrolled mode 的路徑內，而 frond v1 不做 scrolled mode，中日文也一律 `vertical-rl`。ADR-0001 引用過這兩處，這次確認位置不變。

---

## `-epub-` 與 `-webkit-` 前綴的 `writing-mode`，Firefox 不認（#21）

**先講這一條不是什麼：它不是「Firefox 的直排有問題」。**

Firefox 的直排支援是完整的，而且在三家裡是**最正確**的那一家——本檔第一條量到的是 WebKit 在直排下不自動套用 `vert`（日文句點留在左下），Firefox 在那一格是對的；〈foliate-js 的直排在 Firefox 沒有壞〉那條量到它排得出直排、翻得動頁、CFI 往返回得到原位，欄寬／頁數／進度與另外兩家逐位數相同。

Firefox 不認的只是兩個**私有前綴的屬性名**。同一個 Firefox，只把屬性名換成標準寫法就正常了（見下表第一列與最後兩列）。而且嚴格說**Firefox 在這裡是對的**：標準屬性是 `writing-mode`，`-epub-` 是 EPUB 閱讀系統的前綴、`-webkit-` 是 WebKit 的前綴，沒有任何規範要求 Firefox 實作別家的私有前綴。壞的是那本書——它只寫了兩個私有前綴，完全沒寫標準屬性。

這件事要寫在最前面，因為「foliate 直排在 Firefox 是壞的」這句話曾經被當成事實寫進 #1 的工作排序、被 ADR-0001 標為未經核實、最後由 #7 實測撤回。**讓那個結論從「Firefox 不認前綴」這條新路徑重新長回來，代價跟第一次一樣。**

**症狀**

書把直排宣告成 `-epub-writing-mode: vertical-rl` 或 `-webkit-writing-mode: vertical-rl` 而**沒有**無前綴的那一條時，Firefox 整份文件排成橫排。Chromium 與 WebKit 兩個前綴都認。

這不是造出來的案例。觸發點是一本實際的書：**《入境大廳》**（ADR-0007 的觸發點之一，Adobe InDesign 17.0.1 產、EPUB 3、繁中直排、`page-progression-direction="rtl"`）。它的 `<body>` 上宣告的是那兩個前綴版本，**無前綴的 `writing-mode` 一次都沒有出現**——所以整本書在 Firefox 上是橫排的。

在 `<body>` 上宣告 `vertical-rl`，量 computed `writing-mode` 與相鄰兩個字元的推進（`あ` → `い`，Noto Serif CJK JP 32px、`line-height: 1`；直排是 dx 0／dy 正，橫排是 dx 正／dy 0）：

| `<body>` 上的宣告 | Chromium | Firefox | WebKit |
| --- | --- | --- | --- |
| `writing-mode: vertical-rl` | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 |
| `-epub-writing-mode: vertical-rl` | `vertical-rl`，dy +32 | **`horizontal-tb`，dx +32** | `vertical-rl`，dy +32 |
| `-webkit-writing-mode: vertical-rl` | `vertical-rl`，dy +32 | **`horizontal-tb`，dx +32** | `vertical-rl`，dy +32 |
| **兩個前綴都給（實際出現的形狀）** | `vertical-rl`，dy +32 | **`horizontal-tb`，dx +32** | `vertical-rl`，dy +32 |
| `writing-mode: tb-rl`（舊語法） | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 |
| `writing-mode:vertical-rl`（冒號後無空白） | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 | `vertical-rl`，dy +32 |

computed 值與幾何在每一格都同進退——宣告被丟掉時兩者一起變成橫排，所以這裡沒有「computed 說對了但畫出來是錯的」那種分歧（那是本檔第一條的形狀）。

**看得到的樣子**（同一份宣告：`-epub-` 與 `-webkit-` 前綴寫在 `<body>` 上、無前綴的不給；320×220 容器、Noto Serif CJK TC 22px、`line-height: 1.6`）：

| Chromium | Firefox | WebKit |
| --- | --- | --- |
| ![](evidence/21/chromium-prefixed-writing-mode.png) | ![](evidence/21/firefox-prefixed-writing-mode.png) | ![](evidence/21/webkit-prefixed-writing-mode.png) |

第一格與第三格字由上而下、行由右而左；**中間那格是橫排**，從左上開始由左而右。三張圖是同一份 HTML 在三家的結果，差異全部來自前綴要不要認。

圖裡的句子是**為了截圖自造的**，不取自任何書——商業書不進 repo，截圖同樣適用（ADR-0007）。圖以 `docs/evidence/21/` 保存；產生方式是一支一次性的 Playwright spec，用 `page.setContent` 餵上面那份 HTML 後對容器 `locator.screenshot()`，重寫得出來，因此沒有留在 repo 裡。

順帶量到的三件事，都與原本的預期不同：

1. **Chromium 也認 `-epub-` 前綴**，不只 `-webkit-`。前綴支援不是「WebKit 系才有」。
2. **舊語法 `writing-mode: tb-rl` 三家都認**，而且 computed 值正規化成 `vertical-rl`。本機的書裡《我的公寓》與《給力》的樣式表仍有這種寫法，與現代語法並存——讀 computed style 的偵測不需要認得舊語法。
3. **冒號後沒有空白三家都正常。** 這一格沒有分歧，登記它是為了說明**偵測不可以用字串比對**：《入境大廳》寫的是 `-epub-writing-mode:vertical-rl`，在原始碼上比對 `"writing-mode: vertical-rl"` 會漏掉這本書，而 CSSOM 看到的是正規化後的值。

**繞法**

把前綴宣告正規化成無前綴的等價宣告。

foliate 的 `paginator.js` L655–658 做的正是這件事。本檔上一節原本把它歸類成「相鄰但不算瀏覽器補丁」的其中一項、理由寫「EPUB 規格的歷史包袱」——**那個歸類錯了，已據本條修正**：它是一條真的繞法，繞的是 Firefox 不認前綴這件事。foliate 沒有註記原因，所以照抄的人不會知道拿掉它的代價是一家瀏覽器整本排錯。

**frond 是否需要處理**

需要。而且這一格與 ADR-0003 介入清單裡「InDesign 書把 `writing-mode` 宣告在 `<body>` 而非 `<html>`」那一格**看起來是同一件事，理由卻不同**，值得分清楚——那兩件事在同一本書上同時發生：

| | 位置在 `<body>` | 屬性名帶前綴 |
| --- | --- | --- |
| 瀏覽器有照書做嗎 | **有**。三家的 `body` computed 值都是 `vertical-rl` | **Firefox 沒有**。宣告被丟掉 |
| 誰讀得不夠 | library（只讀 `documentElement`） | 沒有人讀不夠，是宣告根本沒生效 |
| frond 要做什麼 | 讀 `<body>` 也要看 | 把宣告翻譯成瀏覽器認得的寫法 |

第二欄不是「覆寫書的宣告」——書的**意圖**沒有被改變，改的只是表達它的語法。

> **ADR-0003 的實例表已依本條新增一行。** 加的是右欄那個案例，並明寫「不要套用『frond 讀得不夠』」——那句話在這裡是錯的，而兩格在同一本書上同時發生，很容易被當成一件事。真正進入介入的封閉清單是 `Renderer` 存在之後的事，那時要連帶決定正規化發生在哪一層。

**這條暴露的 fixture 保真度缺口已經補上（#24）。** `writing-mode-on-body.epub` 只演「位置在 `<body>`」一個軸，宣告寫的是無前綴的 `writing-mode`——而實際的書是兩個軸疊在一起，且無前綴的那條不存在。照那一份開發出來的偵測會在三家全綠，然後在實際的書上讓 Firefox 排錯。現在另有 `writing-mode-prefixed-only.epub`：同樣宣告在 `<body>` 上、同樣 `vertical-rl`，**差別只在屬性名帶前綴、而且沒有無前綴的那一條**。兩份是彼此的對照組，差異對照表見 ADR-0007。

**哪個測試會抓到**

`tests/browser/smoke/writing-mode-declaration.spec.ts`。它刻意**釘住分歧而不期待三家一致**，理由同 `regional-faces.spec.ts`：分歧是瀏覽器的性質，frond 要據此決定介入，它變了必須有人知道。

已驗證有牙齒：把 `firefox` 從該檔的 `IGNORES_PREFIXED_WRITING_MODE` 移除，前綴那兩條測試在 Firefox 上立刻紅，而與例外清單無關的另外三條（無前綴、`tb-rl`、無空白）保持綠。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5——量測時重新確認過版本，與本檔其他條目相同。三家都是 Linux 建置。**真 Safari 走 CoreText，iOS 未驗證**（ADR-0004 明列不做）；前綴支援是 CSS 解析層的事，與文字塑形無關，但沒有量過就是沒有量過。

**沒有任何渲染器參與**（見〈這個數字是誰排的〉）：量測是 `page.setContent` 餵一份手寫的 HTML／CSS，frond 目前也還沒有任何渲染程式碼。所以這一條講的是瀏覽器本身的行為，換渲染器仍然成立——與本檔那兩條直排量測不同，它們是在 foliate 的分欄設定下量到的。

---

## 分欄的欄沿行內軸溢出——直排的欄寬是高度（#32）

**這一條三家一致，登記在這裡是因為它是分頁的地基。** 弄錯不會有任何東西報錯：`column-width` 套在錯的方向上仍然是一個合法的宣告，畫面照樣畫得出來，只是每一頁裝的內容不對——症狀是「一屏疊出好幾頁」。

**量到的**

400×300 的容器（長寬刻意不相等）、`column-fill: auto`、`column-gap: 0`，欄寬取行內軸上的容器尺寸：

| 書寫方向 | 行內軸 | `column-width` 量的是 | 溢出在哪一軸 | 捲動座標 |
| --- | --- | --- | --- | --- |
| `horizontal-tb` | 水平 | 寬度 | **x**（`scrollWidth > clientWidth`，`scrollHeight == clientHeight`） | 由 0 起算，往正數 |
| `vertical-rl` | 垂直（字由上而下） | **高度** | **y**（`scrollHeight > clientHeight`，`scrollWidth == clientWidth`） | 由 0 起算，往正數 |

換一個 viewport 形狀（高度 300 → 600、寬度不動）之後，直排的總長跟著換成 600 的倍數——**欄寬是與容器高度連動的公式，不是常數**。

spine 踩過的「直排欄寬必須剛好等於一個 viewer 高」就是第二列，但那句話只給了結論；換一個 viewport 形狀之後該改哪一個數字，要靠這張表才答得出來。

**捲動座標為什麼也要量**

分頁沿行內軸推進，而這兩種書寫方向的行內軸都是正向的（橫排由左而右、直排由上而下），所以捲動座標從 0 起算。但**負值慣例確實存在**：`direction: rtl` 的行內軸由右而左，CSSOM View 規定那種情況的 `scrollLeft` 由負值表示。frond v1 的兩種書寫方向都不落在那一格，量它是為了讓「不必處理負值」變成一條有東西守著的結論，而不是一個沒有人驗過的假設。

**frond 是否需要處理**

不是「處理」，是**建立在它上面**。`src/renderer/geometry.ts` 每一條公式都以這張表為前提。

**哪個測試會抓到**

`tests/browser/renderer/multicol-geometry.spec.ts`。**沒有任何 frond 程式碼參與**（見〈這個數字是誰排的〉）：`page.setContent` 餵一份手寫的 HTML／CSS，量到的是瀏覽器本身的行為，換渲染器仍然成立。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。Chromium 149.0.7827.0、Firefox 151.0、WebKit 26.5。

---

## 長度為零的 range 在欄邊界上，游標被畫到上一欄的結尾（#32）

**症狀**

一個 collapsed 的 `Range` 落在換頁點上（也就是那個位置正好是下一欄的第一個字元）時，`getClientRects()` 回傳的矩形落在**上一欄的結尾**，而不是下一欄的開頭。

這是文字游標的 affinity——同一個位置在換行處有兩個合理的畫法，而瀏覽器選了前一個。它本身不是 bug，是一個沒有規定的選擇。

**為什麼它會咬到 frond**

frond 每一次回報位置都會碰到這一格：`RenderLocation.cfi` 指的是「這一頁最前面那個字元」，而那個位置**恆定是換頁點**。用游標的矩形去問「這個位置在第幾頁」，答案會是上一頁。

症狀因此是「用 CFI 跳回剛才那一頁，落到了上一頁」，而且只有部分頁面會這樣（取決於斷頁剛好落在哪裡），看起來像隨機的。

實測是在 `vertical-japanese`、讀者字級 64px、800×600 下踩到的：第三節第 2 頁的起點 `epubcfi(/6/6!/4/8/1:13)` 跳回去之後落在第 1 頁。

**繞法**

量長度為零的 range 之前，先把它**往後撐開一個字元**再量。撐開之後量到的是那個字元自己的框，沒有 affinity 的餘地。

foliate 的 `paginator.js` 有一個 `uncollapse()`（本檔表二 #7），但它解的是另一個症狀（「collapsed range 有時候不回傳 client rect」）。**這一條不是那一條**：這裡的 range 有回傳矩形，只是回傳了另一個位置的矩形。兩者剛好共用同一個繞法。

**哪一家**

**Chromium 已重現。** Firefox 與 WebKit 在同一組參數下沒有踩到——但那是**前提未出現**（三家的斷頁位置不同，那個 CFI 在另外兩家不落在換頁點上），不等於它們沒有這個行為。要判定另外兩家需要各自造一個落在它們斷頁點上的位置。

**frond 是否需要處理**

需要，已處理。`src/renderer/section-view.ts` 的 `measurable()`：長度為零的 range 一律先撐開一個字元再量，三家共用同一條路徑，不分支。

**哪個測試會抓到**

`tests/browser/renderer/invariants.spec.ts` 的「CFI → 跳過去 → CFI 是 identity，每一頁都是」。它逐頁驗證，所以只要有任何一頁的起點落在會觸發 affinity 的位置就會紅——這正是它當初抓到這條的方式。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。Chromium 149.0.7827.0。

---

## 直排下 `<p>` 的下邊距落在分頁軸上，會造出一頁空白（#32）

**症狀**

書寫 `p { margin: 0 0 1em }`（實際的書的常態，合成 fixture 也照抄了這個形狀）時，那個 `margin-bottom` 是**實體**邊界。在 `writing-mode: vertical-rl` 下，實體的「下」落在**行內軸**上——而行內軸正是分頁軸（見本檔上面那條）。

於是最後一段的下邊距會把捲動總長推進下一欄，而那一欄裡一個字都沒有。讀者翻到那一頁看到全白。

**這不是瀏覽器的 bug**，是實體邊界與書寫方向的關係，三家一致。登記在這裡是因為它的後果落在 frond 的分頁上，而從 CSS 規格推不出「所以頁數會多一」這個結論——要有一個真的分頁器才看得到。

**它咬到的不只是畫面**

那一頁報得出頁碼，卻報不出屬於自己的 CFI（最靠近的文字位置在上一頁）。於是「CFI → 跳過去 → CFI」在最後一頁對不上——一個看起來與空白頁完全無關的症狀。

**繞法**

頁數不能只看捲動總長，要取它與**內容實際延伸到的那一頁**的小者。「內容」要同時算文字與被取代元素（圖片、影片），只算文字的話純圖片的節會被判成零頁。

不去動書的 `margin`：那是書的宣告，而且它在版面上是對的——多出來的是 frond 把它算成一頁這件事。

**frond 是否需要處理**

需要，已處理。`src/renderer/section-view.ts` 的 `pageCount`。

空白頁是封閉缺陷清單裡的一項（`docs/agents/pull-requests.md`），所以這一格不是可以留著的小瑕疵。

**哪個測試會抓到**

`tests/browser/renderer/invariants.spec.ts` 的「一節的頁數與實際翻得到的頁數相符」與「CFI → 跳過去 → CFI 是 identity」。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。三家皆重現。

---

## 包含塊高度不確定時，百分比的 `max-block-size` 解析不出來——而三家對「然後呢」不一致（#37）

**症狀**

frond 用 `:root img { max-block-size: 100% !important }` 擋「圖比一欄還高」（ADR-0003 的 `cap-overflowing-boxes`）。**那條宣告在實際的書上幾乎總是無效**：百分比的 max-height 要有一個**確定的**包含塊尺寸才解析得出來，而樣本裡的圖版寫法是

```html
<div class="pic"><img src="…"/></div>
```

而 `.pic` 是 `height: auto`。於是整條宣告被當成 `none`，圖照原尺寸排出去。

**這一半三家一致，而且不是 bug**（CSS Sizing：百分比對不確定的包含塊解析為 `none`）。登記在這裡是因為**接下來三家分道揚鑣**，而分歧只有一個真的分頁器看得到。

**量到的**

`plate-taller-than-page`（原圖 64×720），800×600 容器、邊界 24，一欄的區塊軸長度 552：

| 瀏覽器 | 修正前畫出來 | 症狀 | 修正後 |
| --- | --- | --- | --- |
| Chromium | 64×720，下緣 720 | 溢出 168px，被 `overflow: hidden` **裁掉** | 49×552，溢出 0 |
| Firefox | 64×720，下緣 720 | 同上，逐數字相同 | 49×552，溢出 0 |
| WebKit | union 460×552 | **圖被切成兩段分到相鄰兩欄**，讀者看到同一張圖的上半在這一頁、下半在下一頁 | 49×552，溢出 0 |

| | 修正前 | 修正後 |
| --- | --- | --- |
| Chromium | ![](evidence/37/before-chromium-tall-plate.png) | ![](evidence/37/after-chromium-tall-plate.png) |
| WebKit | ![](evidence/37/before-webkit-tall-plate.png) | ![](evidence/37/after-webkit-tall-plate.png) |

WebKit 那一格值得看一眼：`break-inside: avoid` 在那裡**幫不上忙**——一個比一欄還高的盒子無論如何都避不開切割，所以 avoid 只能被忽略。三家都是「合規地做了一件讀者讀不到內容的事」。

**繞法**

區塊軸的上限寫成**像素**而不是百分比。一欄在區塊軸上的長度是 `PageMetrics.blockSize`，而那是 frond 自己設的數字——不必向任何一層包裝問，也就沒有「包含塊尺寸確不確定」這個問題。

行內軸那一側留著 `100%`：那邊的百分比一律解析得出來（包含塊的行內尺寸永遠是確定的），而它要對齊的是**欄寬**而不是容器寬，雙欄時只有 `100%` 講得出這件事。

**frond 是否需要處理**

需要，已處理。`src/renderer/layout.ts`。這不是新增一項介入——`cap-overflowing-boxes` 早就在封閉清單上了，改的是讓它真的生效。

**哪個測試會抓到**

`tests/browser/renderer/rendering.spec.ts` 的〈比一欄還高的圖版〉兩條：圖被縮到一欄裝得下（且等比，不是壓扁），以及圖沒有一段落在容器外。

**怎麼發現的**

不是從規格推出來的，是拿 34 本實際流通的書跑一趟渲染掃描量到的（`npm run scan:books`，ADR-0007 的〈第三層跑過一趟了〉）。樣本裡四本書共七節是這個形狀，最嚴重的一節裁掉 738px——圖的 57%。合成 fixture 那時候全綠，因為它們的圖版只有 96×128。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。

---

## Firefox 不把比一欄還高的表格切到相鄰的欄（#37）

**症狀**

一個 `<table>` 比一欄還高時，Chromium 與 WebKit 把它**切成好幾段分到相鄰的欄**，內容全部讀得到。**Firefox 一段都不切**：表格照內容長，伸出容器，再被 frond 的 `overflow: hidden` 裁掉。

而且代價不只被裁掉的那幾列。不切欄等於內容**不往行內軸延伸**，於是 frond 算出來的頁數是 **1**——表格後面的東西讀者一併看不到，翻頁也翻不出來（分頁沿行內軸推進）。

**量到的**

`table-taller-than-page`（30 列），800×600 容器、邊界 24，一欄的區塊軸長度 552：

| 瀏覽器 | 表格的 fragment 數 | 區塊軸溢出 | 最後一列的下緣 | 這一節的頁數 |
| --- | --- | --- | --- | --- |
| Chromium | 3 | 0 | 503 | 2 |
| WebKit | 3 | 0 | 489 | 2 |
| Firefox | **1** | **751px** | **1301** | **1** |

| Chromium（切欄） | Firefox（不切） |
| --- | --- |
| ![](evidence/37/chromium-tall-table.png) | ![](evidence/37/firefox-tall-table.png) |

Firefox 那張圖上第 13 列被橫向切掉一半——封閉缺陷清單裡的「裁切」與「溢出」同時命中，而第 14 到 30 列一列都到不了。

**`cap-overflowing-boxes` 為什麼擋不住**

frond 的介入清單裡有一項是給溢出的盒子加 `max-block-size` 上限，而它對表格是個 **no-op**：CSS 規定 `height` / `max-height` 對 `display: table` 的元素是**下限**而不是上限，表格一律照內容長。圖版那一份（同一份清單、同一條規則）修得掉，正是因為替換元素沒有這條例外。

三家對這條 no-op 的表現也不一樣，量的時候要小心：Chromium 與 WebKit 的 `table.getBoundingClientRect().height` 回 552（所有 fragment 的聯集，剛好一欄高），Firefox 回 1302.8。**所以「表格比一欄還高嗎」不能用 bounding box 問**——那個問法在會切欄的引擎上永遠得到「沒有」。

**繞法**

沒有不付代價的。剩下的路是把 `display: table` 換掉：換完每一列變成區塊、內容流進相鄰的欄、全部讀得到，代價是**表格的對齊整個消失**。「讀得到但對不齊」與「對得齊但一半看不到」哪個對讀者好，是一個權衡決定。

**frond 是否需要處理**

**尚未處理**，登記成缺口（`src/renderer/interventions.ts` 的〈已知的缺口〉第 3 項）。理由不是「沒量到」——樣本裡三本書共九節是這個形狀，最嚴重的一節裁掉 2563px——而是上面那個權衡需要一張票去決定，不該在一次修 bug 的過程裡順手挑一邊。

**哪個測試會抓到**

`tests/browser/renderer/rendering.spec.ts` 的〈比一欄還高的表格（三家分歧，釘住現況）〉。它**釘住現況而不期待三家一致**，寫法同本檔的 generic family 那一條（#4）：Firefox 開始切表格時它會紅，而那時候要更新的是 `FRAGMENTS_TALL_TABLES`，缺口也就可以拿掉。換句話說這個缺口有可能不必動 frond 就自己消失。

**怎麼發現的**

實書掃描（`npm run scan:books`）。**第一輪只跑 Chromium，完全沒看到它**——Chromium 是會切欄的那一家。三家都跑才浮出來，而那正是 ADR-0004 要求三家同級的理由在掃描上的同一個版本。

**環境**

`Dockerfile` 的映像（`mcr.microsoft.com/playwright:v1.61.1-noble`）。

## Chrome for Android 一個 tap 就選字，並蓋出搜尋 bar（Touch to Search）

**症狀**

手機版 Chrome 上，手指在內文上輕點一下——沒有長按——瀏覽器就選走那個詞，並在畫面
底部升起一條 Google 搜尋 bar。對用 tap 翻頁的閱讀器來說，讀者點頁面邊緣要翻頁，得到
的是一個被選起來的詞加一條搜尋 bar。

這條與本檔其他條目**不同類**：它不是三家排版行為的差異，是 Chrome for Android 特有的
瀏覽器功能，而且**桌機引擎一家都不會做這件事**，所以測試套件抓不到它。

**這一條的證據是什麼**

- 行為本身：消費端 spine 在實機（Android／Chrome）上觀察到，有截圖（spine #36）。
- 觸發與抑制的條件：Chrome 官方文件〈[Manage the triggering of touch to
  search](https://developer.chrome.com/blog/tap-to-search)〉。**未經本專案量測**——這台
  機器上沒有 Android 環境。

依那份文件，會觸發的是「可選取、而且不可互動／不可聚焦的純文字」。不觸發的條件有四種：
元素可聚焦（`tabindex=-1`）、有 widget 語意（`role=button` 那類）、click handler 呼叫
了 `preventDefault()` 或改了 DOM／CSS、以及**文字不可選取**（`user-select: none`）。
最後一種是唯一連長按都不觸發的。

**繞法**

前三種都要落在**被點到的那個元素**上，而書的內文在 iframe 裡、由書自己的標記構成，
消費端碰不到，frond 也不該替書加 `role` 或 `tabindex`。剩下 `user-select: none`。

但整份文件永久不可選會拿掉劃重點，所以範圍要縮到**一次按壓**：`pointerdown` 當下把
`user-select: none` 寫上 `documentElement`，放開就拿掉。tap 選字的判定發生在手勢完成
之後，來得及。

**frond 是否需要處理**

需要，但**只出機制，不做決定**：`RendererPointerDownEvent.preventTextSelection()`。
哪些按壓該抑制（哪裡是翻頁區、這個消費端到底用不用 tap 翻頁、手指還是滑鼠）是政策，
留在消費端（ADR-0002）。介入清單上是 `unselectable-during-press`。

**哪個測試會抓到**

`tests/browser/renderer/input-events.spec.ts` 的〈suppressing text selection for one
press〉。它釘的是**機制**：按壓期間文件不可選、放開之後又可選、期間拖不出選取、以及
連結照樣點得動。Touch to Search 本身只能在實機上手動確認。
