/**
 * Node type tests, in one place.
 *
 * ## Why the numbers are hard-coded rather than using `Node.ELEMENT_NODE`
 *
 * `Renderer`'s code runs in the **outer page's realm**, while the nodes it handles come
 * from the iframe. The two realms each have their own `Node`, and the constants have
 * the same **values**, so comparing against the outer one does in fact work — but only
 * by coincidence, and the same intuition applied to `instanceof` is simply wrong (an
 * element inside the iframe is not an instance of the outer `Element`, and the symptom
 * is that events are never delivered, without any error). Hard-coding removes the need
 * to tell the two apart.
 *
 * ## Why it is a module rather than each file writing its own
 *
 * `cfi-dom.ts`, `text-index.ts` and `section-view.ts` all ask the same set of
 * questions. Written separately, a decision like "does CDATA count as text" would have
 * one answer in each of three places — and CFI's addressing rule says explicitly that
 * it does (spec 2.2), so whichever copy missed it would give the same position
 * different ordinals in different modules.
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
 * The nodes that count as "text" for addressing and traversal.
 *
 * **CDATA counts** (CFI spec 2.2 treats it on a par with text nodes). CDATA is rare in
 * real books, but it is entirely legal in XHTML, and missing it would make that stretch
 * of content vanish from character counting and CFI addressing.
 */
export function isTextLike(node: Node): boolean {
  return node.nodeType === TEXT || node.nodeType === CDATA;
}

/**
 * The nodes that **do not count at all** when addressing — comments and processing
 * instructions.
 *
 * "Do not count" is stronger than "are skipped": they do not even occupy a position, so
 * after a line of comment is added to a document, every existing CFI still points at the
 * same place.
 */
export function isIgnored(node: Node): boolean {
  return node.nodeType === COMMENT || node.nodeType === PROCESSING_INSTRUCTION;
}

export function isDocument(node: Node): boolean {
  return node.nodeType === DOCUMENT;
}
