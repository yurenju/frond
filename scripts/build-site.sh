#!/usr/bin/env bash
#
# Assembles the demo site.
#
#   npm run site
#
# The resulting `site/` is a directory that can be dropped onto any static host as it is.
#
# ## Why copying rather than a symlink or a relative path
#
# `site/` has to be uploadable untouched. Symlinks break on most static hosts, and having
# `index.html` import `../dist/…` would make "the thing you can upload" the repo root rather
# than `site/` — which would drag `src/`, `tests/` and `node_modules/` up with it.
#
# ## No bundler is needed, and this step is checking that
#
# The page's `<script type="module">` imports the files `tsc` emitted, directly. That is a
# direct consequence of "frond ships with zero dependencies", so whether this page opens is
# physical proof of that property. The day someone adds an npm dependency under `src/`,
# `npm run build` turns red first on the bare specifier check in `scripts/finish-build.ts` —
# before the page breaks.
#
# There used to be a second page (`site/react/`), built the opposite way with esbuild, whose
# job was to prove that `@yurenju/frond-react`'s shipped tarball survived an ordinary
# bundler. That package is gone (ADR-0008's revision), and with it the subject of that proof
# — so the page went too, rather than staying on as a bundler test with nothing to test.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

npm run build

rm -rf site/frond
mkdir -p site/frond
cp -R dist/. site/frond/

echo "site/ is ready"
echo "  site/frond/  frond's build output, imported directly by the page"
echo "To view locally:"
echo "  npx --yes serve site    # or any static server; file:// will not do, ES modules need http"
