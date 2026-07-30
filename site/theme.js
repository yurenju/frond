// The demo site's light/dark theme.
//
// It is a module of its own rather than part of `app.js`, and for the same reason
// `style.css` is separate: the theme is a property of **the site**, not a way of using
// frond. The page imports it directly, with no bundler, like everything else it loads.
//
// ## One switch, two sides, and only one of them is CSS
//
// Outside the book the theme is entirely CSS: `style.css` states every colour as a
// `light-dark(…, …)` pair, and this module only ever sets `color-scheme` on `<html>`. That
// really is the whole mechanism, and it is worth more than a palette of custom properties
// would be — the native controls on these pages (the `<select>`s, the range sliders, the
// scrollbars) follow `color-scheme` on their own, and nothing a stylesheet says about
// colour makes them do that.
//
// Inside the book is the other side, and **CSS cannot reach in**: the book renders in an
// iframe, so frond takes colours (`ReaderSettings.theme`) rather than a stylesheet. That
// boundary is why `BOOK_THEMES` below is written in JavaScript instead of being read back
// out of the stylesheet — `light-dark()` is resolved per element at use time, and does not
// come back out of `getPropertyValue()`.
//
// ## Why the book's theme is not a control of its own
//
// It used to be: the reading toolbar had its own light / sepia / dark dropdown, on top of
// the page's. Two switches for one question is one too many — a reader who puts the site in
// dark mode and then finds the book still white has been asked to say the same thing twice.
// So there is one choice, made once, and the book follows it.
//
// The cost is stated plainly, because it is real: a book always themed is a book whose own
// colour scheme is always given up (`settings.ts` says so at length). "As the book" is no
// longer reachable from these pages — the frond API still has it, as `theme: undefined`.

/**
 * @typedef {"system" | "light" | "dark"} ThemeChoice
 * @typedef {{ foreground: string, background: string, link: string }} BookTheme
 */

/**
 * Where the reader's choice is remembered.
 *
 * **This string is repeated verbatim in the page's `<head>`**, and deliberately: applying a
 * stored choice cannot wait for a module to load without the page painting in the wrong
 * scheme first. See the comment on that script in `index.html`.
 */
const STORAGE_KEY = "frond-site-theme";

/**
 * The colours inside the book.
 *
 * They match `--panel` and `--ink` in `style.css` on purpose. The margin is made by insetting
 * the iframe within its container, so that band is outside the document and `Renderer` paints
 * `theme.background` on the container too — any difference between these and the panel behind
 * the book would show up as a ring around the text.
 *
 * `link` is here because `foreground` is applied to every element, links included: without
 * it, nothing in the book looks tappable. frond picks no default of its own — a colour would
 * be exactly the presentational opinion it declines to hold.
 *
 * @type {Record<"light" | "dark", BookTheme>}
 */
const BOOK_THEMES = {
  light: { foreground: "#1c1e21", background: "#ffffff", link: "#2f6b4f" },
  dark: { foreground: "#dfe1e4", background: "#1b1e23", link: "#6fbf95" },
};

const PREFERS_DARK = window.matchMedia("(prefers-color-scheme: dark)");

/** @type {Set<() => void>} */
const listeners = new Set();

/**
 * Reading storage can throw — a browser with cookies and storage blocked raises on the
 * property access itself. Failing to draw the page over a colour preference would be a poor
 * trade, so an unreadable store simply means "no choice was made".
 *
 * @returns {ThemeChoice}
 */
function storedChoice() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

/** @type {ThemeChoice} */
let choice = storedChoice();

/**
 * The scheme actually in effect, with `"system"` already resolved.
 *
 * @returns {"light" | "dark"}
 */
export function currentScheme() {
  if (choice === "light" || choice === "dark") return choice;
  return PREFERS_DARK.matches ? "dark" : "light";
}

/**
 * The colours to hand frond for the book, for the scheme in effect.
 *
 * @returns {BookTheme}
 */
export function currentBookTheme() {
  return BOOK_THEMES[currentScheme()];
}

/**
 * Subscribes to changes of the scheme in effect — the reader choosing, and the system
 * changing underneath a reader who chose "System".
 *
 * @param {() => void} listener
 * @returns {() => void} the unsubscribe
 */
export function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wires up a `<select>` offering `system` / `light` / `dark`.
 *
 * The control lives in the masthead, and it is driven from here so that the page need not
 * know where the choice is kept or what `<html>` has to say for it to take effect.
 *
 * @param {HTMLSelectElement} select
 */
export function connectChoiceControl(select) {
  select.value = choice;

  select.addEventListener("change", () => {
    choice =
      select.value === "light" || select.value === "dark" ? select.value : "system";

    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Same trade as reading: the theme still applies for this visit, it is just not
      // remembered for the next one.
    }

    applyChoice();
    for (const listener of listeners) listener();
  });
}

/**
 * Puts the choice on `<html>`, where `style.css` picks it up.
 *
 * "System" **removes** the attribute rather than writing a resolved value into it: `:root`'s
 * own `color-scheme: light dark` is already the right answer, and it stays right when the
 * system changes without anything having to run.
 */
function applyChoice() {
  const root = document.documentElement;
  if (choice === "system") delete root.dataset.theme;
  else root.dataset.theme = choice;
}

// The `<head>` script has normally done this already; this covers a page that has none, and
// costs nothing when it has.
applyChoice();

PREFERS_DARK.addEventListener("change", () => {
  // Only reaches the page when the reader is following the system. With an explicit choice
  // the scheme in effect has not changed, and waking every listener would relayout the book
  // for nothing.
  if (choice === "system") for (const listener of listeners) listener();
});
