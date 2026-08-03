/**
 * The **grammar layer** of EPUB CFI (Canonical Fragment Identifier): the round trip
 * between string and structure, plus ordering two CFIs.
 *
 * A CFI is an exact position or range within a book (CONTEXT.md), and it is what
 * locates a reader's progress and their annotations.
 *
 * CONTEXT.md says "a CFI is exact but not orderable by magnitude; a fraction is
 * orderable but coarse" — that sentence is about **distance**: there is no "how far
 * apart" between two CFIs, and no percentage to compute, which is what fractions are
 * for. **Which comes first is still answerable**, and has to be (user story 22:
 * ordering annotations by their place in the book). So there is a `compareCfi()` here
 * and no subtraction anywhere.
 *
 * ## This module's boundary
 *
 * **Mapping a CFI onto a position is not here.** Walking a CFI down to a node, or
 * writing a position out as a CFI, means counting nodes, handling ones that do not
 * count, and merging adjacent text — that is `cfi-tree.ts`, next door.
 *
 * This header used to say that half "needs an actually rendered document", and put it
 * in `Renderer` on that basis. It measured the wrong thing: what it needs is a
 * **tree**, and a rendered document merely happens to be one, so the whole of it now
 * sits at this layer too (ADR-0012). What genuinely needs a browser is `Range` itself,
 * and that is all `renderer/cfi-dom.ts` still holds.
 *
 * The cut between this module and that one is unchanged: string ↔ structure here,
 * structure ↔ nodes there, and neither knows what the other is doing. What that buys
 * is that both sit at the base of the test pyramid — zero DOM, Vitest in Node
 * (ADR-0009).
 *
 * ## The oracle is the spec, not foliate
 *
 * This layer's correctness is measured against the EPUB CFI specification; foliate has
 * no special knowledge here (layer 1 of ADR-0001's test pyramid). Its
 * `tests/epubcfi-tests.js` was run once as an **acceptance table**, and the
 * entry-by-entry results are recorded in
 * `tests/node/cfi/foliate-acceptance.test.ts` — that is reading its cases, not
 * reading its code.
 *
 * ## The grammar (the spec's ABNF, keeping only what this layer needs)
 *
 * ```
 * fragment   = "epubcfi(" ( path | range ) ")"
 * range      = path "," local_path "," local_path
 * path       = { step | "!" } [ offset ]
 * step       = "/" integer [ "[" assertion "]" ]
 * offset     = ":" integer [ "[" assertion "]" ]
 * ```
 *
 * `!` is an **indirection**: crossing it switches to a different document (package
 * document → content document). So a path is represented here as "several segments
 * split by `!`" (`CfiSegment`) rather than one flat run of steps — that boundary is
 * the only place compare ever answers "incomparable".
 */

/** One CFI: a position within a book, or a range. */
export type Cfi = CfiPoint | CfiRange;

/** A single position. */
export interface CfiPoint {
  readonly kind: "point";
  readonly path: CfiPath;
}

/**
 * A range — what an annotation uses to mark a stretch of text.
 *
 * The spec's shape is "common prefix + start + end" (`parent,start,end`) rather than
 * two complete CFIs, because a highlight almost always falls inside one document, and
 * sharing the prefix makes it far shorter.
 */
export interface CfiRange {
  readonly kind: "range";
  /** The first half, shared by start and end. */
  readonly parent: CfiPath;
  /** The start, appended after `parent`. */
  readonly start: CfiPath;
  /** The end, appended after `parent`. */
  readonly end: CfiPath;
}

/**
 * A path, split into segments at each indirection (`!`).
 *
 * The first segment lies in the package document, and each later one lies in the
 * document the previous segment's last step points at. At least one segment.
 */
export type CfiPath = readonly CfiSegment[];

/** A run of steps within one document, optionally ending in a character offset. */
export interface CfiSegment {
  readonly steps: readonly CfiStep[];
  /** The character offset at the end of the segment. `undefined` when there is none — that refers to the node itself. */
  readonly offset: CfiOffset | undefined;
}

export interface CfiStep {
  /**
   * The child's ordinal. **Even numbers address elements, odd numbers address text
   * nodes** — that is CFI's addressing rule, not an array index.
   */
  readonly index: number;
  /** `[…]`. An assertion on a step is an id. */
  readonly assertion: CfiAssertion | undefined;
}

