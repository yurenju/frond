/**
 * frond-react 的展示頁。
 *
 * ## 它示範的三件事，都是可以現場切換的
 *
 * 1. **零件怎麼組**——`Root` / `Viewport` / 兩個 Trigger / `Progress` 攤在下面
 *    `App()` 那一個函式裡，沒有再包一層抽象。
 * 2. **預設樣式是可選的**——工具列那個開關切的是一個 `<link>` 的 `disabled`。關掉
 *    之後零件回到瀏覽器原生的樣子，那正是「不 import 就完全不存在」。
 * 3. **政策是可選的**——鍵盤與滑動翻頁由另一個開關決定要不要叫那兩個 hook。關掉
 *    之後方向鍵與滑動一點反應都沒有，翻頁只剩按鈕。
 *
 * 第二與第三點做成開關而不是寫在文件裡，是因為它們是這個套件最容易被當成客套話的
 * 兩個設計主張。一句「樣式是可選的」讀起來像場面話，一個切下去就變樣的開關不是。
 *
 * ## 只有一個 Root
 *
 * 工具列、目錄、書、狀態列全部是同一個 `<Reader.Root>` 的子孫。這不是為了省事——
 * **一個 `Root` 就是一個 `Renderer`，也就是一本掛在畫面上的書**，開兩個會得到兩個
 * iframe。`Root` 自己不渲染任何元素（連 `<div>` 都沒有），所以把整頁包起來不會多
 * 出任何一層 box，版面仍然完全由這裡的 CSS 決定。
 *
 * ## 這個檔案本身也是文件
 *
 * 頁面上「用起來長這樣」那一段程式碼與下面的 `<Reader.Root>` 那一段是同一件事。
 * 抄過去改，不必先讀一份 API 說明。
 */

import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import * as Reader from "@yurenju/frond-react";
import { EpubBook } from "@yurenju/frond/epub";
import type { TocItem } from "@yurenju/frond/epub";

// --- 開書 -------------------------------------------------------------------

interface OpenBook {
  readonly book: EpubBook;
  readonly title: string;
}

function useOpener(): {
  readonly opened: OpenBook | undefined;
  readonly failure: string | undefined;
  open(file: File): void;
} {
  const [opened, setOpened] = useState<OpenBook | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  const open = useCallback((file: File) => {
    setFailure(undefined);
    void (async () => {
      try {
        const book = await EpubBook.open(await file.arrayBuffer());
        setOpened({ book, title: book.metadata.title ?? file.name });
      } catch (reason) {
        setOpened(undefined);
        setFailure(reason instanceof Error ? reason.message : String(reason));
      }
    })();
  }, []);

  return { opened, failure, open };
}

// --- 整頁 -------------------------------------------------------------------

function App() {
  const { opened, failure, open } = useOpener();
  const [fontSize, setFontSize] = useState(20);
  const [styled, setStyled] = useState(true);
  const [paging, setPaging] = useState(true);

  useDefaultStylesheet(styled);

  if (opened === undefined) {
    return <Dropzone failure={failure} onFile={open} />;
  }

  return (
    <Reader.Root book={opened.book} settings={{ fontSize, margin: 32 }}>
      {/* 政策：要不要吃鍵盤與滑動。不掛這個元件的話一個手勢都不吃。 */}
      {paging ? <Paging /> : null}

      <div className="workspace-bar">
        <p className="book-title" data-testid="book-title">
          {opened.title}
        </p>

        <TableOfContents toc={opened.book.toc} />

        <label>
          字級
          <input
            type="range"
            min={12}
            max={40}
            step={1}
            value={fontSize}
            data-testid="font-size"
            onChange={(event) => setFontSize(event.currentTarget.valueAsNumber)}
          />
        </label>

        {/*
          兩個開關。它們切的不是外觀選項，是這個套件的兩個設計主張——切下去馬上
          看得到差別，比讀一段文字有說服力。
        */}
        <label className="switch">
          <input
            type="checkbox"
            checked={styled}
            data-testid="toggle-styles"
            onChange={(event) => setStyled(event.currentTarget.checked)}
          />
          預設樣式
        </label>
        <label className="switch">
          <input
            type="checkbox"
            checked={paging}
            data-testid="toggle-paging"
            onChange={(event) => setPaging(event.currentTarget.checked)}
          />
          鍵盤與滑動翻頁
        </label>

        <label className="file-button small">
          換一本
          <input
            type="file"
            accept=".epub,application/epub+zip"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file !== undefined) open(file);
            }}
          />
        </label>
      </div>

      <div className="reader-stage">
        <Reader.PreviousTrigger className="page-turn" aria-label="上一頁" data-testid="previous">
          ‹
        </Reader.PreviousTrigger>
        <Reader.Viewport className="reader-viewport" data-testid="viewport" />
        <Reader.NextTrigger className="page-turn" aria-label="下一頁" data-testid="next">
          ›
        </Reader.NextTrigger>
      </div>

      <Reader.Progress className="reader-progress" data-testid="progress" />
      <StatusLine />
    </Reader.Root>
  );
}

