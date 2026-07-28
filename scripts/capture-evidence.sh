#!/usr/bin/env bash
#
# Brings the screenshots produced by a one-off Playwright spec out of the container, landing
# them under `docs/evidence/`.
#
# Before opening a PR, any visually relevant change has to be run in all three, read by an
# agent, and the reading written into the PR description alongside the images (ADR-0001,
# docs/agents/pull-requests.md). And **the images are produced inside the container** — the
# three browsers and the pinned fonts only exist in the test image, so images captured on the
# host have the wrong fonts, and what they measure is not what CI will see.
#
# Usage:
#   npm run evidence -- tests/browser/evidence/<name>.spec.ts
#   npm run evidence -- tests/browser/evidence/<name>.spec.ts --project=webkit
#
# Everything from the first argument on passes through to playwright. **At least one path is
# required**: without one it would run the whole test suite with a writable mount, which is
# not what anyone wants.
#
# ## Where one-off specs go, and why they reach the container
#
# In `tests/browser/evidence/` (that directory is gitignored — such specs do not stay in the
# repo; see docs/agents/pull-requests.md). It has to be under `tests/browser/` because
# playwright.config.ts's testDir points there, and files outside are not picked up.
#
# That directory is ignored by git, but **the image gets it anyway**: the build context looks
# at the filesystem rather than at git, and `Dockerfile`'s `COPY . .` brings untracked files
# in with everything else. So the workflow is "write the spec → run this (it rebuilds the
# image)", with no commit needed first.
set -euo pipefail

# Pick an engine, confirm the daemon is reachable, build the image. All three are shared with
# test-in-container.sh.
source "$(dirname "${BASH_SOURCE[0]}")/container.sh"

if [[ $# -eq 0 ]]; then
    echo "Usage: npm run evidence -- <spec path> [playwright arguments]" >&2
    echo "e.g.:  npm run evidence -- tests/browser/evidence/vertical.spec.ts --project=webkit" >&2
    exit 2
fi

EVIDENCE_DIR="$REPO_ROOT/docs/evidence"

# Create it on the host first. If a mount point does not exist, the engine **creates one on
# your behalf** owned by root, and that is a leftover you need sudo to delete.
mkdir -p "$EVIDENCE_DIR"

container_build

# --- run -------------------------------------------------------------------
#
# ## Why mount a directory rather than `cp` afterwards
#
# The container is reaped with `--rm`, and files written inside it disappear with it;
# dropping `--rm` and using `docker cp` would work too, but it adds one more piece of state
# to manage ("has the container been cleaned up"), and a container that was missed quietly
# occupies several GB. A mount is the stateless version of the same thing, and it is
# consistent with how CI mounts playwright-report out (test-in-container.sh).
#
# ## Mount only docs/evidence, not the whole repo
#
# Mounting the repo in looks more convenient (no image rebuild), but it makes "which copy of
# the code is running in the container" have two answers: the one built in, and the one
# mounted in. They necessarily differ in what npm ci produced — `node_modules` was installed
# in the image. And mounting the whole repo gives the container the chance to rewrite the
# source.
#
# ## Who will own the files
#
# Under a rootless engine, the container's root maps to your own uid on the host, so the files
# written out are yours. **Rootful docker produces root-owned PNGs** that git cannot touch
# afterwards — one more concrete reason docs/test-environment.md recommends rootless.
#
# ## The network is off here too
#
# Screenshots have the same requirement as the tests: pages are supplied by page.setContent.
# An image that needs an outside connection to capture cannot be captured on another machine.
exec "$ENGINE" run --rm --init --network=none \
    --volume "${EVIDENCE_DIR}:/work/docs/evidence" \
    "$IMAGE_NAME" npx playwright test "$@"
