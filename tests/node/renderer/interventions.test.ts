import { describe, expect, test } from "vitest";
import { mapStylesheet } from "../../../src/renderer/css.ts";
import { pageMetrics } from "../../../src/renderer/geometry.ts";
import { layoutStylesheet } from "../../../src/renderer/layout.ts";
import { INTERVENTIONS } from "../../../src/renderer/interventions.ts";
import { readerStylesheet, withSettings, DEFAULT_SETTINGS } from "../../../src/renderer/settings.ts";

/**
 * ADR-0003 那份**封閉清單**的守門人。
 *
 * > 危險不在第一天而在第三十天：「反正已經覆寫 column-width 了，line-height 也
 * > 順手調一下吧」，然後半年後沒人記得為什麼書的排版跟原作者設計的不一樣。
 *
 * 所以下面這份 `REQUIRED_BY_ADR_0003` 與 `INTERVENTIONS` 比的是**集合相等**，
 * 任一側多一項或少一項都會紅。加一項介入因此一定會經過改這支測試那一步，而改
 * 它的人會讀到這段話。這與 `single-ailment.test.ts` 守 ADR-0007 那張表是同一個
 * 形狀。
 */
const REQUIRED_BY_ADR_0003 = [
  "blob-urls",
  "cap-overflowing-boxes",
  "column-break",
  "demote-important",
  "integer-page-geometry",
  "multicol-pagination",
  "reader-stylesheet",
  "relativise-font-size",
  "reset-root-box",
  "strip-scripted-content",
  "unprefix-writing-mode",
  "vertical-punctuation",
];

describe("介入的封閉清單", () => {
  test("清單與 ADR-0003 認可的那一份完全相同", () => {
    expect(INTERVENTIONS.map((intervention) => intervention.id).sort()).toEqual(
      [...REQUIRED_BY_ADR_0003].sort(),
    );
  });

  test("id 不重複", () => {
    expect(new Set(INTERVENTIONS.map((i) => i.id)).size).toBe(INTERVENTIONS.length);
  });

  test("每一項都寫了理由與實作位置", () => {
    for (const intervention of INTERVENTIONS) {
      expect(intervention.what.length, intervention.id).toBeGreaterThan(0);
      expect(intervention.why.length, intervention.id).toBeGreaterThan(0);
      expect(intervention.where, intervention.id).toMatch(/^src\/renderer\//);
    }
  });

  test("真的覆寫了書的那幾項，只有兩種理由——ADR-0003 正文的那兩種", () => {
    // frond-own-layer 與 syntax-translation 不算覆寫（見 interventions.ts 的表）。
    // 這條擋的是「新增一種聽起來很合理的理由」這個滑坡。
    const overriding = INTERVENTIONS.filter(
      (intervention) =>
        intervention.reason === "content-unreadable" ||
        intervention.reason === "reader-blocked",
    );

    expect(overriding.length).toBeGreaterThan(0);
    for (const intervention of INTERVENTIONS) {
      expect(
        ["content-unreadable", "reader-blocked", "frond-own-layer", "syntax-translation"],
        intervention.id,
      ).toContain(intervention.reason);
    }
  });

  test("reader-blocked 的每一項都只在讀者設過東西時才發生", () => {
    // 這是 ADR-0003 門檻的機器版本：沒有讀者設定就沒有東西被擋住。
    for (const intervention of INTERVENTIONS) {
      if (intervention.reason === "reader-blocked") {
        expect(intervention.onlyWhenReaderOverrides, intervention.id).toBe(true);
      }
    }
  });

  test("frond 實際注入的每一個 CSS 屬性，清單上都點得到名字", () => {
    // **這一條才是這份清單真正的牙齒。** 上面那條集合相等只能證明「清單沒有被
    // 偷改」，證明不了「程式碼沒有偷偷多寫一條宣告」——它比的是清單與清單的複本。
    //
    // 這裡改成拿**實際產出的樣式表**去對清單：`layoutStylesheet` 與
    // `readerStylesheet` 都是純函式，回傳的就是最後注入文件的那份文字。任何一條
    // 新增的宣告，只要屬性名沒有出現在某一項介入的 `what` 裡，就會紅。
    //
    // 走 `mapStylesheet`（`css.ts` 的宣告定位器）而不是正規表示式：那支已經處理
    // 過註解、字串與選擇器裡的冒號，而這裡要問的正是同一個問題。
    const declared = new Set<string>();
    const collect = (css: string): void => {
      mapStylesheet(css, (declaration) => {
        declared.add(declaration.property);
        return undefined;
      });
    };

    for (const writingMode of ["horizontal-tb", "vertical-rl"] as const) {
      collect(
        layoutStylesheet(
          pageMetrics({
            writingMode,
            viewport: { width: 800, height: 600 },
            columns: writingMode === "vertical-rl" ? 1 : 2,
            gap: 40,
          }),
          writingMode,
        ),
      );
    }

    collect(
      readerStylesheet(
        withSettings(DEFAULT_SETTINGS, {
          fontFamily: '"Noto Serif CJK JP"',
          fontSize: 24,
          lineHeight: 2,
          theme: { foreground: "#eee", background: "#111" },
        }),
      ),
    );

    expect(declared.size).toBeGreaterThan(10);

    const registered = INTERVENTIONS.map((intervention) => intervention.what).join("\n");
    for (const property of declared) {
      expect(registered, `${property} 沒有登記在任何一項介入裡`).toContain(property);
    }
  });

  test("frond 自己那一層與語法翻譯不該綁在讀者設定上", () => {
    // 綁上去的話，一本只寫前綴 writing-mode 的書會因為讀者沒調字級而在
    // Firefox 上排成橫排——兩件事本來就沒有關係。
    for (const intervention of INTERVENTIONS) {
      if (
        intervention.reason === "frond-own-layer" ||
        intervention.reason === "syntax-translation"
      ) {
        expect(intervention.onlyWhenReaderOverrides, intervention.id).toBe(false);
      }
    }
  });
});
