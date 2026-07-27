import { describe, expect, test } from "vitest";
import { EpubBook, type TocItem } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * TOC——有層次的標題與位置對照（CONTEXT.md）。
 *
 * 這一組同時餵**兩種導覽載體**：EPUB 3 的 `nav.xhtml` 與 EPUB 2 的 `toc.ncx`。
 * 兩者表達層次與位置的方式不同（`<ol>` 套在 `<li>` 裡面對 navPoint 套 navPoint、
 * 一個 `<a>` 同時帶標籤與位置對 `navLabel` 與 `content` 是兩個子元素），所以
 * 每一條病症都要在兩種載體上各跑一次——只在一種載體上綠的實作，在實際的書上
 * 有一半會壞（ADR-0010：樣本裡的壞 TOC 正是長在 NCX 上）。
 */

/** 把樹攤平成文件順序，供「有沒有讀到這一項」這種問題。 */
function flatten(items: readonly TocItem[]): readonly TocItem[] {
  return items.flatMap((item) => [item, ...flatten(item.children)]);
}

/** 一項 TOC 指到壓縮檔內的哪個路徑。指不到封裝內時是 undefined。 */
function pathOf(item: TocItem): string | undefined {
  return item.target.kind === "in-container" ? item.target.path : undefined;
}

/** 成對的兩份 fixture：同一個形狀，兩種載體。 */
const VEHICLES = [
  { vehicle: "nav", fileName: "nested-toc.epub" },
  { vehicle: "ncx", fileName: "nested-toc-epub2.epub" },
] as const;

describe("巢狀結構", () => {
  test.for(VEHICLES)(
    "$fileName 的第二層掛在對的父項目底下",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      // 子清單放成兄弟的導覽文件仍然良構、瀏覽器一樣畫得出來，但那棵樹是平的
      // ——所以要問的是形狀，不是項目數。
      expect(book.toc.map((item) => item.label)).toEqual([
        "朝の光",
        "坂の道",
        "夜の駅",
      ]);
      expect(book.toc.map((item) => item.children.map((child) => child.label))).toEqual([
        ["朝の光・一", "朝の光・二"],
        ["坂の道・一", "坂の道・二"],
        [],
      ]);
    },
  );

  test.for(VEHICLES)(
    "$fileName 的深度不被壓平",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      expect(flatten(book.toc)).toHaveLength(7);
      expect(book.toc).toHaveLength(3);
    },
  );

  test("深度不限於一層", async () => {
    // fixture 演的是實際的書量到的形狀（兩層），而實作不該把「兩層」寫死。
    // 三層的書沒有 fixture，所以在這裡手工組一本。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(`<ol>
  <li><a href="section-1.xhtml">一階</a>
    <ol>
      <li><a href="section-1.xhtml#b">二階</a>
        <ol><li><a href="section-1.xhtml#c">三階</a></li></ol>
      </li>
    </ol>
  </li>
</ol>`),
          },
        ],
      }),
    );

    expect(book.toc[0]?.children[0]?.children[0]?.label).toBe("三階");
    expect(flatten(book.toc).map((item) => item.label)).toEqual([
      "一階",
      "二階",
      "三階",
    ]);
  });
});

describe("href 的兩種病症，兩種載體都要解得開", () => {
  const AILING = [
    { fileName: "toc-href-percent-comma.epub", vehicle: "nav" },
    { fileName: "toc-href-percent-comma-epub2.epub", vehicle: "ncx" },
    { fileName: "toc-href-parent-prefix.epub", vehicle: "nav" },
    { fileName: "toc-href-parent-prefix-epub2.epub", vehicle: "ncx" },
  ] as const;

  test.for(AILING)(
    "$fileName 的每一項都解析到 readingOrder 上的 Section",
    async ({ fileName }: (typeof AILING)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));

      // 「解析得到正確的 Section」的意思就是這個：TOC 那一側算出來的路徑，與
      // readingOrder 那一側算出來的路徑是同一個字串。兩側各寫一套正規化的
      // 實作會在這裡分岔——而那正是 #1 記的 spine 原罪。
      expect(book.toc.map(pathOf)).toEqual(
        book.readingOrder.map((section) => section.path),
      );
    },
  );

  test("%2c 的那本書，TOC 指到的是字面逗號的那個項目", async () => {
    const book = await EpubBook.open(
      await readFixture("toc-href-percent-comma.epub"),
    );

    // 病症只長在 TOC 那一側：manifest 與壓縮檔的項目名都是字面的逗號。沒有
    // 還原 percent-encoding 的實作會拿 `section-2%2ccontinued.xhtml` 去查表，
    // 查不到，然後點目錄靜默無反應。
    expect(book.toc[1]?.href).toContain("%2c");
    expect(pathOf(book.toc[1]!)).toBe("EPUB/section-2,continued.xhtml");
  });

  test("../ 的那本書，導覽文件在子目錄裡", async () => {
    const book = await EpubBook.open(
      await readFixture("toc-href-parent-prefix.epub"),
    );

    // href 相對的是**導覽文件自己**的位置，不是封裝文件的位置。拿封裝文件當
    // 基底的實作在這份 fixture 上會走出 EPUB/ 之外。
    expect(book.navigationDocument?.path).toBe("EPUB/nav/nav.xhtml");
    expect(book.toc[0]?.href).toBe("../section-1.xhtml");
    expect(pathOf(book.toc[0]!)).toBe("EPUB/section-1.xhtml");
  });
});

describe("fragment", () => {
  test.for(VEHICLES)(
    "$fileName 的第二層帶得出 fragment，第一層沒有 fragment",
    async ({ fileName }: (typeof VEHICLES)[number]) => {
      const book = await EpubBook.open(await readFixture(fileName));
      const target = (item: TocItem) =>
        item.target.kind === "in-container" ? item.target.fragment : "(不在封裝內)";

      // 帶 fragment 與不帶的在同一份導覽文件裡混用，是樣本裡那本巢狀 EPUB 2 的
      // 形狀。丟掉 fragment 的實作在第一層上完全正常，只有跳到章節中段時才會
      // 靜默地停在 Section 開頭。
      expect(book.toc.map(target)).toEqual([undefined, undefined, undefined]);
      expect(book.toc.map((item) => item.children.map(target))).toEqual([
        ["part-1-1", "part-1-2"],
        ["part-2-1", "part-2-2"],
        [],
      ]);
    },
  );

  test("fragment 是解碼過的，對得上文件裡的 id", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol><li><a href="section-1.xhtml#%E7%AC%AC%E4%B8%80%E7%AB%A0">第一章</a></li></ol>`,
            ),
          },
        ],
      }),
    );

    // id 可以是非 ASCII，而 href 裡的它是 percent-encoded 的。不解碼的話，拿
    // 這個 fragment 去 getElementById 一個字都對不上。
    expect(
      book.toc[0]?.target.kind === "in-container" && book.toc[0].target.fragment,
    ).toBe("第一章");
  });
});

