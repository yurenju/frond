/**
 * `EpubBook` 這一層的公開面——ADR-0005 雙層切分的下半：純 TypeScript、零 DOM。
 *
 * 消費端只需要這個檔案裡的東西：開書、metadata、readingOrder、封面，以及開不
 * 起來時的錯誤。`container.ts` / `package-document.ts` / `xml.ts` 是實作，不在
 * 公開面上——它們的形狀還會隨著後續幾張票變動。
 */

export { EpubBook } from "./epub-book.ts";
export type { EpubSource, Section } from "./epub-book.ts";
export type { CoverImage, CoverNotation } from "./cover.ts";
export type {
  NavigationDocument,
  NavigationVehicle,
  TocItem,
} from "./toc.ts";
// TOC 項目指向哪裡是用它表達的，所以解析器的產物型別在公開面上（`toc.ts` 的
// `TocItem.target`）。
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
export { EpubOpenError, EpubResourceError } from "./errors.ts";
export type { EpubOpenFailure, EpubResourceFailure } from "./errors.ts";
export type { Resource, ResourceLocation } from "./resources.ts";
export type {
  BookMetadata,
  EpubVersion,
  PageProgressionDirection,
} from "./package-document.ts";
