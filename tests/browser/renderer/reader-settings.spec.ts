import { expect, test } from "@playwright/test";
import { mountFixture, openHarness } from "../support/harness.js";

/**
 * 讀者設定，以及它與書的層疊之間那場架。
 *
 * ADR-0003 把權威順序訂成 `讀者設定 > frond 修正 > 書的宣告`，並且點名這件事
 * **不是免費的**：
 *
 * > 書可以寫 `font-size: 12px !important`，而外部 stylesheet 打不贏 inline
 * > `!important`。frond 內部因此需要一套認真的 cascade 對抗機制，不是注入一段
 * > CSS 就結束——這是 frond 相對 foliate 真正要多做的工程之一。
 *
 * 這支 spec 的每一條都在量那套機制的結果。而**同樣重要的是反面**：讀者沒設的
 * 項目，書的宣告要一個字都不變（user story 45）。那幾條就是介入清單不會慢慢長大
 * 的守門人。
 */

test.beforeEach(async ({ page }) => {
  await openHarness(page);
});

test.describe("讀者沒設定的時候，書說了算", () => {
  test("書寫死的 !important 字級照樣生效", async ({ page }) => {
    // ADR-0003 的門檻：沒有讀者設定就沒有東西被擋住，也就沒有介入的理由。
    await mountFixture(page, "font-size-important");

    expect(await computed(page, "p", "font-size")).toBe("12px");
  });

  test("書寫死的顏色照樣生效", async ({ page }) => {
    await mountFixture(page, "hardcoded-colors");

    expect(await computed(page, "body", "color")).toBe("rgb(0, 0, 0)");
    expect(await computed(page, "body", "background-color")).toBe("rgb(255, 255, 255)");
  });

  test("注入的讀者樣式表是空的", async ({ page }) => {
    await mountFixture(page, "vertical-japanese");

    const html = await page.evaluate(() => window.frond.html());
    expect(html).toMatch(/<style[^>]*id="frond-reader"[^>]*>\s*<\/style>/);
  });
});

test.describe("字級", () => {
  test("書沒有意見時，讀者說多大就多大", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", { settings: { fontSize: 24 } });

    expect(await computed(page, "p", "font-size")).toBe("24px");
  });

  test("書寫死 !important 也擋不住讀者", async ({ page }) => {
    // user story 42。書說 12px（也就是預設 16px 的 0.75 倍），讀者說基準是 24px，
    // 所以正文是 18px——**書自己的比例保留，絕對值讓給讀者**。
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });

    expect(await computed(page, "p", "font-size")).toBe("18px");
  });

  test("讀者再調一次，比例跟著走", async ({ page }) => {
    // 這一條才證明字級真的「可調」而不是被換成另一個定值。
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });
    await page.evaluate(() => window.frond.applySettings({ fontSize: 32 }));

    expect(await computed(page, "p", "font-size")).toBe("24px");
  });

  test("書自己的字級層次保留——標題仍然比正文大", async ({ page }) => {
    await mountFixture(page, "font-size-important", { settings: { fontSize: 24 } });

    const heading = parseFloat(await computed(page, "h1", "font-size"));
    const paragraph = parseFloat(await computed(page, "p", "font-size"));

    expect(heading).toBeGreaterThan(paragraph);
  });
});

test.describe("字面與行高", () => {
  test("讀者指名的字面蓋過書的宣告", async ({ page }) => {
    // 指名而不是 generic family：三家對 generic 的 CJK 解析不一致（#4），而讀者
    // 設定是權威順序裡唯一能合法指名的一層（ADR-0004）。
    await mountFixture(page, "vertical-japanese", {
      settings: { fontFamily: '"Noto Sans CJK JP"' },
    });

    expect(await computed(page, "p", "font-family")).toContain("Noto Sans CJK JP");
  });

  test("行高吃得到", async ({ page }) => {
    await mountFixture(page, "vertical-japanese", {
      settings: { fontSize: 20, lineHeight: 2 },
    });

    expect(await computed(page, "p", "line-height")).toBe("40px");
  });
});

