/**
 * CFI 與 DOM 位置之間的來回——`cfi.ts` 那個文法層明確劃出去的另一半。
 *
 * > **CFI ↔ DOM 位置的對應不在這裡。** 那需要真的有一份渲染好的文件——把 CFI 走
 * > 成一個 `Range`、或把讀者選取的一段文字寫成 CFI，都要數節點、要處理被過濾掉的
 * > 節點、要合併相鄰的文字節點。那些屬於 `Renderer`（`src/epub/cfi.ts`）。
 *
 * 這裡就是那段話指的地方。文法層負責字串與結構之間的來回，這裡負責結構與節點之間
 * 的來回，兩層都不知道對方在做什麼。
 *
 * ## 定址規則（規格 2.2）
 *
 * 一個父節點底下的子節點這樣編號：
 *
 * - **元素拿偶數**：第 k 個元素子節點（從 1 起算）的序號是 `2k`
 * - **文字拿奇數**：相鄰的文字節點**合併成一塊**，第 k 個元素之後那一塊的序號是
 *   `2k + 1`；第一個元素之前那一塊是 `1`
 * - **註解與處理指令完全不算**，連位置都不佔
 *
 * 「相鄰的文字節點合併成一塊」是最容易漏掉的一條，而漏掉它的症狀特別難查：一份
 * 文件被 `Node.normalize()` 過與沒有過，同一個位置會得到兩個不同的 CFI，而兩者
 * 都指得到東西。實際的書經過 XML 解析之後常常在實體參照（`&amp;`）的位置留下
 * 相鄰的文字節點，所以這不是理論上的邊界條件。
 *
 * ## `!` 之後從哪裡開始數
 *
 * 間接引用之後的第一步是相對於**內容文件的根元素**（`<html>`）數的，不是相對於
 * document 節點。所以 `<body>` 的第一步是 `/4`（`<head>` 是 `/2`）。這與 foliate
 * 在 #7 spike 量到的 `epubcfi(/6/2!/4,…)` 一致。
 */

import type { Cfi, CfiOffset, CfiPath, CfiSegment, CfiStep } from "../epub/cfi.ts";

/**
 * 封裝文件裡 `<spine>` 的序號。
 *
 * EPUB 的 `<package>` 內容模型規定順序是 metadata、manifest、spine，所以 spine
 * 恆為第三個元素子節點，序號 `2 × 3 = 6`。**這不是對書的寬容度假設**——它是規格
 * 的內容模型，一本把順序寫反的書連 `EpubBook` 那一層都開不起來。
 */
const SPINE_STEP_INDEX = 6;

/** 這一節在封裝文件裡的那一段路徑：`/6/N`。 */
export function spineSegment(sectionIndex: number): CfiSegment {
  return {
    steps: [
      { index: SPINE_STEP_INDEX, assertion: undefined },
      { index: (sectionIndex + 1) * 2, assertion: undefined },
    ],
    offset: undefined,
  };
}

/**
 * 一個 CFI 指向 readingOrder 的第幾項。
 *
 * 認不出來時回 `undefined`——例如路徑短到沒有 itemref 那一步，或第一步不是
 * `/6`。那種 CFI 可能是別的閱讀器寫的，或是書換了一版，兩種都不該讓跳轉靜默地
 * 落在第一節。
 */
export function sectionIndexOf(cfi: Cfi): number | undefined {
  const path = cfi.kind === "point" ? cfi.path : cfi.parent;
  const spine = path[0];
  if (spine === undefined) return undefined;

  const [first, second] = spine.steps;
  if (first?.index !== SPINE_STEP_INDEX || second === undefined) return undefined;
  if (second.index % 2 !== 0 || second.index < 2) return undefined;

  return second.index / 2 - 1;
}

/**
 * 把一段 `Range` 寫成 CFI。
 *
 * 起訖相同時給的是**點**而不是一段長度為零的範圍：那兩者在規格裡是不同的寫法，
 * 而閱讀進度存的是點、annotation 存的是範圍，混用會讓消費端分不出手上這一個是
 * 哪一種。
 */
export function cfiForRange(range: Range, sectionIndex: number): Cfi {
  const start = localPath(range.startContainer, range.startOffset);
  const end = localPath(range.endContainer, range.endOffset);

  if (range.collapsed) {
    return { kind: "point", path: [spineSegment(sectionIndex), start] };
  }

  // 共用前綴抽出來，剩下的兩截各自接在後面——規格的 `parent,start,end` 形狀。
  const shared = sharedStepCount(start.steps, end.steps);

  return {
    kind: "range",
    parent: [
      spineSegment(sectionIndex),
      { steps: start.steps.slice(0, shared), offset: undefined },
    ],
    start: [{ steps: start.steps.slice(shared), offset: start.offset }],
    end: [{ steps: end.steps.slice(shared), offset: end.offset }],
  };
}

