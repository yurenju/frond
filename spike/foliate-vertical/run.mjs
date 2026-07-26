// foliate-js 直排 spike 的驅動程式（issue #7）。
//
// 在 frond 的測試映像內把 foliate-js 用直排 fixture 跑過三家瀏覽器，量下數字與
// 截圖。**這不是 frond 的測試**：它不在 playwright.config.ts 的 testDir 內、
// CI 不跑它，而且 foliate-js 不進 repo、不進 dependency（ADR-0001）。
//
// 用法與前置條件見同目錄的 README.md。量到的結論在 docs/browser-quirks.md。

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "@playwright/test";
import { PNG } from "pngjs";

const SPIKE_DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(SPIKE_DIR, "out");
const PORT = 8731;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".epub": "application/epub+zip",
  ".json": "application/json",
  ".png": "image/png",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  const file = path.join(SPIKE_DIR, rel || "harness.html");
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const INK_THRESHOLD = 200;
function analyseInk(buffer) {
  const { width, height, data } = PNG.sync.read(buffer);
  let n = 0, sx = 0, sy = 0;
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const o = (y * width + x) * 4;
      if (data[o + 3] === 0) continue;
      const lum = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
      if (lum >= INK_THRESHOLD) continue;
      n += 1; sx += x; sy += y;
    }
  return {
    pixelCount: n,
    centroid: n === 0 ? null : { x: +(sx / n / width).toFixed(3), y: +(sy / n / height).toFixed(3) },
    box: { width, height },
  };
}

// --- 在頁面內跑的量測 ------------------------------------------------------

const measureLayout = () => {
  const view = window.__spike.view;
  const r = view.renderer;
  const { doc } = r.getContents()[0];
  const win = doc.defaultView;
  const cs = win.getComputedStyle(doc.documentElement);
  const bodyCs = win.getComputedStyle(doc.body);

  // 每個字元的矩形，用來判定行進軸與行的推進方向。刻意不讀 computed style：
  // computed style 會老實回報 vertical-rl 而畫面仍可能是橫的。
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const rects = [];
  for (let node = walker.nextNode(); node && rects.length < 300; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text.trim()) continue;
    for (let i = 0; i < text.length && rects.length < 300; i += 1) {
      const range = doc.createRange();
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const b = range.getBoundingClientRect();
      if (b.width === 0 && b.height === 0) continue;
      rects.push({ ch: text[i], left: +b.left.toFixed(1), top: +b.top.toFixed(1),
        width: +b.width.toFixed(1), height: +b.height.toFixed(1) });
    }
  }
  // 第一個 <p> 的字（跳過 h1，字級不同）
  const bodyText = rects;
  const first = bodyText[0];
  const second = bodyText[1];
  const wrapped = bodyText.find((x) => x.left < first.left - 1) ?? null;
  const wrappedDown = bodyText.find((x) => x.top > first.top + 1) ?? null;

  return {
    writingModeHtml: cs.writingMode,
    writingModeBody: bodyCs.writingMode,
    // foliate 用 !important 直接寫進 documentElement 的 inline style
    docElInlineStyle: doc.documentElement.getAttribute("style"),
    columnWidth: cs.columnWidth,
    columnGap: cs.columnGap,
    pages: r.pages,
    page: r.page,
    size: r.size,
    viewSize: r.viewSize,
    charAdvance: { dx: +(second.left - first.left).toFixed(1), dy: +(second.top - first.top).toFixed(1) },
    lineAdvance: wrapped
      ? { dx: +(wrapped.left - first.left).toFixed(1), ch: wrapped.ch }
      : null,
    lineAdvanceDown: wrappedDown
      ? { dy: +(wrappedDown.top - first.top).toFixed(1), ch: wrappedDown.ch }
      : null,
    firstChars: bodyText.slice(0, 4),
    fraction: view.lastLocation?.fraction ?? null,
    cfi: view.lastLocation?.cfi ?? null,
    sections: view.book.sections.length,
  };
};

