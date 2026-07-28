import { zipSync } from "fflate";

/**
 * Assembles a book's bytes by hand, so `EpubBook`'s tests can be fed the **shapes no
 * fixture has**.
 *
 * The synthetic fixtures (`tests/fixtures/*.epub`) do the bulk of the work, one file
 * per ailment (ADR-0007), and they are always **conforming books that open** — the
 * generator refuses to emit even a combination like "EPUB 2 with a
 * page-progression-direction". Broken books therefore cannot be produced at that
 * layer: not a zip at all, a missing `META-INF/container.xml`, an OPF pointing at a
 * file that does not exist. None of those shapes is expressible by that generator, and
 * they are exactly what this ticket's error-handling acceptance criterion needs to be
 * fed.
 *
 * So the books here are **written byte by byte by the tests themselves**: the full OPF
 * text lives in the test, and this layer only packs it. That also gives the assertions
 * an independent source for their expected values — rather than checking the generator
 * against its own inverse.
 *
 * These books deliberately **do not go into `tests/fixtures/`**: each serves a single
 * error path, needs no sharing across runners, and should not take up an "ailment"
 * name. The shapes that genuinely need to be in the repo (a `../` in the manifest, for
 * instance) come from #23.
 */

export interface HandmadeEntry {
  /** The path inside the archive, always `/`-separated. */
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface HandmadeBook {
  /** Where the package document sits in the archive. Omitted means `OEBPS/content.opf`. */
  readonly packageDocumentPath?: string;
  /** The full text of the package document. */
  readonly packageDocument: string;
  /**
   * Overrides the contents of `META-INF/container.xml`. Omitted writes a conforming
   * container pointing at `packageDocumentPath`; `null` writes no container at all (the
   * broken book that is missing one).
   */
  readonly container?: string | null;
  /** Entries to include beyond the container and the package document. */
  readonly entries?: readonly HandmadeEntry[];
}

export function handmadeBook(book: HandmadeBook): Uint8Array {
  const packageDocumentPath = book.packageDocumentPath ?? "OEBPS/content.opf";
  const entries: HandmadeEntry[] = [
    { path: "mimetype", contents: "application/epub+zip" },
    ...(book.container === null
      ? []
      : [
          {
            path: "META-INF/container.xml",
            contents: book.container ?? containerXml(packageDocumentPath),
          },
        ]),
    { path: packageDocumentPath, contents: book.packageDocument },
    ...(book.entries ?? []),
  ];

  return pack(entries);
}

/** Packs entries into a ZIP with no EPUB assumptions at all — not even a `mimetype`. */
export function pack(entries: readonly HandmadeEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.path] =
      typeof entry.contents === "string"
        ? encoder.encode(entry.contents)
        : entry.contents;
  }
  // level 0 (stored): these books never enter the repo so size does not matter, and
  // uncompressed bytes can be read by eye when a test fails.
  return zipSync(files, { level: 0 });
}

function containerXml(packageDocumentPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${packageDocumentPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/**
 * A minimal but conforming EPUB 3 package document.
 *
 * When a "healthy except in one place" broken book is needed, change one thing here —
 * the same discipline as the fixture generator (a single point of difference), except
 * that here the single difference is written in the test rather than in the ailment
 * list.
 */
export function packageDocument(options: {
  readonly version?: string;
  readonly metadata?: string;
  readonly manifest?: string;
  readonly readingOrder?: string;
  readonly readingOrderAttributes?: string;
}): string {
  const version = options.version ?? "3.0";
  const metadata =
    options.metadata ??
    `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>手で組んだ本</dc:title>
    <dc:language>ja</dc:language>`;
  const manifest =
    options.manifest ??
    `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`;
  const readingOrder = options.readingOrder ?? `    <itemref idref="section-1"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${metadata}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${options.readingOrderAttributes ?? ""}>
${readingOrder}
  </spine>
</package>
`;
}

/**
 * The content document that matches `packageDocument()`'s default manifest.
 *
 * Most "healthy except in one place" books need only this one entry; writing it out in
 * each test would mean chasing every one of them whenever the default manifest's path
 * changes.
 */
export const HEALTHY_ENTRIES: readonly HandmadeEntry[] = [
  { path: "OEBPS/section-1.xhtml", contents: sectionDocument("朝") },
];

/** A minimal XHTML content document. */
export function sectionDocument(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>${title}</title></head>
  <body><p>${title}</p></body>
</html>
`;
}
