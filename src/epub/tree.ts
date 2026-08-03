/**
 * The shape a tree needs for a position inside it to be addressable, plus the node type
 * tests that go with it.
 *
 * ## Why the addressing does not take `Node`
 *
 * CFI addressing counts children under a parent (spec 2.2). That is a rule about **trees**:
 * nothing in it needs layout, styles, or a browser. Written against `Node` it was
 * nevertheless locked inside `Renderer`, and with it every consumer holding a book but no
 * browser was locked out — a Worker turning a reader's stored position back into text, a
 * CLI, a batch job. `EpubBook` has run in Node since the beginning (ADR-0005); **locating
 * within a book did not**.
 *
 * So addressing walks this interface. A DOM `Node` satisfies it as it stands — no adapter
 * and no wrapper — and so does the tree `xml.ts` parses (`contentTree`). The traversal is
 * therefore **one implementation running on two trees**, not two implementations obliged to
 * agree.
 *
 * That distinction is the whole point. `text-index.ts`'s header records what the second
 * arrangement costs: two walks give the same position two different numbers, and the symptom
 * (the reported position jumping on a page turn) surfaces a long way from the cause. Two
 * walks that additionally sit in different processes would be worse still — a note anchored
 * one paragraph off, with nothing to compare against.
 *
 * ## Why the node type numbers are hard-coded rather than using `Node.ELEMENT_NODE`
 *
 * `Renderer`'s code runs in the **outer page's realm**, while the nodes it handles come from
 * the iframe. The two realms each have their own `Node`, and the constants have the same
 * **values**, so comparing against the outer one does in fact work — but only by
 * coincidence, and the same intuition applied to `instanceof` is simply wrong (an element
 * inside the iframe is not an instance of the outer `Element`, and the symptom is that
 * events are never delivered, without any error).
 *
 * Hard-coding removed the need to tell the two realms apart. It is also what makes this
 * interface possible at all: a tree that is not a DOM has no `Node` constructor to compare
 * against, and these numbers are the only vocabulary the two trees already share.
 *
 * ## Why the tests are a module rather than each file writing its own
 *
 * `cfi-tree.ts`, `text-index.ts` and `section-view.ts` all ask the same set of questions.
 * Written separately, a decision like "does CDATA count as text" would have one answer in
 * each of three places — and CFI's addressing rule says explicitly that it does (spec 2.2),
 * so whichever copy missed it would give the same position different ordinals in different
 * modules.
 */

/**
 * A node in a tree a CFI can address.
 *
 * The member names are the DOM's, so that a DOM `Node` is structurally one of these
 * already. That is not deference to the DOM: it is what keeps the addressing code free of
 * an adapter layer, and an adapter is exactly the place where "the same walk" quietly
 * becomes two.
 *
 * `localName` and `getAttribute` are optional because only elements have them — `Node`
 * itself declares neither, and requiring them would stop a DOM tree from satisfying this at
 * all.
 */
export interface TreeNode {
  readonly nodeType: number;
  /** The text of a text-like node. `null` on everything else. */
  readonly nodeValue: string | null;
  readonly childNodes: ArrayLike<TreeNode> & Iterable<TreeNode>;
  readonly parentNode: TreeNode | null;
  readonly previousSibling: TreeNode | null;
  readonly nextSibling: TreeNode | null;
  /** An element's tag name without its namespace prefix. */
  readonly localName?: string;
  getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const PROCESSING_INSTRUCTION = 7;
const COMMENT = 8;
const DOCUMENT = 9;

export function isElement(node: TreeNode): boolean {
  return node.nodeType === ELEMENT;
}

/**
 * The nodes that count as "text" for addressing and traversal.
 *
 * **CDATA counts** (CFI spec 2.2 treats it on a par with text nodes). CDATA is rare in real
 * books, but it is entirely legal in XHTML, and missing it would make that stretch of
 * content vanish from character counting and CFI addressing.
 */
export function isTextLike(node: TreeNode): boolean {
  return node.nodeType === TEXT || node.nodeType === CDATA;
}

/**
 * The nodes that **do not count at all** when addressing — comments and processing
 * instructions.
 *
 * "Do not count" is stronger than "are skipped": they do not even occupy a position, so
 * after a line of comment is added to a document, every existing CFI still points at the
 * same place.
 *
 * The consequence that is easy to miss is that they do not break up a run of text either.
 * `<p>a<!--c-->b</p>` addresses exactly as `<p>ab</p>` does — one chunk, one ordinal,
 * offsets running straight through. A walk that stopped at the comment would number the two
 * halves as two chunks that both claim the same ordinal, and only one of them would be
 * reachable.
 */
export function isIgnored(node: TreeNode): boolean {
  return node.nodeType === COMMENT || node.nodeType === PROCESSING_INSTRUCTION;
}

export function isDocument(node: TreeNode): boolean {
  return node.nodeType === DOCUMENT;
}

/** The node type numbers, for a tree that is built rather than parsed by a browser. */
export const NODE_TYPE = {
  element: ELEMENT,
  text: TEXT,
  cdata: CDATA,
  comment: COMMENT,
  processingInstruction: PROCESSING_INSTRUCTION,
  document: DOCUMENT,
} as const;
