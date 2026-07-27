// frond 的展示頁。
//
// 這個檔案同時是**純 HTML 的使用範例**——沒有打包器、沒有轉譯、沒有框架，
// `<script type="module">` 直接 import 建置產物。frond 出貨的模組圖裡一個 bare
// specifier 都沒有，所以這件事成立；`scripts/finish-build.ts` 會在建置時把它釘住。
//
// 讀這個檔案的時候，值得注意的是 frond **不做**的那些決定：
//
//   - 翻頁綁哪個按鍵、往左滑算上一頁還是下一頁 —— 在這裡（見 `onKeyDown`）
//   - 點了書裡的連結要不要跳過去 —— 在這裡（見 `linkactivate`）
//   - 目錄要畫成下拉還是側欄 —— 在這裡
//
// frond 給的是事實（現在在第幾頁、這一節排成什麼方向、那個連結指向哪一節），
// 政策留給消費端。這是 ADR-0002 的分工，也是為什麼 `next()` 是一個動作而不是
// 一個事件處理器。

import { EpubBook } from "./frond/epub/index.js";
import { Renderer } from "./frond/renderer/index.js";

const $ = (id) => document.getElementById(id);

/** 讀者設定的目前值。`undefined` 表示「沒設」——那與「設成書的預設值」不同。 */
const settings = {
  fontSize: undefined,
  lineHeight: undefined,
  margin: 24,
  columns: "auto",
  theme: undefined,
};

const THEMES = {
  book: undefined,
  light: { foreground: "#1a1a1a", background: "#ffffff" },
  sepia: { foreground: "#3b3229", background: "#f4ecd8" },
  dark: { foreground: "#d6d6d6", background: "#16181c" },
};

/** 目前開著的書與 renderer。換書時舊的要收掉。 */
let book;
let renderer;

// --- 開書 -------------------------------------------------------------------

async function openBook(file) {
  $("open-error").hidden = true;

  try {
    // `EpubBook.open()` 收 Blob、ArrayBuffer 或 Uint8Array。`File` 是 `Blob`，
    // 所以拖進來的東西可以直接餵進去，不必自己讀成位元組。
    book = await EpubBook.open(file);
  } catch (cause) {
    // 開不起來時丟 `EpubOpenError`，實例不會出現——不存在一個半開的 EpubBook。
    $("open-error").textContent = `這個檔案開不起來：${cause.message}`;
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
      // listener 掛在 `attach()` **裡面**，不是事後 `on()`。
      //
      // `attach()` 回傳的時候第一節已經排好了，也就是說那一次的 load 與
      // relocate 已經送出去了——事後才掛的 listener 收不到它們，而症狀是
      // 「狀態列一開始是空的，翻一頁之後才正常」。
      on: {
        relocate: showLocation,
        load: showWritingMode,
        // `attach()` 是先排好第一節、再把整書索引丟到背景去建的，所以 `indexed`
        // 有可能在 `attach()` 回傳之前就送出來——那時候下面的 `renderer` 還沒被
        // 指派。漏掉這一次沒關係：`attach()` 回傳之後還會再讀一次 location，而
        // 那時候索引已經建好了。
        indexed: () => {
          if (renderer !== undefined) showLocation(renderer.location);
        },
        linkactivate: followLink,
        error: showRenderError,
      },
    });
  } catch (cause) {
    $("render-error").textContent = `這本書排不出來：${cause.message}`;
    $("render-error").hidden = false;
    return;
  }

  buildToc(book.toc);
  syncControls();
  showLocation(renderer.location);
  showWritingMode({ writingMode: renderer.writingMode });
}

// --- 讀 ---------------------------------------------------------------------

function showLocation(at) {
  $("status-section").textContent = `第 ${at.sectionIndex + 1} / ${
    book.readingOrder.length
  } 節`;
  $("status-page").textContent = `第 ${at.page + 1} / ${at.pageCount} 頁`;

  // 整書索引建好之前 fraction 是 undefined。拿一個錯的值畫上去比留白更糟——
  // 所以這裡顯示「索引中」而不是 0%。
  $("status-fraction").textContent =
    at.fraction === undefined
      ? "全書進度：索引中…"
      : `全書進度 ${(at.fraction * 100).toFixed(1)}%`;

  $("status-cfi").textContent = at.cfi;
  $("previous").disabled = at.atStart;
  $("next").disabled = at.atEnd;
}

function showWritingMode(event) {
  const vertical = event.writingMode === "vertical-rl";
  $("status-writing-mode").textContent = vertical ? "直排" : "橫排";
  // 直排一律單欄，欄數的選擇在那時候沒有意義——停用它比讓它看起來可按但沒反應好。
  $("columns").disabled = vertical;
}

function showRenderError(event) {
  $("render-error").textContent = `第 ${event.sectionIndex + 1} 節（${
    event.sectionPath
  }）排不出來：${event.message}`;
  $("render-error").hidden = false;
}