/**
 * 政策掛在一個什麼都不畫的元件上。
 *
 * hook 不能寫在條件裡，所以「可以關掉」這件事的形狀是「條件式地渲染一個掛著它們
 * 的元件」——這也是 `paging.ts` 檔頭建議的寫法。
 */
function Paging() {
  Reader.useKeyboardPaging();
  Reader.useSwipePaging();
  return null;
}

/** 狀態列。它示範的是 `useReader()`——零件沒提供的東西全部從那裡拿。 */
function StatusLine() {
  const { location, writingMode, status } = Reader.useReader();

  if (status !== "ready" || location === undefined) {
    return (
      <p className="reader-status" data-testid="status">
        {status === "error" ? "這一節排不出來" : "排版中…"}
      </p>
    );
  }

  return (
    <p className="reader-status" data-testid="status">
      <span data-testid="status-writing-mode">
        {writingMode === "vertical-rl" ? "直排" : "橫排"}
      </span>
      <span data-testid="status-page">
        第 {location.page + 1} / {location.pageCount} 頁
      </span>
      <span data-testid="status-fraction">
        {location.fraction === undefined
          ? "索引建置中…"
          : `全書 ${(location.fraction * 100).toFixed(1)}%`}
      </span>
      <code data-testid="status-cfi">{location.cfi}</code>
    </p>
  );
}

/**
 * 目錄。
 *
 * 做成頁面自己的一個 `<select>` 而不是一個零件，是因為「目錄要畫成下拉、側欄還是
 * 抽屜」是政策（ADR-0002）。frond 給的是事實——`TocItem.target` 指向哪裡——跳過去
 * 只是一行 `goTo()`。
 */
function TableOfContents({ toc }: { readonly toc: readonly TocItem[] }) {
  const { goTo, status } = Reader.useReader();

  const flat: { readonly label: string; readonly depth: number; readonly item: TocItem }[] = [];
  const walk = (items: readonly TocItem[], depth: number): void => {
    for (const item of items) {
      flat.push({ label: item.label, depth, item });
      walk(item.children, depth + 1);
    }
  };
  walk(toc, 0);

  if (flat.length === 0) return null;

  return (
    <select
      className="toc"
      aria-label="目錄"
      data-testid="toc"
      disabled={status !== "ready"}
      value=""
      onChange={(event) => {
        const chosen = flat[Number(event.currentTarget.value)];
        const target = chosen?.item.target;

        // `target` 是一個 union，不是兩個可有可無的欄位。目錄指到外部連結
        // （`remote`）或指到封裝外（書寫壞了）都是實際會遇到的形狀，而它們的處置
        // 不是跳轉——這裡就是不動作。
        if (target?.kind === "in-container") {
          void goTo({ path: target.path, fragment: target.fragment });
        }
      }}
    >
      <option value="">目錄…</option>
      {flat.map((entry, index) => (
        <option key={index} value={index}>
          {"　".repeat(entry.depth)}
          {entry.label}
        </option>
      ))}
    </select>
  );
}

/**
 * 預設樣式的開關。
 *
 * 切的是 `<link>` 的 `disabled`，而不是把 CSS import 進 bundle——後者會讓它變成
 * 「一定會生效」，而這一頁要示範的正好是它可以完全不生效。
 */
function useDefaultStylesheet(enabled: boolean): void {
  useEffect(() => {
    const link = document.getElementById("frond-react-styles");
    if (link instanceof HTMLLinkElement) link.disabled = !enabled;
  }, [enabled]);
}

function Dropzone({
  failure,
  onFile,
}: {
  readonly failure: string | undefined;
  onFile(file: File): void;
}) {
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={dragging ? "dropzone is-hovered" : "dropzone"}
      data-testid="dropzone"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (file !== undefined) onFile(file);
      }}
    >
      <p className="dropzone-headline">把 EPUB 拖進這裡</p>
      <p className="dropzone-sub">或者</p>
      <label className="file-button">
        選一個檔案
        <input
          type="file"
          accept=".epub,application/epub+zip"
          data-testid="file-input"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file !== undefined) onFile(file);
          }}
        />
      </label>
      {failure === undefined ? null : (
        <p className="error" data-testid="open-error">
          這本書開不起來：{failure}
        </p>
      )}
    </div>
  );
}

const container = document.getElementById("app");
if (container === null) throw new Error("頁面上沒有 #app");

// StrictMode 是刻意的。它會把每個 effect 掛、卸、再掛一次，而那正是薄包裝最容易
// 出錯的地方——展示站自己開著它，等於每一次部署都在走那條路。
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