/** A character offset (`:N`) — before the Nth character inside a text node. */
export interface CfiOffset {
  readonly characters: number;
  /** `[…]`. An assertion on an offset is context (`[before,after]`). */
  readonly assertion: CfiAssertion | undefined;
}

/**
 * The assertion inside `[…]`. **The spec says the index is authoritative and the
 * assertion is redundancy for recovering the position after the book is revised** —
 * so frond reads it and writes it back, but `compareCfi()` does not look at it.
 *
 * Fields are comma-separated: a step has just one (an id), while a character offset
 * has two (the `[before,after]` context). Flattening it into an `id` field and a
 * `before`/`after` pair would mean two types for the same `[…]`, and grammatically
 * they are one thing.
 */
export interface CfiAssertion {
  /** The comma-separated fields, with `^` escapes already undone. */
  readonly fields: readonly string[];
  /** `;name=value`, in order of appearance. */
  readonly parameters: readonly CfiParameter[];
}

export interface CfiParameter {
  readonly name: string;
  readonly value: string;
}

/**
 * The ordering of two CFIs.
 *
 * **`"incomparable"` is not an error, it is an answer.** An API returning
 * `-1`/`0`/`1` has nowhere to say this, so a consumer silently treats "these two
 * positions have no order" as "equal" or "earlier" — the annotation ordering looks
 * right, it is just made up. Returning a string rather than a number is deliberate
 * too: writing `sort(compareCfi)` becomes a type error outright, instead of treating
 * `undefined` as 0 at runtime.
 */
export type CfiComparison = "before" | "equal" | "after" | "incomparable";

/** How a CFI string is broken. */
export type CfiParseFailure =
  /** Neither `epubcfi(…)` nor a path starting with `/`. */
  | "not-a-cfi"
  /** No digits after a `/`. */
  | "malformed-step"
  /** No digits after a `:`. */
  | "malformed-offset"
  /** A `[` with no matching `]`. */
  | "unterminated-assertion"
  /** The wrong number of commas — a range has to be exactly `parent,start,end`. */
  | "malformed-range"
  /**
   * Temporal (`~`) and spatial (`@`) offsets. The grammar recognises them; frond v1
   * does not do them — they locate a moment in audio/video and a coordinate on an
   * image, and v1 only renders XHTML content documents.
   *
   * This case is **explicitly rejected rather than ignored**: the path left after
   * dropping the offset is a valid CFI that points somewhere else, and that is exactly
   * "silently returning a half-right structure".
   */
  | "unsupported-offset"
  /** A character appeared that is not in the grammar. */
  | "unexpected-character";

export class CfiParseError extends Error {
  readonly reason: CfiParseFailure;

  constructor(reason: CfiParseFailure, message: string) {
    super(message);
    this.name = "CfiParseError";
    this.reason = reason;
  }
}

const WRAPPER_PREFIX = "epubcfi(";
const WRAPPER_SUFFIX = ")";

/** The characters that must be escaped inside an assertion (spec 2.3). */
const MUST_ESCAPE = new Set(["^", "[", "]", "(", ")", ",", ";", "="]);

const ESCAPE = "^";

/**
 * Reads a CFI string into a structure.
 *
 * The input may carry `epubcfi(…)` or not: real books write it in a URL fragment
 * (`#epubcfi(/6/4!/4/2)`), while the spec's examples and the values passed around in
 * code are often bare paths. The output always carries it (see `serializeCfi`).
 *
 * @throws CfiParseError a broken string gets an explicit error rather than a half-right structure
 */
export function parseCfi(source: string): Cfi {
  const parts = splitTopLevel(unwrap(source));

  if (parts.length === 1) {
    return { kind: "point", path: parsePath(parts[0]!, source) };
  }
  if (parts.length === 3) {
    return {
      kind: "range",
      parent: parsePath(parts[0]!, source),
      start: parsePath(parts[1]!, source),
      end: parsePath(parts[2]!, source),
    };
  }
  throw new CfiParseError(
    "malformed-range",
    `${source} has ${parts.length - 1} commas; a range has to be exactly parent,start,end`,
  );
}