/**
 * 讀者點了書裡的一個連結。
 *
 * frond 擋下瀏覽器的預設行為（讓 iframe 自己導航過去會把渲染狀態丟掉），但
 * **不自己跳**——跳不跳、外部連結要不要開新分頁，都是這一層的決定。
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

  const placeholder = new Option("目錄…", "");
  placeholder.disabled = true;
  placeholder.selected = true;
  select.append(placeholder);

  // TOC 的深度不限，這裡壓平成一層並用縮排表示層次——畫成什麼樣子是這一層的事。
  const flatten = (nodes, depth) => {
    for (const item of nodes) {
      // 指到遠端或指到封裝外的項目跳過：那兩種都不是「這本書裡的一個位置」。
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

// --- 讀者設定 ---------------------------------------------------------------

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

// --- 事件 -------------------------------------------------------------------

for (const input of [$("file-input"), $("file-input-again")]) {
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file !== undefined) void openBook(file);
    input.value = "";
  });
}

// 拖曳。整個視窗都是放置目標，不只那個框——把書拖到框外一點點就沒反應，是這種
// 頁面最常見的挫折。
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
$("theme").addEventListener("change", (event) =>
  apply({ theme: THEMES[event.target.value] }),
);

$("reset-settings").addEventListener("click", () =>
  // 每一項設回 undefined，而不是設回某個「預設值」。沒設的欄位 frond 一個字都
  // 不覆寫，書自己的宣告原封不動——這兩件事在 frond 是不同的狀態。
  apply({
    fontSize: undefined,
    lineHeight: undefined,
    theme: undefined,
    columns: "auto",
    margin: 24,
  }).then(() => {
    $("theme").value = "book";
    syncControls();
  }),
);

/**
 * 鍵盤翻頁。
 *
 * **哪個方向鍵算「下一頁」是這一層的決定**，frond 不碰它。判準用的是書宣告的
 * 頁面推進方向：rtl 的書（直排中日文書、RTL 語言的橫排書）往左是往前。
 * frond 只回報 `pageProgressionDirection` 這個事實。
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

// --- 分頁切換 ---------------------------------------------------------------

function showPanel(which) {
  const reading = which === "read";
  $("panel-read").hidden = !reading;
  $("panel-inspect").hidden = reading;
  $("tab-read").setAttribute("aria-selected", String(reading));
  $("tab-inspect").setAttribute("aria-selected", String(!reading));
  // iframe 在隱藏的時候量不到尺寸，切回來要重排一次。
  if (reading) void renderer?.resize();
}

$("tab-read").addEventListener("click", () => showPanel("read"));
$("tab-inspect").addEventListener("click", () => showPanel("inspect"));

// --- 檢查 -------------------------------------------------------------------
//
// 這一整段只用到 `EpubBook`，一行 DOM 渲染的程式碼都沒有牽涉進來（ADR-0005 的
// 雙層切分：這一層零 DOM 依賴，在 Node 裡也跑得動）。它回答的是「frond 從這本
// 書讀到了什麼」——那是評估一個函式庫撐不撐得住自己那批書時，最先想知道的事。

function renderInspection(book) {
  const missing = book.resources.filter((r) => r.location.kind === "missing");
  const remote = book.resources.filter((r) => r.location.kind === "remote");

  const rows = [
    ["書名", book.metadata.title ?? "—（書沒宣告）"],
    ["作者", book.metadata.authors.join("、") || "—（書沒宣告）"],
    ["語言", book.metadata.language ?? "—（書沒宣告）"],
    ["識別碼", book.metadata.identifier ?? "—（書沒宣告）"],
    ["EPUB 版本", book.metadata.epubVersion === "epub3" ? "EPUB 3" : "EPUB 2"],
    [
      "頁面推進方向",
      // 「書沒說」與「宣告成 ltr」是兩件事。EPUB 2 一律落在前者——那個版本根本
      // 沒有這個屬性，而把它補成預設值會讓消費端分不出兩者（ADR-0010）。
      book.metadata.pageProgressionDirection ??
        "—（書沒說。EPUB 2 沒有這個屬性）",
    ],
    ["readingOrder", `${book.readingOrder.length} 節`],
    [
      "非線性的節",
      // linear=false 的節（封面頁、版權頁）frond 不濾掉——濾掉是政策不是事實。
      `${book.readingOrder.filter((s) => !s.linear).length} 節（frond 不濾掉它們）`,
    ],
    [
      "導覽文件",
      book.navigationDocument === undefined
        ? "—（一份都沒有。那不是錯誤）"
        : `${
            book.navigationDocument.vehicle === "nav"
              ? "nav.xhtml（EPUB 3）"
              : "toc.ncx（EPUB 2）"
          } — ${book.navigationDocument.path}`,
    ],
    ["目錄項目", `${countToc(book.toc)} 項，最深 ${depthOfToc(book.toc)} 層`],
    [
      "封面",
      book.cover === undefined
        ? "—（兩種宣告寫法都找不到。那不是錯誤）"
        : `${book.cover.path}（${book.cover.mediaType}），由 ${
            book.cover.foundBy === "cover-image-property"
              ? 'properties="cover-image"'
              : '<meta name="cover">'
          } 找到`,
    ],
    ["manifest 宣告的資源", `${book.resources.length} 項`],
    [
      "書宣告了但不在包裡",
      missing.length === 0
        ? "0 項"
        : `${missing.length} 項 — ${missing
            .map((r) => r.location.path)
            .join("、")}`,
    ],
    [
      "遠端資源",
      remote.length === 0 ? "0 項" : `${remote.length} 項（frond 不下載它們）`,
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
    "以下全部只用到 EpubBook——這一層零 DOM 依賴，同一段程式碼在 Node 裡也跑得出同樣的答案。";

  const cover = document.createElement("div");
  if (book.cover !== undefined) {
    const image = document.createElement("img");
    image.className = "cover";
    image.alt = "封面";
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
