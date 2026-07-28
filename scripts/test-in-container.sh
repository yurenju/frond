#!/usr/bin/env bash
#
# Runs the tests inside the test container. CI and local machines share one image — this is
# deliberate; see docs/test-environment.md.
#
# Both runners run here (ADR-0009): Vitest's Node tests first, then Playwright's
# three-browser tests. The Node half depends on neither fonts nor browsers, but it still goes
# in the container — one entry point and one set of versions is what makes "the tests are all
# green" mean the same thing locally and in CI.
#
# Usage:
#   ./scripts/test-in-container.sh                     # run both runners
#   ./scripts/test-in-container.sh --project=firefox   # remaining arguments pass through to playwright
#
# When what you want is screenshots rather than a red/green light, use
# ./scripts/capture-evidence.sh: this one runs with --rm and mounts no writable directory, so
# files produced inside the container disappear with it.
set -euo pipefail

# Pick an engine, confirm the daemon is reachable, build the image. All three are shared with
# capture-evidence.sh.
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

container_build

# --- run -------------------------------------------------------------------
#
# The tests need no network at all: every page is supplied by page.setContent, with no
# external resources. Turning the network off explicitly also guarantees no test quietly
# depends on an outside connection — such a dependency becomes an irreproducible red light in
# someone else's environment.
run_args=(--rm --init --network=none)

# CI has to reach inside the container, or the branches in playwright.config.ts that look at
# process.env.CI (forbidOnly, the github reporter, the html reporter) are all dead in CI.
# The report is written inside the container, and without mounting it out, --rm takes it away
# and CI's artifact is empty forever.
if [[ -n "${CI:-}" ]]; then
    mkdir -p "$REPO_ROOT/playwright-report"
    run_args+=(
        --env CI
        --volume "${REPO_ROOT}/playwright-report:/work/playwright-report"
    )
fi

# The Node tests run first. They finish in seconds, and they cover what the browser tests
# depend on (the structure of the synthetic fixtures, say) — when that layer is broken,
# seeing "the fixture is not a conforming book" first is far easier to trace than seeing all
# three browsers go red together.
echo "==> running the Node tests (Vitest)"
"$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx vitest run

echo "==> running the browser tests (Playwright)"
exec "$ENGINE" run "${run_args[@]}" "$IMAGE_NAME" npx playwright test "$@"
