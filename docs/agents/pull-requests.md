# Pull requests

## PR 說明要用 closing keyword 關掉它做的那張票

一張票對應的 PR，說明裡要有 GitHub 的關閉關鍵字，指向那張票：

```
Closes #6
```

合併時 GitHub 會自動關掉該 issue，並在 issue 上留下指向 PR 的紀錄。關鍵字要放在 PR **內文**（`--body` / `--body-file`），不是留言也不是 commit message 的內文以外的地方；一個 PR 收掉多張票就寫多行，每行一個關鍵字加一個編號（`Closes #6` 換行 `Closes #7`），寫成 `Closes #6, #7` 只會關掉第一張。

**為什麼要求這件事：漏掉的代價不是「issue 忘了關」，是後面的票被錯誤地擋住。** 這個 repo 用 GitHub 原生的 issue dependencies 表達阻塞邊（見 `issue-tracker.md`），而那個閘門看的是 blocker **開著還是關著**，不是它的程式碼有沒有合併。PR #14 把 #6 的產生器整個合進 main 卻沒帶關閉關鍵字，於是 #6 留在 open，#7 與 #8 的 `blocked_by` 到現在都還指著它——下一個 agent 跑 frontier query 會得到「沒有票可以做」，而那是假的。

只有在確實不想連動時才不寫（例如票的範圍大於這個 PR，PR 只做了其中一刀）。那種情況用 `Part of #<n>` 或 `Refs #<n>`，讓連結留著但不觸發關閉。

## 說明裡該放圖

frond 的正確性有一部分只有畫面看得出來——直排標點的位置、區域字形、破版。這類缺陷的共同點是 DOM 斷言與幾何不變量全數通過而像素是錯的，所以 PR 說明裡**該放圖**。

### 跟視覺有關的變更，三家都要跑過，並由 agent 判讀

**適用範圍**：動到 `Renderer`、版面幾何、注入的 CSS、字型或書寫方向的變更。純解析層（`EpubBook`）的變更不適用——那一層沒有畫面。

開 PR 之前，在 **Chromium、Firefox、WebKit 各跑一次**，看這次的實作在三家實際渲染成什麼樣子。三家都要跑，不是挑一家代表：frond 存在的一半理由就是別人沒把直排跨瀏覽器做好，而三家的分歧正是這個專案最常踩到的東西（ADR-0004）。

**判讀由開 PR 的 agent 自己做**，照這份**封閉式缺陷清單**逐項回答，每項給一個 severity：

| 缺陷 | 問的是 |
| --- | --- |
| 溢出 | 內容有沒有跑出容器、被裁掉讀不到 |
| 重疊 | 有沒有兩段內容疊在一起 |
| 書寫方向 | 畫出來的像素方向對不對——直排的字是不是真的由上而下、行由右而左 |
| 空白頁 | 有沒有整頁空白或幾乎空白 |
| 裁切 | 字有沒有被切掉一半（字符、標點、行首行尾） |

**清單必須是封閉式的，這不是形式。** LLM 的判讀是非決定性的：問「這張圖看起來對嗎」每跑一次得到不一樣的答案，也沒辦法跟上一個 PR 的判讀比較。固定成這五項、輸出結構化欄位，判讀才落在欄位上而不是印象上（ADR-0001）。

判讀結果寫進 PR 說明，跟圖與數字放在一起，**按瀏覽器分開寫**——「哪一家出現哪一項」本身就是資訊，三家不一致比三家一起壞更常見。**沒有發現缺陷也要寫**（「三家皆跑過，五項皆無」），否則讀 PR 的人分不出「跑過而沒事」與「根本沒跑」。

**這是開 PR 前的作者側檢查，不是 CI 閘門。** 它不擋任何東西，也不守回歸——那個取捨與代價記在 ADR-0001。

### 圖片可以放，但不能用網頁介面那條路

GitHub 的 PR 說明與留言支援 Markdown 圖片，前提是圖片有一個公開取得的 URL。

網頁介面拖放上傳會產生 `https://github.com/user-attachments/assets/...`，那個 URL 只有瀏覽器 session 拿得到——`gh` 沒有上傳附件的指令，PAT 也打不到那個端點。CI 的 artifact 需要認證而且會過期，同樣不能內嵌。

可行的做法是**把圖片 commit 進 repo，用 `raw.githubusercontent.com` 引用**。frond 是公開 repo，這個 URL 不需要認證。

### 流程

1. **在容器裡產生截圖**：`npm run evidence -- <spec 路徑>`。做法見下面〈截圖怎麼從容器裡出來〉——這一步不能在 host 上做，host 沒有瀏覽器也沒有那套釘死的字型。
2. 裁切、縮到夠看就好，存成 PNG，放在 `docs/evidence/<issue 編號>/` 底下。
3. 跟著這次變更一起 commit 並 push。
4. 取得 commit SHA：`git rev-parse HEAD`。
5. PR 內文用這個形式引用：

```
![WebKit 直排下句點留在左下](https://raw.githubusercontent.com/yurenju/frond/<SHA>/docs/evidence/3/webkit-vertical-fullstop.png)
```

6. `gh pr create --body-file <檔案>`。