/**
 * Writes the structure back to a string.
 *
 * `parseCfi` → `serializeCfi` is the identity, **except for four normalizations** —
 * all four collapse two spellings of the same position into one, and lose no
 * information:
 *
 * 1. **`epubcfi(…)` is always added.** A bare path goes in, a wrapped one comes out.
 * 2. **Surplus escapes are dropped.** `^/` and `/` are the same character inside an
 *    assertion (the spec only requires escaping `^ [ ] ( ) , ; =`), and the output
 *    escapes only what must be escaped.
 * 3. **Leading zeros are dropped.** `/06` and `/6` are the same step.
 * 4. **Valueless parameters gain an `=`.** `[a;b]` is written back as `[a;b=]`.
 */
export function serializeCfi(cfi: Cfi): string {
  const body =
    cfi.kind === "point"
      ? writePath(cfi.path)
      : `${writePath(cfi.parent)},${writePath(cfi.start)},${writePath(cfi.end)}`;

  return `${WRAPPER_PREFIX}${body}${WRAPPER_SUFFIX}`;
}

/**
 * Which of two CFIs comes first in the book (user story 22: ordering annotations by
 * their place in the book).
 *
 * Ranges are ordered by start first, then by end when the starts match — the same
 * scheme as for points, because a point is a range whose start and end coincide. A
 * position falling inside someone else's range therefore still gets an order rather
 * than "incomparable":
 *
 * - The point is **after** the range's start (the range has already begun) → the point
 *   sorts after the range, decided by the start alone
 * - The point is **exactly on** the range's start → the starts match, so compare ends;
 *   the point's end is itself, which is before the range's end, so the point sorts
 *   first
 *
 * What the reader wants is a stable ordering, and overlapping annotations (highlights
 * are often drawn on top of one another) really do share a start in the book.
 *
 * ## Assertions take no part in the comparison
 *
 * When two CFIs have matching indices and differing `[…]`, the answer is `"equal"`.
 * The spec says the index is authoritative and the assertion is redundancy for
 * recovering a position after the book is revised — using it as grounds for comparison
 * would turn one position into two different positions just because the book got a new
 * edition.
 *
 * ## When it is incomparable
 *
 * When the two make incompatible claims about the **same node**, this layer has no way
 * to order them, and must not guess:
 *
 * - One crosses into a different document at that node (`!`) while the other keeps
 *   walking into its children. The two positions lie in different documents, and the
 *   order between documents is not something this string can state.
 * - One lands in that node's text (`:N`) while the other lands on one of its children.
 *   Which comes first depends on where that child sits in the content, and that takes
 *   a document to know.
 *
 * Both need `Renderer` to have parsed the document before there is an answer, so at
 * the grammar layer they are `"incomparable"`, not `"equal"`.
 */
export function compareCfi(a: Cfi, b: Cfi): CfiComparison {
  const byStart = comparePaths(startOf(a), startOf(b));
  return byStart === "equal" ? comparePaths(endOf(a), endOf(b)) : byStart;
}

function startOf(cfi: Cfi): CfiPath {
  return cfi.kind === "point" ? cfi.path : concat(cfi.parent, cfi.start);
}

function endOf(cfi: Cfi): CfiPath {
  return cfi.kind === "point" ? cfi.path : concat(cfi.parent, cfi.end);
}

/**
 * Appends a range's start (or end) to the common prefix, giving one complete path.
 *
 * It joins **inside the prefix's last segment**: `/6/4!/4` plus `/10` is `/6/4!/4/10`,
 * not an extra segment. Joining it wrongly would move that position into a different
 * document.
 */
function concat(parent: CfiPath, local: CfiPath): CfiPath {
  const [first, ...rest] = local;
  if (first === undefined) return parent;

  const last = parent[parent.length - 1];
  if (last === undefined) return local;

  return [
    ...parent.slice(0, -1),
    { steps: [...last.steps, ...first.steps], offset: first.offset },
    ...rest,
  ];
}

function comparePaths(a: CfiPath, b: CfiPath): CfiComparison {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    // One side ran out first: the shorter is a prefix of the longer, hence its
    // ancestor, and sorts first.
    if (left === undefined) return "before";
    if (right === undefined) return "after";

    const order = compareSegments(left, right, {
      leftContinues: index < a.length - 1,
      rightContinues: index < b.length - 1,
    });
    if (order !== "equal") return order;
  }
  return "equal";
}

/** Whether another segment follows this one — that is, whether this segment's end crosses into a different document. */
interface Continuation {
  readonly leftContinues: boolean;
  readonly rightContinues: boolean;
}

