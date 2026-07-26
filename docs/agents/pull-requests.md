# Pull requests

frond 的正確性有一部分只有畫面看得出來——直排標點的位置、區域字形、破版。這類缺陷的共同點是 DOM 斷言與幾何不變量全數通過而像素是錯的，所以 PR 說明裡**該放圖**。

## 圖片可以放，但不能用網頁介面那條路

GitHub 的 PR 說明與留言支援 Markdown 圖片，前提是圖片有一個公開取得的 URL。

網頁介面拖放上傳會產生 `https://github.com/user-attachments/assets/...`，那個 URL 只有瀏覽器 session 拿得到——`gh` 沒有上傳附件的指令，PAT 也打不到那個端點。CI 的 artifact 需要認證而且會過期，同樣不能內嵌。

可行的做法是**把圖片 commit 進 repo，用 `raw.githubusercontent.com` 引用**。frond 是公開 repo，這個 URL 不需要認證。

## 流程

1. 產生截圖。瀏覽器端測試用 Playwright 的 `locator.screenshot()`；`tests/browser/support/glyph.ts` 已經有單字元渲染的輔助程式。
2. 裁切、縮到夠看就好，存成 PNG，放在 `docs/evidence/<issue 編號>/` 底下。
3. 跟著這次變更一起 commit 並 push。
4. 取得 commit SHA：`git rev-parse HEAD`。
5. PR 內文用這個形式引用：

```
![WebKit 直排下句點留在左下](https://raw.githubusercontent.com/yurenju/frond/<SHA>/docs/evidence/3/webkit-vertical-fullstop.png)
```

6. `gh pr create --body-file <檔案>`。

**URL 一定要釘 commit SHA，不要用分支名。** 分支名指向的內容會隨著後續 commit 改變，分支在合併後被刪掉時整個 URL 就死了——而 PR 說明是要留著給人回頭看的。

## 圖要怎麼放才有用

**成對放，不要單張。** 「WebKit 的句點在錯的位置」單看一張圖說服不了人，要並排「Chromium／Firefox 是這樣、WebKit 是這樣」，或是「修正前／修正後」。Markdown 表格的儲存格裡可以放圖：

```
| Chromium | WebKit |
| --- | --- |
| ![](https://raw.githubusercontent.com/.../chromium.png) | ![](https://raw.githubusercontent.com/.../webkit.png) |
```

**圖旁邊一定要附數字。** 這個專案的立場是視覺判讀不可省略但也不可單獨採信——截圖是給人看的證據，不是可以被否證的斷言。所以放圖的同時要寫出量到的值（墨水重心座標、矩形、頁數），並指出是哪一條測試在守著它。只有圖沒有數字的 PR 說明，等於把「我看起來覺得對」寫進紀錄。

**圖片會永遠留在 git 歷史裡。** 只放真正解釋得了東西的圖，裁掉沒有資訊的留白。同一張圖如果也值得長期保存，`docs/browser-quirks.md` 之類的文件可以用相對路徑引用它——repo 內的 Markdown 檔案吃相對路徑，PR 說明不吃，所以兩邊寫法不同但可以共用同一個檔案。

**不要截版權內的書。** ADR-0007 禁止把商業書 commit 進 repo，截圖同樣適用——這是公開 repo，截圖等於發佈內容。要示範真書的排版就用青空文庫或 Project Gutenberg 的公版書。