const roundTrip = async () => {
  const view = window.__spike.view;
  const startCfi = view.lastLocation.cfi;
  const startFraction = view.lastLocation.fraction;
  const seen = [startCfi];
  let steps = 0;
  for (; steps < 60; steps += 1) {
    const before = view.lastLocation.cfi;
    await view.next();
    if (view.lastLocation.cfi === before) break;
    seen.push(view.lastLocation.cfi);
  }
  const endCfi = view.lastLocation.cfi;
  const endFraction = view.lastLocation.fraction;
  for (let i = 0; i < steps; i += 1) await view.prev();
  return {
    forwardSteps: steps,
    distinctPositions: new Set(seen).size,
    startCfi,
    endCfi,
    backCfi: view.lastLocation.cfi,
    roundTripIdentical: view.lastLocation.cfi === startCfi,
    startFraction,
    endFraction,
    backFraction: view.lastLocation.fraction,
  };
};

// 把第一個「。」捲進畫面，回傳它在 top document 座標系裡的矩形。
const showFullStop = async () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const i = node.nodeValue.indexOf("。");
    if (i < 0) continue;
    const range = doc.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    await view.renderer.scrollToAnchor(range);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const b = range.getBoundingClientRect();
    const frame = doc.defaultView.frameElement.getBoundingClientRect();
    const cs = doc.defaultView.getComputedStyle(node.parentElement);
    // 三家給的 range rect 在行框方向上寬度不同（Chromium/WebKit 92px、
    // Firefox 64px），直接拿來當截圖框的話重心不可比。統一裁成以字元中心為
    // 中心、邊長等於字級的方框——那正是字面方框。
    const em = parseFloat(cs.fontSize);
    const cx = frame.x + b.x + b.width / 2;
    const cy = frame.y + b.y + b.height / 2;
    return {
      rect: { x: Math.round(cx - em / 2), y: Math.round(cy - em / 2), width: em, height: em },
      rawRect: { width: +b.width.toFixed(2), height: +b.height.toFixed(2) },
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
    };
  }
  return null;
};

// --- 針對登記表個別條目的探針 ----------------------------------------------

// Firefox 的 getBoundingClientRect 漏掉零寬非零高的 rect（foliate paginator.js
// L79-92 的註解）。在 foliate 已分欄的真實文件上掃每一個文字節點的 range，
// 比對 getBoundingClientRect() 與 getClientRects() 的聯集。
const probeBoundingRect = () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  let checked = 0, mismatches = 0, worst = null, zeroWidthSeen = 0;
  const LIMIT = 200000;
  for (let node = walker.nextNode(); node && checked < LIMIT; node = walker.nextNode()) {
    const text = node.nodeValue;
    if (!text.trim()) continue;
    for (let start = 0; start < text.length && checked < LIMIT; start += 1)
      for (let end = start + 1; end <= Math.min(text.length, start + 40); end += 1) {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const list = Array.from(range.getClientRects());
        if (!list.length) continue;
        let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
        let zeroWidth = 0;
        for (const rect of list) {
          if (rect.width === 0 && rect.height !== 0) { zeroWidth += 1; zeroWidthSeen += 1; }
          l = Math.min(l, rect.left); t = Math.min(t, rect.top);
          r = Math.max(r, rect.right); b = Math.max(b, rect.bottom);
        }
        const bb = range.getBoundingClientRect();
        checked += 1;
        const d = Math.max(Math.abs(bb.left - l), Math.abs(bb.top - t),
          Math.abs(bb.right - r), Math.abs(bb.bottom - b));
        if (d > 0.5) {
          mismatches += 1;
          if (!worst || d > worst.delta)
            worst = { delta: +d.toFixed(2), text: text.slice(start, end),
              zeroWidthRects: zeroWidth, rectCount: list.length,
              bounding: { left: +bb.left.toFixed(1), top: +bb.top.toFixed(1),
                right: +bb.right.toFixed(1), bottom: +bb.bottom.toFixed(1) },
              union: { left: +l.toFixed(1), top: +t.toFixed(1),
                right: +r.toFixed(1), bottom: +b.toFixed(1) } };
        }
      }
  }
  // zeroWidthRectsSeen 是這個探針的前提條件：等於 0 的話，不是「Firefox 沒有
  // 這個 bug」，而是「這份文件沒有製造出零寬非零高的 rect」，探針根本沒踩到。
  return { rangesChecked: checked, mismatches, zeroWidthRectsSeen: zeroWidthSeen, worst };
};

