/**
 * `EpubBook` 這一層的公開面——ADR-0005 雙層切分的下半：純 TypeScript、零 DOM。
 *
 * 消費端只需要這個檔案裡的東西：開書、metadata、readingOrder、封面，以及開不
 * 起來時的錯誤。`container.ts` / `package-document.ts` / `xml.ts` 是實作，不在
 * 公開面上——它們的形狀還會隨著後續幾張票變動。
 */

export { EpubBook } from "./epub-book.ts";
export type {
  BookMetadata,
  CoverImage,
  CoverNotation,
  EpubSource,
  Section,
} from "./epub-book.ts";
export { EpubOpenError } from "./errors.ts";
export type { EpubOpenFailure } from "./errors.ts";
export type { EpubVersion, PageProgressionDirection } from "./package-document.ts";