**URL 一定要釘 commit SHA，不要用分支名。** 分支名指向的內容會隨著後續 commit 改變，分支在合併後被刪掉時整個 URL 就死了——而 PR 說明是要留著給人回頭看的。

### 截圖怎麼從容器裡出來

**圖只能在容器裡產生。** 三家瀏覽器與釘死的字型只存在於測試映像裡（`docs/test-environment.md`）——在 host 上截出來的圖，字型是那台機器碰巧裝了什麼，量到的東西就不是 CI 會看到的東西，而視覺判讀的整個價值建立在「這是三家實際排出來的樣子」上。

而容器以 `--rm` 執行，裡面寫出來的檔案跟著容器一起消失。所以有一支腳本專門處理這件事：

```bash
npm run evidence -- tests/browser/evidence/vertical.spec.ts
npm run evidence -- tests/browser/evidence/vertical.spec.ts --project=webkit
```

它與 `test:container` 走同一套引擎判斷與同一個映像，差別只有兩件事：只跑你指定的那一支 spec，以及把 `docs/evidence/` 掛成可寫。**spec 要把檔案寫進 `docs/evidence/<issue 編號>/`**，那是唯一活得下來的路徑。

一次性的 spec 放 `tests/browser/evidence/`：

- 要在 `tests/browser/` 底下，`playwright.config.ts` 的 `testDir` 才收得到它
- 那個目錄已經 gitignore。**這種 spec 不留在 repo**——它服務單一次判讀，留下來會變成沒有人維護、CI 卻要跑的東西。做法寫進 PR 說明或 quirk 的敘述裡，需要時重寫得出來（`docs/browser-quirks.md` 已經有兩條是這樣記的）
- 被 git 忽略不影響它進映像：build context 看的是檔案系統不是 git，所以**寫完直接跑，不必先 commit**

一支最小的 spec 長這樣——`page.setContent` 餵 HTML，對元素而不是整頁截圖（整頁會有大片留白）：

```ts
import { mkdir } from "node:fs/promises";
import { test } from "@playwright/test";

test("直排下的句點位置", async ({ page }, testInfo) => {
  await mkdir("docs/evidence/29", { recursive: true });
  await page.setContent(`<!doctype html>
<html lang="ja"><body style="margin:0;writing-mode:vertical-rl;font-family:'Noto Serif CJK JP';font-size:32px">
<p style="margin:0">朝の光。</p></body></html>`);
  // 檔名帶瀏覽器名字：三家的圖要並排比較，混在一起就分不出誰是誰。
  await page
    .locator("p")
    .screenshot({ path: `docs/evidence/29/${testInfo.project.name}-vertical.png` });
});
```

截圖與測試同一個要求：頁面由 `page.setContent` 供給，腳本以 `--network=none` 執行。一張要連外才截得出來的圖，換一台機器就截不出來了。

引擎用 rootless（`docs/test-environment.md` 建議的做法）時，寫出來的 PNG 屬於你自己的 uid。**rootful docker 會產出 root 擁有的檔案**，之後 git 動不了它。

### 圖要怎麼放才有用

**成對放，不要單張。** 「WebKit 的句點在錯的位置」單看一張圖說服不了人，要並排「Chromium／Firefox 是這樣、WebKit 是這樣」，或是「修正前／修正後」。Markdown 表格的儲存格裡可以放圖：

```
| Chromium | WebKit |
| --- | --- |
| ![](https://raw.githubusercontent.com/.../chromium.png) | ![](https://raw.githubusercontent.com/.../webkit.png) |
```

**圖旁邊一定要附數字。** 這個專案的立場是視覺判讀不可省略但也不可單獨採信——截圖是給人看的證據，不是可以被否證的斷言。所以放圖的同時要寫出量到的值（墨水重心座標、矩形、頁數），並指出是哪一條測試在守著它。只有圖沒有數字的 PR 說明，等於把「我看起來覺得對」寫進紀錄。

**圖片會永遠留在 git 歷史裡。** 只放真正解釋得了東西的圖，裁掉沒有資訊的留白。同一張圖如果也值得長期保存，`docs/browser-quirks.md` 之類的文件可以用相對路徑引用它——repo 內的 Markdown 檔案吃相對路徑，PR 說明不吃，所以兩邊寫法不同但可以共用同一個檔案。

**不要截版權內的書。** ADR-0007 禁止把商業書 commit 進 repo，截圖同樣適用——這是公開 repo，截圖等於發佈內容。要示範實際書籍的排版就用 `tests/books/public/` 底下那兩本公版書（ADR-0007 的第二層）：

```
tests/books/public/kusamakura-vertical-japanese.epub    直排日文——草枕／夏目漱石，ruby、傍點、rtl
tests/books/public/alice-in-wonderland-horizontal.epub  橫排英文——Alice，43 張插畫剪到 9 張、圖文混排
```

兩本的出處與授權見 ADR-0007，都可以公開重製。**它們正是「實際的書排得對」這句話唯一能拿出來的證據**：合成 fixture 那一批只證明得了「已知的那幾種病沒有復發」，動到版面的變更要附的是這兩本的圖。
