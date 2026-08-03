/**
 * The text within one content document, flattened into document order.
 *
 * It serves three things: the whole-book index has to count characters (`progress.ts`),
 * jumping back from a fraction has to recover which node "the Nth character" lives in, and a
 * consumer with no browser has to be able to read a section as text and point back into it
 * (`content-document.ts`).
 *
 * ## Both sides have to arrive at the same number
 *
 * In the browser the index is built on a document that has **not been rendered** (parsed
 * once with `DOMParser` and thrown away), while positions are computed on the **rendered**
 * document, which frond has modified: two `<style>` elements injected, `<script>` removed.
 * If the two sides walked differently, the same position would yield two different character
 * counts, and the symptom would be the reported position jumping on a page turn — with
 * nobody able to trace the root cause back to two traversals having different filters.
 *
 * Since this walk moved down to the tree layer there is a **third** side: a Worker holding
 * the same section as bytes. It is the same argument one step further out, and with a worse
 * failure mode — a note anchored a paragraph away from where the reader put it, in a process
 * that has nothing to compare against.
 *
 * So this is the **one** traversal, called by all of them, with its filter hard-coded: only
 * inside `<body>`, skipping `<script>` and `<style>`. The styles frond injects live in
 * `<head>` and are outside the scope to begin with; hard-coding script/style is what makes
 * "the same number before and after script removal" hold.
 */

import { isElement, isTextLike, type TreeNode } from "./tree.ts";

/** Elements skipped wholesale during traversal. Tag names are compared in lower case — XHTML tag names are lower case to begin with. */
const SKIPPED_ELEMENTS = new Set(["script", "style", "template", "head"]);

/**
 * The `<body>` of a content document.
 *
 * Returns `undefined` when there is none, which is not an error: a parse failure or an empty
 * document both land here, and `empty-and-image-only-sections` demonstrates exactly that.
 *
 * The search only descends through elements, and only to the depth XHTML puts a body at.
 * Going deeper would find a `<body>` nested somewhere inside the content — legal in neither
 * XHTML nor sense, but a broken book can contain anything, and picking one up would silently
 * change what the whole document's text is.
 */
export function bodyOf(root: TreeNode): TreeNode | undefined {
  for (const child of root.childNodes) {
    if (!isElement(child)) continue;
    if ((child.localName ?? "").toLowerCase() === "body") return child;
  }
  return undefined;
}

/** The text nodes under this body, in document order. */
export function textNodesUnder(body: TreeNode): readonly TreeNode[] {
  const nodes: TreeNode[] = [];
  collect(body, nodes);
  return nodes;
}

function collect(element: TreeNode, into: TreeNode[]): void {
  for (const child of element.childNodes) {
    if (isTextLike(child)) {
      // **Nodes that are entirely whitespace are skipped.** XHTML indentation leaves one of
      // these between every pair of block elements, and they occupy no space in the layout —
      // no rectangle can be measured for them.
      //
      // The consequence of that is far worse than "a few characters over-counted":
      // `section-view.ts` uses a binary search to find "the first character on this page",
      // and a binary search presupposes that node positions increase with document order. A
      // node with no measurable rectangle reports position 0, which breaks that premise, and
      // the search then lands anywhere — the symptom being that the position reported after
      // a page turn occasionally jumps to the start of the section.
      //
      // It is also right for progress: indentation between blocks is not content the reader
      // read.
      if ((child.nodeValue ?? "").trim() === "") continue;

      into.push(child);
      continue;
    }
    if (!isElement(child)) continue;
    if (SKIPPED_ELEMENTS.has((child.localName ?? "").toLowerCase())) continue;

    collect(child, into);
  }
}

function lengthOf(node: TreeNode): number {
  return node.nodeValue?.length ?? 0;
}

/** How many characters these nodes hold between them. */
export function countCharactersIn(nodes: readonly TreeNode[]): number {
  let total = 0;
  for (const node of nodes) total += lengthOf(node);
  return total;
}

/**
 * How many characters precede some position, or `undefined` when the position is **outside
 * this traversal** — inside `<head>`, inside a skipped element, or on a node holding no text
 * at all such as an `<img>`.
 *
 * The two callers want opposite things from that case, which is why it is a distinct answer
 * here rather than a number chosen for one of them:
 *
 * - **Progress** wants a number, and 0 is the only one that does not lie: a position outside
 *   the read text is, for progress purposes, the start of the document. That is
 *   `charactersBeforeIn`.
 * - **Turning a CFI back into text** must not get 0, because 0 is also the perfectly ordinary
 *   answer for the first character. A consumer would quote the opening of the section with
 *   nothing to distinguish it from a real answer.
 */
export function charactersAt(
  nodes: readonly TreeNode[],
  node: TreeNode,
  offset: number,
): number | undefined {
  let total = 0;

  for (const candidate of nodes) {
    if (candidate === node) return total + Math.min(offset, lengthOf(candidate));
    total += lengthOf(candidate);
  }

  return undefined;
}

/** How many characters precede some position, counting a position outside the traversal as the start. */
export function charactersBeforeIn(
  nodes: readonly TreeNode[],
  node: TreeNode,
  offset: number,
): number {
  return charactersAt(nodes, node, offset) ?? 0;
}

/**
 * Where character `target` falls.
 *
 * Stops at the last position when past the total length. A document with not a single
 * character returns `undefined` — the caller falls back to the start of the section on that
 * basis, rather than building a position around a made-up node.
 */
export function positionAtCharacterIn(
  nodes: readonly TreeNode[],
  target: number,
): { readonly node: TreeNode; readonly offset: number } | undefined {
  if (nodes.length === 0) return undefined;

  let remaining = Math.max(0, target);

  for (const node of nodes) {
    if (remaining < lengthOf(node)) return { node, offset: remaining };
    remaining -= lengthOf(node);
  }

  const last = nodes[nodes.length - 1]!;
  return { node: last, offset: lengthOf(last) };
}
