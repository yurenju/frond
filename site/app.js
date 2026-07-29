// frond's demo page.
//
// This file is also **a plain-HTML usage example** — no bundler, no transpilation, no
// framework; a `<script type="module">` imports the build output directly. That works
// because frond's shipped module graph contains not one bare specifier, and
// `scripts/finish-build.ts` pins that down at build time.
//
// While reading this file, what is worth noticing is the decisions frond **does not** make:
//
//   - which key turns the page, and whether swiping left is previous or next — here (see `onKeyDown`)
//   - whether activating a link inside the book navigates — here (see `linkactivate`)
//   - whether the table of contents is drawn as a dropdown or a sidebar — here
//
// frond supplies facts (which page we are on, which direction this section laid out in,
// which section that link points at) and leaves policy to the consumer. That is ADR-0002's
// division of labour, and it is why `next()` is an action rather than an event handler.

import { EpubBook } from "./frond/epub/index.js";
import { Renderer } from "./frond/renderer/index.js";
import {
  connectChoiceControl,
  currentBookTheme,
  subscribe,
} from "./theme.js";

const $ = (id) => document.getElementById(id);

/**
 * The reader settings' current values. `undefined` means "not set" — which differs from "set
 * to the book's default".
 *
 * `theme` is the exception on this page: it is never unset, because it is not this toolbar's
 * to set. It mirrors the site's light/dark choice, and `theme.js` explains what that costs.
 */
const settings = {
  fontSize: undefined,
  lineHeight: undefined,
  margin: 24,
  columns: "auto",
  theme: currentBookTheme(),
};

/** The currently open book and renderer. On a book change the old one has to be torn down. */
let book;
let renderer;

// --- opening a book ---------------------------------------------------------

async function openBook(file) {
  $("open-error").hidden = true;

  try {
    // `EpubBook.open()` takes a Blob, an ArrayBuffer or a Uint8Array. A `File` is a `Blob`,
    // so whatever was dragged in can be fed straight through without reading it into bytes.
    book = await EpubBook.open(file);
  } catch (cause) {
    // When it will not open it throws `EpubOpenError` and no instance appears — there is no
    // such thing as a half-opened EpubBook.
    $("open-error").textContent = `This file will not open: ${cause.message}`;
    $("open-error").hidden = false;
    return;
  }

  renderer?.destroy();
  renderer = undefined;

  $("intro").hidden = true;
  $("workspace").hidden = false;
  $("book-title").textContent = book.metadata.title ?? file.name;

  renderInspection(book);
  await attachRenderer();
}

async function attachRenderer() {
  $("render-error").hidden = true;

  try {
    renderer = await Renderer.attach(book, $("viewer"), {
      settings,
      // The listeners are attached **inside** `attach()`, not with an `on()` afterwards.
      //
      // By the time `attach()` returns the first section has already laid out, which means
      // that run's load and relocate have already been emitted — listeners attached
      // afterwards never receive them, and the symptom is "the status bar is empty at first
      // and only correct after turning a page".
      on: {
        relocate: showLocation,
        load: showWritingMode,
        // `attach()` lays out the first section first and then throws the whole-book index
        // into the background, so `indexed` may be emitted before `attach()` returns — at
        // which point the `renderer` below has not been assigned yet. Missing that one is
        // fine: location is read once more after `attach()` returns, and by then the index
        // is built.
        indexed: () => {
          if (renderer !== undefined) showLocation(renderer.location);
        },
        linkactivate: followLink,
        error: showRenderError,
      },
    });
  } catch (cause) {
    $("render-error").textContent = `This book will not render: ${cause.message}`;
    $("render-error").hidden = false;
    return;
  }

  buildToc(book.toc);
  syncControls();
  showLocation(renderer.location);
  showWritingMode({ writingMode: renderer.writingMode });
}

// --- reading ----------------------------------------------------------------

function showLocation(at) {
  $("status-section").textContent = `Section ${at.sectionIndex + 1} / ${
    book.readingOrder.length
  }`;
  $("status-page").textContent = `Page ${at.page + 1} / ${at.pageCount}`;

  // fraction is undefined until the whole-book index is built. Drawing a wrong value is
  // worse than leaving it blank — so this shows "indexing" rather than 0%.
  $("status-fraction").textContent =
    at.fraction === undefined
      ? "Book progress: indexing…"
      : `Book progress ${(at.fraction * 100).toFixed(1)}%`;

  $("status-cfi").textContent = at.cfi;
  $("previous").disabled = at.atStart;
  $("next").disabled = at.atEnd;
}

function showWritingMode(event) {
  const vertical = event.writingMode === "vertical-rl";
  $("status-writing-mode").textContent = vertical ? "Vertical" : "Horizontal";
  // Vertical is always single-column, so the column choice is meaningless then — disabling
  // it beats leaving it looking pressable but inert.
  $("columns").disabled = vertical;
}

function showRenderError(event) {
  $("render-error").textContent = `Section ${event.sectionIndex + 1} (${
    event.sectionPath
  }) will not render: ${event.message}`;
  $("render-error").hidden = false;
}

