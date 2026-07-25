# 用 iframe 隔離內容，且不支援 EPUB scripted content

每個 section 在 iframe 內渲染。這幾乎沒有選擇餘地：EPUB 樣式表大量使用 `body`、`p`、`*` 這類全域選擇器，Shadow DOM 擋不住這種等級的污染；而分頁需要一個真正的 document 來承載 `writing-mode` 與 multi-column。epub.js 與 foliate 都用 iframe，不是巧合。

**代價是 sandbox 形同虛設。** 因 [WebKit bug 218086](https://bugs.webkit.org/show_bug.cgi?id=218086)，iframe 要能發事件就必須加 `allow-scripts`，而加了之後 sandbox 的隔離價值大幅喪失（foliate 的 `paginator.js` L242 有對應註解）。

因此 frond **不支援 EPUB 的 scripted content**（書內嵌的 JavaScript），與 foliate 同立場。foliate README 給的理由成立且適用於 frond：內容以同源 `blob:` URL 提供，在此前提下無法安全地隔離書內腳本。

這是**安全決策，不是功能取捨**——不是「還沒做」，是「不會做」。EPUB 3 規格允許 scripted content，所以未來一定會有人問「為什麼我的互動書不動」，答案在這裡。
