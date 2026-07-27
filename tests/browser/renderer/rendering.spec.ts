import { expect, test } from "@playwright/test";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * 把書渲染進容器，並認出它的書寫方向。
 *
 * 書寫方向這一格是這支 spec 的重心，理由是它**只有在瀏覽器裡才問得出答案**：判準
 * 是 CSSOM，而字串比對會漏掉書實際的寫法（ADR-0010、`docs/browser-quirks.md`）。
 * 三個宣告寫法各有一份 fixture，彼此是對照組。
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("渲染進容器", () => {
  test("掛上去就排得出第一頁", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");

    expect(location.sectionIndex).toBe(0);
    expect(location.page).toBe(0);
    expect(location.pageCount).toBeGreaterThanOrEqual(1);
    expect(location.atStart).toBe(true);
    expect(location.cfi).toMatch(/^epubcfi\(/);
  });

  test("內容真的在畫面上——iframe 有一份載好的文件", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).toContain("朝の光");
    // frond 自己那兩份樣式表都掛上去了。
    expect(html).toContain('id="frond-layout"');
    expect(html).toContain('id="frond-reader"');
  });

  test("書內的腳本不會進到文件裡（ADR-0006）", async ({ page }) => {
    // `manifest-href-parent-prefix` 帶了一份 js 資源。書內腳本一律拿掉——
    // iframe 為了讓 parent 收得到事件必須帶 allow-scripts，所以擋得住書內程式碼
    // 的只有這一步。
    await mountFixture(page, "manifest-href-parent-prefix");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).not.toContain("<script");
  });
});

