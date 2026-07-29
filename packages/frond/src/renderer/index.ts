/**
 * The public face of the `Renderer` layer — the upper half of ADR-0005's two-layer
 * split: it needs the DOM.
 *
 * Consumers only need what is in this file: mounting a book on a container, turning
 * pages, jumping to a position, changing reader settings, receiving events.
 * `section-view.ts` / `document-source.ts` / `cfi-dom.ts` / `layout.ts` are
 * implementation and are not on the public face.
 *
 * `MemoryBook` is here, and deliberately so: ADR-0002 explicitly requires frond to
 * **provide its own fake / in-memory implementation and treat it as part of the public
 * API** — a layer above testing a pure decision module such as a Navigator should not
 * be forced to build its own doubles.
 *
 * The intervention list (`INTERVENTIONS`) is on the public face too. Which parts of a
 * book frond touched is a fact the consumer has a right to know, not an implementation
 * detail (ADR-0003).
 */

export { Renderer } from "./renderer.ts";
export type {
  RendererListeners,
  RendererOptions,
  RendererStart,
  SectionAnchor,
  SectionAt,
} from "./renderer.ts";

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
  LayoutEvent,
  LinkActivateEvent,
  Listener,
  RenderLocation,
  RendererErrorEvent,
  RendererEvents,
  RendererFailure,
  RendererKeyEvent,
  RendererPointerEvent,
  SectionLoadEvent,
  SelectionEvent,
  Unsubscribe,
} from "./events.ts";

export { DEFAULT_SETTINGS, withSettings } from "./settings.ts";
export type { ReaderSettings, Theme } from "./settings.ts";

export type { ColumnChoice, Insets, Margin, WritingMode } from "./geometry.ts";

export { INTERVENTIONS } from "./interventions.ts";
export type { Intervention, InterventionReason } from "./interventions.ts";

export { SectionParseError } from "./document-source.ts";
export { WritingModeUnreadableError } from "./section-view.ts";