/**
 * 把一個 CFI 走成這份文件裡的 `Range`。
 *
 * 走不到時回 `undefined`。走不到是常態而不是例外——書換了一版、CFI 來自別的
 * 閱讀器、或那一節根本不是這一節，三種都會走到這裡，而它們的處置是「跳到這一節
 * 的開頭」而不是丟一個例外把整個閱讀流程打斷。
 */
export function rangeForCfi(document: Document, cfi: Cfi): Range | undefined {
  const root = document.documentElement;

  if (cfi.kind === "point") {
    const local = contentSegmentOf(cfi.path);
    if (local === undefined) return undefined;

    const point = resolve(root, local);
    if (point === undefined) return undefined;

    const range = document.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    return range;
  }

  const parent = contentSegmentOf(cfi.parent);
  if (parent === undefined) return undefined;

  const startLocal = joinSegments(parent, cfi.start);
  const endLocal = joinSegments(parent, cfi.end);
  if (startLocal === undefined || endLocal === undefined) return undefined;

  const start = resolve(root, startLocal);
  const end = resolve(root, endLocal);
  if (start === undefined || end === undefined) return undefined;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * 取出路徑裡落在**內容文件**的那一段。
 *
 * 一條完整的 CFI 是「封裝文件那一段 `!` 內容文件那一段」，所以內容文件那一段是
 * 最後一段。只有一段的 CFI（`/6/4`，指向整個 Section）沒有內容文件那一段，回
 * `undefined`——那不是壞掉的 CFI，是一個指向整節的合法位置，由呼叫端決定它等於
 * 這一節的開頭。
 */
function contentSegmentOf(path: CfiPath): CfiSegment | undefined {
  return path.length >= 2 ? path[path.length - 1] : undefined;
}

/** 把範圍的起（訖）接到共用前綴後面，得到內容文件裡的完整一段。 */
function joinSegments(parent: CfiSegment, local: CfiPath): CfiSegment | undefined {
  const first = local[0];
  if (first === undefined) return undefined;
  // 範圍的起訖不會跨進另一份文件——那種 CFI 在文法層就是 `incomparable` 的形狀。
  if (local.length > 1) return undefined;

  return { steps: [...parent.steps, ...first.steps], offset: first.offset };
}

interface DomPosition {
  readonly node: Node;
  readonly offset: number;
}

/** 從根元素依序走每一步。 */
function resolve(root: Element, segment: CfiSegment): DomPosition | undefined {
  let current: Node = root;

  for (let index = 0; index < segment.steps.length; index += 1) {
    const next = childAt(current, segment.steps[index]!.index);
    if (next === undefined) return undefined;

    // 文字那一塊只可能出現在最後一步——它沒有子節點可以再往下走。走到這裡表示
    // 這個 CFI 與這份文件對不上，回 undefined 讓呼叫端退回這一節的開頭。
    if (next.kind === "text" && index !== segment.steps.length - 1) return undefined;

    current = next.node;
  }

  if (segment.offset === undefined) {
    // 沒有字元位移：指的是節點本身。用「父節點加上它在父節點裡的位置」表示，
    // 這樣 Range 落在節點之前而不是它的內容裡。
    const parent = current.parentNode;
    if (parent === null) return { node: current, offset: 0 };
    return { node: parent, offset: indexInParent(parent, current) };
  }

  return offsetWithin(current, segment.offset);
}

interface ChildTarget {
  readonly node: Node;
  readonly kind: "element" | "text";
}

/**
 * 父節點底下序號為 `index` 的那個子節點。
 *
 * 偶數找元素，奇數找**那一整塊**相鄰文字裡的第一個節點——後續的偏移計算需要從
 * 塊的開頭數起。
 */
function childAt(parent: Node, index: number): ChildTarget | undefined {
  if (index <= 0) return undefined;

  if (index % 2 === 0) {
    const wanted = index / 2;
    let seen = 0;
    for (const child of parent.childNodes) {
      if (isElement(child)) {
        seen += 1;
        if (seen === wanted) return { node: child, kind: "element" };
      }
    }
    return undefined;
  }

  const after = (index - 1) / 2;
  let elements = 0;
  let chunkStart: Node | undefined;

  for (const child of parent.childNodes) {
    if (isIgnored(child)) continue;

    if (isElement(child)) {
      if (chunkStart !== undefined && elements === after) {
        return { node: chunkStart, kind: "text" };
      }
      elements += 1;
      chunkStart = undefined;
      continue;
    }

    if (isText(child) && chunkStart === undefined) chunkStart = child;
  }

  return chunkStart !== undefined && elements === after
    ? { node: chunkStart, kind: "text" }
    : undefined;
}

/**
 * 一塊相鄰文字裡的第 N 個字元落在哪一個節點的第幾個位置。
 *
 * 位移是**整塊**的位移，所以要跨著節點數過去。超出整塊長度時停在塊尾而不是回
 * `undefined`：書改了一版讓那一段變短是常見的事，停在最接近的位置比跳回章節
 * 開頭好。
 */
function offsetWithin(chunkStart: Node, offset: CfiOffset): DomPosition {
  let remaining = offset.characters;
  let node: Node = chunkStart;

  for (;;) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };

    const next = node.nextSibling;
    if (next === null || !isText(next)) return { node, offset: length };

    remaining -= length;
    node = next;
  }
}

