import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { Page } from "@playwright/test";

/**
 * Feeding frond-react into a browser.
 *
 * ## Why this one needs a bundler when `tests/browser/support/harness.ts` does not
 *
 * That one relies on frond's module graph containing no bare specifier at all — strip the
 * types and it goes straight into a `<script type="module">`. **frond-react does not have
 * that property, and should not**: it necessarily imports `react`, and that is exactly
 * the line between it and frond.
 *
 * And `react` ships CommonJS on npm, which a browser cannot load. Hence the extra
 * esbuild: it is a devDependency and enters neither package's shipped surface
 * (`scripts/finish-build.ts` confirms that on every build).
 *
 * This does not lose the "needs no bundler" property — that property was only ever
 * frond's, and it is still verified by every deploy of the demo site
 * (`scripts/build-site.sh`).
 *
 * ## What gets bundled is the source, not dist
 *
 * `alias` points both package names back at their own `src/`. The reason is the same as
 * for the other harness: the tests run against the source, so that seeing one change does
 * not require a build first.
 *
 * The cost is that this cannot prove "the shipped tarball installs and works". That
 * happens in `release.yml` — it builds a fake consumer outside the repo, installs the
 * tarball, and then verifies runtime and types together.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const ENTRY = resolve(REPO_ROOT, "tests/browser/react/support/page/react-page.tsx");

export const ORIGIN = "http://frond-react.test";

/**
 * Bundle once.
 *
 * Each Playwright worker is its own process, but every spec within one worker shares this
 * module — without caching, it would be one bundle per spec times three browsers, and
 * esbuild's start-up cost would become the most expensive slot in the whole suite.
 */
let bundling: Promise<string> | undefined;

function bundle(): Promise<string> {
  bundling ??= build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    // React's development build prints more under StrictMode and runs each effect an extra
    // time — and "an extra effect run must not leave a second iframe" is exactly what these
    // tests are here to catch. So: the development build, not the production one.
    define: { "process.env.NODE_ENV": '"development"' },
    alias: {
      "@yurenju/frond-react": resolve(REPO_ROOT, "packages/frond-react/src/index.ts"),
      "@yurenju/frond/renderer": resolve(REPO_ROOT, "packages/frond/src/renderer/index.ts"),
    },
  }).then((result) => {
    const output = result.outputFiles[0];
    if (output === undefined) throw new Error("esbuild produced no output file");
    return output.text;
  });

  return bundling;
}

/** Teaches this page about `http://frond-react.test` and opens the shell page. */
export async function openReactHarness(page: Page): Promise<void> {
  const script = await bundle();

  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname === "/") {
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: shell() });
      return;
    }

    if (url.pathname === "/react-page.js") {
      await route.fulfill({ contentType: "text/javascript; charset=utf-8", body: script });
      return;
    }

    if (url.pathname === "/styles.css") {
      await route.fulfill({
        contentType: "text/css; charset=utf-8",
        path: resolve(REPO_ROOT, "packages/frond-react/styles.css"),
      });
      return;
    }

    await route.fulfill({ status: 404, body: "" });
  });

  await page.goto(`${ORIGIN}/`);
  await page.waitForFunction(() => window.reactHarness !== undefined);
}

/**
 * The shell page.
 *
 * **`styles.css` is deliberately not loaded.** These tests' default state is "the
 * consumer imported nothing", and that is exactly where "the default styles are entirely
 * optional" gets verified — the spec that checks whether they take effect calls
 * `loadDefaultStyles()` itself.
 */
function shell(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>frond-react harness</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      /*
       * The shell gives the viewport a size. frond-react sets none of its own (see
       * viewport.tsx's header comment), so without this the height is 0, every spec measures
       * a blank screen — and the symptom looks like frond being broken.
       */
      .viewport { width: 800px; height: 600px; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/react-page.js"></script>
  </body>
</html>`;
}

/** Attaches the default styles. Used by the spec that verifies they are optional. */
export async function loadDefaultStyles(page: Page): Promise<void> {
  await page.addStyleTag({ url: `${ORIGIN}/styles.css` });
}

/** Which synthetic book to mount. `null` means "no book chosen yet". */
export type BookChoice = "one" | "two" | null;

export interface MountConfig {
  readonly book: BookChoice;
  readonly settings?: SettingsPatch | undefined;
  /** Wrap in `<StrictMode>`. */
  readonly strict?: boolean | undefined;
  /** Install `useKeyboardPaging()`. */
  readonly keyboard?: boolean | undefined;
  /** Switch the paging triggers to `asChild`, with a `<button>` carrying its own `onClick` as the child. */
  readonly asChild?: boolean | undefined;
}

/** A serializable form of `ReaderSettings` — `page.evaluate` can only send plain data across. */
export interface SettingsPatch {
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly margin?: number;
  readonly columns?: 1 | 2 | "auto";
}

export interface LocationSnapshot {
  readonly sectionIndex: number;
  readonly sectionPath: string;
  readonly page: number;
  readonly pageCount: number;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

/** The page side's operating surface. Implemented in `tests/browser/react/support/page/react-page.tsx`. */
export interface ReactHarness {
  /** Builds a fresh React tree, unmounting any existing one first. */
  mount(config: MountConfig): Promise<void>;
  /** Changes props **without rebuilding the React tree** — the controlled route is only measurable through this. */
  update(config: MountConfig): Promise<void>;
  /** Unmounts the whole tree. `Root`'s cleanup should tear the `Renderer` down here. */
  unmount(): Promise<void>;
  /** How many iframes are under the viewport. StrictMode's double mount would make it 2. */
  iframeCount(): number;
  /** How many `load` events were received. **A reader-setting change adds one too** — it rebuilds the document. */
  loadCount(): number;
  /**
   * How many distinct `Renderer` instances have appeared — that is, how many times a book
   * was mounted.
   *
   * Both "changing settings must not remount" and "changing books must remount" are
   * measured through it. On identity rather than a count; the reasoning is in the comment
   * on `seenRenderers` in `react-page.tsx`.
   */
  attachCount(): number;
  location(): LocationSnapshot | null;
  /** The computed style of a selector inside the current section's iframe. */
  computed(selector: string, property: string): string;
  /** How many times the consumer's own `onClick` (for `asChild`) was called. */
  childClickCount(): number;
}

declare global {
  interface Window {
    readonly reactHarness: ReactHarness;
  }
}

export async function mount(page: Page, config: MountConfig): Promise<void> {
  await page.evaluate((value) => window.reactHarness.mount(value as MountConfig), config);
}

export async function update(page: Page, config: MountConfig): Promise<void> {
  await page.evaluate((value) => window.reactHarness.update(value as MountConfig), config);
}
