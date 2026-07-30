#!/usr/bin/env node
//
// Writes the synthetic vertical Traditional Chinese demo book to a file.
//
//   npm run demo:book                    # writes to tests/books/demo-zh-tw.epub
//   node scripts/build-demo-book.ts <path>
//
// The book's content and the reasoning behind it are in
// `src/test-fixtures/demo-book.ts`. This only puts it on disk — the screenshot specs
// import that module directly and need no file written first
// (`docs/agents/pull-requests.md`). This exists so there is a book to drag in when trying
// the demo site by hand.
//
// This script is executed directly by `node` (type stripping), so imports always carry a
// .ts extension — the stripper does not map ./x.js back to ./x.ts.

import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { buildDemoBook } from "../src/test-fixtures/demo-book.ts";

const REPOSITORY_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUTPUT = join(REPOSITORY_ROOT, "tests", "books", "demo-zh-tw.epub");

const requested = process.argv[2];
const output = requested === undefined ? DEFAULT_OUTPUT : resolve(requested);
const bytes = buildDemoBook();

await mkdir(dirname(output), { recursive: true });
await writeFile(output, bytes);

console.log(`${relative(REPOSITORY_ROOT, output)} (${bytes.length} bytes)`);