// foliate 在 expand() 裡對「頁首的分欄斷點造成的位移」做的補償
// （paginator.js L369-372：「seem to be supported only by WebKit and only for
// horizontal writing」）。從外面把同一個算式重算一次。
const probeContentStart = () => {
  const view = window.__spike.view;
  const r = view.renderer;
  const { doc } = r.getContents()[0];
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  const content = range.getBoundingClientRect();
  const root = doc.documentElement.getBoundingClientRect();
  return {
    horizontalContentStart: +(content.left - root.left).toFixed(2),
    verticalContentStart: +(content.top - root.top).toFixed(2),
    rootLeft: +root.left.toFixed(2),
    contentLeft: +content.left.toFixed(2),
    pages: r.pages,
    viewSize: r.viewSize,
    size: r.size,
  };
};

// 內容在 block 軸上的總長，以及每個區塊元素的尺寸。頁數 = ceil(內容長 / 頁長)，
// 所以三家頁數不同時，差在哪一個區塊上要看得出來。
const probeContentExtent = () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const win = doc.defaultView;
  const range = doc.createRange();
  range.selectNodeContents(doc.body);
  const cr = range.getBoundingClientRect();
  return {
    contentWidth: +cr.width.toFixed(2),
    contentHeight: +cr.height.toFixed(2),
    children: Array.from(doc.body.children).map((el) => {
      const b = el.getBoundingClientRect();
      const cs = win.getComputedStyle(el);
      return { tag: el.tagName, width: +b.width.toFixed(2), height: +b.height.toFixed(2),
        fontSize: cs.fontSize, lineHeight: cs.lineHeight };
    }),
  };
};

// foliate 對 WebKit 字符裁切的繞法是無條件寫進 documentElement 的
// `-webkit-line-box-contain: block glyphs replaced`（paginator.js L330-331）。
// 介入實驗：把那條宣告拿掉再量一次，看行框與內容總長會不會動。
const probeLineBoxContain = () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const de = doc.documentElement;
  const prop = "-webkit-line-box-contain";
  const measure = () => {
    const range = doc.createRange();
    range.selectNodeContents(doc.body);
    const cr = range.getBoundingClientRect();
    const h1 = doc.body.querySelector("h1").getBoundingClientRect();
    return { h1Width: +h1.width.toFixed(2), contentHeight: +cr.height.toFixed(2) };
  };
  const declaration = de.style.getPropertyValue(prop);
  const withRule = measure();
  de.style.removeProperty(prop);
  const withoutRule = measure();
  if (declaration) de.style.setProperty(prop, declaration, "important");
  return {
    declarationSurvived: declaration || null,
    withRule,
    withoutRule,
    changed: withRule.h1Width !== withoutRule.h1Width
      || withRule.contentHeight !== withoutRule.contentHeight,
  };
};

