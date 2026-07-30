#!/usr/bin/env node
//
// The tidy-up after `tsc -p tsconfig.build.json`: rewrite the extensions inside `.d.ts`,
// then check `dist/`'s two invariants. Run after compilation by `npm run build`:
//
//     node scripts/finish-build.ts
//
// The package directory is the repository root, derived from this file's own location
// rather than from cwd — the checks below are about a fixed pair of paths (`package.json`
// and `dist/`), so where the script was invoked from should not change what it looks at.
//
// This script is executed directly by `node` (type stripping), so imports always carry a
// .ts extension — the stripper does not map ./x.js back to ./x.ts.

import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(packageDirectory, "dist");

const manifest: {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
} = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8"));

const packageName = manifest.name ?? packageDirectory;

/**
 * Which bare specifiers this package permits.
 *
 * **The list is not hand-written; it is derived from `package.json`'s `dependencies` and
 * `peerDependencies`.** That matters more than it looks: a hand-written list rots as the
 * dependencies change, and it always rots in the direction of being too permissive —
 * nobody remembers to come back and narrow it after removing a dependency.
 *
 * Derived from the declarations, "what the shipped artifact imports" and "what package.json
 * says it depends on" become the same thing, and the moment the two drift, the build turns
 * red. For `@yurenju/frond` both are empty, so **the zero-dependency invariant maintains
 * itself** — it is no longer a special case hard-coded into this script.
 *
 * That shape is kept even though there is only one package left to check (frond-react is
 * gone; ADR-0008's revision). Hard-coding "no bare specifiers at all" would read the same
 * today and be wrong the first time a dependency is genuinely declared — the derivation
 * costs three lines and never needs revisiting.
 *
 * `devDependencies` do not count: those do not ship, and their appearance in `dist/` is a
 * defect.
 */
const allowed = new Set([
  ...Object.keys(manifest.dependencies ?? {}),
  ...Object.keys(manifest.peerDependencies ?? {}),
]);

/**
 * Whether a specifier belongs to a permitted package.
 *
 * What is compared is the **package name** rather than the whole specifier, because
 * subpaths are the norm: permitting `react` permits `react/jsx-runtime` with it (another
 * entry point of the same package), while `reactive-x` is not let through merely because
 * the prefix looks similar. Scoped names have two segments, so splitting on the first `/`
 * alone will not do.
 */
function packageOf(specifier: string): string {
  const segments = specifier.split("/");
  return specifier.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? "");
}

/**
 * ## Why the `.d.ts` have to be rewritten by hand
 *
 * Inside `src/` everything imports everything else with a `.ts` extension (for the reason
 * see `tsconfig.json`), and `rewriteRelativeImportExtensions` is responsible for swapping
 * them for `.js` on emit.
 *
 * **It only swaps them in the `.js` output, not in the `.d.ts` output** (measured on
 * TypeScript 7.0.2). So `dist/renderer/index.js` is right while the `index.d.ts` in the same
 * directory still says `export { Renderer } from "./renderer.ts"` — a file that does not
 * exist in `dist/`, and the consumer's type resolution breaks there. The symptom is hard to
 * recognise: the `import` works, and the types are `any`.
 *
 * So this makes that cut. The scope of the rewrite is narrow enough for string processing:
 * relative specifiers appear in the output in only one form, `from "…"` (there are no
 * `import("…")` type queries), and the invariant check below turns red if a new form
 * appears, rather than quietly missing it.
 */
