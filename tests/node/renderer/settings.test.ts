import { describe, expect, test } from "vitest";
import {
  DEFAULT_SETTINGS,
  overriddenProperties,
  readerStylesheet,
  withSettings,
  type ReaderSettings,
} from "../../../packages/frond/src/renderer/settings.ts";

/**
 * 讀者設定那一層。
 *
 * 這一組的重心不在「設了會怎樣」，而在**沒設會怎樣**——ADR-0003 的門檻是
 * 「讀者設定被書擋住」，沒有讀者設定就不成立，而漏掉那條的實作會在每一本書上
 * 都覆寫一輪，然後沒有人發現：畫面看起來正常，只是作者的設計被抹掉了。
 */

function settings(patch: Partial<ReaderSettings> = {}): ReaderSettings {
  return withSettings(DEFAULT_SETTINGS, patch);
}

describe("預設值", () => {
  test("除了邊界，什麼都沒設", () => {
    expect(DEFAULT_SETTINGS.fontFamily).toBeUndefined();
    expect(DEFAULT_SETTINGS.fontSize).toBeUndefined();
    expect(DEFAULT_SETTINGS.lineHeight).toBeUndefined();
    expect(DEFAULT_SETTINGS.theme).toBeUndefined();
  });

  test("邊界有預設值——0 的話文字會貼著螢幕邊", () => {
    expect(DEFAULT_SETTINGS.margin).toBeGreaterThan(0);
  });

  test("什麼都沒設時，注入的樣式表是空的", () => {
    // 這一條是 user story 45（沒有主動調整時，書的排版被完整保留）的機器版本。
    expect(readerStylesheet(DEFAULT_SETTINGS)).toBe("");
  });

  test("什麼都沒設時，一個 !important 都不拿掉", () => {
    expect(overriddenProperties(DEFAULT_SETTINGS).size).toBe(0);
  });
});

describe("介入的範圍", () => {
  test("設了字級只碰字級（外加 font 縮寫）", () => {
    const properties = overriddenProperties(settings({ fontSize: 24 }));

    expect([...properties].sort()).toEqual(["font", "font-size"]);
  });

  test("設了主題碰的是顏色那幾格，不碰字級", () => {
    const properties = overriddenProperties(
      settings({ theme: { foreground: "#eee", background: "#111" } }),
    );

    expect(properties.has("color")).toBe(true);
    expect(properties.has("background-color")).toBe(true);
    expect(properties.has("font-size")).toBe(false);
  });

  test("font 縮寫一定包含進來——它一條就能寫死字級、行高與字面", () => {
    expect(overriddenProperties(settings({ lineHeight: 2 })).has("font")).toBe(true);
    expect(overriddenProperties(settings({ fontFamily: "X" })).has("font")).toBe(true);
  });
});

describe("注入的樣式表", () => {
  test("字級只設在根元素——書自己的層次靠繼承保留", () => {
    const css = readerStylesheet(settings({ fontSize: 24 }));

    expect(css).toContain(":root { font-size: 24px !important; }");
    // 設到每一個元素上的話，標題與正文會一樣大。
    expect(css).not.toContain(":root * { font-size");
  });

  test("字面設到每一個元素上——書在後代元素上的宣告蓋不回來", () => {
    const css = readerStylesheet(settings({ fontFamily: '"Noto Serif CJK JP"' }));

    expect(css).toContain(':root, :root * { font-family: "Noto Serif CJK JP" !important; }');
  });

  test("主題的底色只給根元素，其餘一律透明", () => {
    const css = readerStylesheet(
      settings({ theme: { foreground: "#eeeeee", background: "#111111" } }),
    );

    expect(css).toContain(":root { background-color: #111111 !important; }");
    expect(css).toContain(":root *:not(:root) { background-color: transparent !important; }");
    expect(css).toContain("color: #eeeeee !important;");
  });

  test("邊界不出現在注入的 CSS 裡——它在 iframe 外面", () => {
    // 注入書的 CSS 去搶 body 的 padding，正是 spine 掛 MutationObserver 的原因。
    expect(readerStylesheet(settings({ margin: 48 }))).not.toContain("48");
  });

  test("欄數不出現在讀者的樣式表裡——它是分頁那一層的參數", () => {
    expect(readerStylesheet(settings({ columns: 2 }))).toBe("");
  });
});

describe("套用局部設定", () => {
  test("沒提到的欄位保持原樣", () => {
    const first = withSettings(DEFAULT_SETTINGS, { fontSize: 24 });
    const second = withSettings(first, { lineHeight: 2 });

    expect(second.fontSize).toBe(24);
    expect(second.lineHeight).toBe(2);
    expect(second.margin).toBe(DEFAULT_SETTINGS.margin);
  });

  test("設回 undefined 就是取消那一項", () => {
    const applied = withSettings(settings({ fontSize: 24 }), { fontSize: undefined });

    expect(applied.fontSize).toBeUndefined();
    expect(readerStylesheet(applied)).toBe("");
  });
});
