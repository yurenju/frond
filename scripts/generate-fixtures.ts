#!/usr/bin/env node
//
// Produces the synthetic fixtures — one ailment per file, with the filename being the
// ailment's name.
//
//   npm run fixtures                 # writes to tests/fixtures/
//   node scripts/generate-fixtures.ts <directory>
//
// The output is deterministic: the same input produces byte-for-byte identical files, so
// running it again leaves no diff in git. If a diff does appear, the generator really has
// changed, and the diff is the change itself.
//
// This script is executed directly by `node` (type stripping), so imports always carry a
// .ts extension — the stripper does not map ./x.js back to ./x.ts.

import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { writeFixtures } from "../src/test-fixtures/index.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(REPOSITORY_ROOT, "tests", "fixtures");

const requested = process.argv[2];
const output = requested === undefined ? DEFAULT_OUTPUT : resolve(requested);

const written = await writeFixtures(output);

for (const path of written) {
  console.log(relative(REPOSITORY_ROOT, path));
}
console.log(`${written.length} fixtures written to ${relative(REPOSITORY_ROOT, output)}/`);