test.describe("主題", () => {
  test("書寫死黑字白底，讀者的暗色模式照樣生效", async ({ page }) => {
    // user story 43。
    await mountFixture(page, "hardcoded-colors", {
      settings: { theme: { foreground: "#eeeeee", background: "#111111" } },
    });

    expect(await computed(page, "body", "color")).toBe("rgb(238, 238, 238)");
    // 書寫在 body 上的白底變透明，讀者的底色從根元素透出來——全部設成讀者的
    // 底色會讓書用底色區分的引文區塊消失。
    expect(await computed(page, "body", "background-color")).toBe("rgba(0, 0, 0, 0)");
    expect(await computed(page, "html", "background-color")).toBe("rgb(17, 17, 17)");
  });

  test("底色也塗在容器上，邊界那一圈不會留白", async ({ page }) => {
    // 邊界在 iframe 外面，所以它不在書的文件裡——只塗文件的話深色模式下文字
    // 四周會留一圈消費端頁面的白底。這一條是照 `docs/evidence/32/` 那批截圖
    // 判讀出來的缺陷補的。
    await mountFixture(page, "hardcoded-colors", {
      settings: { theme: { foreground: "#eeeeee", background: "#111111" } },
    });

    const background = await page.evaluate(() => {
      const container = document.getElementById("viewport");
      return container === null
        ? ""
        : window.getComputedStyle(container).backgroundColor;
    });

    expect(background).toBe("rgb(17, 17, 17)");
  });

  test("沒有主題時不碰容器的底色", async ({ page }) => {
    // 那時候消費端自己的底色才是對的答案。
    await mountFixture(page, "hardcoded-colors");

    const inline = await page.evaluate(
      () => document.getElementById("viewport")?.style.backgroundColor ?? "",
    );

    expect(inline).toBe("");
  });
});

test.describe("固定寬度的書", () => {
  test("width: 800px 在小一點的版面上不會被裁掉", async ({ page }) => {
    // ADR-0003 的「內容讀不到」那一格。容器 800、邊界 24、單欄，所以一欄是 752 寬。
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 1 },
    });

    expect(await computed(page, "body", "width")).toBe("752px");
  });

  test("放得下的時候這條介入是 no-op", async ({ page }) => {
    // 這一條擋的是「一律把 body 縮到版面寬」這種過度介入：書要求 800px 而一欄
    // 有 900px 時，書應該拿到它要的 800px。
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 1 },
      viewport: { width: 948, height: 600 },
    });

    expect(await computed(page, "body", "width")).toBe("800px");
  });

  test("雙欄時上限是一欄的寬度，不是整個版面", async ({ page }) => {
    // 分欄容器裡的百分比是**相對於一欄**的，不是相對於容器——所以
    // `max-inline-size: 100%` 剛好等於「內容要塞得進一欄」。那正是這條介入要的
    // 意思，但它是 CSS 的性質而不是 frond 寫的規則，所以在這裡釘住：哪天百分比
    // 的基準變了，這條會紅，而別條不會。
    //
    // 版面 752、欄距 40，兩欄各 356。
    await mountFixture(page, "fixed-width-800", {
      settings: { margin: 24, columns: 2 },
    });

    expect(await computed(page, "body", "width")).toBe("356px");
  });
});

test.describe("欄數", () => {
  test("橫排可以要兩欄", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { columns: 2 } });

    expect(await computed(page, "html", "column-count")).toBe("2");
  });

  test("直排一律單欄，設兩欄也一樣", async ({ page }) => {
    // ADR-0003 明列的刻意簡化。不是錯誤，是一個此刻不適用的偏好。
    await mountFixture(page, "vertical-japanese", { settings: { columns: 2 } });

    expect(await computed(page, "html", "column-count")).toBe("1");
  });
});

test.describe("邊界", () => {
  test("邊界靠把 iframe 縮進來，不是注入 padding 給書", async ({ page }) => {
    // 注入 padding 給分欄容器會讓第一欄與其餘的欄起點不一樣，「翻一頁 = 移動一個
    // 頁距」就不再成立。所以書的 body 一個 padding 都拿不到。
    await mountFixture(page, "huge-single-section", { settings: { margin: 50 } });

    expect(await computed(page, "html", "width")).toBe("700px");
    expect(await computed(page, "body", "padding-top")).toBe("0px");
  });

  test("換邊界之後版面跟著換", async ({ page }) => {
    await mountFixture(page, "huge-single-section", { settings: { margin: 50 } });
    await page.evaluate(() => window.frond.applySettings({ margin: 10 }));

    expect(await computed(page, "html", "width")).toBe("780px");
  });
});

async function computed(
  page: Parameters<typeof mountFixture>[0],
  selector: string,
  property: string,
): Promise<string> {
  return page.evaluate(
    ([element, name]) => window.frond.computed(element as string, name as string),
    [selector, property] as const,
  );
}
