/**
 * 一份內容文件裡的文字，依文件順序攤平。
 *
 * 服務兩件事：整書索引要數字元（`progress.ts`），而由 fraction 跳回位置要能從
 * 「第 N 個字元」找回那個字元在哪一個節點裡。
 *
 * ## 兩邊必須數到同一個數字
 *
 * 索引是在**還沒渲染**的文件上建的（`DOMParser` 解一次就丟），位置是在**渲染好**
 * 的文件上算的，而那份文件被 frond 動過：注入了兩個 `<style>`、拿掉了 `<script>`。
 * 兩邊若用不同的走法，同一個位置會得到兩個不同的字元數，而症狀是進度條在翻頁時
 * 跳一下——沒有人查得到根因在兩個走訪的過濾條件不一樣。
 *
 * 所以這裡是**唯一**的走法，兩邊都叫它，而且過濾條件寫死：只看 `<body>` 裡面，
 * 跳過 `<script>` 與 `<style>`。frond 注入的樣式在 `<head>`，本來就不在範圍內；
 * 寫死 script／style 是為了讓「拿掉 script 之前與之後數到同一個數字」成立。
 */

/** 走訪時整棵跳過的元素。標籤名小寫比對——XHTML 的標籤名本來就是小寫。 */
const SKIPPED_ELEMENTS = new Set(["script", "style", "template", "head"]);

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;
const NODE_TYPE_CDATA = 4;

/**
 * 這份文件裡的文字節點，依文件順序。
 *
 * `body` 不存在（解析失敗或空文件）時回空陣列——那不是錯誤，`empty-and-image-only-sections`
 * 演的正是這一格。
 */
export function textNodesIn(document: Document): readonly Text[] {
  const body = document.body;
  if (body === null) return [];

  const nodes: Text[] = [];
  collect(body, nodes);
  return nodes;
}

function collect(element: Node, into: Text[]): void {
  for (const child of element.childNodes) {
    if (child.nodeType === NODE_TYPE_TEXT || child.nodeType === NODE_TYPE_CDATA) {
      // **整段都是空白的節點跳過。** XHTML 的縮排在每一個區塊元素之間都留下一個
      // 這種節點，而它們在版面上不佔位置——量不到矩形。
      //
      // 那件事的後果比「多數幾個字元」嚴重得多：`section-view.ts` 用二分搜尋找
      // 「這一頁最前面那個字元」，而二分搜尋的前提是節點的位置隨文件順序遞增。
      // 一個量不到矩形的節點會回報位置 0，前提就破了，搜尋會落在任意一處——症狀
      // 是翻頁之後回報的位置偶爾跳到章節開頭。
      //
      // 對進度而言這也是對的：區塊之間的縮排不是讀者讀過的內容。
      if ((child.nodeValue ?? "").trim() === "") continue;

      into.push(child as Text);
      continue;
    }
    if (child.nodeType !== NODE_TYPE_ELEMENT) continue;
    if (SKIPPED_ELEMENTS.has((child as Element).localName.toLowerCase())) continue;

    collect(child, into);
  }
}

/** 這份文件有多少字元。 */
export function countCharacters(document: Document): number {
  let total = 0;
  for (const node of textNodesIn(document)) total += node.length;
  return total;
}

/**
 * 某個位置之前有多少字元。
 *
 * 位置不在這份文件的走訪範圍裡時（例如落在 `<head>` 或被跳過的元素裡）回 0——
 * 那個位置在進度上等於文件開頭，而那是唯一不會說謊的答案。
 */
export function charactersBefore(
  nodes: readonly Text[],
  node: Node,
  offset: number,
): number {
  let total = 0;

  for (const candidate of nodes) {
    if (candidate === node) return total + Math.min(offset, candidate.length);
    total += candidate.length;
  }

  return 0;
}

/**
 * 第 `target` 個字元落在哪裡。
 *
 * 超出總長時停在最後一個位置。一個字都沒有的文件回 `undefined`——呼叫端據此
 * 退回這一節的開頭，而不是拿一個假的節點去建 `Range`。
 */
export function positionAtCharacter(
  nodes: readonly Text[],
  target: number,
): { readonly node: Text; readonly offset: number } | undefined {
  if (nodes.length === 0) return undefined;

  let remaining = Math.max(0, target);

  for (const node of nodes) {
    if (remaining < node.length) return { node, offset: remaining };
    remaining -= node.length;
  }

  const last = nodes[nodes.length - 1]!;
  return { node: last, offset: last.length };
}
