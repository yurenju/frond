/**
 * `Renderer` 這一層的公開面——ADR-0005 雙層切分的上半：需要 DOM。
 *
 * 消費端只需要這個檔案裡的東西：把書掛到容器上、翻頁、跳位置、換讀者設定、收事件。
 * `section-view.ts` / `document-source.ts` / `cfi-dom.ts` / `layout.ts` 是實作，
 * 不在公開面上。
 *
 * `MemoryBook` 在這裡，而且是刻意的：ADR-0002 明列 frond **必須自己提供 fake /
 * in-memory 實作，並視為公開 API 的一部分**——上層測試 Navigator 那類純決策模組
 * 時，不該被迫自己造假物。
 *
 * 介入清單（`INTERVENTIONS`）也在公開面上。frond 動了書的哪幾處是消費端有權知道
 * 的事實，而不是實作細節（ADR-0003）。
 */

export { Renderer } from "./renderer.ts";
export type { RendererOptions, SectionAnchor } from "./renderer.ts";

export { MemoryBook } from "./book.ts";
export type {
  MemoryBookSpec,
  MemoryResourceSpec,
  MemorySectionSpec,
  RenderableBook,
  RenderableLocation,
  RenderableResource,
  RenderableSection,
} from "./book.ts";

export type {
  IndexedEvent,
  LinkActivateEvent,
  Listener,
  RenderLocation,
  RendererErrorEvent,
  RendererEvents,
  RendererFailure,
  SectionLoadEvent,
  SelectionEvent,
  Unsubscribe,
} from "./events.ts";

export { DEFAULT_SETTINGS, withSettings } from "./settings.ts";
export type { ReaderSettings, Theme } from "./settings.ts";

export type { ColumnChoice, WritingMode } from "./geometry.ts";

export { INTERVENTIONS } from "./interventions.ts";
export type { Intervention, InterventionReason } from "./interventions.ts";

export { SectionParseError } from "./document-source.ts";
export { WritingModeUnreadableError } from "./section-view.ts";
