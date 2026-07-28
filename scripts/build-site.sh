#!/usr/bin/env bash
#
# Assembles the demo site.
#
#   npm run site
#
# The resulting `site/` is a directory that can be dropped onto any static host as it is. It
# has two pages, and **the two are built deliberately differently** — that difference is
# itself part of what is being demonstrated:
#
#   site/index.html        @yurenju/frond        no bundling step
#   site/react/index.html  @yurenju/frond-react  esbuild, zero configuration
#
# ## Why copying rather than a symlink or a relative path
#
# `site/` has to be uploadable untouched. Symlinks break on most static hosts, and having
# `index.html` import `../packages/frond/dist/…` would make "the thing you can upload" the
# repo root rather than `site/` — which would drag `packages/`, `tests/` and `node_modules/`
# up with it.
#
# ## The first page: no bundler needed, and this step is checking that
#
# The home page's `<script type="module">` imports the files `tsc` emitted, directly. That is
# a direct consequence of "frond ships with zero dependencies", so whether this page opens is
# physical proof of that property. The day someone adds an npm dependency under
# `packages/frond/src`, `npm run build` turns red first on the bare specifier check in
# `scripts/finish-build.ts` — before the page breaks.
#
# **frond-react therefore cannot go on this page.** It necessarily depends on react and so
# necessarily needs a bundler, and once this page has been bundled the claim above no longer
# checks anything.
#
# ## The second page: a bundler is needed, and this step is checking something else
#
# frond-react's consumers all have a bundler, so the question to ask of it is not "can it go
# unbundled" but "**does the shipped package, fed to a zero-configuration bundler, actually
# run**". The second page goes through node_modules resolution — the files a consumer gets
# after `npm install` — and the full reasoning is in `scripts/bundle-site-react.ts`'s file
# header.
#
# That route requires both packages to be built first, so the order below is hard-coded.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

npm run build

# --- first page: copy, do not bundle -----------------------------------------

rm -rf site/frond
mkdir -p site/frond
cp -R packages/frond/dist/. site/frond/

# --- second page: bundle -----------------------------------------------------

node scripts/bundle-site-react.ts

echo "site/ is ready"
echo "  site/frond/           frond's build output, imported directly by the home page"
echo "  site/react/bundle.js  the frond-react demo page, bundled by esbuild"
echo "To view locally:"
echo "  npx --yes serve site    # or any static server; file:// will not do, ES modules need http"
