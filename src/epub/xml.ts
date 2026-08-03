import { EpubOpenError, type EpubOpenFailure } from "./errors.ts";
import { NODE_TYPE, type TreeNode } from "./tree.ts";

/**
 * The small amount of XML the EPUB packaging format requires.
 *
 * **No `DOMParser`**: `EpubBook` has zero DOM dependency (ADR-0005), and that is
 * exactly why it can run in Node and be tested at the base of the test pyramid.
 *
 * **No XML library either**: frond ships with zero runtime dependencies. This module
 * replaces `fast-xml-parser`, and the reason it is barely longer than the adapter
 * layer it replaced is that the old layer was almost entirely translating the
 * parser's representation (`:@`, `#text`, the `@_` prefix) back into the three
 * questions wanted here: child elements, attributes, text. Parsing it ourselves makes
 * that whole translation disappear.
 *
 * The dialect to be read is narrow — narrow enough to enumerate: tags, attributes,
 * text, CDATA, comments, processing instructions, skipping DOCTYPE, the five
 * predefined entities and numeric character references. The 1767 XML documents in the
 * sample use nothing beyond that.
 *
 * ## Well-formedness and parsing are one pass
 *
 * The old implementation had to call `XMLValidator` once and then `XMLParser` again,
 * because that parser is very forgiving of malformed input (one missing end tag
 * silently swallows an entire subtree). Writing it ourselves removes that crack — the
 * place that is malformed is the place parsing stops, and a broken book always gets
 * "this book is broken" rather than "that field would not read". That silent failure
 * is the whole reason this layer exists.
 *
 * ## Namespace prefixes are always stripped
 *
 * The `dc` in `dc:title` is just a prefix this document chose for itself, and the XML
 * spec allows a book to write any string (the binding is what carries the meaning).
 * An implementation matching prefixes literally would fail to read the title of a
 * book that declares it as `d:`, and that book is entirely conforming. With prefixes
 * stripped, `dc:title`, `opf:role` and `xml:lang` become `title`, `role` and `lang`.
 * `xmlns` and `xmlns:*` themselves are discarded entirely — they declare bindings,
 * not what this document is talking about.
 *
 * ## Document order has to be preserved
 *
 * The order of mixed content must not be lost: `<a>前<span>言</span>後</a>` has to
 * read back as `前言後`. That is not fastidiousness, it is measured: across the local
 * set of books, 73 of the navigation documents' 1527 TOC links have **titles carrying
 * inline tags** (5 books), and in one of them (《我的公寓》) **all 39 TOC entries have
 * their text wrapped in a `<span>`** — an implementation reading only the node's own
 * level of text would give that book an empty string for every TOC title. Another
 * book's second level is `<span><small>輯一</small>・儲藏室</span>`, and losing the
 * order turns that title into `・儲藏室輯一`. Both are silent errors: the TOC length
 * is right, the hrefs are right, only the words are broken.
 */

export interface XmlElement {
  /** The first child element with this name. */
  child(name: string): XmlElement | undefined;
  /** Every child element with this name, in document order. */
  children(name: string): readonly XmlElement[];
  /**
   * Every element with this name **anywhere below** this one, in document order,
   * however deeply wrapped.
   *
   * This exists alongside `children` rather than replacing it, and the caller has to
   * choose: "a direct child" and "somewhere underneath" are different questions, and
   * answering the first with the second is how a search picks up something that merely
   * happens to share a tag name. `toc.ts` uses both, and says there which question each
   * of its two steps is asking.
   */
  descendants(name: string): readonly XmlElement[];
  attribute(name: string): string | undefined;
  /**
   * **All** the text under the element, joined in document order, trimmed at both
   * ends. An empty string when there is no text.
   *
   * "All" is deliberate: taking only the node's own level would make a TOC entry like
   * `<a><span>序</span></a>` read as an empty string — and that is a measured shape,
   * see the file header. Offering only this one method is deliberate too; one more
   * "own level only" method is one more option that silently reads empty on real
   * books.
   *
   * **Interior whitespace is kept verbatim; only the ends are trimmed.** Both halves
   * are necessary: without trimming the ends, a neatly formatted
   * `<dc:title>\n  Title\n</dc:title>` reads back as a title with newlines in it;
   * and trimming each text run separately before joining (`fast-xml-parser`'s
   * default) turns `Chapter <em>One</em> Revised` into `ChapterOneRevised` — that is
   * deleting meaningful inter-word spaces.
   */
  text(): string;
}

