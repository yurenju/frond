import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AILMENTS, specFor, epubVersionOf, type AilmentName } from "./ailments.ts";
import { buildEpub, type EpubVersion } from "./epub.ts";

/**
 * The synthetic fixture generator — **one ailment per file, and the filename is the
 * ailment's name** (ADR-0007).
 *
 * This is the first layer of test books, and the main one. The value of synthetic
 * fixtures is that they are controllable and nameable: each file reproduces one known
 * ailment exactly, and when a test fails the filename says which ailment has come back.
 *
 * This generator is **published for consumers to use** (the distribution section of #1),
 * so the exports below are part of the product rather than internal details: the ailment
 * list itself is one of this project's most valuable pieces of knowledge, and should not
 * be locked inside a test directory.
 *
 * ## Determinism
 *
 * The same input produces a **byte-for-byte identical** file. This is not reproducibility
 * hygiene, it is a hard requirement: regenerate the fixtures and every geometric number
 * drifts, for reasons that have nothing to do with frond's code. All four leaks are
 * explicitly suppressed — ZIP mtimes and external attributes, deflate implementation
 * differences (always stored), `dcterms:modified`, and the identifier (a fixed string
 * rather than a UUID). `tests/node/test-fixtures/determinism.test.ts` proves it by
 * generating twice and comparing hashes.
 */

export type { Ailment, AilmentName } from "./ailments.ts";
export type {
  CoverNotation,
  CoverSpec,
  EpubSpec,
  ResourceSpec,
  SectionSpec,
  EpubVersion,
} from "./epub.ts";

export interface SyntheticFixture {
  readonly name: AilmentName;
  /** A one-line statement of which ailment this file encodes. */
  readonly description: string;
  /**
   * The packaging version. Consumers use it to pick books — "give me an EPUB 2 one" is
   * more reliable than guessing at a filename suffix, and the suffix convention is for
   * people to read, not a string consumers should have to parse.
   */
  readonly epubVersion: EpubVersion;
  readonly fileName: string;
}

export const syntheticFixtures: readonly SyntheticFixture[] = AILMENTS.map(
  (ailment) => ({
    name: ailment.name,
    description: ailment.description,
    epubVersion: epubVersionOf(ailment),
    fileName: `${ailment.name}.epub`,
  }),
);

/** Produces the EPUB bytes of one fixture. */
export function buildFixture(name: AilmentName): Uint8Array {
  const ailment = AILMENTS.find((candidate) => candidate.name === name);
  if (ailment === undefined) {
    throw new Error(
      `unknown ailment ${name}. The known ones are: ${AILMENTS.map((candidate) => candidate.name).join(", ")}`,
    );
  }
  return buildEpub(specFor(ailment));
}

/** Writes the whole set of fixtures into `directory`, returning the paths written. */
export async function writeFixtures(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const fixture of syntheticFixtures) {
    const path = join(directory, fixture.fileName);
    await writeFile(path, buildFixture(fixture.name));
    written.push(path);
  }
  return written;
}
