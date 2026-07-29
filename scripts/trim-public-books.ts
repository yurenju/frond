/**
 * Cuts the two public-domain books down to a size the repository can carry, and writes the
 * result to `tests/books/public/` (ADR-0007's second layer).
 *
 * Usage:
 *   FROND_PUBLIC_BOOK_SOURCES=/path/to/originals npm run trim:books
 *
 * The source directory holds the two files exactly as downloaded, under their upstream
 * names. **Those originals are not in the repository** — a second layer book is a
 * downloaded artifact rather than something a generator can reproduce, so what the
 * repository keeps is the trimmed result plus this script. This file is therefore the
 * machine-readable half of ADR-0007's "what was trimmed away"; the prose half is in the
 * ADR, and the two have to be changed together.
 *
 * ## Why the two books are trimmed differently
 *
 * The originals are 17.9 MB and 10.6 MB, and in both cases nearly all of that is one kind
 * of resource. But which kind, and what it costs to drop it, is not the same:
 *
 * - **Kusamakura** carries 18 MB of media-overlay narration in two MP3s. frond renders
 *   nothing from a media overlay, so dropping the audio costs no coverage at all. It also
 *   removes this book's only encumbered material: the publication is CC0, but those two
 *   MP3s alone are CC-BY-NC-SA 3.0, and a non-commercial clause does not belong in an MIT
 *   repository. Every chapter of the text is kept.
 *
 * - **Alice** carries 9.5 MB across 43 Tenniel illustrations, and those are not
 *   incidental: an illustrated real book is precisely the shape ADR-0007 says the
 *   synthetic fixtures cannot reach. So the illustrations are kept **at their original
 *   dimensions and bytes** — re-encoding or downscaling them would change whether a plate
 *   overflows a page, and "a plate taller than the page" is a defect this layer exists to
 *   find. The text is cut to chapters 1-3 instead, which is what makes the illustration
 *   count fall.
 *
 * ## Chapters 1-3 rather than some other slice
 *
 * The three of them run about 7,600 words — enough that every section paginates to many
 * pages in all three engines at the default type size, which is the axis the synthetic
 * prose cannot reach (most synthetic sections are a single page). They carry 8
 * illustrations plus the frontispiece, and chapter 3 holds the mouse's tail: a poem set as
 * a tapering shape, which is a real typographic structure no synthetic fixture has. All of
 * Standard Ebooks' front and back matter is kept, so the spine still opens and closes the
 * way a real book does.
 *
 * ## Keeping the package consistent
 *
 * Dropping a resource from an EPUB is never just dropping the file: the package document,
 * the navigation document, the NCX and the list of illustrations all point at it, and a
 * dangling pointer would turn this book into a test of our error handling rather than of
 * our rendering. Every removal below therefore states how many elements it expects to
 * take out, and `expect()` fails the run when the count does not match — an upstream
 * revision that renames a file should stop this script rather than quietly produce a book
 * with half its references hanging.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unzipSync, zipSync } from "fflate";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESTINATION = join(REPO_ROOT, "tests", "books", "public");

/** Entries of an EPUB, keyed by their path inside the archive. */
type Archive = Record<string, Uint8Array>;

