import { EpubOpenError } from "./errors.ts";
import { CONTAINER_ROOT, resolveHref } from "./resource-path.ts";
import { parseXml } from "./xml.ts";
import { readZip } from "./zip.ts";

/**
 * The OCF container — an EPUB's outer shell: a ZIP, plus a
 * `META-INF/container.xml` saying where the package document is.
 *
 * This layer is its own module because it is the **only place that knows a book is
 * an archive**. Every layer above it sees nothing but a "path → bytes" table, so the
 * decompression implementation (today `zip.ts` inflating everything into memory) can
 * be swapped for streaming or range requests without touching a line of the parsing
 * code.
 *
 * `openContainer` is async because decompression is — `DecompressionStream` has no
 * synchronous form (`zip.ts`). **Only the moment of opening is async**: the bytes are
 * all inflated into the table right here, so `bytes()` and `text()` stay synchronous
 * and the four parsing modules above them need not change a line.
 *
 * Zero DOM dependency (ADR-0005): `DecompressionStream` and `URL` are both standard
 * WHATWG objects, present in Node and in all three browsers.
 */

const CONTAINER_PATH = "META-INF/container.xml";

export interface EpubContainer {
  /** The path of the package document (OPF) inside the archive. */
  readonly packageDocumentPath: string;
  has(path: string): boolean;
  bytes(path: string): Uint8Array;
  text(path: string): string;
}

export async function openContainer(archive: Uint8Array): Promise<EpubContainer> {
  const entries = await readZip(archive);
  const decoder = new TextDecoder();

  const has = (path: string): boolean => entries.has(path);
  const bytes = (path: string): Uint8Array => {
    const found = entries.get(path);
    if (found === undefined) {
      throw new EpubOpenError(
        "missing-resource",
        `the archive has no ${path}`,
      );
    }
    return found;
  };
  const text = (path: string): string => decoder.decode(bytes(path));

  if (!has(CONTAINER_PATH)) {
    // No container.xml means no entry point. A ZIP without one could be anything —
    // a .cbz, a .docx, a folder the author zipped up themselves.
    throw new EpubOpenError(
      "missing-container",
      `this archive has no ${CONTAINER_PATH}; it is not an EPUB OCF container`,
    );
  }

  const packageDocumentPath = readPackageDocumentPath(text(CONTAINER_PATH));
  if (!has(packageDocumentPath)) {
    // The container points at a package document that does not exist. This is a
    // different kind of breakage from "the manifest points at a missing file": what
    // is broken here is the entry point itself, so not one page of the book is
    // readable.
    throw new EpubOpenError(
      "missing-package-document",
      `${CONTAINER_PATH} points at ${packageDocumentPath}, but the archive has no such entry`,
    );
  }

  return {
    packageDocumentPath,
    has,
    bytes,
    text,
  };
}

/**
 * The first rootfile in `container.xml` is the package document.
 *
 * OCF allows several rootfiles (multiple renditions of the same content), but EPUB
 * specifies that the first `application/oebps-package+xml` one is **this book**.
 * frond reads only that one.
 *
 * `full-path` is a **URL** just like a manifest href, only its base is the package
 * root rather than some document, so it goes through the same resolution
 * (percent-encoding has to be undone; resolving outside the package root is
 * non-conforming). Writing one of each would mean only one of the two remembers that
 * books are allowed to encode their paths.
 */
function readPackageDocumentPath(source: string): string {
  const container = parseXml(source, {
    reason: "malformed-container",
    label: CONTAINER_PATH,
  });

  const rootfiles = container.child("container")?.child("rootfiles");
  const fullPath = rootfiles?.children("rootfile")[0]?.attribute("full-path");
  if (fullPath === undefined || fullPath === "") {
    throw new EpubOpenError(
      "malformed-container",
      `${CONTAINER_PATH} does not say where the package document is (<rootfile full-path>)`,
    );
  }

  const resolved = resolveHref(fullPath, CONTAINER_ROOT);
  if (resolved.kind !== "in-container") {
    throw new EpubOpenError(
      "malformed-container",
      `${CONTAINER_PATH} points outside the package: full-path="${fullPath}"`,
    );
  }
  return resolved.path;
}
