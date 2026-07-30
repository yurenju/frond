/**
 * The round trip between a CFI and a DOM position — the other half that the `cfi.ts`
 * grammar layer explicitly ruled out.
 *
 * > **Mapping between a CFI and a DOM position is not here.** That needs an actually
 * > rendered document — walking a CFI into a `Range`, or writing a reader's selection out
 * > as a CFI, both mean counting nodes, handling filtered-out nodes, and merging adjacent
 * > text nodes. Those belong to `Renderer` (`src/epub/cfi.ts`).
 *
 * This is the place that passage points at. The grammar layer handles the round trip
 * between string and structure, this handles the round trip between structure and nodes,
 * and neither layer knows what the other is doing.
 *
 * ## The addressing rule (spec 2.2)
 *
 * The children under one parent are numbered like this:
 *
 * - **Elements take even numbers**: the kth element child (counting from 1) has ordinal
 *   `2k`
 * - **Text takes odd numbers**: adjacent text nodes are **merged into one chunk**, and the
 *   chunk after the kth element has ordinal `2k + 1`; the chunk before the first element
 *   is `1`
 * - **Comments and processing instructions do not count at all**, not even occupying a
 *   position
 *
 * "Adjacent text nodes are merged into one chunk" is the easiest one to miss, and the
 * symptom of missing it is particularly hard to trace: the same position yields two
 * different CFIs depending on whether the document has been through `Node.normalize()`,
 * and both of them point at something. Real books, after XML parsing, frequently leave
 * adjacent text nodes where entity references (`&amp;`) were, so this is not a
 * theoretical edge case.
 *
 * ## Where counting starts after a `!`
 *
 * The first step after an indirection is counted relative to the **content document's
 * root element** (`<html>`), not relative to the document node. So `<body>`'s first step
 * is `/4` (`<head>` being `/2`). This agrees with the `epubcfi(/6/2!/4,…)` measured from
 * foliate in the #7 spike.
 */

import type { Cfi, CfiOffset, CfiPath, CfiSegment, CfiStep } from "../epub/cfi.ts";
import { isDocument, isElement, isIgnored, isTextLike } from "./node-type.ts";

/**
 * The ordinal of `<spine>` within the package document.
 *
 * EPUB's `<package>` content model specifies the order metadata, manifest, spine, so the
 * spine is invariably the third element child, with ordinal `2 × 3 = 6`. **This is not an
 * assumption about how lenient to be with books** — it is the spec's content model, and a
 * book writing them in the wrong order does not even open at the `EpubBook` layer.
 */
const SPINE_STEP_INDEX = 6;

/** This section's segment of the path within the package document: `/6/N`. */
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
 * Which readingOrder item a CFI points at.
 *
 * Returns `undefined` when it cannot be recognised — for instance when the path is too
 * short to have an itemref step, or the first step is not `/6`. Such a CFI may have been
 * written by a different reader, or the book may have a new edition, and neither should
 * let a jump land silently in the first section.
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
 * Writes a `Range` out as a CFI.
 *
 * When start and end coincide this gives a **point** rather than a zero-length range:
 * those are different notations in the spec, and reading progress stores a point while an
 * annotation stores a range, so conflating them would leave a consumer unable to tell
 * which one it is holding.
 */