export interface XmlParseFailure {
  /** Which kind of open error to throw when parsing fails. */
  readonly reason: EpubOpenFailure;
  /** The file path that appears in the error message. */
  readonly label: string;
}

export function parseXml(source: string, failure: XmlParseFailure): XmlElement {
  return element(new Reader(source, failure).document());
}

/**
 * The same parse, seen as a **tree of nodes in document order** rather than as the query
 * interface above, and returning the root element.
 *
 * `XmlElement` answers "which child elements have this name" — enough for the packaging
 * documents, which is all this module was written for. Addressing a position inside a
 * content document asks a different question: "what is the third node under this parent",
 * text nodes included and in order. That is what CFI counts (`cfi-tree.ts`), and it cannot
 * be reconstructed from the query interface.
 *
 * The shape is the DOM's, so the addressing walk runs here unmodified — see
 * `tree.ts`. Two consequences of this parser are worth naming, because both are places
 * where a browser's tree looks different and the addressing rule absorbs it:
 *
 * - **Comments and processing instructions are not in the tree at all.** A browser keeps
 *   them; CFI does not count them, and does not let them break a run of text in two, so both
 *   trees address identically.
 * - **A run of text is one node even where it contains entity references.** A browser's XML
 *   parser often leaves several adjacent text nodes there. Adjacent text merges into a
 *   single chunk before anything is numbered, so again both trees agree.
 */
export function parseContentTree(source: string, failure: XmlParseFailure): TreeNode {
  const document = new Reader(source, failure).document();
  // `document()` fails rather than returning when there is no root element, so the wrapper
  // it returns always has exactly one element child.
  const root = document.children.find((child): child is Node => typeof child !== "string")!;
  return buildElement(root);
}

/**
 * A node of the tree above.
 *
 * The links are assigned during construction rather than being computed on demand: the
 * addressing walk asks for `previousSibling` from inside a loop, and recomputing a position
 * within the parent each time would turn walking one chunk of text into quadratic work on a
 * document that is entirely text.
 */
class XmlTreeNode implements TreeNode {
  readonly nodeType: number;
  readonly nodeValue: string | null;
  readonly localName: string | undefined;
  readonly childNodes: XmlTreeNode[] = [];
  parentNode: TreeNode | null = null;
  previousSibling: TreeNode | null = null;
  nextSibling: TreeNode | null = null;
  private readonly attributes: ReadonlyMap<string, string>;

