import { existsSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";

/**
 * Opening a book — the consumer hands `EpubBook` a book's bytes and needs to know
 * nothing else.
 *
 * This group guards the **entry point**: all three input types are accepted, and both
 * EPUB versions open. Decompression and the container format (OCF's `mimetype`,
 * `META-INF/container.xml`, where the package document lives) are `EpubBook`'s
 * obligation, not the consumer's — a bookshelf just wants to hand over a `File` and get
 * back a title.
 *
 * Assertions are always made against the public API (#8): what is visible here is what
 * the consumer sees.
 */

describe("the three input types", () => {
  // The expected value comes from the fixture generator's template (baseSpec in
  // `src/test-fixtures/ailments.ts`): the title is `frond fixture — <ailment name>`.
  // Written out literally rather than asked of the generator — computing the expected
  // value with the generator would have the assertion and the code under test both
  // consult the same possibly-wrong source.
  const title = "frond fixture — vertical-japanese";

  test("ArrayBuffer", async () => {
    const bytes = await readFixture("vertical-japanese.epub");
    const book = await EpubBook.open(bytes.buffer);

    expect(book.metadata.title).toBe(title);
  });

  test("Blob", async () => {
    const book = await EpubBook.open(
      new Blob([await readFixture("vertical-japanese.epub")]),
    );

    expect(book.metadata.title).toBe(title);
  });

  test("File", async () => {
    const book = await EpubBook.open(
      new File([await readFixture("vertical-japanese.epub")], "vertical-japanese.epub", {
        type: "application/epub+zip",
      }),
    );

    expect(book.metadata.title).toBe(title);
  });
});

describe("EPUB 3", () => {
  test("opens, and reports itself as EPUB 3", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.epubVersion).toBe("epub3");
  });
});

describe("the published entry point", () => {
  test("the @yurenju/frond/epub exports entry point opens a book", async () => {
    // Every other test goes through a relative path (that is this repo's internal
    // idiom), but what the consumer gets is the route through package.json's exports —
    // and if nobody walks that route, a typo in a path makes nothing go red.
    //
    // **That route points at `dist/`, not `src/`**, so this test needs `npm run build`
    // to have run before there is anything to load (`npm install`'s `prepare` runs it;
    // in the container the Dockerfile does). That is exactly where its value is: it is
    // the only test that executes the shipped artifact, proving the emitted JavaScript
    // actually runs — a botched extension rewrite or a typo in an `exports` path goes
    // red right here.
    //
    // The assertion is "a book opens" rather than "this is the same object the relative
    // import gives": the latter happened to hold back when exports pointed at src, but
    // that was a coincidence rather than a fact worth guarding. Pointing at `dist/`
    // makes them different module instances by construction, and what the consumer
    // cares about was always whether it works.
    //
    // ## Why the specifier goes through a variable
    //
    // A literal `import("@yurenju/frond/epub")` would make **tsc resolve that route
    // too**, so `npm run typecheck` would start requiring `dist/` to exist — a freshly
    // cloned, not-yet-built tree would get `TS2307: Cannot find module
    // '@yurenju/frond/epub'`, and that message gives no hint that the real cause is
    // "not built yet".
    //
    // Going through a variable makes tsc give up resolving (the type degrades to
    // `any`), and this test goes back to being what it always should have been: **an
    // assertion about runtime**. The shipped artifact's type half is not this test's
    // business — `release.yml` verifies that with a fake consumer outside the repo and
    // `skipLibCheck: false`, and that vantage point is more accurate than this one
    // because it looks in from outside, like a real consumer.
    // When `dist/` is absent, Node throws `Cannot find package '@yurenju/frond'` — a
    // message that points at the `exports` configuration when the real cause is "not
    // built yet". Say so first.
    expect(
      existsSync(new URL("../../../dist/epub/index.js", import.meta.url)),
      "dist/ does not exist. This test goes through the shipped artifact; run `npm run build` first",
    ).toBe(true);

    const publishedEntryPoint = "@yurenju/frond/epub";
    const entry = await import(publishedEntryPoint);
    const book = await entry.EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.metadata.title).toBe("frond fixture — vertical-japanese");
    expect(book.readingOrder.length).toBeGreaterThan(0);
  });
});

describe("zero DOM dependency", () => {
  test("the environment these tests run in has no DOM", async () => {
    // ADR-0005's two-layer split: `EpubBook` has zero DOM dependency, which is why it
    // runs in Node and why its tests sit at the bottom of the pyramid (ADR-0009). This
    // assertion pins the **test environment** — if someone switches Vitest's
    // environment to jsdom, none of the tests above prove that any more, and nothing
    // else would go red on that regression.
    expect(globalThis.document).toBeUndefined();
    expect(globalThis.DOMParser).toBeUndefined();

    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.readingOrder.length).toBeGreaterThan(0);
  });
});

describe("EPUB 2", () => {
  test("opens, and reports itself as EPUB 2", async () => {
    // EPUB 2 has been in scope since day one (ADR-0010) — not "do EPUB 3 first and come
    // back for it".
    const book = await EpubBook.open(await readFixture("healthy-epub2.epub"));

    expect(book.metadata.epubVersion).toBe("epub2");
    expect(book.metadata.title).toBe("frond fixture — healthy-epub2");
  });
});
