# frond's test environment.
#
# This is not an accessory of the CI configuration; it is the physical precondition for
# cross-browser self-differencing to work at all (ADR-0004). The oracle for the differencing
# is frond itself: the same book, the same viewport and the same settings are run once in
# each of the three browsers and compared, and a difference is a red light. If the three
# environments resolved to different system fonts, every difference measured would be 100%
# a font difference, and real bugs would be buried.
#
# The same reasoning is why local runs cannot happen directly on a developer's own operating
# system — that would create the most draining kind of gap, "green locally, red in CI", with
# the cause hidden in the font layer where it is extremely hard to trace. So CI and local
# machines share this one image.

# The base is pinned to an explicit version, not a floating tag.
# The version here has to match package.json's @playwright/test, or the browsers in the image
# will not match the version the test suite expects.
#
# The upper bound is set by the image rather than by npm: MCR's official images lag the npm
# package. At the time of writing, npm's @playwright/test is already 1.62.0, while
# mcr.microsoft.com/playwright only has v1.62.0-next-canary-*, with v1.61.1 as the latest
# official. When upgrading, check the tags before touching package.json:
#   curl -s https://mcr.microsoft.com/v2/playwright/tags/list
FROM mcr.microsoft.com/playwright:v1.61.1-noble

# ---------------------------------------------------------------------------
# Fonts
# ---------------------------------------------------------------------------
#
# Noto CJK is used uniformly for CJK: Traditional Chinese, Simplified Chinese and Japanese
# share one font family. The reason is to avoid mixing differently designed fonts across
# locales — that would give each of the three browsers' fallback paths a chance to diverge,
# and a divergence hidden in the font layer is extremely hard to trace.
#
# The reason the version is pinned is not ordinary reproducibility hygiene but this: a font
# update changes glyph metrics, changed glyph metrics change line breaking, and changed line
# breaking changes page breaking. One unintended update can turn a whole batch of invariants
# and differencing tests a different colour, for reasons unrelated to frond's code.
#
# Only fonts-noto-cjk is installed (regular and bold, about 91 MB installed), not
# fonts-noto-cjk-extra (the remaining weights, another 214 MB or so). No fixture currently
# uses a weight other than regular or bold; add it when one really does, and record the
# reason here.
ARG FONTS_NOTO_CJK_VERSION=1:20230817+repack1-3
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        "fonts-noto-cjk=${FONTS_NOTO_CJK_VERSION}" \
    && rm -rf /var/lib/apt/lists/*

# Pins the generic families and the regional faces. Merely "having installed the fonts" is
# not enough: the resolution order for serif and sans-serif could still change with a base
# image update, and if the choice of regional face (TC / SC / JP) is left to each browser's
# own language matching, the three may pick different faces for the same Japanese book.
# The number 75 is necessary rather than arbitrary: the base image's 60-latin.conf and the
# 70-fonts-noto-cjk.conf that ships with fonts-noto-cjk both touch the same generic
# families, and this file has to come after both. The comment at the top of that file records
# the complete ordering rules — including one that runs counter to intuition:
# mode="prepend" inserts before the value the test matched, so an earlier-applied rule has
# higher priority.
COPY docker/fontconfig/75-frond-cjk.conf /etc/fonts/conf.d/75-frond-cjk.conf
RUN fc-cache --force --really-force

# The process's locale is part of the font configuration too, so it is pinned explicitly.
#
# When WebKit asks fontconfig for a generic family (serif / sans-serif) it **does not pass
# the document's lang**, and fontconfig fills that gap from the process's locale — so the
# CJK regional face for the entire WebKit process is decided by this environment variable.
# Measured, LANG=ja_JP.UTF-8 switches WebKit's serif from TC to JP across the board, even for
# documents with lang=zh-TW (docs/browser-quirks.md).
#
# The base image is already C.UTF-8, so these two lines are a no-op today. They are written
# out because the moment it drifts, the symptom is all three browsers' line and page breaks
# changing together, with the cause hidden in an environment variable nobody is looking at.
#
# Placed before the font verification, so that script's fc-match runs under the pinned locale
# — the same variable also changes fc-match's answer for a generic family.
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8

# Verifies at build time that the font bindings really took effect. It is here rather than
# left to the tests, because the failure mode of a broken binding is a silent fallback to a
# different font — which raises no error and merely builds every subsequent geometric number
# on the wrong font. Better to blow up at build.
COPY docker/verify-fonts.sh /usr/local/bin/frond-verify-fonts
RUN chmod +x /usr/local/bin/frond-verify-fonts && frond-verify-fonts

# ---------------------------------------------------------------------------
# The test suite
# ---------------------------------------------------------------------------
WORKDIR /work

# Copy only the manifests first, so the dependency layer still hits the build cache when the
# source changes.
#
# Every package in the workspace has to have its own manifest present, or `npm ci` will not
# recognise the directories `workspaces` points at and fails as if packages were missing.
# They are listed one by one rather than `COPY packages/*/package.json` — under Docker's COPY
# semantics the latter flattens each of them onto `packages/package.json`, with the last
# overwriting the previous, and the symptom is npm complaining about a package whose name
# does not match.
COPY package.json package-lock.json ./
COPY packages/frond/package.json packages/frond/
COPY packages/frond-react/package.json packages/frond-react/
# The browsers are already in the base image and need not be downloaded again.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
#
# `--ignore-scripts` is for the root package.json's `prepare`. That script runs
# `npm run build`, and the build needs `packages/*/src/` and `scripts/` — while this layer has
# only copied a few manifests (which is precisely why it can hit the cache). Without blocking
# it, this step fails outright.
RUN npm ci --ignore-scripts

COPY . .

# The build only works once the source is all here. Three things need it:
# `tests/node/epub-book/open.test.ts` goes through package.json's `exports` entry point (which
# points at `packages/frond/dist/`), frond-react's browser tests need its own `dist/`, and the
# demo page's screenshots need build output under `site/frond/`.
#
# Two steps rather than one: `npm run site` only builds `@yurenju/frond` (for the reason see
# `scripts/build-site.sh`), so frond-react relies on the full build in the line before.
RUN npm run build
RUN npm run site

CMD ["npx", "playwright", "test"]