// Firefox 的 ResizeObserver 在這個場景失效（foliate paginator.js L275-278，
// 引 bugzilla 1832939）。在 foliate 自己觀察的那個 body 上再掛一個，然後真的
// 改變內容尺寸，看回呼有沒有第二次。
const probeResizeObserver = async () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const win = doc.defaultView;
  let fired = 0;
  const observer = new win.ResizeObserver(() => { fired += 1; });
  observer.observe(doc.body);
  await new Promise((r) => setTimeout(r, 200));
  const initial = fired;
  const extra = doc.createElement("p");
  extra.textContent = "あ".repeat(400);
  doc.body.append(extra);
  await new Promise((r) => setTimeout(r, 400));
  const afterGrow = fired;
  extra.remove();
  await new Promise((r) => setTimeout(r, 400));
  const afterShrink = fired;
  observer.disconnect();
  return { initialCallbacks: initial, afterGrow, afterShrink,
    firesOnResize: afterGrow > initial };
};

// WebKit bug 218086：sandbox 少了 allow-scripts 時，從 parent 掛到 iframe
// 文件上的事件收不到（foliate paginator.js L242-244 因此永遠開 allow-scripts）。
const probeSandboxEvents = async (withScripts) => {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox",
    withScripts ? "allow-same-origin allow-scripts" : "allow-same-origin");
  Object.assign(iframe.style, { position: "fixed", left: "0", top: "0",
    width: "200px", height: "200px", border: "0", zIndex: "9999" });
  const loaded = new Promise((resolve) => iframe.addEventListener("load", resolve, { once: true }));
  iframe.srcdoc = "<!DOCTYPE html><html><body style='margin:0'><div style='width:200px;height:200px'>x</div></body></html>";
  document.body.append(iframe);
  await loaded;
  const doc = iframe.contentDocument;
  if (!doc) { iframe.remove(); return { contentDocument: false }; }
  let clicks = 0, custom = 0;
  doc.addEventListener("click", () => { clicks += 1; });
  doc.addEventListener("frond-probe", () => { custom += 1; });
  doc.body.dispatchEvent(new doc.defaultView.CustomEvent("frond-probe", { bubbles: true }));
  doc.body.click();
  await new Promise((r) => setTimeout(r, 100));
  iframe.remove();
  return { contentDocument: true, syntheticClickSeen: clicks > 0, customEventSeen: custom > 0 };
};

// 「it needs to be visible for Firefox to get computed style」
// （foliate paginator.js L260-264：讀 writing-mode 與背景色之前先把 iframe
// display 切成 block，讀完再切回 none）。
const probeHiddenComputedStyle = async () => {
  const iframe = document.createElement("iframe");
  iframe.style.display = "none";
  iframe.setAttribute("sandbox", "allow-same-origin allow-scripts");
  const loaded = new Promise((r) => iframe.addEventListener("load", r, { once: true }));
  iframe.srcdoc = `<!DOCTYPE html><html style="writing-mode: vertical-rl">
    <body style="background: rgb(9, 8, 7); direction: rtl">x</body></html>`;
  document.body.append(iframe);
  await loaded;
  const doc = iframe.contentDocument;
  const read = () => {
    const cs = doc.defaultView.getComputedStyle(doc.body);
    return { writingMode: cs.writingMode, direction: cs.direction,
      backgroundColor: cs.backgroundColor };
  };
  const whileHidden = read();
  iframe.style.display = "block";
  const whileVisible = read();
  iframe.style.display = "none";
  const hiddenAgain = read();
  iframe.remove();
  return {
    whileHidden, whileVisible, hiddenAgain,
    hiddenMatchesVisible:
      whileHidden.writingMode === whileVisible.writingMode
      && whileHidden.direction === whileVisible.direction
      && whileHidden.backgroundColor === whileVisible.backgroundColor,
  };
};