/**
 * The reader activated a link inside the book.
 *
 * frond prevents the browser's default behaviour (letting the iframe navigate there would
 * throw away the rendering state), but **does not navigate itself** — whether to navigate,
 * and whether an external link opens in a new tab, are decisions for this layer.
 */
function followLink(event) {
  if (event.externalUrl !== undefined) {
    window.open(event.externalUrl, "_blank", "noopener");
    return;
  }
  if (event.sectionIndex === undefined) return;

  renderer.goToSection(
    event.sectionIndex,
    event.fragment === undefined
      ? { kind: "first-page" }
      : { kind: "fragment", id: event.fragment },
  );
}

function buildToc(items) {
  const select = $("toc");
  select.replaceChildren();

  const placeholder = new Option("Contents…", "");
  placeholder.disabled = true;
  placeholder.selected = true;
  select.append(placeholder);

  // The TOC has unlimited depth; this flattens it to one level and expresses the hierarchy
  // with indentation — how it is drawn is this layer's business.
  const flatten = (nodes, depth) => {
    for (const item of nodes) {
      // Skip entries pointing at something remote or outside the package: neither is "a
      // position inside this book".
      if (item.target.kind === "in-container") {
        const option = new Option(
          `${"　".repeat(depth)}${item.label}`,
          JSON.stringify({
            path: item.target.path,
            fragment: item.target.fragment,
          }),
        );
        select.append(option);
      }
      flatten(item.children, depth + 1);
    }
  };
  flatten(items, 0);

  select.disabled = select.options.length <= 1;
}

// --- reader settings --------------------------------------------------------

function syncControls() {
  $("font-size").value = settings.fontSize ?? 18;
  $("line-height").value = settings.lineHeight ?? 1.8;
  $("margin").value = settings.margin;
  $("columns").value = String(settings.columns);
}

async function apply(patch) {
  Object.assign(settings, patch);
  await renderer?.applySettings(patch);
}

// --- events -----------------------------------------------------------------

for (const input of [$("file-input"), $("file-input-again")]) {
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file !== undefined) void openBook(file);
    input.value = "";
  });
}

// Drag and drop. The whole window is the drop target, not just that box — dragging a book
// slightly outside the box and getting no response is the most common frustration with this
// kind of page.
for (const type of ["dragenter", "dragover"]) {
  window.addEventListener(type, (event) => {
    event.preventDefault();
    $("dropzone").classList.add("is-hovered");
  });
}
window.addEventListener("dragleave", (event) => {
  if (event.relatedTarget === null) $("dropzone").classList.remove("is-hovered");
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  $("dropzone").classList.remove("is-hovered");
  const file = event.dataTransfer?.files?.[0];
  if (file !== undefined) void openBook(file);
});

$("next").addEventListener("click", () => void renderer?.next());
$("previous").addEventListener("click", () => void renderer?.previous());

$("toc").addEventListener("change", (event) => {
  const target = JSON.parse(event.target.value);
  void renderer?.goTo(target);
});

$("font-size").addEventListener("input", (event) =>
  apply({ fontSize: Number(event.target.value) }),
);
$("line-height").addEventListener("input", (event) =>
  apply({ lineHeight: Number(event.target.value) }),
);
$("margin").addEventListener("input", (event) =>
  apply({ margin: Number(event.target.value) }),
);
$("columns").addEventListener("change", (event) =>
  apply({
    columns: event.target.value === "auto" ? "auto" : Number(event.target.value),
  }),
);

$("reset-settings").addEventListener("click", () =>
  // Each item is set back to undefined rather than to some "default value". For an unset
  // field frond overrides not one character and the book's own declarations stand untouched
  // — those are two different states in frond.
  //
  // `theme` is deliberately not in the list. It is the site's answer, not a reader setting
  // made here, and clearing it would leave a white book on a dark page — which is the state
  // this button exists to get *out* of, not into.
  apply({
    fontSize: undefined,
    lineHeight: undefined,
    columns: "auto",
    margin: 24,
  }).then(syncControls),
);

/**
 * Keyboard page turning.
 *
 * **Which arrow key counts as "next page" is this layer's decision**, and frond does not
 * touch it. The criterion used is the page progression direction the book declares: in an
 * rtl book (vertical Chinese and Japanese books, horizontal books in RTL languages) leftward
 * is forward. frond only reports the `pageProgressionDirection` fact.
 */
function onKeyDown(event) {
  if (renderer === undefined) return;
  if (event.target instanceof HTMLInputElement) return;
  if (event.target instanceof HTMLSelectElement) return;

  const rtl = book.metadata.pageProgressionDirection === "rtl";

  if (event.key === "ArrowRight") {
    void (rtl ? renderer.previous() : renderer.next());
  } else if (event.key === "ArrowLeft") {
    void (rtl ? renderer.next() : renderer.previous());
  } else if (event.key === "ArrowDown" || event.key === "PageDown") {
    void renderer.next();
  } else if (event.key === "ArrowUp" || event.key === "PageUp") {
    void renderer.previous();
  } else {
    return;
  }

  event.preventDefault();
}