const RELATIVE_TS_SPECIFIER = /(\bfrom\s*")(\.[^"]*)\.ts(")/g;

/**
 * Strips the lines that are entirely comment.
 *
 * ## Why this step is needed
 *
 * The two checks below run regular expressions over text, and tsc's emit **preserves
 * comments** — so a documentation comment like this gets treated as a real import:
 *
 *     /** ```ts
 *      * import { Renderer } from "@yurenju/frond/renderer";
 *      * ``` *\/
 *
 * The symptom is the build going red on a dependency that does not exist at all, and the fix
 * looks like "delete the examples from the documentation". That price cannot be paid: almost
 * all of this repo's public face explains itself through file-header comments.
 *
 * ## Why "entire line" is enough, without really parsing
 *
 * What is scanned is **the files tsc emitted**, not source written by a person. The emitted
 * shape is decided by a machine: every module specifier appears in an `import` / `export`
 * statement starting at column 0, and even a multi-line import only moves `} from "…"` onto
 * the next line — a line starting with `}`, not a comment. Conversely, preserved comments
 * are always lines starting with `//` or `*`.
 *
 * So a miss is impossible (a real import never grows on a comment line), and false positives
 * are blocked by this step. Doing better would take a parser that genuinely understands regex
 * literals and template literals, and that adds no protection for the two invariants guarded
 * here.
 */
function codeLines(source: string): string {
  return source
    .split("\n")
    .filter((line) => {
      const trimmed = line.trimStart();
      return !(
        trimmed.startsWith("//") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith("/*")
      );
    })
    .join("\n");
}

/** The absolute paths of every file under `dist/`. */
async function distFiles(directory: string = DIST): Promise<readonly string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await distFiles(path)));
    } else {
      files.push(path);
    }
  }

  return files;
}

const files = await distFiles();

/** Paths in messages are always relative to the package directory — that is where whoever reads the message is standing. */
function describe(path: string): string {
  const inside = relative(packageDirectory, path);
  return isAbsolute(inside) ? path : inside;
}

// --- rewrite ----------------------------------------------------------------

let rewritten = 0;

for (const path of files) {
  if (!path.endsWith(".d.ts")) continue;

  const before = await readFile(path, "utf8");
  const after = before.replace(RELATIVE_TS_SPECIFIER, "$1$2.js$3");
  if (after === before) continue;

  await writeFile(path, after);
  rewritten += 1;
}

// --- invariants -------------------------------------------------------------
//
// Both are **properties of the shipped artifact**, so they are checked here rather than
// written as unit tests: what they guard is the contents of `dist/`, and `dist/` only
// exists once a build has run.

const problems: string[] = [];

for (const path of files) {
  if (extname(path) !== ".ts" && extname(path) !== ".js") continue;
  if (path.endsWith(".map")) continue;

  const source = codeLines(await readFile(path, "utf8"));
  const where = describe(path);

  // 1. Not one `.ts` specifier should remain. If the rewrite above missed some form (say the
  //    output starts carrying `import("./x.ts")` type queries one day), it turns red here.
  for (const match of source.matchAll(/from\s*"([^"]*\.ts)"|import\("([^"]*\.ts)"\)/g)) {
    problems.push(`${where}: leftover .ts specifier ${match[1] ?? match[2]}`);
  }

  // 2. Not one undeclared bare specifier should appear.
  //
  //    `@yurenju/frond`'s `dependencies` and `peerDependencies` are both empty, so this rule
  //    reads "not one bare specifier is allowed" — exactly what this check originally looked
  //    like (commit 6f74fa8). That is not merely a matter of "few dependencies": it is the
  //    **precondition** for both "consumers need no bundler" and "the demo site can use a
  //    plain <script type=module>". Adding one npm package into src/epub or src/renderer
  //    would defeat both at once, and the symptom would only be visible when someone else's
  //    build failed. It turns red here.
  for (const match of source.matchAll(/from\s*"([^".][^"]*)"/g)) {
    const specifier = match[1] ?? "";
    if (specifier.startsWith("./") || specifier.startsWith("../")) continue;
    if (allowed.has(packageOf(specifier))) continue;

    problems.push(
      allowed.size === 0
        ? `${where}: bare specifier "${specifier}" — ${packageName}'s shipped dependencies must be zero`
        : `${where}: bare specifier "${specifier}" is not declared in ${packageName}'s dependencies or peerDependencies`,
    );
  }
}

if (problems.length > 0) {
  console.error(`${packageName}'s dist/ invariants are broken:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

const permitted = allowed.size === 0 ? "no bare specifiers" : `bare specifiers limited to ${[...allowed].join(", ")}`;

console.log(`${packageName}: rewrote relative imports to .js in ${rewritten} .d.ts files`);
console.log(`${packageName}: dist/ checks passed — no .ts specifiers, ${permitted} (${files.length} files)`);
