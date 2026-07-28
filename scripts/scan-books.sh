#!/usr/bin/env bash
#
# Runs Playwright over a set of **real, commercially circulating books**, to find the class of
# defect that is "all green on the synthetic fixtures, broken on real books" (CONTEXT.md's
# "model books").
#
# Usage:
#   FROND_BOOKS=/path/to/books npm run scan:books -- tests/browser/evidence/<name>.spec.ts
#   FROND_BOOKS=/path/to/books npm run scan:books -- tests/browser/evidence/<name>.spec.ts --project=webkit
#
# The books are named by `FROND_BOOKS` and mounted into the container at
# `tests/books/commercial` (already in `.gitignore`; ADR-0007: commercial books do not enter
# the repo). **A read-only mount rather than copying into the image** for two reasons: those
# books are copyrighted and should enter neither the build context nor the repo tree; and
# stuffing hundreds of MB of books into the image would mean repacking the context every time
# a line of a spec changes.
#
# One-off scanning specs go in `tests/browser/evidence/` (likewise gitignored, but `COPY . .`
# looks at the filesystem rather than git, so no commit is needed first — same as
# capture-evidence.sh).
set -euo pipefail

# Pick an engine, confirm the daemon is reachable, build the image. All three are shared with
# the other two scripts.
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

BOOKS="${FROND_BOOKS:-$REPO_ROOT/tests/books/commercial}"

if [[ ! -d "$BOOKS" ]]; then
    echo "Book directory not found: $BOOKS" >&2
    echo "Name it with FROND_BOOKS=<directory>, or put the books in tests/books/commercial/." >&2
    exit 2
fi

if [[ $# -eq 0 ]]; then
    echo "Usage: FROND_BOOKS=<directory> npm run scan:books -- <spec path> [playwright arguments]" >&2
    exit 2
fi

container_build

# The network is off here too (same as test-in-container.sh): the books are supplied by the
# filesystem, and a scan should need no outside connection.
exec "$ENGINE" run --rm --init --network=none \
    --volume "${BOOKS}:/work/tests/books/commercial:ro" \
    "$IMAGE_NAME" npx playwright test "$@"