/** 一個節點在父節點的 `childNodes` 裡的位置——`Range` 用的那種索引。 */
function indexInParent(parent: Node, node: Node): number {
  let index = 0;
  for (const child of parent.childNodes) {
    if (child === node) return index;
    index += 1;
  }
  return index;
}

/** 這個節點在它父節點底下的那一段路徑（不含父節點以上）。 */
function localPath(container: Node, offset: number): CfiSegment {
  if (isText(container)) {
    const { chunkStart, charactersBefore } = chunkOf(container);
    return {
      steps: stepsTo(chunkStart),
      offset: { characters: charactersBefore + offset, assertion: undefined },
    };
  }

  // 容器是元素時，`offset` 是子節點的索引而不是字元位置。
  //
  // 落在子節點之間的邊界（讀者從段落開頭往前選一格就會產生）在 CFI 裡沒有直接
  // 的寫法——CFI 定址的是節點，不是節點之間的縫。取那個位置**之後**的那個子
  // 節點，也就是最靠近的一個實際節點；沒有子節點時退回元素自己。
  const child = container.childNodes[Math.min(offset, container.childNodes.length - 1)];
  const target = child ?? container;

  return { steps: stepsTo(target), offset: undefined };
}

interface Chunk {
  readonly chunkStart: Node;
  readonly charactersBefore: number;
}

/** 這個文字節點屬於哪一塊，以及它在塊裡從第幾個字元開始。 */
function chunkOf(node: Node): Chunk {
  let chunkStart = node;
  let charactersBefore = 0;

  for (;;) {
    const previous = chunkStart.previousSibling;
    if (previous === null || !isText(previous)) break;
    chunkStart = previous;
    charactersBefore += previous.nodeValue?.length ?? 0;
  }

  return { chunkStart, charactersBefore };
}

/**
 * 從內容文件的根元素走到這個節點的每一步。
 *
 * 根元素本身不算一步——`!` 之後的第一步是根元素的子節點（見檔頭）。
 */
function stepsTo(node: Node): readonly CfiStep[] {
  const steps: CfiStep[] = [];
  let current: Node | null = node;

  while (current !== null) {
    const parent: Node | null = current.parentNode;
    if (parent === null || parent.nodeType === NODE_TYPE_DOCUMENT) break;

    steps.unshift({ index: stepIndexOf(parent, current), assertion: assertionFor(current) });
    current = parent;
  }

  return steps;
}

/**
 * 元素的 id 寫進斷言裡。
 *
 * 規格說索引才是權威、斷言是書改版之後用來回復位置的冗餘，所以 `compareCfi()`
 * 不看它、`rangeForCfi()` 也不用它。寫出去是因為**別的閱讀器會用**，而一個帶
 * 得動 id 的 CFI 在書換版之後救得回來。
 */
function assertionFor(node: Node): { readonly fields: readonly string[]; readonly parameters: readonly [] } | undefined {
  if (!isElement(node)) return undefined;
  const id = node.getAttribute("id");
  return id === null || id === "" ? undefined : { fields: [id], parameters: [] };
}

/**
 * 這個節點在父節點底下的序號。
 *
 * 文字節點不必分辨自己是不是所屬那一塊的第一個——**整塊共用同一個序號**，而那個
 * 序號只由「前面有幾個元素」決定。塊裡的第幾個字元由位移那一格表達，不由序號表達。
 */
function stepIndexOf(parent: Node, node: Node): number {
  let elements = 0;

  for (const child of parent.childNodes) {
    if (isIgnored(child)) continue;

    if (isElement(child)) {
      elements += 1;
      if (child === node) return elements * 2;
      continue;
    }

    if (child === node) return elements * 2 + 1;
  }

  return elements * 2 + 1;
}

/** 兩條路徑從頭數起有幾步相同。 */
function sharedStepCount(
  left: readonly CfiStep[],
  right: readonly CfiStep[],
): number {
  let shared = 0;
  while (
    shared < left.length &&
    shared < right.length &&
    left[shared]!.index === right[shared]!.index
  ) {
    shared += 1;
  }
  return shared;
}

const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;
const NODE_TYPE_CDATA = 4;
const NODE_TYPE_PROCESSING_INSTRUCTION = 7;
const NODE_TYPE_COMMENT = 8;
const NODE_TYPE_DOCUMENT = 9;

function isElement(node: Node): node is Element {
  return node.nodeType === NODE_TYPE_ELEMENT;
}

/** CDATA 在定址上與文字節點同一類（規格 2.2）。 */
function isText(node: Node): boolean {
  return node.nodeType === NODE_TYPE_TEXT || node.nodeType === NODE_TYPE_CDATA;
}

/** 註解與處理指令完全不算，連位置都不佔。 */
function isIgnored(node: Node): boolean {
  return (
    node.nodeType === NODE_TYPE_COMMENT ||
    node.nodeType === NODE_TYPE_PROCESSING_INSTRUCTION
  );
}
