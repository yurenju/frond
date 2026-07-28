#!/usr/bin/env node
//
// Bundles the demo site's React page. Called by `scripts/build-site.sh`; not a standalone
// entry point.
//
// This script is executed directly by `node` (type stripping), so imports always carry a
// .ts extension — the stripper does not map ./x.js back to ./x.ts.

import { copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE_REACT = join(REPOSITORY_ROOT, "site", "react");

/**
 * ## Why this page may have a bundler when the home page may not
 *
 * The home page is physical proof of "frond ships with zero dependencies": a
 * `<script type="module">` importing the files `tsc` emitted, with no third tool involved.
 * Putting anything requiring bundling on that page would leave the claim checking nothing.
 *
 * This page proves **something else**, and it needs physical proof just as much:
 * `@yurenju/frond-react` depends on react, so its consumers all have a bundler — and the
 * question to ask here is not "can it go unbundled" but "**does the shipped package, fed to a
 * zero-configuration bundler, actually run in a real browser**".
 *
 * ## Hence resolution goes through node_modules, not the source
 *
 * There is deliberately **no** alias here. `tests/browser/react/support/harness.ts` has one
 * (it points the package names back at their `src/`, so a one-line change is immediately
 * visible), and this does the opposite: it resolves to each package's `dist/`, which is what a
 * consumer gets after `npm install`.
 *
 * The difference between the two is this page's value. The tests run against the source, so
 * they cannot catch "a wrong path in `exports`", "`files` missed something" or "the emitted
 * `.js` is missing an extension" — mistakes that only exist in the shipped artifact, and that
 * are fatal for a consumer. This page walks that route on every deploy.
 *
 * The cost is that `npm run site` has to build both packages first. `build-site.sh` therefore
 * hard-codes the order.
 */
const result = await build({
  entryPoints: [join(SITE_REACT, "app.tsx")],
  outfile: join(SITE_REACT, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  // The sourcemap lets "I saw something odd on the demo site" map straight back to the source.
  // It points at frond's shipped `src/` (those files are in the tarball; see ADR-0008), so it
  // can even step into frond's internals.
  sourcemap: true,
  // React's development build does a great deal of extra checking and logs warnings. The demo
  // site wants to show how it actually runs, not a page of console warnings, so the production
  // build is used.
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
});

// The default styles are copied over, and the page attaches them with a `<link>` that can be
// disabled.
//
// They are not imported into the bundle: that would make them "always in effect", and what
// this page is demonstrating is precisely that they **can be entirely absent**. A `<link>`
// that a switch can turn off is the only shape that expresses this.
await copyFile(
  join(REPOSITORY_ROOT, "packages", "frond-react", "styles.css"),
  join(SITE_REACT, "frond-react.css"),
);

const outputs = Object.entries(result.metafile.outputs);
for (const [path, meta] of outputs) {
  if (path.endsWith(".map")) continue;
  console.log(`site/react/bundle.js: ${(meta.bytes / 1024).toFixed(0)} kB (react included)`);
}
