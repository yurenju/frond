import { expect, test } from "@playwright/test";
import { openHarness } from "../support/harness.js";

/**
 * 隔離：書內的東西跑不起來，書的 CSS 也污染不到消費端（ADR-0006、user story 52、53）。
 *
 * > 因 WebKit bug 218086，iframe 要能發事件就必須加 `allow-scripts`，而加了之後
 * > sandbox 的隔離價值大幅喪失。因此 frond **不支援** EPUB 的 scripted content
 * > ……這是**安全決策，不是功能取捨**。
 *
 * 「不支援」在實作上只有一個意思：**把跑得起來的東西從文件裡拿掉**。sandbox 幫不
 * 上忙（`allow-scripts` 是被 WebKit 逼開的），來源也幫不上忙（`blob:` 帶的就是
 * 消費端 app 的來源）。所以這一支是那道防線唯一的守衛。
 *
 * 內容用 `mountInline` 手寫而不是做成 committed fixture：ADR-0007 的紀律是一個檔
 * 一個**排版病症**，而「書裡有 script」是安全性質不是排版病症。
 */

/** 腳本跑起來時會留下的痕跡。它要落在**外層頁面**上才算數。 */
const MARKER = "__frond_script_ran__";

function sectionWith(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="ja">
  <head><title>t</title></head>
  <body><p>本文がここにあります。</p>${body}</body>
</html>`;
}

test.beforeEach(async ({ page }) => {
  await openHarness(page);
  await page.evaluate((marker) => {
    (window as unknown as Record<string, unknown>)[marker] = false;
  }, MARKER);
});

test.describe("書內的腳本", () => {
  test("<script> 不會進到文件裡，也不會執行", async ({ page }) => {
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [sectionWith(`<script>window.top["${MARKER}"] = true;</script>`)] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("<script");
    expect(
      await page.evaluate(
        (marker) => (window as unknown as Record<string, unknown>)[marker],
        MARKER,
      ),
    ).toBe(false);
  });

  test("SVG 裡的 <script> 也拿得掉——它在另一個命名空間", async ({ page }) => {
    // `getElementsByTagName("script")` 在 XML 文件裡是照 qualified name 比對的，
    // 所以帶前綴的寫法會漏掉。這一條釘住的是「用 NS 版本查」這個選擇。
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">` +
            `<script>window.top["${MARKER}"] = true;</script></svg>`,
        ),
      ] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("<script");
    expect(
      await page.evaluate(
        (marker) => (window as unknown as Record<string, unknown>)[marker],
        MARKER,
      ),
    ).toBe(false);
  });

  test("on* 事件屬性拿得掉", async ({ page }) => {
    // 只拿掉 <script> 的話，這條路還開著。
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [sectionWith(`<p onclick="window.top['${MARKER}'] = true;">押す</p>`)] as const,
    );

    expect(await page.evaluate(() => window.frond.html())).not.toContain("onclick");
  });
});

test.describe("巢狀的瀏覽環境", () => {
  /**
   * 這一組守的是最容易漏、後果也最嚴重的那一格。
   *
   * `<iframe>` 與 `<object>` 會開出**巢狀的瀏覽環境**，而巢狀的環境**繼承** parent
   * 的 sandbox 旗標——連同那個被 WebKit 逼開的 `allow-scripts` 一起。它載進來的
   * 那份文件從來沒有經過 `stripScriptedContent`（那一步只清理最外層），而
   * `blob:` 帶的是消費端 app 的來源。
   *
   * 三件事疊起來的結果是：書裡放一份帶腳本的 XHTML，用 `<iframe>` 指過去，那段
   * 腳本就以 app 的來源執行——`<script>` 拿不拿掉完全無關。
   */
  for (const [name, markup] of [
    ["iframe", `<iframe src="inline-2.xhtml"></iframe>`],
    ["object", `<object data="inline-2.xhtml" type="application/xhtml+xml"></object>`],
    ["embed", `<embed src="inline-2.xhtml" type="application/xhtml+xml"/>`],
  ] as const) {
    test(`<${name}> 整個拿掉，它指的那份文件不會被載進來`, async ({ page }) => {
      const hostile = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>
<body><script>window.top["${MARKER}"] = true;</script><p>埋め込み</p></body></html>`;

      await page.evaluate(
        ([outer, inner]) =>
          window.frond.mountInline([outer as string, inner as string], {}),
        [sectionWith(markup), hostile] as const,
      );

      const html = await page.evaluate(() => window.frond.html());
      expect(html).not.toContain(`<${name}`);

      // 外層頁面沒有被寫到——那才是「以 app 的來源執行」真正的判準。
      expect(
        await page.evaluate(
          (marker) => (window as unknown as Record<string, unknown>)[marker],
          MARKER,
        ),
      ).toBe(false);

      // 而書本身照樣讀得到：拿掉的是載體，不是內容。
      expect(html).toContain("本文がここにあります");
    });
  }
});

test.describe("樣式的隔離", () => {
  test("書的全域選擇器污染不到消費端的頁面（user story 52）", async ({ page }) => {
    // iframe 而不是 Shadow DOM 的理由（ADR-0006）：EPUB 樣式表大量使用
    // `body`、`*` 這類全域選擇器，Shadow DOM 擋不住那種等級的污染。
    await page.evaluate(
      ([source]) => window.frond.mountInline([source as string], {}),
      [
        sectionWith(
          `<style>* { color: rgb(255, 0, 0) !important; }` +
            `body { background: rgb(0, 255, 0) !important; }</style>`,
        ),
      ] as const,
    );

    const outer = await page.evaluate(() => {
      const style = window.getComputedStyle(document.body);
      return { color: style.color, background: style.backgroundColor };
    });

    expect(outer.color).not.toBe("rgb(255, 0, 0)");
    expect(outer.background).not.toBe("rgb(0, 255, 0)");
  });
});
