/**
 * 節點型別的判斷，一份。
 *
 * ## 為什麼寫死數字而不是用 `Node.ELEMENT_NODE`
 *
 * `Renderer` 的程式碼跑在**外層頁面的 realm**，而它處理的節點來自 iframe。兩個
 * realm 各有一份 `Node`，常數的**值**一樣所以拿外層的來比其實會對——但那是靠巧合
 * 成立的，而同一份直覺套到 `instanceof` 上就是錯的（iframe 裡的元素不是外層
 * `Element` 的實例，症狀是事件完全不送而且不報錯）。寫死讓兩者不必分辨。
 *
 * ## 為什麼是一個模組而不是各檔案自己寫
 *
 * `cfi-dom.ts`、`text-index.ts` 與 `section-view.ts` 都要問同一組問題。各寫一份的
 * 話，「CDATA 算不算文字」這種決定會在三個地方各有一個答案——而 CFI 的定址規則
 * 明文說它算（規格 2.2），漏掉的那一份會讓同一個位置在不同模組裡得到不同的序號。
 */

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PROCESSING_INSTRUCTION = 7;
const COMMENT = 8;
const DOCUMENT = 9;

export function isElement(node: Node): node is Element {
  return node.nodeType === ELEMENT;
}

/**
 * 在定址與走訪上算「文字」的節點。
 *
 * **CDATA 算**（CFI 規格 2.2 把它與文字節點同等看待）。實際的書裡 CDATA 少見，
 * 但它在 XHTML 裡完全合法，而漏掉它會讓那一段內容在字元計數與 CFI 定址上憑空
 * 消失。
 */
export function isTextLike(node: Node): boolean {
  return node.nodeType === TEXT || node.nodeType === CDATA;
}

/**
 * 定址時**完全不算**的節點——註解與處理指令。
 *
 * 「不算」比「跳過」更強：它們連位置都不佔，所以一份文件加了一行註解之後，
 * 每一個既有的 CFI 仍然指到同一個地方。
 */
export function isIgnored(node: Node): boolean {
  return node.nodeType === COMMENT || node.nodeType === PROCESSING_INSTRUCTION;
}

export function isDocument(node: Node): boolean {
  return node.nodeType === DOCUMENT;
}
