/**
 * The public face of the `EpubBook` layer — the lower half of ADR-0005's two-layer
 * split: pure TypeScript, zero DOM.
 *
 * Consumers only need what is in this file: opening a book, metadata, readingOrder,
 * the cover, and the errors raised when it will not open. `container.ts` /
 * `package-document.ts` / `xml.ts` are implementation and are not on the public
 * face — their shape will still move over the next few issues.
 */

export { EpubBook } from "./epub-book.ts";
export type { EpubSource, Section } from "./epub-book.ts";
export type { CoverImage, CoverNotation } from "./cover.ts";
export type {
  NavigationDocument,
  NavigationVehicle,
  TocItem,
} from "./toc.ts";
// Where a TOC item points is expressed with it, so the parser's product type is on
// the public face (`toc.ts`'s `TocItem.target`).
export type { ResolvedHref } from "./resource-path.ts";
export { compareCfi, parseCfi, serializeCfi, CfiParseError } from "./cfi.ts";
export type {
  Cfi,
  CfiAssertion,
  CfiComparison,
  CfiOffset,
  CfiParameter,
  CfiParseFailure,
  CfiPath,
  CfiPoint,
  CfiRange,
  CfiSegment,
  CfiStep,
} from "./cfi.ts";
// Reading one section as text, and pointing back into it, with no browser in sight. The
// `Renderer` half of ADR-0005 answers the same two questions for a document it has actually
// laid out; this answers them from the bytes, which is the only option a consumer outside a
// browser has.
export { ContentDocument } from "./content-document.ts";
export type { TextRange } from "./content-document.ts";
// Which section a CFI belongs to — the question that comes **before** `ContentDocument`,
// since parsing one means knowing which one to parse. A consumer holding a stored CFI (a
// reading position, an annotation's anchor) has only the string, and the alternative to this
// is reading `/6/N` out of the parsed structure by hand — which is this function's body,
// written again on the far side of the package boundary and pinned to a step layout that is
// this layer's to know.
export { sectionIndexOf } from "./cfi-tree.ts";
export { EpubOpenError, EpubResourceError } from "./errors.ts";
export type { EpubOpenFailure, EpubResourceFailure } from "./errors.ts";
export type { Resource, ResourceLocation } from "./resources.ts";
export type {
  BookMetadata,
  EpubVersion,
  PageProgressionDirection,
} from "./package-document.ts";
