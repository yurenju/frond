import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { unzipSync } from "fflate";
import {
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * Every XML document in the synthetic fixtures really does parse in all three browsers.
 *
 * The fixture generator assembles its output from string templates, and **XHTML is not
 * HTML**: one missing end tag, one unquoted attribute, one unescaped `&`, and a browser
 * does not forgivingly repair it the way it would for HTML — it refuses to render the
 * whole document. That failure mode is invisible at the Node layer — `EpubBook` reads
 * metadata without building a DOM — and holds out all the way to `Renderer` before
 * exploding, far from its cause.
 *
 * The browsers' own DOMParser is used deliberately rather than a Node XML library (that
 * case is covered by `tests/node/test-fixtures/epub-structure.test.ts`): the question is
 * "do these three engines accept it", and only these three engines can answer it.
 *
 * The filename list is taken from the generator rather than copied out here. Copied, this
 * spec would silently fail to cover a newly added ailment — and "not covered" never goes
 * red.
 */

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

/** XHTML and the other XML documents (container.xml, package.opf) have different media types. */
const XHTML = "application/xhtml+xml";
const XML = "application/xml";

test("a parse failure really is detected", async ({ page }) => {
  // Without this case, the ones below would all be green in an environment that answers
  // "fine" to every question — which is this kind of test's most typical failure mode. The
  // three engines report parse errors differently (some insert a parsererror element, and
  // even the namespaces differ), so each has to prove it once.
  const failures = await parse(page, [
    { path: "broken.xhtml", source: "<a><b></a>", mediaType: XHTML },
  ]);

  expect(failures.length).toBe(1);
});

for (const fixture of syntheticFixtures) {
  test(`${fixture.name}'s XML parses in this engine`, async ({ page }) => {
    const documents = xmlDocumentsIn(fixture.name);

    expect(documents.length).toBeGreaterThan(0);
    expect(await parse(page, documents)).toEqual([]);
  });
}

interface XmlDocument {
  readonly path: string;
  readonly source: string;
  readonly mediaType: string;
}

function xmlDocumentsIn(name: AilmentName): XmlDocument[] {
  const entries = unzipSync(readFileSync(join(FIXTURE_DIRECTORY, `${name}.epub`)));
  const decoder = new TextDecoder();

  return Object.entries(entries)
    // `.ncx` is included: EPUB 2's navigation document is XML, and it is assembled from
    // string templates too. Leaving it off the extension list would make this spec
    // **silently fail to cover** it — and "not covered" never goes red.
    .filter(([path]) => /\.(xhtml|xml|opf|ncx)$/.test(path))
    .map(([path, bytes]) => ({
      path,
      source: decoder.decode(bytes),
      mediaType: path.endsWith(".xhtml") ? XHTML : XML,
    }));
}

/** Returns the documents that failed to parse, one message each. An empty array when all parse. */
async function parse(
  page: Page,
  documents: readonly XmlDocument[],
): Promise<string[]> {
  return page.evaluate((sources) => {
    const parser = new DOMParser();
    return sources
      .map(({ path, source, mediaType }) => {
        const parsed = parser.parseFromString(
          source,
          mediaType as DOMParserSupportedType,
        );
        // On a parse failure all three return a document containing a parsererror rather than
        // throwing.
        const error = parsed.querySelector("parsererror");
        return error === null ? null : `${path}: ${error.textContent ?? ""}`;
      })
      .filter((message): message is string => message !== null);
  }, documents as XmlDocument[]);
}