window.addEventListener("keydown", onKeyDown);

// --- the site's theme -------------------------------------------------------
//
// One switch, in the masthead, for the whole site. Everything outside the book is CSS and
// never reaches this file; the book is the exception, because it renders in an iframe and the
// page's stylesheet stops at its edge. So this is where the two sides are joined — the same
// choice, handed to frond as colours.
//
// The subscription covers both halves of "the choice changed": the reader picking from the
// control, and the operating system flipping underneath a reader who picked "System".

connectChoiceControl($("theme-choice"));

subscribe(() => {
  void apply({ theme: currentBookTheme() });
});

// --- panel switching --------------------------------------------------------

function showPanel(which) {
  const reading = which === "read";
  $("panel-read").hidden = !reading;
  $("panel-inspect").hidden = reading;
  $("tab-read").setAttribute("aria-selected", String(reading));
  $("tab-inspect").setAttribute("aria-selected", String(!reading));
  // An iframe cannot be measured while hidden, so switching back requires a re-layout.
  if (reading) void renderer?.resize();
}

$("tab-read").addEventListener("click", () => showPanel("read"));
$("tab-inspect").addEventListener("click", () => showPanel("inspect"));

// --- inspection -------------------------------------------------------------
//
// This whole section uses nothing but `EpubBook`, with not one line of DOM rendering code
// involved (ADR-0005's two-layer split: this layer has zero DOM dependency and runs in Node
// too). What it answers is "what did frond read from this book" — the first thing anyone
// wants to know when evaluating whether a library holds up against their own set of books.

function renderInspection(book) {
  const missing = book.resources.filter((r) => r.location.kind === "missing");
  const remote = book.resources.filter((r) => r.location.kind === "remote");

  const rows = [
    ["Title", book.metadata.title ?? "— (the book did not declare one)"],
    ["Authors", book.metadata.authors.join(", ") || "— (the book did not declare any)"],
    ["Language", book.metadata.language ?? "— (the book did not declare one)"],
    ["Identifier", book.metadata.identifier ?? "— (the book did not declare one)"],
    ["EPUB version", book.metadata.epubVersion === "epub3" ? "EPUB 3" : "EPUB 2"],
    [
      "Page progression direction",
      // "The book did not say" and "declared as ltr" are two different things. EPUB 2 always
      // lands in the former — that version has no such attribute at all, and filling in a
      // default would leave the consumer unable to tell the two apart (ADR-0010).
      book.metadata.pageProgressionDirection ??
        "— (the book did not say. EPUB 2 has no such attribute)",
    ],
    ["readingOrder", `${book.readingOrder.length} sections`],
    [
      "Non-linear sections",
      // frond does not filter out linear=false sections (cover pages, copyright pages) —
      // filtering them is policy, not fact.
      `${book.readingOrder.filter((s) => !s.linear).length} (frond does not filter them out)`,
    ],
    [
      "Navigation document",
      book.navigationDocument === undefined
        ? "— (there is none. That is not an error)"
        : `${
            book.navigationDocument.vehicle === "nav"
              ? "nav.xhtml (EPUB 3)"
              : "toc.ncx (EPUB 2)"
          } — ${book.navigationDocument.path}`,
    ],
    ["TOC entries", `${countToc(book.toc)} entries, ${depthOfToc(book.toc)} levels deep`],
    [
      "Cover",
      book.cover === undefined
        ? "— (neither notation declares one. That is not an error)"
        : `${book.cover.path} (${book.cover.mediaType}), found by ${
            book.cover.foundBy === "cover-image-property"
              ? 'properties="cover-image"'
              : '<meta name="cover">'
          }`,
    ],
    ["Resources declared in the manifest", `${book.resources.length}`],
    [
      "Declared but not in the package",
      missing.length === 0
        ? "0"
        : `${missing.length} — ${missing
            .map((r) => r.location.path)
            .join(", ")}`,
    ],
    [
      "Remote resources",
      remote.length === 0 ? "0" : `${remote.length} (frond does not download them)`,
    ],
  ];

  const table = document.createElement("dl");
  table.className = "facts";
  for (const [term, value] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = term;
    const dd = document.createElement("dd");
    dd.textContent = value;
    table.append(dt, dd);
  }

  const heading = document.createElement("p");
  heading.className = "note";
  heading.textContent =
    "Everything below uses nothing but EpubBook — this layer has zero DOM dependency, and the same code produces the same answers in Node.";

  const cover = document.createElement("div");
  if (book.cover !== undefined) {
    const image = document.createElement("img");
    image.className = "cover";
    image.alt = "Cover";
    image.src = URL.createObjectURL(
      new Blob([book.cover.bytes], { type: book.cover.mediaType }),
    );
    cover.append(image);
  }

  $("inspect").replaceChildren(heading, cover, table);
}

const countToc = (items) =>
  items.reduce((total, item) => total + 1 + countToc(item.children), 0);

const depthOfToc = (items) =>
  items.length === 0
    ? 0
    : 1 + Math.max(...items.map((item) => depthOfToc(item.children)));
