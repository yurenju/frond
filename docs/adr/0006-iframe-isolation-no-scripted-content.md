# 用 iframe 隔離內容，且不支援 EPUB scripted content

每個 section 在 iframe 內渲染。這幾乎沒有選擇餘地：EPUB 樣式表大量使用 `body`、`p`、`*` 這類全域選擇器，Shadow DOM 擋不住這種等級的污染；而分頁需要一個真正的 document 來承載 `writing-mode` 與 multi-column。epub.js 與 foliate 都用 iframe，不是巧合。

**代價是 sandbox 形同虛設。** 因 [WebKit bug 218086](https://bugs.webkit.org/show_bug.cgi?id=218086)，iframe 要能發事件就必須加 `allow-scripts`，而加了之後 sandbox 的隔離價值大幅喪失（foliate 的 `paginator.js` L242 有對應註解）。

因此 frond **不支援 EPUB 的 scripted content**（書內嵌的 JavaScript），與 foliate 同立場。foliate README 給的理由成立且適用於 frond：內容以同源 `blob:` URL 提供，在此前提下無法安全地隔離書內腳本。

這是**安全決策，不是功能取捨**——不是「還沒做」，是「不會做」。EPUB 3 規格允許 scripted content，所以未來一定會有人問「為什麼我的互動書不動」，答案在這裡。

## 做法是原地清空，不是移除

`<script>` 與 `<iframe>` / `<object>` / `<embed>` / `<frame>` **留在原位**，但屬性與子節點全部清掉，另外掛上 `display: none !important`（`<iframe>` 再加一個空的 `sandbox`）。這些元素還在樹上，只是身上什麼都沒有。

不用 `element.remove()` 的理由跟安全無關，跟 CFI 有關：CFI 是**用兄弟之中的排序**指一個元素的，移掉一個，它後面每個兄弟的索引都往前兩格。而 progress 與 annotation 正是以 CFI 儲存的東西，所以位移的症狀是讀者的畫線靜靜落到別的句子上——兩個方向都會壞：frond 寫出的 CFI 對別的 reader 不成立，別人寫的 CFI 在 frond 裡解到錯的節點。ADR-0008 把這種形狀的介入歸為 CFI 級的 breaking change（#65）。

安全性一分不減，理由在 `document-source.ts` 的 `emptyInPlace`：沒有 `src` 也沒有內容的 `<script>` 在解析時就沒有東西可以準備；`<iframe>` / `<object>` / `<embed>` 是靠 `src` / `data` / `srcdoc` 指到文件的，`<object>` 另外靠子節點 fallback，這四條路全部清掉了。之後也放不回去——`rewriteResourceReferences` 只改**已經存在**的屬性，而這一步跑在它前面。

代價是不變量變弱了：從「這個元素不在文件裡」變成「這個元素身上什麼都沒有」。前者不可能被侵蝕，後者可以——以後任何一個依 tag name 寫屬性的 pass 都會鬆動它。`isolation.spec.ts` 逐一比對清空後剩下哪些屬性，守的就是這一格。