// 「NOTE: needs `requestAnimationFrame` in Chromium」
// （foliate paginator.js L1111-1113：setStyles 之後要隔一個 frame 才讀得到
// 新的背景色）。這裡照 foliate 的做法注入樣式，然後比「同步讀」與「隔一個
// frame 讀」。
const probeStyleReadTiming = async () => {
  const view = window.__spike.view;
  const { doc } = view.renderer.getContents()[0];
  const read = () => doc.defaultView.getComputedStyle(doc.body).backgroundColor;
  const before = read();
  view.renderer.setStyles("html, body { background: rgb(1, 2, 3) !important }");
  const immediate = read();
  const afterRaf = await new Promise((r) => requestAnimationFrame(() => r(read())));
  view.renderer.setStyles("");
  return { before, immediate, afterRaf, needsFrame: immediate !== afterRaf };
};

// --- 每家瀏覽器跑一次 ------------------------------------------------------

const BROWSERS = { chromium, firefox, webkit };
const results = {};
await fs.mkdir(OUT_DIR, { recursive: true });

for (const [name, type] of Object.entries(BROWSERS)) {
  const browser = await type.launch();
  const record = { browser: name, browserVersion: browser.version(), console: [] };
  try {
    const context = await browser.newContext({
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") record.console.push(`${m.type()}: ${m.text()}`);
    });
    page.on("pageerror", (e) => record.console.push(`pageerror: ${e.message}`));

    await page.goto(`http://127.0.0.1:${PORT}/harness.html`);
    await page.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 30000 });
    record.fatal = await page.evaluate(() => window.__spike.fatal ?? null);
    if (record.fatal) throw new Error(record.fatal);

    await page.evaluate(() => window.__spike.view.renderer.getContents()[0].doc.fonts.ready);
    await page.waitForTimeout(300);

    record.layout = await page.evaluate(measureLayout);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-page1.png`) });

    record.navigation = await page.evaluate(roundTrip);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}-after-roundtrip.png`) });

    record.probes = {
      boundingRect: await page.evaluate(probeBoundingRect),
      resizeObserver: await page.evaluate(probeResizeObserver),
      sandboxWithScripts: await page.evaluate(probeSandboxEvents, true),
      sandboxWithoutScripts: await page.evaluate(probeSandboxEvents, false),
      contentExtent: await page.evaluate(probeContentExtent),
      lineBoxContain: await page.evaluate(probeLineBoxContain),
      hiddenComputedStyle: await page.evaluate(probeHiddenComputedStyle),
      styleReadTiming: await page.evaluate(probeStyleReadTiming),
    };

    // 標點字符：放大字級後量一個「。」的墨水重心。foliate 沒有注入
    // font-feature-settings: "vert"，所以這一格量的是 foliate 自己的行為。
    const big = await context.newPage();
    await big.goto(`http://127.0.0.1:${PORT}/harness.html?styles=${encodeURIComponent(
      "html { font-size: 64px !important }")}`);
    await big.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 30000 });
    await big.evaluate(() => window.__spike.view.renderer.getContents()[0].doc.fonts.ready);
    await big.waitForTimeout(300);
    // 放大字級後這一節跨了好幾欄，換行邊界才真的存在——上面那次
    // boundingRect 探針跑在單欄的節上，根本沒有機會踩到欄邊界。
    // 逐頁走過第一個 Section，量每一頁的墨水像素數。頁數在三家不同時，這是
    // 分辨「多出來的那一頁有沒有字」的唯一辦法——空白頁是讀者看得到的缺陷，
    // 而 pages 這個數字本身看不出來。
    record.pageInk = [];
    await big.evaluate(() => window.__spike.view.goTo(0));
    await big.waitForTimeout(300);
    for (let i = 0; i < 12; i += 1) {
      const state = await big.evaluate(() => {
        const r = window.__spike.view.renderer;
        return { page: r.page, pages: r.pages };
      });
      const shot = await big.screenshot();
      const ink = analyseInk(shot);
      record.pageInk.push({ page: state.page, pages: state.pages, inkPixels: ink.pixelCount });
      await fs.writeFile(path.join(OUT_DIR, `${name}-64px-page${state.page}.png`), shot);
      if (state.page >= state.pages - 2) break;
      await big.evaluate(() => window.__spike.view.next());
      await big.waitForTimeout(200);
    }
    await big.evaluate(() => window.__spike.view.goTo(0));
    await big.waitForTimeout(300);

    record.probes.boundingRectMultiColumn = await big.evaluate(probeBoundingRect);
    record.probes.multiColumnLayout = await big.evaluate(probeContentStart);
    record.probes.multiColumnExtent = await big.evaluate(probeContentExtent);

    const found = await big.evaluate(showFullStop);
    if (found) {
      const shot = await big.screenshot({ clip: found.rect });
      await fs.writeFile(path.join(OUT_DIR, `${name}-fullstop.png`), shot);
      record.fullStop = { ...analyseInk(shot), fontFamily: found.fontFamily,
        fontSize: found.fontSize, rect: found.rect, rawRect: found.rawRect };

      // 同一家瀏覽器內的對照組：把 "vert" 1 顯式打開再截同一個框。
      // 兩張逐位元組相同 ⇒ 這家本來就套了直排字符；不同 ⇒ 沒套。
      // 這個比法不受各家 range rect 偏移的影響——分子分母都在同一家裡。
      const forced = await context.newPage();
      await forced.goto(`http://127.0.0.1:${PORT}/harness.html?styles=${encodeURIComponent(
        'html { font-size: 64px !important } * { font-feature-settings: "vert" 1 !important }')}`);
      await forced.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 30000 });
      await forced.evaluate(() => window.__spike.view.renderer.getContents()[0].doc.fonts.ready);
      await forced.waitForTimeout(300);
      const foundForced = await forced.evaluate(showFullStop);
      if (foundForced) {
        const forcedShot = await forced.screenshot({ clip: foundForced.rect });
        await fs.writeFile(path.join(OUT_DIR, `${name}-fullstop-vert-forced.png`), forcedShot);
        record.fullStopForced = { ...analyseInk(forcedShot), rect: foundForced.rect,
          rawRect: foundForced.rawRect };
        record.fullStopMatchesForced =
          Buffer.compare(PNG.sync.read(shot).data, PNG.sync.read(forcedShot).data) === 0
          && found.rect.x === foundForced.rect.x && found.rect.y === foundForced.rect.y;
      }
      await forced.close();

      await big.screenshot({ path: path.join(OUT_DIR, `${name}-64px.png`) });
    } else {
      record.fullStop = null;
    }
    await big.close();

    // 第二本：橫排的 huge-single-section。foliate 對「頁首分欄斷點」的補償
    // 註記為橫排限定，直排的 fixture 量不到它。
    const horiz = await context.newPage();
    await horiz.goto(`http://127.0.0.1:${PORT}/harness.html?book=book-horizontal.epub`);
    await horiz.waitForFunction(() => window.__spike?.ready === true, null, { timeout: 60000 });
    const horizFatal = await horiz.evaluate(() => window.__spike.fatal ?? null);
    if (horizFatal) {
      record.horizontal = { fatal: horizFatal };
    } else {
      await horiz.evaluate(() => window.__spike.view.renderer.getContents()[0].doc.fonts.ready);
      await horiz.waitForTimeout(300);
      record.horizontal = {
        layout: await horiz.evaluate(measureLayout),
        contentStart: await horiz.evaluate(probeContentStart),
        boundingRect: await horiz.evaluate(probeBoundingRect),
      };
      await horiz.screenshot({ path: path.join(OUT_DIR, `${name}-horizontal-page1.png`) });
    }
    await horiz.close();
    await context.close();
  } catch (e) {
    record.error = String(e && e.stack ? e.stack : e);
  } finally {
    await browser.close();
  }
  results[name] = record;
  console.log(`--- ${name} ---`);
  console.log(JSON.stringify(record, null, 2));
}

await fs.writeFile(path.join(OUT_DIR, "results.json"), JSON.stringify(results, null, 2));
server.close();
