import { describe, expect, test } from "vitest";
import { PNG } from "pngjs";
import {
  openEpub,
  type EpubArchive,
  type TocNode,
} from "../support/epub-archive.ts";
import { buildEpub } from "../../../packages/frond/src/test-fixtures/epub.ts";
import {
  buildFixture,
  type AilmentName,
} from "../../../packages/frond/src/test-fixtures/index.ts";

/**
 * 每個 fixture 到底有沒有帶著它名字上的那個病。
 *
 * 這一組與 `single-ailment.test.ts` 是一體兩面：這裡問「病在不在」，那裡問
 * 「病有沒有溢出到別的檔案」。兩條都要，只有前者的話一個把所有病症寫進同一份
 * 樣式表的產生器也會全綠。
 */

function open(name: AilmentName): EpubArchive {
  return openEpub(buildFixture(name));
}

describe("樣式表裡的病症", () => {
  test("writing-mode-on-body：直排宣告在 body 而不是 html", () => {
    const book = open("writing-mode-on-body");

    expect(book.stylesheet).toMatch(/body\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/html\s*\{[^}]*writing-mode/);
  });

  test("writing-mode-prefixed-only：只有帶前綴的屬性名，無前綴的一次都沒有", () => {
    const book = open("writing-mode-prefixed-only");

    expect(book.stylesheet).toMatch(/-epub-writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).toMatch(/-webkit-writing-mode:\s*vertical-rl/);

    // 「無前綴的一次都沒有」是這份 fixture 的全部價值：只要補上一條無前綴的
    // 宣告，Firefox 就正常了，而這本書要演的正是那條不存在的情況。
    expect(book.stylesheet).not.toMatch(/[^-\w]writing-mode:/);
  });

  test("writing-mode-prefixed-only 與 writing-mode-on-body 病的不是同一件事", () => {
    // 對照組成立的條件：兩份都宣告在 <body> 上、都是 vertical-rl，差別只在
    // 屬性名。差別若不只這一項，「Firefox 為什麼一本橫排一本直排」就不再只有
    // 前綴這一個解釋。
    const prefixed = open("writing-mode-prefixed-only");
    const unprefixed = open("writing-mode-on-body");

    expect(prefixed.stylesheet).toMatch(/body\s*\{[^}]*-epub-writing-mode/);
    expect(unprefixed.stylesheet).toMatch(/body\s*\{[^}]*[^-\w]writing-mode:/);
    expect(prefixed.stylesheet).not.toMatch(/html\s*\{[^}]*writing-mode/);
    expect(unprefixed.stylesheet).not.toMatch(/-epub-|-webkit-/);
  });

  test("vertical-japanese：直排宣告在 html——這是對照組", () => {
    const book = open("vertical-japanese");

    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
    expect(book.stylesheet).not.toMatch(/body\s*\{[^}]*writing-mode/);
  });

  test("writing-mode-behind-import：<link> 到的樣式表只有一行 @import 字串", () => {
    const book = open("writing-mode-behind-import");

    // 引號寫法而不是 `url()`——樣本量到的是這一種，而只認 `url()` 的實作正是在
    // 這一格輸掉的。
    expect(book.stylesheet).toMatch(/@import\s*"book-style\.css"\s*;/);
    expect(book.stylesheet).not.toContain("url(");

    // 排版意圖一條都不在這個檔案裡。留下任何一條的話，「樣式表整份消失」這個
    // 症狀就會被那幾條擋掉一部分，fixture 也就不再是乾淨的一格。
    expect(book.stylesheet).not.toMatch(/writing-mode/);
    expect(book.stylesheet).not.toMatch(/font-family/);
  });

  test("writing-mode-behind-import：直排的宣告在被 import 的那一份裡", () => {
    const book = open("writing-mode-behind-import");
    const imported = book.manifest.find((item) => item.href === "book-style.css");

    expect(imported?.mediaType).toBe("text/css");
    expect(book.text(imported!.archivePath)).toMatch(
      /html\s*\{[^}]*writing-mode:\s*vertical-rl/,
    );
  });

  test("writing-mode-behind-import 與 vertical-japanese 只差宣告放在哪個檔案", () => {
    // 這一對成立的條件：宣告的內容逐字元相同，唯一的差別是那些位元組在哪一個
    // 檔案裡。差別若不只這一項，「為什麼一本直排一本橫排」就不再只有 @import
    // 這一個解釋。
    const behindImport = open("writing-mode-behind-import");
    const inline = open("vertical-japanese");
    const imported = behindImport.manifest.find(
      (item) => item.href === "book-style.css",
    )!;

    expect(behindImport.text(imported.archivePath)).toBe(inline.stylesheet);
  });

  test("font-size-important：書用 !important 蓋掉讀者的字級", () => {
    const book = open("font-size-important");

    expect(book.stylesheet).toMatch(/font-size:\s*12px\s*!important/);
  });

  test("fixed-width-800：固定寬度讓小螢幕的內容被裁掉", () => {
    const book = open("fixed-width-800");

    expect(book.stylesheet).toMatch(/width:\s*800px/);
  });

  test("hardcoded-colors：寫死前景與背景，夜間模式失效", () => {
    const book = open("hardcoded-colors");

    expect(book.stylesheet).toMatch(/color:\s*#000000/);
    expect(book.stylesheet).toMatch(/background-color:\s*#ffffff/);
  });
});

describe("TOC href 裡的病症", () => {
  test("toc-href-percent-comma：nav 的逗號被編碼成 %2c，manifest 沒有", () => {
    const book = open("toc-href-percent-comma");

    const encoded = book.toc.filter((entry) => entry.href.includes("%2c"));
    expect(encoded.length).toBe(1);

    // 病症的形狀是 nav 與 manifest 對同一個檔名有兩種寫法。兩邊都編碼的話
    // 字串比對就會直接成功，這個 fixture 也就測不到東西了。
    const section = book.readingOrder.find(
      (item) => item.archivePath === encoded[0]!.archivePath,
    );
    expect(section?.href).toContain(",");
    expect(section?.href).not.toContain("%2c");
  });

  test("toc-href-parent-prefix：導覽文件在子目錄，href 帶 ../ 前綴", () => {
    const book = open("toc-href-parent-prefix");

    expect(book.navigationPath).toBe("EPUB/nav/nav.xhtml");
    for (const entry of book.toc) {
      expect(entry.href).toMatch(/^\.\.\//);
    }
    // 「解析得到 Section」由 epub-structure.test.ts 蓋住——這裡只釘住病症的
    // 形狀。href 若不是相對於導覽文件而是相對於封裝文件去解析，那條會紅。
  });

  test("toc-href-percent-comma-epub2：同一個病症長在 NCX 的 content src 上", () => {
    const book = open("toc-href-percent-comma-epub2");

    // 載體必須真的是 NCX——這一份存在的理由就是「實測的壞 TOC 出現在這個載體
    // 上」，落回 nav 的話它與 EPUB 3 那一份就是同一個檔案了。
    expect(book.navigationVehicle).toBe("ncx");

    const encoded = book.toc.filter((entry) => entry.href.includes("%2c"));
    expect(encoded.length).toBe(1);

    // 只有 NCX 這一側編碼：manifest 與壓縮檔的項目名都是字面的逗號。樣本裡那
    // 本書逐項核對過的正是這三者的關係。
    const section = book.readingOrder.find(
      (item) => item.archivePath === encoded[0]!.archivePath,
    );
    expect(section?.href).toContain(",");
    expect(section?.href).not.toContain("%2c");
    expect(book.entryPaths).toContain(encoded[0]!.archivePath);
  });

  test("toc-href-percent-comma 的兩個載體版本，病症形狀一致", () => {
    // 兩份 fixture 共用同一個 afflict，這條把「共用」變成可以變紅的斷言：
    // 同一個字元、同樣小寫、同樣只有一側編碼（#23 的驗收原文）。
    const nav = open("toc-href-percent-comma");
    const ncx = open("toc-href-percent-comma-epub2");

    const encodedHrefs = (book: EpubArchive): string[] =>
      book.toc.map((entry) => entry.href).filter((href) => href.includes("%"));

    expect(encodedHrefs(ncx)).toEqual(encodedHrefs(nav));
    expect(encodedHrefs(nav)).toEqual(["section-2%2ccontinued.xhtml"]);
  });

  test("toc-href-parent-prefix-epub2：NCX 在子目錄，content src 帶 ../ 前綴", () => {
    const book = open("toc-href-parent-prefix-epub2");

    expect(book.navigationVehicle).toBe("ncx");
    expect(book.navigationPath).toBe("EPUB/toc/toc.ncx");
    for (const entry of book.toc) {
      expect(entry.href).toMatch(/^\.\.\//);
    }
  });
});

describe("manifest href 裡的形狀", () => {
  test("manifest-href-parent-prefix：../ 走到封裝根，而目標確實存在", () => {
    const book = open("manifest-href-parent-prefix");
    const script = book.manifest.find((item) => item.href.startsWith("../"));

    expect(script?.href).toBe("../js/reader.js");
    // 解析後落在**封裝根**，不在內容目錄底下——這是這份 fixture 的重點。把
    // href 當字串接在內容目錄後面的實作會去找 `EPUB/../js/reader.js`，找不到，
    // 然後把這本好書判成「OPF 指向不存在的檔案」（#8 的 comment）。
    expect(script?.archivePath).toBe("js/reader.js");
    expect(book.has(script!.archivePath)).toBe(true);
    expect(book.entryPaths).not.toContain("EPUB/../js/reader.js");
  });

  test("manifest-href-parent-prefix 是好書：解析後仍落在封裝內", () => {
    const book = open("manifest-href-parent-prefix");

    for (const item of book.manifest) {
      expect(item.archivePath.startsWith("../"), item.href).toBe(false);
      expect(book.has(item.archivePath), item.href).toBe(true);
    }
  });

  test("走出封裝根的 href 被擋下來，不靜默修正", () => {
    // 「`../` 是合規的」與「`../` 一律放行」是兩件事：多一層 `..` 就跳出封裝，
    // 那才是真的不合規。ADR-0007 要求不合法的組合在產生器裡丟錯——靜默收斂成
    // 封裝根的話，這種 spec 會產出一本看起來正常的書。
    expect(() =>
      buildEpub({
        title: "frond fixture",
        language: "ja",
        identifier: "urn:uuid:frond-fixture-probe",
        stylesheet: "html { line-height: 1.8; }\n",
        readingOrder: [
          { path: "section-1.xhtml", title: "朝", body: "    <p>朝。</p>" },
        ],
        resources: [
          {
            path: "../../outside.js",
            mediaType: "application/javascript",
            contents: Uint8Array.of(1),
          },
        ],
      }),
    ).toThrow(/package root/);
  });
});

/**
 * 巢狀 TOC——兩種載體各一份，同一棵樹。
 *
 * 形狀照樣本裡那本 EPUB 2（Sigil → calibre）縮小：深度 2、不是每個頂層都有子
 * 項目、`content src` 帶 fragment 與不帶的在同一份文件裡混用。
 */
describe("巢狀的 TOC", () => {
  const NESTED = ["nested-toc", "nested-toc-epub2"] as const;

  test.for(NESTED)("%s 的 TOC 有兩層", (name: AilmentName) => {
    const book = open(name);

    expect(book.tocTree.length).toBe(3);
    expect(book.tocTree.map((node) => node.children.length)).toEqual([2, 2, 0]);
    expect(book.toc.length).toBe(7);
    expect(depthOf(book.tocTree)).toBe(2);
  });

  test.for(NESTED)(
    "%s 的同一份導覽文件裡混用帶 fragment 與不帶的 href",
    (name: AilmentName) => {
      const book = open(name);
      const children = book.tocTree.flatMap((node) => node.children);

      // 頂層都不帶、第二層都帶——樣本那本書「同一份 NCX 裡兩種 content src
      // 混用」的形狀。混用是**整份文件**的性質，不必靠某一層自己再混一次。
      expect(book.tocTree.every((node) => !node.href.includes("#"))).toBe(true);
      expect(children.length).toBe(4);
      expect(children.every((child) => child.href.includes("#"))).toBe(true);
    },
  );

  test.for(NESTED)("%s 的每一項 TOC 都指向不同的位置", (name: AilmentName) => {
    const book = open(name);
    const hrefs = book.toc.map((entry) => entry.href);

    // 子項目若省略 fragment，它的 href 會與父項目一字不差——而「父子同一個
    // 目標」是票沒有要求的額外性質。會去重的實作把那一項吃掉之後，這份
    // fixture 就靜默地少了一個第二層項目。
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test.for(NESTED)("%s 帶 fragment 的第二層指得到真的錨點", (name: AilmentName) => {
    const book = open(name);
    const withFragment = book.toc.filter((entry) => entry.href.includes("#"));

    expect(withFragment.length).toBeGreaterThan(0);
    for (const entry of withFragment) {
      const fragment = entry.href.slice(entry.href.indexOf("#") + 1);
      // 指不到的話這份 fixture 除了「TOC 有兩層」之外還多帶一個病症，而
      // single-ailment 那一組看不出來——它問的是症狀有沒有溢出到別的檔案。
      expect(book.text(entry.archivePath), entry.href).toContain(
        `id="${fragment}"`,
      );
    }
  });

  test("nested-toc：子清單是 <ol> 套在 <li> 裡面", () => {
    const book = open("nested-toc");
    const navigation = book.text(book.navigationPath);

    expect(book.navigationVehicle).toBe("nav");
    // 子清單放成 <li> 的兄弟時 XHTML 一樣良構、瀏覽器一樣畫得出來，但那棵樹是
    // 平的。位置寫錯正是這個載體最典型的錯法。
    expect(navigation).toMatch(/<li><a [^>]*>[^<]*<\/a>\n\s*<ol>/);
  });

  test("nested-toc-epub2：子項目是 navPoint 套 navPoint，playOrder 跨層連續", () => {
    const book = open("nested-toc-epub2");
    const ncx = book.text(book.navigationPath);

    expect(book.navigationVehicle).toBe("ncx");
    expect(ncx).toMatch(/<content src="[^"]*"\/>\n\s*<navPoint /);

    // playOrder 是整棵樹拉平後的序號，不是每一層各自從 1 重數——樣本裡那本
    // 平的 NCX 是 1..48 連續，巢狀那本同樣連續。
    const order = [...ncx.matchAll(/playOrder="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7]);

    // NCX 自己宣告的深度要與實際的層數一致。寫死成 1 的話，只讀這個欄位決定
    // 要不要往下走的實作會看不到第二層。
    expect(ncx).toContain('<meta name="dtb:depth" content="2"/>');
  });

  test("平的 TOC 仍然宣告 dtb:depth=1", () => {
    // 深度是算出來的，不是跟著巢狀那份一起改掉的常數。
    expect(open("healthy-epub2").text("EPUB/toc.ncx")).toContain(
      '<meta name="dtb:depth" content="1"/>',
    );
  });
});

/**
 * 樹有幾層。`epub.ts` 的 `tocDepth` 是同一個 reduce，**刻意各寫一次**：拿被測
 * 程式自己算出來的深度去驗它寫進 `dtb:depth` 的深度，兩邊會一起錯而測試照樣
 * 全綠。
 */
function depthOf(nodes: readonly TocNode[]): number {
  return nodes.reduce(
    (deepest, node) => Math.max(deepest, 1 + depthOf(node.children)),
    0,
  );
}

describe("readingOrder 的方向", () => {
  test("ppd-rtl-vertical：直排且 page-progression-direction=rtl", () => {
    const book = open("ppd-rtl-vertical");

    expect(book.pageProgressionDirection).toBe("rtl");
    expect(book.stylesheet).toMatch(/html\s*\{[^}]*writing-mode:\s*vertical-rl/);
  });

  test("對照組不宣告 page-progression-direction", () => {
    // 「沒宣告」與「宣告成 ltr」在規格上同義但在位元組上不同。對照組取前者，
    // 才能讓 ppd-rtl-vertical 與它之間只差那一個屬性。
    expect(open("vertical-japanese").pageProgressionDirection).toBeUndefined();
  });
});

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

describe("readingOrder 形狀上的病症", () => {
  test("huge-single-section：單一巨大的 Section", () => {
    const book = open("huge-single-section");

    expect(book.readingOrder.length).toBe(1);
    expect(book.text(book.readingOrder[0]!.archivePath).length).toBeGreaterThan(
      30_000,
    );
  });

  test("empty-and-image-only-sections：一個空的、一個只有圖片的", () => {
    const book = open("empty-and-image-only-sections");
    const bodies = book.readingOrder.map((section) =>
      bodyOf(book.text(section.archivePath)),
    );

    expect(bodies.filter((body) => body.trim() === "").length).toBe(1);

    const imageOnly = bodies.filter(
      (body) => body.includes("<img") && !/<p[\s>]/.test(body),
    );
    expect(imageOnly.length).toBe(1);
  });

  test("empty-and-image-only-sections：圖片是真的 PNG 且被 manifest 宣告", () => {
    const book = open("empty-and-image-only-sections");
    const image = book.manifest.find((item) => item.mediaType === "image/png");

    expect(image).toBeDefined();
    const bytes = book.bytes(image!.archivePath);
    expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE);

    // 用 pngjs 真的解一次。只比對簽章的話，一份 IDAT 壞掉、CRC 算錯或 adler32
    // 寫反的 PNG 照樣會過——而那種圖在瀏覽器裡是一個破圖 icon，不是圖版。
    const decoded = PNG.sync.read(Buffer.from(bytes));
    expect(decoded.width).toBe(96);
    expect(decoded.height).toBe(128);
  });
});

describe("比一頁還高的圖版", () => {
  test("plate-taller-than-page：圖包在一層沒有宣告高度的 div 裡", () => {
    const book = open("plate-taller-than-page");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    expect(body).toContain('<div class="plate"><img src="images/tall-plate.png"');

    // 包裝那一層**不能有高度宣告**——這份 fixture 的機制全在「包含塊的高度不確
    // 定」上，一旦那層有了確定的高度，`max-block-size: 100%` 就解析得出來，
    // fixture 也就不再帶病。
    expect(book.stylesheet).toMatch(/\.plate\s*\{[^}]*\}/);
    expect(/\.plate\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(
      /height|block-size/,
    );
  });

  test("plate-taller-than-page：圖真的比一頁還高", () => {
    const book = open("plate-taller-than-page");
    const image = book.manifest.find((item) => item.mediaType === "image/png");
    const decoded = PNG.sync.read(Buffer.from(book.bytes(image!.archivePath)));

    // 800x600 的 viewport 扣掉讀者邊界之後，一欄在區塊軸上大約 552px。圖必須
    // 明顯超過它，否則這份 fixture 什麼都證明不了。
    expect(decoded.height).toBeGreaterThan(600);
    // 窄長的比例：行內軸放得下、區塊軸放不下——書自己的 max-width 因此是無害的，
    // 溢出只可能來自區塊軸那一側。
    expect(decoded.width).toBeLessThan(decoded.height / 5);
  });

  test("plate-taller-than-page：書自己只管了行內軸", () => {
    const book = open("plate-taller-than-page");

    // 這是實際的書的形狀：`max-width: 100%`（行內軸）有，區塊軸沒有上限。
    expect(book.stylesheet).toMatch(/\.plate img\s*\{[^}]*max-inline-size:\s*100%/);
    expect(/\.plate img\s*\{([^}]*)\}/.exec(book.stylesheet)?.[1]).not.toMatch(
      /max-block-size|max-height/,
    );
  });
});

describe("內容文件裡藏起來的內容", () => {
  test("hidden-trailing-notes：註腳在正文之後，而且是最後的東西", () => {
    const book = open("hidden-trailing-notes");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));

    // 位置就是這個病症的全部。註腳若不在最後，文件順序的最後一個文字節點就是
    // 看得見的正文，而那本書是健康的。
    const firstNote = body.indexOf('<div class="note"');
    expect(firstNote).toBeGreaterThan(0);
    expect(
      body.slice(firstNote).replaceAll(/<div class="note"[\s\S]*?<\/div>/g, "").trim(),
      "註腳之後不該還有任何東西——那會讓最後一個文字節點又變成看得見的。",
    ).toBe("");

    expect(book.stylesheet).toMatch(/\.note\s*\{[^}]*display:\s*none/);
  });

  test("hidden-trailing-notes：正文長得足以排出好幾頁", () => {
    const book = open("hidden-trailing-notes");
    const body = bodyOf(book.text(book.readingOrder.at(-1)!.archivePath));
    const paragraphs = [...body.matchAll(/<p>/g)].length;

    // 長度不是第二個病症，是**症狀成立的前提**：只有一頁的節，「頁數被壓成 1」
    // 與正確答案是同一個數字，這份 fixture 就什麼也證明不了（ailments.ts）。
    expect(paragraphs).toBeGreaterThan(40);
  });

  test("hidden-trailing-notes：只動最後一節，前面幾節保持健康", () => {
    const book = open("hidden-trailing-notes");
    const healthy = open("vertical-japanese");

    // readingOrder 的長度不動——「readingOrder 只有一個 Section」是
    // huge-single-section 那個病症，兩份在探針上必須分得開。
    expect(book.readingOrder.length).toBe(healthy.readingOrder.length);
    for (const [index, section] of book.readingOrder.slice(0, -1).entries()) {
      expect(book.text(section.archivePath)).toBe(
        healthy.text(healthy.readingOrder[index]!.archivePath),
      );
    }
  });
});

function bodyOf(document: string): string {
  return document.slice(
    document.indexOf("<body>") + "<body>".length,
    document.indexOf("</body>"),
  );
}