function expect(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Removes every XML element named `tag` whose text contains one of `needles`.
 *
 * The books' package, navigation and NCX documents are all machine-generated and regular,
 * so matching an element by name and then filtering on a substring of it is enough — and
 * it keeps every byte of the elements that stay, which a parse-and-serialize round trip
 * would not. `removed` is asserted by the caller.
 */
function dropElements(
  xml: string,
  tag: string,
  needles: readonly string[],
): { text: string; removed: number } {
  let removed = 0;
  const pattern = new RegExp(`[ \\t]*<${tag}[\\s>][\\s\\S]*?</${tag}>\\n?|[ \\t]*<${tag}[\\s][^>]*?/>\\n?`, "g");
  const text = xml.replace(pattern, (element) => {
    if (!needles.some((needle) => element.includes(needle))) return element;
    removed += 1;
    return "";
  });
  return { text, removed };
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function readText(archive: Archive, path: string): string {
  const bytes = archive[path];
  expect(bytes !== undefined, `${path} is not in the archive`);
  return decoder.decode(bytes);
}

/**
 * Writes an OCF container. `mimetype` goes first and stored, which OCF requires; everything
 * else is deflated, because unlike the synthetic fixtures these bytes feed no
 * byte-for-byte comparison and halving the repository's copy of the Japanese text is worth
 * more than being able to read the archive with `less`.
 */
async function writeEpub(archive: Archive, fileName: string): Promise<number> {
  const mimetype = archive["mimetype"];
  expect(mimetype !== undefined, "the archive has no mimetype entry");

  const ordered: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [mimetype, { level: 0 }],
  };
  for (const [path, bytes] of Object.entries(archive)) {
    if (path === "mimetype") continue;
    ordered[path] = [bytes, { level: 6 }];
  }

  const zipped = zipSync(ordered);
  await mkdir(DESTINATION, { recursive: true });
  await writeFile(join(DESTINATION, fileName), zipped);
  return zipped.byteLength;
}

/**
 * Kusamakura: drop the narration, keep all thirteen chapters.
 *
 * Four things point at the audio and have to go with it: the SMIL overlays, their manifest
 * items, the `media-overlay` attributes on the two chapters that carry one, and the
 * metadata that refines the removed ids (`media:duration`, `media:narrator`, and the
 * per-audio rights and licence statements). The last of those is the reason this cannot be
 * a file-deletion pass: a `refines` pointing at an id no longer in the manifest is an
 * invalid package.
 */
async function trimKusamakura(source: Archive): Promise<void> {
  const archive: Archive = {};
  let droppedFiles = 0;
  for (const [path, bytes] of Object.entries(source)) {
    if (path.startsWith("OPS/audio/") || path.endsWith(".smil")) {
      droppedFiles += 1;
      continue;
    }
    archive[path] = bytes;
  }
  expect(droppedFiles === 4, `expected 2 MP3s and 2 SMIL files, dropped ${droppedFiles}`);

  let opf = readText(source, "OPS/package.opf");

  // The manifest items for the overlays and the audio.
  const manifest = dropElements(opf, "item", [
    'href="xhtml/一.smil"',
    'href="xhtml/二.smil"',
    'href="audio/fmse004b.mp3"',
    'href="audio/ulnr0036.mp3"',
  ]);
  expect(manifest.removed === 4, `expected 4 manifest items, removed ${manifest.removed}`);
  opf = manifest.text;

  // The metadata refining the ids just removed, plus the book-wide duration and narrator —
  // both describe narration that is no longer here.
  const metadata = dropElements(opf, "meta", [
    'refines="#一_overlay"',
    'refines="#二_overlay"',
    'refines="#一_audio"',
    'refines="#二_audio"',
    'property="media:duration">1:00:03.031',
    'property="media:narrator"',
  ]);
  expect(metadata.removed === 8, `expected 8 metadata entries, removed ${metadata.removed}`);
  opf = metadata.text;

  // The two chapters that referenced an overlay. The attribute sits on its own line in the
  // upstream file, so the newline before it goes too.
  const before = opf;
  opf = opf.replace(/\n\s*media-overlay="[^"]*"/g, "");
  expect(
    before.length - opf.length > 0 && !opf.includes('media-overlay="'),
    "the media-overlay attributes were not removed",
  );

  // The section comments upstream wrote above the removed entries. They are three headings
  // over nothing now, and a heading over nothing is how a reader concludes the file is
  // damaged rather than trimmed.
  opf = opf.replace(/[ \t]*<!-- (media-overlays|smil|audio) -->\n/g, "");

  expect(!opf.includes("by-nc-sa"), "a non-commercial licence statement is still in the package");

  archive["OPS/package.opf"] = encoder.encode(opf);

  const size = await writeEpub(archive, "kusamakura-vertical-japanese.epub");
  console.log(`kusamakura-vertical-japanese.epub  ${(size / 1024).toFixed(0)} KB`);
}

/** The Alice documents kept in the spine, in spine order. */
const ALICE_KEPT_DOCUMENTS = [
  "titlepage.xhtml",
  "imprint.xhtml",
  "epigraph.xhtml",
  "frontispiece.xhtml",
  "halftitlepage.xhtml",
  "chapter-1.xhtml",
  "chapter-2.xhtml",
  "chapter-3.xhtml",
  "loi.xhtml",
  "colophon.xhtml",
  "uncopyright.xhtml",
] as const;

const ALICE_DROPPED_CHAPTERS = [4, 5, 6, 7, 8, 9, 10, 11, 12].map(
  (n) => `chapter-${n}.xhtml`,
);

/**
 * Alice: keep chapters 1-3 and every piece of front and back matter, and keep exactly the
 * images those documents still reference.
 *
 * The image set is derived from the kept text rather than listed by hand, so the
 * illustrations always match the chapters. `cover.jpg` and `logo.png` are added on top:
 * neither is referenced from a content document (the cover is reached through
 * `properties="cover-image"`, the logo through the imprint and colophon), and dropping
 * them by the "unreferenced" rule would take away the only real-book cover this repository
 * has.
 */
async function trimAlice(source: Archive): Promise<void> {
  const kept = new Set<string>(ALICE_KEPT_DOCUMENTS);

  const referencedImages = new Set<string>(["cover.jpg", "logo.png"]);
  for (const name of kept) {
    const text = readText(source, `epub/text/${name}`);
    for (const match of text.matchAll(/src="\.\.\/images\/([^"]+)"/g)) {
      referencedImages.add(match[1]!);
    }
  }

  const archive: Archive = {};
  for (const [path, bytes] of Object.entries(source)) {
    if (path.startsWith("epub/text/")) {
      if (!kept.has(path.slice("epub/text/".length))) continue;
    } else if (path.startsWith("epub/images/")) {
      if (!referencedImages.has(path.slice("epub/images/".length))) continue;
    }
    archive[path] = bytes;
  }

  const imagesKept = Object.keys(archive).filter((path) =>
    path.startsWith("epub/images/"),
  ).length;
  expect(
    imagesKept === referencedImages.size,
    `${referencedImages.size} images are referenced but ${imagesKept} are in the archive`,
  );

  // The package document: manifest items and spine itemrefs for the dropped chapters, and
  // manifest items for the images that went with them.
  let opf = readText(source, "epub/content.opf");
  const droppedImages = Object.keys(source)
    .filter((path) => path.startsWith("epub/images/"))
    .map((path) => path.slice("epub/images/".length))
    .filter((name) => !referencedImages.has(name));

  const items = dropElements(opf, "item", [
    ...ALICE_DROPPED_CHAPTERS.map((name) => `href="text/${name}"`),
    ...droppedImages.map((name) => `href="images/${name}"`),
  ]);
  expect(
    items.removed === ALICE_DROPPED_CHAPTERS.length + droppedImages.length,
    `expected ${ALICE_DROPPED_CHAPTERS.length + droppedImages.length} manifest items, removed ${items.removed}`,
  );
  opf = items.text;

  const itemrefs = dropElements(opf, "itemref", ALICE_DROPPED_CHAPTERS);
  expect(itemrefs.removed === ALICE_DROPPED_CHAPTERS.length, `expected 9 itemrefs, removed ${itemrefs.removed}`);
  opf = itemrefs.text;
  archive["epub/content.opf"] = encoder.encode(opf);

  // The navigation document: one <li> per dropped chapter, all of them inside the nested
  // <ol> under the half-title.
  const nav = dropElements(
    readText(source, "epub/toc.xhtml"),
    "li",
    ALICE_DROPPED_CHAPTERS.map((name) => `href="text/${name}"`),
  );
  expect(nav.removed === ALICE_DROPPED_CHAPTERS.length, `expected 9 nav entries, removed ${nav.removed}`);
  archive["epub/toc.xhtml"] = encoder.encode(nav.text);

  // The NCX carries the same tree a second time (ADR-0010: having both is the norm), so it
  // has to be cut to match — a TOC that disagrees with the spine would be a defect this
  // book reports about itself rather than about frond.
  const ncx = dropElements(
    readText(source, "epub/toc.ncx"),
    "navPoint",
    ALICE_DROPPED_CHAPTERS.map((name) => `src="text/${name}"`),
  );
  expect(ncx.removed === ALICE_DROPPED_CHAPTERS.length, `expected 9 navPoints, removed ${ncx.removed}`);
  archive["epub/toc.ncx"] = encoder.encode(ncx.text);

  // The list of illustrations points into the chapters by fragment, so its entries for the
  // dropped chapters have to go as well.
  const loi = dropElements(
    readText(source, "epub/text/loi.xhtml"),
    "li",
    ALICE_DROPPED_CHAPTERS.map((name) => `href="${name}#`),
  );
  expect(loi.removed > 0, "no list-of-illustrations entries were removed");
  archive["epub/text/loi.xhtml"] = encoder.encode(loi.text);

  const size = await writeEpub(archive, "alice-in-wonderland-horizontal.epub");
  console.log(
    `alice-in-wonderland-horizontal.epub  ${(size / 1024 / 1024).toFixed(1)} MB` +
      `  (${kept.size} documents, ${imagesKept} images, ${loi.removed} illustrations delisted)`,
  );
}

const sources = process.env["FROND_PUBLIC_BOOK_SOURCES"];
if (sources === undefined) {
  console.error(
    "Name the directory holding the original downloads with FROND_PUBLIC_BOOK_SOURCES.\n" +
      "See docs/adr/0007-test-fixtures.md for where each book comes from.",
  );
  process.exit(2);
}

/**
 * Reads one original, **without its directory entries**. A ZIP may carry an empty entry per
 * directory, and one of these two books does while the other does not — left in, they
 * would be counted as resources by every "how many of these did we drop" assertion below
 * and would make the two books need different numbers for the same reason. Nothing reads
 * them: OCF addresses every resource by full path.
 */
const open = async (fileName: string): Promise<Archive> => {
  const entries = unzipSync(new Uint8Array(await readFile(join(sources, fileName))));
  return Object.fromEntries(
    Object.entries(entries).filter(([path]) => !path.endsWith("/")),
  );
};

await trimKusamakura(await open("kusamakura-japanese-vertical-writing.epub"));
await trimAlice(await open("lewis-carroll_alices-adventures-in-wonderland_john-tenniel.epub"));
