import { describe, expect, test } from "vitest";
import { mapStylesheet } from "../../../packages/frond/src/renderer/css.ts";
import { pageMetrics } from "../../../packages/frond/src/renderer/geometry.ts";
import { layoutStylesheet } from "../../../packages/frond/src/renderer/layout.ts";
import { INTERVENTIONS } from "../../../packages/frond/src/renderer/interventions.ts";
import { readerStylesheet, withSettings, DEFAULT_SETTINGS } from "../../../packages/frond/src/renderer/settings.ts";

/**
 * The gatekeeper for ADR-0003's **closed list**.
 *
 * > The danger is not on day one but on day thirty: "we already override column-width,
 * > so let us adjust line-height while we are here" — and six months later nobody
 * > remembers why the book does not look the way its author designed it.
 *
 * So `REQUIRED_BY_ADR_0003` below is compared with `INTERVENTIONS` for **set equality**,
 * and one entry too many or too few on either side goes red. Adding an intervention
 * therefore always passes through editing this test, and whoever edits it reads this
 * passage. It is the same shape as `single-ailment.test.ts` guarding ADR-0007's table.
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
  "resolve-generic-families",
  "strip-scripted-content",
  "unprefix-writing-mode",
  "vertical-punctuation",
];

describe("the closed list of interventions", () => {
  test("the list is exactly the one ADR-0003 sanctions", () => {
    expect(INTERVENTIONS.map((intervention) => intervention.id).sort()).toEqual(
      [...REQUIRED_BY_ADR_0003].sort(),
    );
  });

  test("no duplicate ids", () => {
    expect(new Set(INTERVENTIONS.map((i) => i.id)).size).toBe(INTERVENTIONS.length);
  });

  test("every entry states its reason and where it is implemented", () => {
    for (const intervention of INTERVENTIONS) {
      expect(intervention.what.length, intervention.id).toBeGreaterThan(0);
      expect(intervention.why.length, intervention.id).toBeGreaterThan(0);
      expect(intervention.where, intervention.id).toMatch(/^src\/renderer\//);
    }
  });

  test("the entries that really override the book have only two reasons — the two in ADR-0003's body", () => {
    // frond-own-layer and syntax-translation do not count as overriding (see the table in
    // interventions.ts). This case blocks the slope of "add one more reason that sounds
    // perfectly sensible".
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

  test("every reader-blocked entry happens only once the reader has set something", () => {
    // The machine-readable form of ADR-0003's threshold: with no reader setting, nothing
    // is being blocked.
    for (const intervention of INTERVENTIONS) {
      if (intervention.reason === "reader-blocked") {
        expect(intervention.onlyWhenReaderOverrides, intervention.id).toBe(true);
      }
    }
  });

  test("every CSS property frond actually injects is named somewhere on the list", () => {
    // **This is where the list gets its teeth.** The set equality above can only prove
    // "the list was not quietly edited"; it cannot prove "the code did not quietly add a
    // declaration" — it compares the list against a copy of the list.
    //
    // This instead checks the **stylesheets actually produced** against the list:
    // `layoutStylesheet` and `readerStylesheet` are both pure functions returning exactly
    // the text injected into the document. Any newly added declaration goes red as soon as
    // its property name is absent from some intervention's `what`.
    //
    // It goes through `mapStylesheet` (`css.ts`'s declaration locator) rather than a
    // regular expression: that one already handles comments, strings and colons in
    // selectors, and this asks the very same question.
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
          // The theme is given every field it has, `link` included: this check is only
          // worth anything if what it collects is the **complete** injected surface, and a
          // field left out here is a rule this test never sees.
          theme: { foreground: "#eee", background: "#111", link: "#8ab4f8" },
        }),
      ),
    );

    expect(declared.size).toBeGreaterThan(10);

    const registered = INTERVENTIONS.map((intervention) => intervention.what).join("\n");
    for (const property of declared) {
      expect(registered, `${property} is not registered under any intervention`).toContain(property);
    }
  });

  test("frond's own layer and syntax translation must not be tied to reader settings", () => {
    // Tying them would make a book that writes only a prefixed writing-mode lay out
    // horizontally in Firefox because the reader never adjusted the font size — two things
    // that have nothing to do with each other.
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