export function cfiForRange(range: Range, sectionIndex: number): Cfi {
  const start = localPath(...normaliseBoundary(range.startContainer, range.startOffset, "start"));
  const end = localPath(...normaliseBoundary(range.endContainer, range.endOffset, "end"));

  if (range.collapsed) {
    return { kind: "point", path: [spineSegment(sectionIndex), start] };
  }

  // The shared prefix is lifted out and the two remaining pieces are appended to it — the
  // spec's `parent,start,end` shape.
  //
  // **The prefix has to be a proper prefix**: when start and end walk the same path (the
  // selection falls within a single text node, or `selectNodeContents` gives two
  // boundaries pointing at the same node), lifting all of it out would make both pieces
  // empty strings, serializing as `epubcfi(/6/2!/4/4/1,,)` — a string that will not even
  // parse back. Leaving one step outside makes that step the content of each of the two
  // pieces.
  const shared = Math.min(
    sharedStepCount(start.steps, end.steps),
    Math.max(0, Math.min(start.steps.length, end.steps.length) - 1),
  );

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
 * Walks a CFI into a `Range` within this document.
 *
 * Returns `undefined` when it cannot be walked. Failing to walk is the norm rather than
 * the exception — a new edition of the book, a CFI from a different reader, or simply a
 * different section, all three arrive here, and the response to them is "jump to the start
 * of this section" rather than throwing an exception that interrupts the whole reading
 * flow.
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
 * Takes the part of the path that falls in the **content document**.
 *
 * A complete CFI is "the package document part `!` the content document part", so the
 * content document part is the last segment. A single-segment CFI (`/6/4`, pointing at a
 * whole Section) has no content document part and returns `undefined` — that is not a
 * broken CFI, it is a valid position referring to the whole section, and the caller decides
 * that it means the start of that section.
 */
function contentSegmentOf(path: CfiPath): CfiSegment | undefined {
  return path.length >= 2 ? path[path.length - 1] : undefined;
}

/** Appends a range's start (or end) to the shared prefix, giving one complete segment within the content document. */
function joinSegments(parent: CfiSegment, local: CfiPath): CfiSegment | undefined {
  const first = local[0];
  if (first === undefined) return undefined;
  // A range's start and end never cross into another document — such a CFI is the
  // `incomparable` shape already at the grammar layer.
  if (local.length > 1) return undefined;

  return { steps: [...parent.steps, ...first.steps], offset: first.offset };
}

interface DomPosition {
  readonly node: Node;
  readonly offset: number;
}

/** Walks each step in turn from the root element. */
function resolve(root: Element, segment: CfiSegment): DomPosition | undefined {
  let current: Node = root;

  for (let index = 0; index < segment.steps.length; index += 1) {
    const next = childAt(current, segment.steps[index]!.index);
    if (next === undefined) return undefined;

    // A text chunk can only ever be the last step — it has no children to walk into.
    // Reaching here means this CFI does not match this document, so returning undefined
    // lets the caller fall back to the start of the section.
    if (next.kind === "text" && index !== segment.steps.length - 1) return undefined;

    current = next.node;
  }

  if (segment.offset === undefined) {
    // No character offset: this refers to the node itself. Expressed as "the parent plus
    // its position within the parent", so the Range falls before the node rather than
    // inside its content.
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
 * The child with ordinal `index` under a parent.
 *
 * Even numbers find an element, odd numbers find the first node of **that whole chunk** of
 * adjacent text — the offset computation that follows needs to count from the start of the
 * chunk.
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

    if (isTextLike(child) && chunkStart === undefined) chunkStart = child;
  }

  return chunkStart !== undefined && elements === after
    ? { node: chunkStart, kind: "text" }
    : undefined;
}

/**
 * Which node, and which position within it, the Nth character of a chunk of adjacent text
 * falls at.
 *
 * The offset is an offset into the **whole chunk**, so it has to be counted across nodes.
 * Past the chunk's length it stops at the end of the chunk rather than returning
 * `undefined`: a new edition of the book shortening that stretch is a common thing, and
 * stopping at the nearest position beats jumping back to the start of the section.
 */
function offsetWithin(chunkStart: Node, offset: CfiOffset): DomPosition {
  let remaining = offset.characters;
  let node: Node = chunkStart;

  for (;;) {
    const length = node.nodeValue?.length ?? 0;
    if (remaining <= length) return { node, offset: remaining };

    const next = node.nextSibling;
    if (next === null || !isTextLike(next)) return { node, offset: length };

    remaining -= length;
    node = next;
  }
}

/** A node's position within its parent's `childNodes` — the kind of index a `Range` uses. */
function indexInParent(parent: Node, node: Node): number {
  let index = 0;
  for (const child of parent.childNodes) {
    if (child === node) return index;
    index += 1;
  }
  return index;
}

/**
 * Converts a boundary that falls on an **element** into one that falls on text.
 *
 * A `Range`'s boundary may point at "before the nth child of some element", whereas CFI
 * addresses nodes and characters within nodes, with no notation for "the gap between
 * children". The most common source is `selectNodeContents(p)` — both of its boundaries
 * fall on the `<p>`, the start at child 0 and the end at the child count.
 *
 * The direction of the conversion differs depending on whether the boundary is the start or
 * the end, and that is precisely why one implementation will not do:
 *
 * - **The start** walks inward to character 0 of the first text node
 * - **The end** walks back to the end of the last text node inside the previous child
 *
 * With both walking the same direction, selecting a whole paragraph would give a CFI whose
 * start and end coincide — looking as though the reader had selected only a point.
 *
 * When the element contains no text node at all (a paragraph holding only an image) it is
 * returned verbatim, and `localPath` addresses the node itself.
 */
function normaliseBoundary(
  container: Node,
  offset: number,
  side: "start" | "end",
): [Node, number] {
  if (isTextLike(container) || !isElement(container)) return [container, offset];

  const children = [...container.childNodes];
  if (children.length === 0) return [container, offset];

  if (side === "start") {
    const from = children[Math.min(offset, children.length - 1)];
    const text = from === undefined ? undefined : firstTextIn(from);
    return text === undefined ? [container, offset] : [text, 0];
  }

  const from = children[Math.max(0, offset - 1)];
  const text = from === undefined ? undefined : lastTextIn(from);
  return text === undefined ? [container, offset] : [text, text.nodeValue?.length ?? 0];
}

function firstTextIn(node: Node): Node | undefined {
  if (isTextLike(node)) return node;
  for (const child of node.childNodes) {
    const found = firstTextIn(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function lastTextIn(node: Node): Node | undefined {
  if (isTextLike(node)) return node;
  const children = [...node.childNodes];
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const found = lastTextIn(children[index]!);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** This node's segment of the path under its parent (excluding the parent and above). */
function localPath(container: Node, offset: number): CfiSegment {
  if (isTextLike(container)) {
    const { chunkStart, charactersBefore } = chunkOf(container);
    return {
      steps: stepsTo(chunkStart),
      offset: { characters: charactersBefore + offset, assertion: undefined },
    };
  }

  // When the container is an element, `offset` is a child index rather than a character
  // position.
  //
  // A boundary falling between children (which is what a reader selecting one step back
  // from the start of a paragraph produces) has no direct notation in CFI — CFI addresses
  // nodes, not the gaps between them. This takes the child **after** that position, that
  // is, the nearest actual node; with no children it falls back to the element itself.
  const child = container.childNodes[Math.min(offset, container.childNodes.length - 1)];
  const target = child ?? container;

  return { steps: stepsTo(target), offset: undefined };
}

interface Chunk {
  readonly chunkStart: Node;
  readonly charactersBefore: number;
}

/** Which chunk this text node belongs to, and which character of the chunk it starts at. */
function chunkOf(node: Node): Chunk {
  let chunkStart = node;
  let charactersBefore = 0;

  for (;;) {
    const previous = chunkStart.previousSibling;
    if (previous === null || !isTextLike(previous)) break;
    chunkStart = previous;
    charactersBefore += previous.nodeValue?.length ?? 0;
  }

  return { chunkStart, charactersBefore };
}

/**
 * Every step from the content document's root element down to this node.
 *
 * The root element itself is not a step — the first step after a `!` is a child of the root
 * element (see the file header).
 */
function stepsTo(node: Node): readonly CfiStep[] {
  const steps: CfiStep[] = [];
  let current: Node | null = node;

  while (current !== null) {
    const parent: Node | null = current.parentNode;
    if (parent === null || isDocument(parent)) break;

    steps.unshift({ index: stepIndexOf(parent, current), assertion: assertionFor(current) });
    current = parent;
  }

  return steps;
}

/**
 * An element's id is written into the assertion.
 *
 * The spec says the index is authoritative and the assertion is redundancy for recovering a
 * position after the book is revised, so `compareCfi()` does not look at it and
 * `rangeForCfi()` does not use it. It is written out because **other readers do use it**,
 * and a CFI carrying an id can be recovered after the book changes edition.
 */
function assertionFor(node: Node): { readonly fields: readonly string[]; readonly parameters: readonly [] } | undefined {
  if (!isElement(node)) return undefined;
  const id = node.getAttribute("id");
  return id === null || id === "" ? undefined : { fields: [id], parameters: [] };
}

/**
 * This node's ordinal under its parent.
 *
 * A text node does not have to work out whether it is the first of its chunk — **the whole
 * chunk shares one ordinal**, and that ordinal is determined solely by how many elements
 * precede it. Which character within the chunk is expressed by the offset, not by the
 * ordinal.
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

/** How many steps two paths share, counting from the start. */
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