  constructor(
    nodeType: number,
    nodeValue: string | null,
    localName: string | undefined,
    attributes: ReadonlyMap<string, string>,
  ) {
    this.nodeType = nodeType;
    this.nodeValue = nodeValue;
    this.localName = localName;
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

const NO_ATTRIBUTES: ReadonlyMap<string, string> = new Map();

function buildElement(node: Node): XmlTreeNode {
  const built = new XmlTreeNode(NODE_TYPE.element, null, node.name, node.attributes);

  for (const child of node.children) {
    // An empty run of text is dropped rather than becoming a zero-length node: a browser
    // creates nothing there, and a node with no characters would still occupy an ordinal.
    if (child === "") continue;

    const builtChild =
      typeof child === "string"
        ? new XmlTreeNode(NODE_TYPE.text, child, undefined, NO_ATTRIBUTES)
        : buildElement(child);
    builtChild.parentNode = built;

    const previous = built.childNodes[built.childNodes.length - 1];
    if (previous !== undefined) {
      previous.nextSibling = builtChild;
      builtChild.previousSibling = previous;
    }
    built.childNodes.push(builtChild);
  }

  return built;
}

/** An element node. A text node is just a string, without another wrapper. */
interface Node {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly (Node | string)[];
}

function element(node: Node): XmlElement {
  const children = (name: string): readonly XmlElement[] =>
    node.children
      .filter((child): child is Node => typeof child !== "string" && child.name === name)
      .map(element);

  const descendants = (name: string): readonly XmlElement[] => {
    const found: XmlElement[] = [];
    const walk = (current: Node): void => {
      for (const child of current.children) {
        if (typeof child === "string") continue;
        if (child.name === name) found.push(element(child));
        walk(child);
      }
    };
    walk(node);
    return found;
  };

  return {
    child: (name) => children(name)[0],
    children,
    descendants,
    attribute: (name) => node.attributes.get(name),
    // Trimming happens exactly once, here. Doing it inside the recursion would trim
    // every interior text run separately, and that is precisely where the
    // `ChapterOneRevised` above comes from.
    text: () => textOf(node).trim(),
  };
}

function textOf(node: Node): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

/**
 * XML 1.0 §2.11: `\r\n` and a lone `\r` are translated to `\n` **before the application sees
 * the document**.
 *
 * This is required of every conforming parser, and the reason it is required is portability:
 * the same document written on a different platform has to read back as the same characters.
 * Skipping it does not merely leave stray characters lying around — it makes frond's idea of
 * a document's text differ from a browser's, and once the two disagree about how many
 * characters there are, every position after the first CRLF disagrees too. That is how it was
 * found: a real book's poem block (`kusamakura`, written with CRLF) was four characters
 * longer here than in the browser, and so was every CFI past it
 * (`tests/browser/renderer/cfi-cross-implementation.spec.ts`).
 *
 * Done to the whole source before scanning, so it covers attribute values and CDATA as well —
 * the spec applies it to the document, not to a particular construct.
 */
function normaliseLineEnds(source: string): string {
  // Cheap enough to be worth checking: most documents contain no carriage return at all, and
  // this runs over every XML file in every book that is opened.
  return source.includes("\r") ? source.replace(/\r\n?/g, "\n") : source;
}

/** These five are defined by XML itself and need no DTD declaration. Other named entities are left verbatim (see `entity`). */
const PREDEFINED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** A name's first character may not be one of these. Validity elsewhere is decided by where the scanner stops. */
const INVALID_NAME_START = /[0-9.\-]/;

/** A name ends at these characters. They are also the characters a name may not contain. */
const NAME_END = /[\s/>=<&"']/;

const WHITESPACE = /\s/;

const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

class Reader {
  private readonly source: string;
  private readonly failure: XmlParseFailure;
  private at = 0;

  constructor(source: string, failure: XmlParseFailure) {
    this.source = normaliseLineEnds(source);
    this.failure = failure;
  }

  document(): Node {
    // A UTF-8 BOM decodes to a single U+FEFF. Left in, it would be treated as text
    // before the root element.
    const start = this.source.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.at = start;

    const roots: Node[] = [];
    while (this.at < this.source.length) {
      if (this.source[this.at] !== "<") {
        // Outside the root element there may only be whitespace. This is stricter
        // than `fast-xml-parser`'s validator — that one passes both `<a/>tail` and
        // `<a/><b/>`, and neither is well-formed XML. Not one of the sample's 1767
        // documents trips on it, so the strictness buys "a broken book speaks up" at
        // no cost.
        if (this.until("<").trim() !== "") this.fail("text outside the root element");
        continue;
      }
      const node = this.markup(roots.length > 0, start);
      if (node === undefined) continue;
      if (roots.length > 0) {
        this.fail(`an XML document may have only one root element; a second <${node.name}> appears here`);
      }
      roots.push(node);
    }
    if (roots.length === 0) this.fail("this document has no root element");

    // Wrapped in a nameless element, taking the root and taking a child at any level
    // become the same operation.
    return { name: "", attributes: new Map(), children: roots };
  }

  /** Reads one `<`-introduced construct. Returns `undefined` for a comment / processing instruction / DOCTYPE. */
  private markup(rootSeen: boolean, documentStart = -1): Node | undefined {
    if (this.peek("<!--")) {
      this.upTo("-->", "unterminated comment");
      return undefined;
    }
    if (this.peek(CDATA_OPEN)) this.fail("CDATA is not allowed outside the root element");
    if (this.peek("<!DOCTYPE")) {
      this.skipDoctype();
      return undefined;
    }
    if (this.peek("<!")) this.fail("unrecognised declaration");
    if (this.peek("<?")) {
      // The XML declaration may only come first. That is its only difference from
      // other processing instructions, so position is the only thing to check — frond
      // uses none of its content (version, encoding): bytes are always decoded as
      // UTF-8, which is `container.ts`'s decision.
      //
      // Matching a prefix is not enough: `<?xml-stylesheet?>` also starts with
      // `<?xml`, and it is an ordinary processing instruction, legal anywhere. The
      // target name has to be **exactly** `xml` to count as the declaration.
      if (this.isDeclaration() && this.at !== documentStart) {
        this.fail("the XML declaration may only appear at the very start of the document");
      }
      this.upTo("?>", "unterminated processing instruction");
      return undefined;
    }
    if (this.peek("</")) this.fail("stray end tag");
    if (rootSeen) this.fail("elements are not allowed outside the root element");
    return this.startTag();
  }

  private startTag(): Node {
    this.at += 1; // '<'
    const name = this.name("tag");
    const attributes = this.attributes(name);

    if (this.peek("/>")) {
      this.at += 2;
      return { name, attributes, children: [] };
    }
    this.at += 1; // '>', guaranteed by attributes()

    const children: (Node | string)[] = [];
    for (;;) {
      if (this.at >= this.source.length) this.fail(`<${name}> has no end tag`);

      if (this.source[this.at] !== "<") {
        children.push(this.decode(this.until("<")));
        continue;
      }
      if (this.peek("</")) {
        this.at += 2;
        const closing = this.name("end tag");
        this.skipWhitespace();
        if (!this.peek(">")) this.fail(`</${closing}> is not terminated properly`);
        this.at += 1;
        // A difference in case is a different name — XML is not HTML.
        if (closing !== name) this.fail(`<${name}> is closed by </${closing}>`);
        return { name, attributes, children };
      }
      if (this.peek(CDATA_OPEN)) {
        this.at += CDATA_OPEN.length;
        children.push(this.upTo(CDATA_CLOSE, "unterminated CDATA"));
        continue;
      }
      const child = this.markup(false);
      if (child !== undefined) children.push(child);
    }
  }

  /** Reads the attributes, leaving the cursor on `>` or `/>`. */
  private attributes(tag: string): ReadonlyMap<string, string> {
    const attributes = new Map<string, string>();
    const seen = new Set<string>();
    for (;;) {
      const before = this.at;
      this.skipWhitespace();
      if (this.peek("/>") || this.peek(">")) return attributes;
      if (this.at >= this.source.length) this.fail(`the <${tag}> tag is not terminated properly`);
      // Without whitespace separating them it is not a new attribute — `<a x="1"y="2">`
      // is not well-formed.
      if (this.at === before) this.fail(`missing whitespace between <${tag}>'s attributes`);

      const raw = this.rawName("attribute");
      this.skipWhitespace();
      // Boolean attributes (`<a disabled>`) are an HTML notation; XML always requires
      // a value. Allowing them would let a navigation document written with an HTML
      // mindset pass as conforming, and the browser would then refuse to render it.
      if (!this.peek("=")) this.fail(`attribute ${raw} has no value`);
      this.at += 1;
      this.skipWhitespace();

      const quote = this.source[this.at];
      if (quote !== '"' && quote !== "'") this.fail(`attribute ${raw}'s value is not quoted`);
      this.at += 1;
      const value = this.upTo(quote, `attribute ${raw}'s quote is not closed`);

      // A duplicated attribute has no "right answer" in the document — last-one-wins
      // is the parser's choice, not the spec's. So it is an error, not something to
      // handle silently. What is compared is the **original name**: `dc:x` and `opf:x`
      // are two different attributes in XML.
      if (seen.has(raw)) this.fail(`attribute ${raw} appears twice`);
      seen.add(raw);
      if (raw === "xmlns" || raw.startsWith("xmlns:")) continue;

      const name = stripPrefix(raw);
      const decoded = this.decode(value);
      // The case where names only collide after the prefix is stripped. **The same
      // value is not a problem** — `<html xml:lang="zh" lang="zh">` is the standard
      // XHTML notation, the two attributes are saying the same thing to begin with,
      // and every navigation document in the sample writes it that way. Only differing
      // values genuinely leave `attribute("lang")` with no answer to give, and that
      // has to speak up rather than pick one.
      const existing = attributes.get(name);
      if (existing !== undefined && existing !== decoded) {
        this.fail(`two attributes are both called ${name} once prefixes are stripped, and their values differ`);
      }
      attributes.set(name, decoded);
    }
  }

  /** Turns entities and numeric character references into characters. */
  private decode(raw: string): string {
    if (!raw.includes("&")) return raw;

    let out = "";
    let at = 0;
    for (;;) {
      const amp = raw.indexOf("&", at);
      if (amp < 0) return out + raw.slice(at);
      out += raw.slice(at, amp);

      const end = raw.indexOf(";", amp);
      const reference = end < 0 ? "" : raw.slice(amp + 1, end);
      if (reference === "" || WHITESPACE.test(reference)) {
        // A bare `&` is a well-formedness error, not a character to copy through.
        // Allowing it means the browser refuses to render the same document, and by
        // then the symptom is a long way from the cause.
        this.fail("an unterminated & in text; it has to be written &amp;");
      }
      out += entity(reference);
      at = end + 1;
    }
  }

  private name(kind: string): string {
    return stripPrefix(this.rawName(kind));
  }

  private rawName(kind: string): string {
    const start = this.at;
    while (this.at < this.source.length && !NAME_END.test(this.source[this.at]!)) {
      this.at += 1;
    }
    const raw = this.source.slice(start, this.at);
    if (raw === "") this.fail(`the ${kind} name is empty`);
    if (INVALID_NAME_START.test(raw[0]!)) this.fail(`the ${kind} name ${raw} is not valid`);
    return raw;
  }

  /**
   * Skips the DOCTYPE, internal subset included.
   *
   * In the sample, 17 navigation documents and 1 NCX have a DOCTYPE. The internal
   * subset (`[ … ]`) may contain `>` — `<!ENTITY foo "bar">` does — so stopping at the
   * first `>` is wrong. frond does not expand the entities declared inside: that road
   * leads to billion laughs, and not one book in the sample uses them.
   */
  private skipDoctype(): void {
    this.at += "<!DOCTYPE".length;
    let inSubset = false;
    while (this.at < this.source.length) {
      const char = this.source[this.at]!;
      this.at += 1;
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      else if (char === ">" && !inSubset) return;
    }
    this.fail("unterminated DOCTYPE");
  }

  private peek(token: string): boolean {
    return this.source.startsWith(token, this.at);
  }

  private isDeclaration(): boolean {
    if (!this.peek("<?xml")) return false;
    const after = this.source[this.at + "<?xml".length];
    return after === undefined || after === "?" || WHITESPACE.test(after);
  }

  private skipWhitespace(): void {
    while (this.at < this.source.length && WHITESPACE.test(this.source[this.at]!)) {
      this.at += 1;
    }
  }

  /** Reads up to but not including `token`, leaving the cursor on `token`. Reads to end of document if absent. */
  private until(token: string): string {
    const end = this.source.indexOf(token, this.at);
    const stop = end < 0 ? this.source.length : end;
    const text = this.source.slice(this.at, stop);
    this.at = stop;
    return text;
  }

  /** Reads up to but not including `token`, leaving the cursor after `token`. Throws if absent. */
  private upTo(token: string, complaint: string): string {
    const end = this.source.indexOf(token, this.at);
    if (end < 0) this.fail(complaint);
    const text = this.source.slice(this.at, end);
    this.at = end + token.length;
    return text;
  }

  private fail(detail: string): never {
    const line = this.source.slice(0, this.at).split("\n").length;
    throw new EpubOpenError(
      this.failure.reason,
      `${this.failure.label} is not well-formed XML: ${detail} (line ${line})`,
    );
  }
}

/**
 * The character an entity reference turns into.
 *
 * The only things recognised are the five predefined entities and numeric character
 * references. **Anything unrecognised is left verbatim** (`&nbsp;` stays `&nbsp;`)
 * rather than throwing: it may have been declared by the DOCTYPE's internal subset,
 * and frond does not expand those declarations. Throwing would keep a conforming book
 * from opening, whereas leaving it costs at worst a stray run of characters in a
 * title — the latter is visible, the former makes the whole book disappear.
 */
function entity(reference: string): string {
  const predefined = PREDEFINED_ENTITIES.get(reference);
  if (predefined !== undefined) return predefined;

  if (reference.startsWith("#")) {
    const hex = reference.startsWith("#x") || reference.startsWith("#X");
    const digits = reference.slice(hex ? 2 : 1);
    const code = /^[0-9a-fA-F]+$/.test(digits) ? Number.parseInt(digits, hex ? 16 : 10) : Number.NaN;
    // The surrogate range (U+D800–U+DFFF) does not hold characters, and
    // `String.fromCodePoint` throws on it.
    if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
      return String.fromCodePoint(code);
    }
  }
  return `&${reference};`;
}

/** `dc:title` → `title`. The prefix is a string the document chose, not meaning. */
function stripPrefix(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
