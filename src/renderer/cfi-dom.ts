/**
 * The adapter between a `Range` and the tree positions `src/epub/cfi-tree.ts` addresses.
 *
 * Everything about **counting** — which ordinal a node has, where a chunk of text begins,
 * how a CFI's steps walk down — moved to the tree layer, because none of it needs a browser
 * (see that file's header, and `src/epub/tree.ts`). What genuinely needs one is what remains
 * here: a `Range` is a DOM object, `createRange` comes off a `Document`, and a selection
 * arrives as one.
 *
 * Keeping this file as the only place that names `Range` is what stops the split from being
 * two implementations: there is one walk, and this is the shim that hands it a DOM and takes
 * DOM back.
 */

import type { Cfi } from "../epub/cfi.ts";
import { cfiForPositions, positionsForCfi, type TreePosition } from "../epub/cfi-tree.ts";

export { sectionIndexOf, spineSegment } from "../epub/cfi-tree.ts";

/**
 * Writes a `Range` out as a CFI.
 *
 * A collapsed range gives a **point** rather than a zero-length range: those are different
 * notations in the spec, and reading progress stores a point while an annotation stores a
 * range.
 */
export function cfiForRange(range: Range, sectionIndex: number): Cfi {
  return cfiForPositions(
    { node: range.startContainer, offset: range.startOffset },
    { node: range.endContainer, offset: range.endOffset },
    range.collapsed,
    sectionIndex,
  );
}

/**
 * Walks a CFI into a `Range` within this document.
 *
 * Returns `undefined` when it cannot be walked — a new edition of the book, a CFI from a
 * different reader, or simply a different section all arrive here, and the response is "jump
 * to the start of this section" rather than an exception interrupting the reading flow.
 */
export function rangeForCfi(document: Document, cfi: Cfi): Range | undefined {
  const positions = positionsForCfi(document.documentElement, cfi);
  if (positions === undefined) return undefined;

  const range = document.createRange();
  range.setStart(domNode(positions.start), positions.start.offset);

  if (cfi.kind === "point") {
    range.collapse(true);
    return range;
  }

  range.setEnd(domNode(positions.end), positions.end.offset);
  return range;
}

/**
 * The tree walked above is this document's own, so every node coming back out of it is one of
 * its `Node`s — the same object that went in.
 *
 * The cast is needed because `TreeNode` is a structural subset of `Node` rather than a
 * supertype TypeScript was told about: assignability runs `Node` → `TreeNode`, and this is
 * the way back.
 */
function domNode(position: TreePosition): Node {
  return position.node as Node;
}
