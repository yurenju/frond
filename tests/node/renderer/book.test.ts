import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { EpubBook } from "../../../src/epub/index.ts";
import { MemoryBook, type RenderableBook } from "../../../src/renderer/book.ts";

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

describe("EpubBook satisfies what Renderer requires of a book", () => {
  test("an opened book can be used directly as a RenderableBook", async () => {
    // **This test's value is in the types, not at runtime.** `RenderableBook` is a structural
    // interface, and not one line of code declares `EpubBook implements RenderableBook` — so
    // when the two drift, the only thing that turns red is this line's type check. Without it,
    // Renderer would silently fail to connect after some change to EpubBook's fields, and that
    // would only blow up in the browser tests.
    const book: RenderableBook = await EpubBook.open(
      readFileSync(join(FIXTURE_DIRECTORY, "vertical-japanese.epub")),
    );

    expect(book.readingOrder.length).toBeGreaterThan(0);
    expect(book.resources.length).toBeGreaterThan(0);
    expect(book.bytes(book.readingOrder[0]!.path).length).toBeGreaterThan(0);
  });
});

describe("MemoryBook", () => {
  const book = MemoryBook.of({
    sections: [
      { path: "one.xhtml", content: "<p>一</p>" },
      { path: "two.xhtml", content: "<p>二</p>", linear: false },
    ],
    resources: [
      { path: "images/a.png", mediaType: "image/png", bytes: Uint8Array.of(1, 2, 3) },
    ],
  });

  test("it is a RenderableBook", () => {
    const renderable: RenderableBook = book;
    expect(renderable.readingOrder.length).toBe(2);
  });

  test("content is encoded as UTF-8", () => {
    expect(new TextDecoder().decode(book.bytes("one.xhtml"))).toBe("<p>一</p>");
  });

  test("linear defaults to true, and follows what was specified when it was", () => {
    expect(book.readingOrder[0]!.linear).toBe(true);
    // Non-linear items **stay in the list** — filtering out cover and copyright pages is
    // policy, not fact (ADR-0002).
    expect(book.readingOrder[1]!.linear).toBe(false);
  });

  test("content documents and other resources are all on resources, with a findable media type", () => {
    const paths = book.resources.map((resource) =>
      resource.location.kind === "remote" ? "(remote)" : resource.location.path,
    );

    expect(paths).toEqual(["one.xhtml", "two.xhtml", "images/a.png"]);
    expect(book.resources[2]!.mediaType).toBe("image/png");
    expect(book.resources[0]!.mediaType).toBe("application/xhtml+xml");
  });

  test("taking a path that does not exist throws rather than returning empty bytes", () => {
    // The symptom of empty bytes is a missing image or a page full of tofu, and by then nobody
    // can trace the root cause back to this fetch.
    expect(() => book.bytes("nope.xhtml")).toThrow(/nope\.xhtml/);
  });

  test("content given as bytes is taken verbatim", () => {
    const raw = MemoryBook.of({
      sections: [{ path: "x.xhtml", content: Uint8Array.of(60, 112, 62) }],
    });

    expect([...raw.bytes("x.xhtml")]).toEqual([60, 112, 62]);
  });
});
