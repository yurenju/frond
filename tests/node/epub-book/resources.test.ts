import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import {
  EpubBook,
  EpubResourceError,
  type EpubResourceFailure,
  type Resource,
} from "../../../packages/frond/src/epub/index.ts";
import { readFixture } from "../support/fixtures.ts";
import {
  handmadeBook,
  packageDocument,
  sectionDocument,
  HEALTHY_ENTRIES,
} from "./support/handmade.ts";

/**
 * Resource access — the route `Renderer` needs when it lays a book out: a Section's
 * bytes, images, stylesheets, fonts.
 *
 * ## Why the oracle is not the generator
 *
 * The expected values for the obfuscation cases are all **computed by this file
 * itself**: `node:crypto`'s SHA-1 plus the XOR written out here. Checking the generator
 * against its own inverse would make any misunderstanding of the algorithm hold on both
 * sides at once and the tests would stay green — while the symptom only surfaces on the
 * reader's screen, as a page full of tofu. This is the same discipline as
 * `tests/node/support/epub-archive.ts` reading its own output with external libraries.
 */

const FONT_PATH = "EPUB/fonts/obfuscated.otf";
const FIXTURE_IDENTIFIER = "urn:uuid:frond-fixture-obfuscated-font-idpf";

/** IDPF covers only this many bytes from the start. */
const OBFUSCATED_LENGTH = 1040;

/** Adobe's algorithm URI. frond does not undo it. */
const ADOBE_ALGORITHM = "http://ns.adobe.com/pdf/enc#RC";
const IDPF_ALGORITHM = "http://www.idpf.org/2008/embedding";

/**
 * IDPF obfuscation and its undoing — XOR is its own inverse, so one function does both.
 *
 * The key is the SHA-1 of the identifier with whitespace stripped (the spec names four
 * code points: space, tab, CR, LF), and the hash goes through `node:crypto`: a
 * third-party implementation with no connection to frond at all.
 */
function idpfXor(bytes: Uint8Array, identifier: string): Uint8Array {
  const stripped = [...identifier]
    .filter((character) => ![0x20, 0x09, 0x0d, 0x0a].includes(character.codePointAt(0)!))
    .join("");
  const key = createHash("sha1").update(stripped, "utf8").digest();

  const out = Uint8Array.from(bytes);
  for (let index = 0; index < Math.min(out.length, OBFUSCATED_LENGTH); index += 1) {
    out[index] = out[index]! ^ key[index % key.length]!;
  }
  return out;
}

/** The bytes actually stored in the archive — before any undoing. */
function storedBytes(archive: Uint8Array, path: string): Uint8Array {
  const found = unzipSync(archive)[path];
  if (found === undefined) throw new Error(`The archive has no ${path}`);
  return found;
}

/** A resource's path inside the archive. Resources outside the package have no bytes to fetch; everything the tests want is inside. */
function pathOf(resource: Resource | undefined): string {
  if (resource?.location.kind !== "in-container") {
    throw new Error(`${resource?.id ?? "(not found)"} is not inside the archive`);
  }
  return resource.location.path;
}

/**
 * Which kind of failure is thrown when the bytes cannot be read.
 *
 * Asked only this way because `toThrow()` only asks "did something get thrown" — and
 * what these cases guard is precisely **which kind**: the consumer uses `reason` to
 * tell "this book does not have that item" from "that item cannot be decoded", and the
 * two call for different responses.
 */
function expectFailure(read: () => unknown, reason: EpubResourceFailure): void {
  try {
    read();
    expect.unreachable("should have thrown EpubResourceError");
  } catch (error) {
    expect(error).toBeInstanceOf(EpubResourceError);
    expect((error as EpubResourceError).reason).toBe(reason);
  }
}