test.describe("書寫方向的偵測", () => {
  test("宣告在 <html> 上：直排", async ({ page }) => {
    const location = await mountFixture(page, "vertical-japanese");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("宣告在 <body> 上：一樣認得出直排", async ({ page }) => {
    // InDesign 產的書就是這個形狀。只讀 documentElement 的 library 會判成橫排
    // ——spine 為此自己寫了一支 detectVerticalBook（ADR-0002）。
    const location = await mountFixture(page, "writing-mode-on-body");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("只有 -epub- 與 -webkit- 前綴：三家都排成直排", async ({ page }) => {
    // **這一條在 Firefox 上才有牙齒。** 那本書沒有無前綴的宣告，而 Firefox 兩種
    // 前綴都不認，所以沒有正規化的話它會整本排成橫排（《入境大廳》的形狀，
    // docs/browser-quirks.md）。另外兩家本來就認得前綴，所以它們在這一條上證明
    // 的是「補一條無前綴的宣告沒有把它們弄壞」。
    const location = await mountFixture(page, "writing-mode-prefixed-only");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("宣告在被 @import 進來的樣式表裡：一樣認得出直排", async ({ page }) => {
    // 實書量到的形狀（樣本 34 本裡 4 本，同一條 Kadokawa／BookCreator 工具鏈）：
    // 內容文件只 <link> 一支聚合檔，而那支檔案只有 `@import "…"` 字串。不展開
    // @import 的話那份樣式表**整份消失**——不是漏掉一條宣告，是整本書排錯方向，
    // 而且不會有任何錯誤訊息。
    const location = await mountFixture(page, "writing-mode-behind-import");
    expect(location.writingMode).toBe("vertical-rl");
  });

  test("@import 進來的宣告在文件裡是內嵌的，不是一個等著載的位址", async ({ page }) => {
    // 展開而不是換成 blob: 位址，是因為 `@import` 的載入是**非同步**的：frond 在
    // iframe 的 load 事件之後立刻量內容總長算頁數，樣式若還沒到位，量到的頁數
    // 就是錯的，而且只在載入比較慢的時候錯（`document-source.ts` 檔頭）。
    await mountFixture(page, "writing-mode-behind-import");

    const html = await page.evaluate(() => window.frond.html());

    expect(html).toContain("writing-mode: vertical-rl");
    expect(html).not.toContain("@import");
  });

  test("沒有直排宣告的書是橫排", async ({ page }) => {
    const location = await mountFixture(page, "huge-single-section");
    expect(location.writingMode).toBe("horizontal-tb");
  });

  test("直排的頁沿 y 推進，橫排沿 x", async ({ page }) => {
    // 讀者字級放大到 64px，這一節才排得出不只一頁——`vertical-japanese` 每節只有
    // 三個段落，書自己的字級下一屏就裝得下，而那時候 `next()` 會直接跨到下一節，
    // 量到的捲動位置就永遠是 0。#7 的 foliate spike 用的也是這個字級。
    const vertical = await mountFixture(page, "vertical-japanese", {
      settings: { fontSize: 64 },
    });
    expect(vertical.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const verticalOffset = await page.evaluate(() => window.frond.scrollOffset());

    const horizontal = await mountFixture(page, "huge-single-section");
    expect(horizontal.pageCount).toBeGreaterThan(1);

    await page.evaluate(() => window.frond.next());
    const horizontalOffset = await page.evaluate(() => window.frond.scrollOffset());

    // `scrollOffset()` 依書寫方向讀 scrollTop 或 scrollLeft，所以兩邊都大於零
    // 就表示各自的那一軸真的動了。這同時證明了 `overflow: hidden` 的分欄容器
    // 仍然捲得動——讀者捲不動它，frond 捲得動。
    expect(verticalOffset).toBeGreaterThan(0);
    expect(horizontalOffset).toBeGreaterThan(0);
  });
});

test.describe("分頁的幾何", () => {
  test("直排的欄寬等於一個 viewer 高", async ({ page }) => {
    // spine 那句「直排欄寬必須剛好等於一個 viewer 高」的機器版本。容器 800×600、
    // 邊界 24，所以 iframe 是 752×552，直排的欄寬取高度 552。
    await mountFixture(page, "vertical-japanese", { settings: { margin: 24 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("552px");
  });

  test("橫排的欄寬等於一個 viewer 寬", async ({ page }) => {
    await mountFixture(page, "huge-single-section", {
      settings: { margin: 24, columns: 1 },
    });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toBe("752px");
  });

  test("直排時注入直排標點的字符設定，橫排時不注入", async ({ page }) => {
    // WebKit 在直排下不自動套用 `vert`，日文句點留在左下（browser-quirks.md
    // 第一條）。三家共用同一條規則不分支——實測強制之後 Chromium 與 Firefox 的
    // 結果逐位元組不變。
    //
    // `vertical-writing.spec.ts` 那條驗的是「這套字型有直排字符且畫得出來」，
    // 因為它自己注入了 `"vert" 1`。這一條驗的是**Renderer 本身有做這件事**。
    await mountFixture(page, "vertical-japanese");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).toContain("vert");

    await mountFixture(page, "huge-single-section");
    expect(
      await page.evaluate(() => window.frond.computed("html", "font-feature-settings")),
    ).not.toContain("vert");
  });

  test("欄寬是整數像素", async ({ page }) => {
    // 分數欄寬會讓頁距累積誤差，翻幾十頁之後一屏疊出兩個半頁。
    await mountFixture(page, "vertical-japanese", { settings: { margin: 25 } });

    const columnWidth = await page.evaluate(() =>
      window.frond.computed("html", "column-width"),
    );

    expect(columnWidth).toMatch(/^\d+px$/);
  });
});

/**
 * 溢出的內容被裁掉——ADR-0003 介入清單裡的 `cap-overflowing-boxes` 那一格。
 *
 * `fixed-width-800` 演的是**行內軸**那一側（書寫死 `width: 800px`），這一組演的是
 * **區塊軸**：一張比一欄還高的圖版。兩側的機制不對稱，而那個不對稱正是實書上量到
 * 的病——`max-block-size: 100%` 需要一個確定的包含塊尺寸才解析得出來，而圖版外面
 * 那層 `height: auto` 的 div 讓它靜默地變成 `none`（`src/renderer/layout.ts`）。
 *
 * 症狀在 DOM 斷言上完全看不出來：圖在文件裡、`<img>` 的屬性都對、頁數也是一個
 * 正常的數字。看得出來的只有幾何——所以這一組量的是矩形。
 */
test.describe("比一欄還高的圖版", () => {
  /** 圖版在最後一節（`ailments.ts`）。 */
  const PLATE_SECTION = 2;

  test("圖被縮到一欄裝得下，不是被裁掉", async ({ page }) => {
    await mountFixture(page, "plate-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      PLATE_SECTION,
    );

    const plate = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return null;
      const inner = frame.contentDocument;
      const image = inner === null ? null : inner.querySelector(".plate img");
      if (inner === null || image === null) return null;

      const rect = image.getBoundingClientRect();
      return {
        width: rect.width,
        height: rect.height,
        // 一欄在區塊軸上的長度。橫排的區塊軸是 y。
        blockExtent: inner.documentElement.clientHeight,
      };
    });

    expect(plate).not.toBeNull();
    // 容器 800×600、邊界 24 → 一欄的區塊軸長度 552。圖原本 720 高。
    expect(plate!.blockExtent).toBe(552);
    expect(plate!.height).toBeLessThanOrEqual(plate!.blockExtent);

    // **等比縮放，不是壓扁。** 原圖 64×720，縮到 552 高應該是 49 寬左右；寬度
    // 沒跟著縮的話讀者看到的是一張變形的圖，而那與被裁掉一樣是呈現錯誤。
    const aspect = plate!.width / plate!.height;
    expect(aspect).toBeCloseTo(64 / 720, 1);
  });

  test("圖版整張都在畫面上——沒有一段落在容器外", async ({ page }) => {
    await mountFixture(page, "plate-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      PLATE_SECTION,
    );

    const overflow = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return -1;
      const inner = frame.contentDocument;
      const image = inner === null ? null : inner.querySelector(".plate img");
      if (inner === null || image === null) return -1;

      const rect = image.getBoundingClientRect();
      return rect.bottom - inner.documentElement.clientHeight;
    });

    // 病在的時候這個數字是好幾百：圖伸出容器，再被 `overflow: hidden` 裁掉，
    // 而分頁是沿行內軸推進的，所以裁掉的那一段**翻頁也翻不出來**。
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/**
 * 表格比一欄還高——**三家分歧，而 frond 修不掉，所以這一組釘住現況**。
 *
 * 寫法照 `regional-faces.spec.ts` 對 #4 的處置：不期待三家一致，把各家實測到的
 * 行為寫成一張表，然後斷言它們仍然是那樣。分歧是瀏覽器的性質，frond 要據此決定
 * 介不介入，所以它變了必須有人知道。
 *
 * ## 為什麼 `cap-overflowing-boxes` 對表格無效
 *
 * `:root table { max-block-size: <一欄>px }` 對表格是個 no-op：CSS 規定
 * `height` / `max-height` 對 `display: table` 的元素是**下限**而不是上限，表格一律
 * 照內容長。圖版那一份（`plate-taller-than-page`）修得掉正是因為替換元素沒有這條
 * 例外——兩份 fixture 因此不能合併。
 *
 * ## 為什麼不修
 *
 * 剩下的路是把 `display: table` 換掉（換成 block 之後每一列變成一個區塊，內容就
 * 會流進相鄰的欄，全部讀得到），代價是**表格的對齊整個消失**。「讀得到但對不齊」
 * 與「對得齊但一半看不到」哪個好，是一個權衡決定而不是一個 bug 修正，所以它登記
 * 成缺口（`src/renderer/interventions.ts`）而不是在這裡順手做掉。
 *
 * 樣本裡三本書共九節是這個形狀，最嚴重的一節被裁掉 2563px。
 */
test.describe("比一欄還高的表格（三家分歧，釘住現況）", () => {
  /** 表格在最後一節（`ailments.ts`）。 */
  const TABLE_SECTION = 2;

  /**
   * 這一家會不會把比一欄還高的表格切到相鄰的欄。
   *
   * 實測（`Dockerfile` 的映像）：**只有 Firefox 不會**。Chromium 與 WebKit 都把
   * 表格切成三段分到相鄰的欄，溢出 0；Firefox 一段都不切，表格排到 1302px 高、
   * 伸出容器 751px 再被 `overflow: hidden` 裁掉。
   *
   * Firefox 上的代價還不只那 751px：不切欄等於內容不往行內軸延伸，於是**整節的
   * 頁數變成 1**——表格後面的東西讀者一併看不到。
   *
   * 這個分布與實書一致：樣本裡帶表格的三本書（《FIRE．致富實踐》、
   * 《幽靈帝國拜占庭》、《激進市場》）在 Chromium 與 WebKit 上都沒有溢出，只有
   * Firefox 有，最嚴重的一節 2563px。
   */
  const FRAGMENTS_TALL_TABLES: Record<string, boolean> = {
    chromium: true,
    webkit: true,
    firefox: false,
  };

  test("表格切不切欄，落在這一家的實測行為上", async ({ page }, info) => {
    const fragments = FRAGMENTS_TALL_TABLES[info.project.name];
    expect(
      fragments,
      `FRAGMENTS_TALL_TABLES 少了 ${info.project.name}——新增瀏覽器要先量一次。`,
    ).toBeDefined();

    await mountFixture(page, "table-taller-than-page", { settings: { margin: 24 } });
    await page.evaluate(
      (index) => window.frond.goToSection(index),
      TABLE_SECTION,
    );

    const measured = await page.evaluate(() => {
      const frame = document.querySelector("#viewport iframe");
      if (!(frame instanceof HTMLIFrameElement)) return null;
      const inner = frame.contentDocument;
      const table = inner === null ? null : inner.querySelector("table");
      if (inner === null || table === null) return null;

      const root = inner.documentElement;
      const rows = [...inner.querySelectorAll("tr")];
      const lastRow = rows[rows.length - 1];
      return {
        // 橫排的區塊軸是 y（`geometry.ts` 那張表）。溢出就是「有內容落在容器外」。
        blockOverflow: root.scrollHeight - root.clientHeight,
        blockExtent: root.clientHeight,
        rows: rows.length,
        lastRowInsideBlockAxis:
          lastRow !== undefined &&
          lastRow.getBoundingClientRect().bottom <= root.clientHeight,
      };
    });

    expect(measured).not.toBeNull();
    // 前提：這份 fixture 的表格真的裝不進一欄。
    //
    // **不能用 `table.getBoundingClientRect().height` 問這件事**：切欄的那幾家
    // 回的是所有 fragment 的聯集，高度剛好就是一欄（552），於是「比一欄還高」
    // 在它們身上永遠不成立。要問的是列數與內容——30 列 × 一列約 29px 遠超過 552。
    expect(measured!.rows).toBe(30);

    if (fragments === true) {
      expect(measured!.blockOverflow).toBeLessThanOrEqual(2);
      // 切欄的那幾家，最後一列真的落在容器裡——溢出 0 也可能是因為表格整個
      // 沒畫出來，多這一條把那種情況分開。
      expect(measured!.lastRowInsideBlockAxis).toBe(true);
    } else {
      // 這一行是「現況」而不是「期望」：它紅掉最可能的原因是那家瀏覽器開始支援
      // 表格的欄切割了——那時候要更新的是 FRAGMENTS_TALL_TABLES，而缺口也就可以
      // 從 interventions.ts 拿掉。
      expect(measured!.blockOverflow).toBeGreaterThan(2);
    }
  });
});