describe("兩份導覽文件都在時誰贏（ADR-0010）", () => {
  /** 宣告 3.x，nav 與 NCX 都在，而且**內容不一致**。 */
  function bothVehicles(): Uint8Array {
    return handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        readingOrderAttributes: ` toc="ncx"`,
      }),
      entries: [
        ...HEALTHY_ENTRIES,
        {
          path: "OEBPS/nav.xhtml",
          contents: navigationDocument(
            `<ol><li><a href="section-1.xhtml">nav 說的標題</a></li></ol>`,
          ),
        },
        {
          path: "OEBPS/toc.ncx",
          contents: navigationControlFile(
            `<navPoint id="p1" playOrder="1"><navLabel><text>NCX 說的標題</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
          ),
        },
      ],
    });
  }

  test("EPUB 3 用 nav，NCX 完全忽略", async () => {
    // 兩者都在是常態（樣本裡 31 本 EPUB 3 全部都有），所以這一格不能是「報錯」
    // 或「合併」。
    const book = await EpubBook.open(bothVehicles());

    expect(book.navigationDocument).toEqual({
      vehicle: "nav",
      path: "OEBPS/nav.xhtml",
    });
    expect(book.toc.map((item) => item.label)).toEqual(["nav 說的標題"]);
  });

  test("兩份內容不一致不是錯誤——不合併、不交叉驗證", async () => {
    // 不一致是事實，要不要提示讀者是消費端的政策（ADR-0002）。一本 EPUB 3 附
    // 一份過期的 NCX 完全合規，把它變成錯誤會讓一本好書開不起來。
    await expect(EpubBook.open(bothVehicles())).resolves.toBeDefined();
  });

  test("宣告 3.x 卻沒有 nav 時退回 NCX，不丟錯", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
          readingOrderAttributes: ` toc="ncx"`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/toc.ncx",
            contents: navigationControlFile(
              `<navPoint id="p1" playOrder="1"><navLabel><text>只有 NCX</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
            ),
          },
        ],
      }),
    );

    expect(book.metadata.epubVersion).toBe("epub3");
    expect(book.navigationDocument?.vehicle).toBe("ncx");
    expect(book.toc.map((item) => item.label)).toEqual(["只有 NCX"]);
  });

  test("EPUB 2 只有 NCX 這條路", async () => {
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.navigationDocument).toEqual({
      vehicle: "ncx",
      path: "EPUB/toc.ncx",
    });
    expect(book.toc.map((item) => item.label)).toEqual([
      "朝の光",
      "坂の道",
      "夜の駅",
    ]);
  });

  test("NCX 沒有被 <spine toc> 指到時，靠 media type 也找得到", async () => {
    // 量到的：那 33 本書全部在 manifest 上宣告了 NCX，但只有 27 本用
    // `<spine toc>` 指向它——**6 本只能靠 media type 找到**。那 6 本都有 nav
    // 所以走不到這條路，但「NCX 沒被指到」這件事本身在野外很常見。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          version: "2.0",
          manifest: `    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/toc.ncx",
            contents: navigationControlFile(
              `<navPoint id="p1" playOrder="1"><navLabel><text>沒被指到的 NCX</text></navLabel><content src="section-1.xhtml"/></navPoint>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual(["沒被指到的 NCX"]);
  });
});