/** A `META-INF/encryption.xml` declaring one obfuscated resource. */
function encryptionXml(path: string, algorithm: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="${algorithm}"/>
    <enc:CipherData>
      <enc:CipherReference URI="${path}"/>
    </enc:CipherData>
  </enc:EncryptedData>
</encryption>
`;
}

describe("a Section's bytes and media type", () => {
  test("every item on the readingOrder is reachable", async () => {
    const archive = await readFixture("vertical-japanese.epub");
    const book = await EpubBook.open(archive);

    for (const section of book.readingOrder) {
      const bytes = book.bytes(section.path);

      expect(section.mediaType).toBe("application/xhtml+xml");
      // What `Renderer` wants is the bytes themselves: all it has is this book, not a
      // filesystem.
      expect(new TextDecoder().decode(bytes)).toContain("<html");
    }
    expect(book.readingOrder.length).toBeGreaterThan(0);
  });

  test("the bytes are that Section's, not another's", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));
    const first = new TextDecoder().decode(book.bytes(book.readingOrder[0]!.path));

    expect(first).toContain("朝の光");
    expect(first).not.toContain("坂の道");
  });
});

describe("any resource on the manifest", () => {
  test("an image's bytes are reachable", async () => {
    const book = await EpubBook.open(
      await readFixture("empty-and-image-only-sections.epub"),
    );
    const image = book.resources.find((resource) => resource.mediaType === "image/png");

    const bytes = book.bytes(pathOf(image));
    // The PNG signature. Whether what came back is an image cannot be settled by the
    // media type — that is the book's own declaration.
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("a stylesheet's bytes are reachable", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));
    const stylesheet = book.resources.find(
      (resource) => resource.mediaType === "text/css",
    );

    expect(new TextDecoder().decode(book.bytes(pathOf(stylesheet)))).toContain(
      "writing-mode",
    );
  });

  test("findable by the manifest's id", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expect(book.resource("stylesheet")?.mediaType).toBe("text/css");
    expect(book.resource("no-such-id")).toBeUndefined();
  });

  test("a path not in the archive throws an explicit error", async () => {
    const book = await EpubBook.open(await readFixture("vertical-japanese.epub"));

    expectFailure(() => book.bytes("EPUB/no-such-file.xhtml"), "missing-resource");
  });
});

describe("fetched, remote, and absent are three distinguishable answers", () => {
  /** A book whose manifest has all three cases. */
  async function threeWays(): Promise<EpubBook> {
    return EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="narration" href="https://example.invalid/narration.mp3" media-type="audio/mpeg" properties="remote-resources"/>
    <item id="lost-plate" href="images/lost.png" media-type="image/png"/>`,
        }),
        entries: HEALTHY_ENTRIES,
      }),
    );
  }

  test("each of the three is its own slot", async () => {
    const book = await threeWays();
    const kinds = Object.fromEntries(
      book.resources.map((resource) => [resource.id, resource.location.kind]),
    );

    // An API that collapses the latter two into one undefined leaves the consumer unable
    // to tell "this item was never in the package (conforming)" from "this book declared
    // it and did not ship it (the book is wrong)" — and those two call for different
    // responses.
    expect(kinds).toEqual({
      "section-1": "in-container",
      narration: "remote",
      "lost-plate": "missing",
    });
  });

  test("neither a missing file nor a remote one stops this book opening", async () => {
    // A missing file is only fatal on the readingOrder (`resources.ts`: the 33/33
    // measurement). This case guards that existing semantics are not re-litigated just
    // because an access API was opened up.
    const book = await threeWays();

    expect(book.readingOrder).toHaveLength(1);
  });

  test("the absent item still reports its location, for diagnostics", async () => {
    const book = await threeWays();
    const lost = book.resource("lost-plate");

    expect(lost?.location).toEqual({ kind: "missing", path: "OEBPS/images/lost.png" });
  });
});

