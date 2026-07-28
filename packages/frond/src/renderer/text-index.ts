/**
 * The text within one content document, flattened into document order.
 *
 * It serves two things: the whole-book index has to count characters
 * (`progress.ts`), and jumping back from a fraction has to recover which node "the Nth
 * character" lives in.
 *
 * ## Both sides have to arrive at the same number
 *
 * The index is built on a document that has **not been rendered** (parsed once with
 * `DOMParser` and thrown away), while positions are computed on the **rendered**
 * document, which frond has modified: two `<style>` elements injected, `<script>`
 * removed. If the two sides walked differently, the same position would yield two
 * different character counts, and the symptom would be the progress bar jumping on a
 * page turn — with nobody able to trace the root cause back to two traversals having
 * different filters.
 *
 * So this is the **one** traversal, called by both sides, with its filter hard-coded:
 * only inside `<body>`, skipping `<script>` and `<style>`. The styles frond injects
 * live in `<head>` and are outside the scope to begin with; hard-coding script/style is
 * what makes "the same number before and after script removal" hold.
 */

import { isElement, isTextLike } from "./node-type.ts";

/** Elements skipped wholesale during traversal. Tag names are compared in lower case — XHTML tag names are lower case to begin with. */
const SKIPPED_ELEMENTS = new Set(["script", "style", "template", "head"]);

/**
 * The text nodes in this document, in document order.
 *
 * Returns an empty array when `body` does not exist (a parse failure or an empty
 * document) — that is not an error;
 * `empty-and-image-only-sections` demonstrates exactly this case.
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
    if (isTextLike(child)) {
      // **Nodes that are entirely whitespace are skipped.** XHTML indentation leaves one
      // of these between every pair of block elements, and they occupy no space in the
      // layout — no rectangle can be measured for them.
      //
      // The consequence of that is far worse than "a few characters over-counted":
      // `section-view.ts` uses a binary search to find "the first character on this
      // page", and a binary search presupposes that node positions increase with
      // document order. A node with no measurable rectangle reports position 0, which
      // breaks that premise, and the search then lands anywhere — the symptom being that
      // the position reported after a page turn occasionally jumps to the start of the
      // section.
      //
      // It is also right for progress: indentation between blocks is not content the
      // reader read.
      if ((child.nodeValue ?? "").trim() === "") continue;

      into.push(child as Text);
      continue;
    }
    if (!isElement(child)) continue;
    if (SKIPPED_ELEMENTS.has(child.localName.toLowerCase())) continue;

    collect(child, into);
  }
}

/** How many characters this document has. */
export function countCharacters(document: Document): number {
  let total = 0;
  for (const node of textNodesIn(document)) total += node.length;
  return total;
}

/**
 * How many characters precede some position.
 *
 * Returns 0 when the position is outside this document's traversal scope (for instance
 * inside `<head>` or inside a skipped element) — for progress purposes that position
 * equals the start of the document, and that is the only answer that does not lie.
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
 * Where character `target` falls.
 *
 * Stops at the last position when past the total length. A document with not a single
 * character returns `undefined` — the caller falls back to the start of the section on
 * that basis, rather than building a `Range` around a made-up node.
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