describe("一份導覽文件都沒有的書", () => {
  test("回報空 TOC 而不是拒開", async () => {
    // 讀者要的是書打得開（ADR-0010 的權衡方向）。一本沒有目錄的書仍然讀得完。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({}),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.toc).toEqual([]);
    expect(book.navigationDocument).toBeUndefined();
  });

  test("導覽文件宣告了卻不在壓縮檔裡，也只是空 TOC", async () => {
    // 缺檔只在 readingOrder 上致命（`resources.ts`）。導覽文件缺了，少的是
    // 目錄不是內容。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );

    expect(book.toc).toEqual([]);
    expect(book.navigationDocument).toBeUndefined();
  });
});

describe("nav.xhtml 這個載體自己的形狀", () => {
  test("landmarks 那份 nav 不會被當成 TOC", async () => {
    // 量到的：31 本有 nav 的書裡，**27 本的導覽文件不只一個 `<nav>`**（多半是
    // landmarks），而且 31 本全部都在 TOC 那一個上宣告了 epub:type="toc"。
    // 拿第一個 `<nav>` 當 TOC 的實作在這批書上會撿到別的清單。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol><li><a href="section-1.xhtml">目錄的標題</a></li></ol>`,
              `<ol><li><a href="section-1.xhtml">本文開始</a></li></ol>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual(["目錄的標題"]);
  });

  test("標題包在行內標籤裡也讀得出來，順序不變", async () => {
    // 量到的：1527 個目錄連結裡有 73 個的標題帶行內標籤（5 本書），其中一本
    // **39 個項目的文字全部包在 `<span>` 裡**。只讀 `<a>` 自己那一層文字的
    // 實作會讓那本書整份目錄的標題是空字串。
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "OEBPS/nav.xhtml",
            contents: navigationDocument(
              `<ol>
  <li><a href="section-1.xhtml"><span>序</span></a></li>
  <li><a href="section-1.xhtml"><span class="part"><small>輯一</small>・儲藏室</span></a></li>
  <li><a href="section-1.xhtml">前<em>言</em>後</a></li>
</ol>`,
            ),
          },
        ],
      }),
    );

    expect(book.toc.map((item) => item.label)).toEqual([
      "序",
      "輯一・儲藏室",
      "前言後",
    ]);
  });
});

/** 一份 `nav.xhtml`。`before` 若給了，會多一個排在前面的 landmarks nav。 */
function navigationDocument(list: string, before?: string): string {
  const landmarks =
    before === undefined
      ? ""
      : `    <nav epub:type="landmarks"><h1>導讀</h1>${before}</nav>\n`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>目次</title></head>
  <body>
${landmarks}    <nav epub:type="toc">
${list}
    </nav>
  </body>
</html>
`;
}

/** 一份 NCX。 */
function navigationControlFile(navPoints: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="ja">
  <head><meta name="dtb:uid" content="urn:uuid:frond-handmade"/></head>
  <docTitle><text>手で組んだ本</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}
