/**
 * The reasons a book fails to open.
 *
 * This is a **closed union of strings** rather than free text: messages are for
 * people, they get rewritten as the wording changes, and consumers must not match
 * against them. A bookshelf needs to tell "this file is not a book at all" apart
 * from "this book's packaging is broken" — the former can simply be left out of the
 * shelf, the latter is worth telling the reader that this book has a problem.
 */
export type EpubOpenFailure =
  /** The bytes are not a ZIP — most often a different file, or a partial download. */
  | "not-a-zip"
  /**
   * It is a ZIP, but it uses features frond does not read: ZIP64, encryption,
   * compression methods other than deflate, multi-volume archives
   * (`src/epub/zip.ts`).
   *
   * **Kept separate from `not-a-zip`, because the bookshelf should do something
   * different**: that case means the file is not a book at all and can simply be
   * left out; this one means it really is a book, frond just cannot open it — which
   * is worth letting the reader know, and worth reporting upstream.
   */
  | "unsupported-zip-feature"
  /** The ZIP opens, but there is no `META-INF/container.xml` inside, so it is not an OCF container. */
  | "missing-container"
  /**
   * A container-level file under `META-INF/` is broken: `container.xml` is not
   * well-formed XML, does not point at a package document, or `encryption.xml` is
   * not well-formed XML.
   */
  | "malformed-container"
  /** The package document the container points at is not in the archive. */
  | "missing-package-document"
  /** The package document is not well-formed XML, or is missing required elements. */
  | "malformed-package-document"
  /** The packaging version is out of the supported range (ADR-0010: OEBPS 1.2 and OEB 1.0 are explicitly rejected). */
  | "unsupported-package-version"
  /**
   * The navigation document (`nav.xhtml` or `toc.ncx`) is not well-formed XML.
   *
   * This case **is an error rather than an empty TOC**, unlike "there is no
   * navigation document at all": neither declaring one, nor declaring one whose file
   * is missing, means anything more than that this book has no table of contents;
   * but declaring one whose file is present and which then will not parse means this
   * book is broken. The evidence for that is that the navigation documents of those
   * 33 books (across both vehicles) are **all well-formed** — relaxing this case
   * does not buy a single known book, but it would make "the whole TOC failed to
   * parse" silent.
   */
  | "malformed-navigation-document"
  /** The manifest points at a file that does not exist inside the archive. */
  | "missing-resource"
  /** A manifest href resolves outside the package root — non-conforming, and also the shape of a path traversal. */
  | "resource-outside-container"
  /** readingOrder points at an id the manifest does not have, so that item's content does not exist. */
  | "unknown-reading-order-item"
  /**
   * A **content** document — a section's own XHTML — is not well-formed.
   *
   * The odd one out in this list: every other case is a way `EpubBook.open` fails, and when
   * one happens there is no book. This one is thrown later, by `ContentDocument.parse`, and
   * the book around it is fine. It lives here anyway because the failure is the same failure
   * (`xml.ts` refusing the same way it refuses a package document) and a second error
   * taxonomy for one variant would cost more than the mismatch does.
   *
   * A consumer's response is not "this book is broken" but "this section cannot be read" —
   * which is also what a browser does with the same bytes, reporting `not-well-formed` and
   * rendering an error page for that section only.
   */
  | "malformed-content-document";

/**
 * Opening the book failed. **An explicit error rather than a silent failure or a
 * half-open state** (#8) — `EpubBook` either opens completely or throws this; there
 * is no such thing as a half-opened instance.
 */
export class EpubOpenError extends Error {
  readonly reason: EpubOpenFailure;

  constructor(reason: EpubOpenFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EpubOpenError";
    this.reason = reason;
  }
}

/**
 * The reasons taking the bytes of a resource fails.
 *
 * Kept separate from `EpubOpenFailure` because the **timing differs**: those are
 * ways opening goes wrong, and when one happens there is no `EpubBook` instance at
 * all; these happen after the book is already open, and only that one resource is
 * unavailable. A book carrying an unsupported obfuscated font still opens and still
 * reads through to the end — what the reader wants is for the book to open
 * (ADR-0010).
 */
export type EpubResourceFailure =
  /** The archive has no such path. */
  | "missing-resource"
  /**
   * This item was obfuscated, but not with the IDPF algorithm.
   *
   * **Do not hand back broken bytes.** A corrupt font file shows up on screen as a
   * page full of tofu, and by then nobody can trace the root cause back to decoding
   * — so this would rather hand the consumer an error that can state its reason.
   */
  | "unsupported-obfuscation"
  /** This item was obfuscated with the IDPF algorithm, but the book has no unique identifier, so the key cannot be derived. */
  | "missing-obfuscation-key";

/** Taking the bytes of a resource failed. The book is still open. */
export class EpubResourceError extends Error {
  readonly reason: EpubResourceFailure;

  constructor(reason: EpubResourceFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EpubResourceError";
    this.reason = reason;
  }
}