function compareSegments(
  a: CfiSegment,
  b: CfiSegment,
  continuation: Continuation,
): CfiComparison {
  const shared = Math.min(a.steps.length, b.steps.length);
  for (let index = 0; index < shared; index += 1) {
    const left = a.steps[index]!.index;
    const right = b.steps[index]!.index;
    if (left !== right) return left < right ? "before" : "after";
  }

  if (a.steps.length !== b.steps.length) {
    const shorterIsLeft = a.steps.length < b.steps.length;
    const shorter = shorterIsLeft ? a : b;
    const shorterContinues = shorterIsLeft
      ? continuation.leftContinues
      : continuation.rightContinues;

    // The shorter one switches documents at this node, or lands inside its text, while
    // the longer one walks into its children — either way it takes a document to
    // order them.
    if (shorterContinues || shorter.offset !== undefined) return "incomparable";
    return shorterIsLeft ? "before" : "after";
  }

  return compareOffsets(a.offset, b.offset);
}

/**
 * The ordering of offsets. **No offset sorts before an offset**: `/2` refers to the
 * node itself and `/2:0` to the first character inside it, and a node's start comes
 * before its content.
 */
function compareOffsets(
  a: CfiOffset | undefined,
  b: CfiOffset | undefined,
): CfiComparison {
  if (a === undefined && b === undefined) return "equal";
  if (a === undefined) return "before";
  if (b === undefined) return "after";
  if (a.characters === b.characters) return "equal";
  return a.characters < b.characters ? "before" : "after";
}

function unwrap(source: string): string {
  if (source.startsWith(WRAPPER_PREFIX) && source.endsWith(WRAPPER_SUFFIX)) {
    // Any `)` inside is necessarily escaped (the spec requires it), so the last
    // character is the closer.
    return source.slice(WRAPPER_PREFIX.length, -WRAPPER_SUFFIX.length);
  }
  if (source.startsWith("/")) return source;

  throw new CfiParseError(
    "not-a-cfi",
    `${JSON.stringify(source)} is not a CFI — it has to be either epubcfi(…) or a path starting with /`,
  );
}

