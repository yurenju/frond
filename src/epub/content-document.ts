/**
 * One section of a book, read as text and pointed back into — **without a browser**.
 *
 * This is what the tree layer is for. A consumer holding a book's bytes and nothing else can
 * now answer both directions of the question a reading position asks:
 *
 * - *what is the reader looking at* — a stored CFI comes in, a stretch of this section's text
 *   comes out
 * - *where is this passage* — a stretch of text goes in, a CFI comes out, and it addresses
 *   the same place the browser would have written
 *
 * The second direction is the one that was impossible before, and it is the one that matters
 * for writing anything back: a note has to be anchored, and an anchor is a CFI.
 *
 * ## Character offsets, not node offsets
 *
 * The unit on this interface is "the Nth character of this section's text", counted by the
 * same traversal the whole-book index uses (`text-nodes.ts`). That is deliberate: node
 * offsets are a property of one parser's tree, and this whole module exists because two
 * parsers produce trees that differ in small ways. Character offsets into the flattened text
 * are the thing both of them agree on, and they are also what a consumer can actually work
 * with — searching for a passage is `indexOf`, not a tree walk.
 *
 * ## What it does not do
 *
 * It does not paginate, measure, or lay anything out. A **page** is a product of layout, and
 * layout needs a browser (CONTEXT.md); nothing here can say which characters share a screen.
 * A consumer that needs that has to be told by whatever is rendering.
 */

import type { Cfi } from "./cfi.ts";
import { cfiForPositions, positionsForCfi, sectionIndexOf } from "./cfi-tree.ts";
import {
  bodyOf,
  charactersBeforeIn,
  lengthOf,
  positionAtCharacterIn,
  textNodesUnder,
} from "./text-nodes.ts";
import type { TreeNode } from "./tree.ts";
import { parseContentTree } from "./xml.ts";

/** A stretch of a section's text, as character offsets into `ContentDocument.text`. */
export interface TextRange {
  readonly start: number;
  /** Exclusive, so `text.slice(start, end)` is the passage. */
  readonly end: number;
}

export class ContentDocument {
  /** Which readingOrder item this is — every CFI written here begins with it. */
  readonly sectionIndex: number;
  /** This section's text, in document order, with the whole-book index's filter applied. */
  readonly text: string;

  private readonly root: TreeNode;
  private readonly nodes: readonly TreeNode[];

  private constructor(sectionIndex: number, root: TreeNode, nodes: readonly TreeNode[]) {
    this.sectionIndex = sectionIndex;
    this.root = root;
    this.nodes = nodes;
    this.text = nodes.map((node) => node.nodeValue ?? "").join("");
  }

  /**
   * Reads one content document.
   *
   * **Throws** `EpubOpenError` with reason `malformed-content-document` when the XHTML will
   * not parse, carrying the same detail (and line number) the packaging documents get. It
   * throws rather than returning `undefined` so that "this section is broken" and "this
   * section has nothing to read" stay distinguishable — a consumer catching it says *this
   * section cannot be read*, which is also what a browser does with the same bytes, and it
   * does not affect the rest of the book.
   *
   * A section with no `<body>`, or a body holding no text, parses successfully and has empty
   * `text`. An image-only section is a real and ordinary thing, not a failure.
   */
  static parse(xhtml: string, sectionIndex: number): ContentDocument {
    const root = parseContentTree(xhtml, {
      reason: "malformed-content-document",
      label: `the content document of section ${sectionIndex}`,
    });

    const body = bodyOf(root);
    const nodes = body === undefined ? [] : textNodesUnder(body);
    return new ContentDocument(sectionIndex, root, nodes);
  }

  /**
   * The CFI addressing characters `[start, end)` of `text`.
   *
   * With `end` omitted, or equal to `start`, this gives a **point** rather than a
   * zero-length range — the spec spells them differently, and a reading position is a point
   * while an annotation is a range.
   *
   * Offsets past the end of the text stop at the end rather than failing: a passage found in
   * one edition of a book and looked up in another is the ordinary case, and landing at the
   * nearest position beats refusing.
   *
   * Returns `undefined` only when this section has no text at all, because then there is no
   * position for a character offset to mean.
   */
  cfiForCharacters(start: number, end?: number): Cfi | undefined {
    const from = positionAtCharacterIn(this.nodes, start);
    if (from === undefined) return undefined;

    const to = end === undefined ? from : positionAtCharacterIn(this.nodes, end);
    if (to === undefined) return undefined;

    const collapsed = end === undefined || end <= start;
    return cfiForPositions(from, to, collapsed, this.sectionIndex);
  }

  /**
   * Which characters of `text` a CFI addresses.
   *
   * A point CFI gives a range whose `start` and `end` are equal — the caller keeps whatever
   * distinction it needs; this answers "where", not "what kind".
   *
   * Returns `undefined` when the CFI belongs to **another section**, or when it will not walk
   * this document. The first check is not defensiveness: without it a CFI written for section
   * 3 resolves happily against section 5's tree and points confidently at the wrong words.
   */
  charactersForCfi(cfi: Cfi): TextRange | undefined {
    if (sectionIndexOf(cfi) !== this.sectionIndex) return undefined;

    const positions = positionsForCfi(this.root, cfi);
    if (positions === undefined) return undefined;

    return {
      start: charactersBeforeIn(this.nodes, positions.start.node, positions.start.offset),
      end: charactersBeforeIn(this.nodes, positions.end.node, positions.end.offset),
    };
  }

  /** How many characters this section holds. */
  get characters(): number {
    let total = 0;
    for (const node of this.nodes) total += lengthOf(node);
    return total;
  }
}