describe("an IDPF-obfuscated font", () => {
  test("the restored bytes equal the un-obfuscated original", async () => {
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);

    // The expected value is computed back from the archive's bytes by this file itself,
    // using node:crypto.
    const expected = idpfXor(storedBytes(archive, FONT_PATH), FIXTURE_IDENTIFIER);

    expect(book.bytes(FONT_PATH)).toEqual(expected);
  });

  test("what the archive stores really is obfuscated bytes", async () => {
    // Without this case, a restore() that does nothing at all would also make the case
    // above green — and what would have been measured is only "the fixture was never
    // obfuscated".
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);
    const stored = storedBytes(archive, FONT_PATH);
    const restored = book.bytes(FONT_PATH);

    expect([...stored.subarray(0, OBFUSCATED_LENGTH)]).not.toEqual([
      ...restored.subarray(0, OBFUSCATED_LENGTH),
    ]);
  });

  test("only the first 1040 bytes are covered; the rest is untouched", async () => {
    const archive = await readFixture("obfuscated-font-idpf.epub");
    const book = await EpubBook.open(archive);
    const stored = storedBytes(archive, FONT_PATH);
    const restored = book.bytes(FONT_PATH);

    // Covering too far is the easiest step of this algorithm to get wrong, and its
    // symptom is the same as not undoing it at all: a broken font. The fixture is
    // deliberately longer than 1040 bytes so that this slot is lit.
    expect(stored.length).toBeGreaterThan(OBFUSCATED_LENGTH);
    expect([...restored.subarray(OBFUSCATED_LENGTH)]).toEqual([
      ...stored.subarray(OBFUSCATED_LENGTH),
    ]);
  });

  test("key derivation strips whitespace out of the identifier", async () => {
    // Books commonly wrap the identifier across lines in the XML. Without stripping,
    // the same book reformatted derives a different key.
    const identifier = "urn:uuid:frond \t\r\n handmade";
    const original = Uint8Array.from({ length: 1100 }, (_, index) => (index * 7) % 256);

    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">${identifier}</dc:identifier>
    <dc:title>字型を難読化した本</dc:title>
    <dc:language>ja</dc:language>`,
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/face.otf", IDPF_ALGORITHM),
          },
          {
            path: "OEBPS/fonts/face.otf",
            contents: idpfXor(original, identifier),
          },
        ],
      }),
    );

    expect(book.bytes("OEBPS/fonts/face.otf")).toEqual(original);
  });

  test("a book declaring no obfuscation gets its bytes back verbatim", async () => {
    // None of the 33 books in the sample has an encryption.xml, so this is the common
    // case.
    const archive = await readFixture("empty-and-image-only-sections.epub");
    const book = await EpubBook.open(archive);
    const path = "EPUB/images/plate.png";

    expect(book.bytes(path)).toEqual(storedBytes(archive, path));
  });
});

describe("unsupported obfuscation", () => {
  /** A book declaring one resource obfuscated with `algorithm`. */
  function obfuscatedWith(algorithm: string): Uint8Array {
    return handmadeBook({
      packageDocument: packageDocument({
        manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
      }),
      entries: [
        ...HEALTHY_ENTRIES,
        {
          path: "META-INF/encryption.xml",
          contents: encryptionXml("OEBPS/fonts/face.otf", algorithm),
        },
        { path: "OEBPS/fonts/face.otf", contents: Uint8Array.from({ length: 1100 }) },
      ],
    });
  }

  test("Adobe's scheme gives an explicit error rather than bad bytes", async () => {
    // The two schemes differ in both key derivation and length, so undoing Adobe's with
    // IDPF's **always** yields bad bytes. And a broken font's on-screen symptom is a page
    // full of tofu — at which point nobody traces the root cause back to decoding, so it
    // is better for the consumer to get an error that can state its reason.
    const book = await EpubBook.open(obfuscatedWith(ADOBE_ALGORITHM));

    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "unsupported-obfuscation");
    // The message has to name the algorithm — "unsupported" without saying what still
    // leaves whoever investigates digging through the archive themselves.
    expect(() => book.bytes("OEBPS/fonts/face.otf")).toThrow(ADOBE_ALGORITHM);
  });

  test("a genuinely encrypted resource is an explicit error too", async () => {
    const book = await EpubBook.open(
      obfuscatedWith("http://www.w3.org/2001/04/xmlenc#aes256-cbc"),
    );

    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "unsupported-obfuscation");
  });

  test("the book still opens, and the other resources are still reachable", async () => {
    // What cannot be decoded is that one font, not this book. What the reader wants is
    // for the book to open (ADR-0010).
    const book = await EpubBook.open(obfuscatedWith(ADOBE_ALGORITHM));

    expect(book.readingOrder).toHaveLength(1);
    expect(new TextDecoder().decode(book.bytes("OEBPS/section-1.xhtml"))).toContain(
      "<html",
    );
  });

  test("IDPF obfuscation with no identifier in the book says the key cannot be derived", async () => {
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:title>識別碼のない本</dc:title>
    <dc:language>ja</dc:language>`,
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/face.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/face.otf", IDPF_ALGORITHM),
          },
          { path: "OEBPS/fonts/face.otf", contents: Uint8Array.from({ length: 1100 }) },
        ],
      }),
    );

    expect(book.metadata.identifier).toBeUndefined();
    expectFailure(() => book.bytes("OEBPS/fonts/face.otf"), "missing-obfuscation-key");
  });
});

describe("the cover goes through the same route as any resource", () => {
  test("a cover that cannot be decoded means no cover, not a book that will not open", async () => {
    // One path in one book can only have one answer: if the cover bypassed the undoing
    // and read the archive directly, `book.cover.bytes` and `book.bytes(cover.path)`
    // would give two different sets of bytes. And what to do about an unavailable cover
    // was settled long ago — it is not an error (ADR-0010).
    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          metadata: `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>表紙が復号できない本</dc:title>
    <dc:language>ja</dc:language>
    <meta name="cover" content="cover-image"/>`,
          manifest: `    <item id="cover-image" href="images/cover.png" media-type="image/png"/>
    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/images/cover.png", ADOBE_ALGORITHM),
          },
          { path: "OEBPS/images/cover.png", contents: Uint8Array.from({ length: 64 }) },
        ],
      }),
    );

    expect(book.cover).toBeUndefined();
    expect(book.readingOrder).toHaveLength(1);
  });
});

describe("encryption.xml's URI is a URL too", () => {
  test("an encoded URI matches the archive's entry name", async () => {
    // Spaces in font filenames are common, and in a URI they arrive percent-encoded.
    // This goes through the same resolution as the manifest and the TOC.
    const original = Uint8Array.from({ length: 1100 }, (_, index) => (index * 13) % 256);
    const identifier = "urn:uuid:frond-handmade";

    const book = await EpubBook.open(
      handmadeBook({
        packageDocument: packageDocument({
          manifest: `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="face" href="fonts/Noto%20Serif.otf" media-type="font/otf"/>`,
        }),
        entries: [
          ...HEALTHY_ENTRIES,
          {
            path: "META-INF/encryption.xml",
            contents: encryptionXml("OEBPS/fonts/Noto%20Serif.otf", IDPF_ALGORITHM),
          },
          {
            path: "OEBPS/fonts/Noto Serif.otf",
            contents: idpfXor(original, identifier),
          },
        ],
      }),
    );

    expect(book.bytes("OEBPS/fonts/Noto Serif.otf")).toEqual(original);
  });
});