/** Splits on commas that are **not inside an assertion**. A comma inside an assertion separates fields, not range parts. */
function splitTopLevel(body: string): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let inAssertion = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === ESCAPE) {
      // The whole escape sequence is carried over verbatim; unescaping waits until the
      // assertion is read.
      current += character + (body[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "[") inAssertion = true;
    else if (character === "]") inAssertion = false;
    else if (character === "," && !inAssertion) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  parts.push(current);
  return parts;
}

/** The reading position. A cursor rather than threading new indices through, so each read function returns only what it read. */
interface Cursor {
  readonly text: string;
  index: number;
}

function parsePath(text: string, source: string): CfiPath {
  if (!text.startsWith("/") && !text.startsWith("!")) {
    throw new CfiParseError(
      "not-a-cfi",
      `${JSON.stringify(text)} in ${source} is not a path — a path has to start with / or !`,
    );
  }

  const cursor: Cursor = { text, index: 0 };
  const segments: CfiSegment[] = [];
  let steps: CfiStep[] = [];
  let offset: CfiOffset | undefined;

  while (cursor.index < text.length) {
    const character = text[cursor.index]!;

    if (character === "/") {
      if (offset !== undefined) {
        // `:5/2` — there is no walking further after an offset; characters have no
        // children.
        throw new CfiParseError(
          "malformed-step",
          `${source} has a step after a character offset; an offset can only end a segment`,
        );
      }
      steps.push(readStep(cursor, source));
      continue;
    }

    if (character === "!") {
      cursor.index += 1;
      segments.push({ steps, offset });
      steps = [];
      offset = undefined;
      continue;
    }

    if (character === ":") {
      if (offset !== undefined) {
        throw new CfiParseError(
          "malformed-offset",
          `${source} has two character offsets in one segment`,
        );
      }
      offset = readOffset(cursor, source);
      continue;
    }

    if (character === "~" || character === "@") {
      throw new CfiParseError(
        "unsupported-offset",
        `${source} carries a ${character === "~" ? "temporal" : "spatial"} offset (${character}); frond v1 only does character offsets in XHTML content documents`,
      );
    }

    throw new CfiParseError(
      "unexpected-character",
      `character ${cursor.index + 1} of ${source}, ${JSON.stringify(character)}, is not in the CFI grammar`,
    );
  }

  segments.push({ steps, offset });
  return segments;
}

function readStep(cursor: Cursor, source: string): CfiStep {
  cursor.index += 1; // "/"
  const digits = readDigits(cursor);
  if (digits === undefined) {
    throw new CfiParseError(
      "malformed-step",
      `${source} has no digits after its /`,
    );
  }
  return { index: digits, assertion: readAssertion(cursor, source) };
}

function readOffset(cursor: Cursor, source: string): CfiOffset {
  cursor.index += 1; // ":"
  const digits = readDigits(cursor);
  if (digits === undefined) {
    throw new CfiParseError(
      "malformed-offset",
      `${source} has no digits after its :`,
    );
  }
  return { characters: digits, assertion: readAssertion(cursor, source) };
}

function readDigits(cursor: Cursor): number | undefined {
  const start = cursor.index;
  while (cursor.index < cursor.text.length && isDigit(cursor.text[cursor.index]!)) {
    cursor.index += 1;
  }
  if (cursor.index === start) return undefined;
  // Leading zeros are absorbed here; `/06` and `/6` are the same step (see
  // serializeCfi's normalization rules).
  return Number(cursor.text.slice(start, cursor.index));
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * `[…]`. Not being on a `[` means there is no assertion.
 *
 * Splitting fields and undoing escapes **have to happen in the same pass**: `,`
 * separates fields while `^,` is a comma itself, and unescaping the whole segment
 * before splitting makes the two indistinguishable — and "an id containing a comma" is
 * a shape the spec explicitly permits and foliate's acceptance table demonstrates.
 */
function readAssertion(cursor: Cursor, source: string): CfiAssertion | undefined {
  if (cursor.text[cursor.index] !== "[") return undefined;
  cursor.index += 1;

  const fields: string[] = [];
  const parameters: CfiParameter[] = [];
  let current = "";
  /** This parameter's name, meaning its `=` has already been read. */
  let parameterName: string | undefined;
  /** Whether reading has passed a `;` — that is, whether what is being read now is a parameter rather than a field. */
  let inParameters = false;

  const finish = (): void => {
    if (!inParameters) {
      fields.push(current);
    } else if (parameterName !== undefined) {
      parameters.push({ name: parameterName, value: current });
    } else if (current !== "") {
      // `;name` came with no value. An empty one is supplied rather than dropping it —
      // writing it back adds an `=`, which is one of the normalizations serializeCfi
      // records.
      parameters.push({ name: current, value: "" });
    }
    current = "";
    parameterName = undefined;
  };

  for (;;) {
    if (cursor.index >= cursor.text.length) {
      throw new CfiParseError(
        "unterminated-assertion",
        `${source} has a [ with no matching ]`,
      );
    }
    const character = cursor.text[cursor.index]!;
    cursor.index += 1;

    if (character === ESCAPE) {
      current += cursor.text[cursor.index] ?? "";
      cursor.index += 1;
      continue;
    }
    if (character === "]") {
      finish();
      break;
    }
    if (character === "," && !inParameters) {
      fields.push(current);
      current = "";
      continue;
    }
    if (character === ";") {
      finish();
      inParameters = true;
      continue;
    }
    if (character === "=" && inParameters && parameterName === undefined) {
      parameterName = current;
      current = "";
      continue;
    }
    current += character;
  }

  return { fields, parameters };
}

function writePath(path: CfiPath): string {
  return path.map(writeSegment).join("!");
}

function writeSegment(segment: CfiSegment): string {
  const steps = segment.steps
    .map((step) => `/${step.index}${writeAssertion(step.assertion)}`)
    .join("");
  const offset =
    segment.offset === undefined
      ? ""
      : `:${segment.offset.characters}${writeAssertion(segment.offset.assertion)}`;

  return steps + offset;
}

function writeAssertion(assertion: CfiAssertion | undefined): string {
  if (assertion === undefined) return "";

  const fields = assertion.fields.map(escape).join(",");
  const parameters = assertion.parameters
    .map((parameter) => `;${escape(parameter.name)}=${escape(parameter.value)}`)
    .join("");

  return `[${fields}${parameters}]`;
}

/**
 * Escapes only the characters the spec names.
 *
 * "Only" is the point: escaping a few extra would not stop anyone reading it, but it
 * would stop the round trip being the identity — and identity is the one property this
 * layer can verify about itself.
 */
function escape(text: string): string {
  return [...text]
    .map((character) => (MUST_ESCAPE.has(character) ? ESCAPE + character : character))
    .join("");
}
