/**
 * 對書的樣式表做的每一次文字層改寫。**這一支不碰 DOM**，輸入輸出都是 CSS 字串。
 *
 * 每一個改寫都對應 ADR-0003 介入清單裡的一項，理由與清單一起記在
 * `interventions.ts`——這裡只放機制。分開放是因為兩者的變動速度不同：機制會因為
 * 量到新的瀏覽器行為而改，清單會因為權衡改變而改，而混在一起的話「為什麼可以動
 * 書的宣告」這個問題會散在程式碼各處。
 *
 * ## 為什麼是自己走一趟而不是正規表示式
 *
 * CSS 的宣告不是行導向的：`;` 可以出現在字串與 `url()` 裡、註解可以插在屬性名
 * 中間、`@media` 的區塊裡裝的是規則而不是宣告。正規表示式在這三處都會錯，而錯
 * 的形式是**靜默改壞一本書的樣式表**——沒有人會拿到錯誤訊息，只會看到版面不對。
 *
 * 這裡因此自己走一趟，只認四件事：註解、字串、括號、以及分隔用的 `{` `}` `;`。
 * 這不是一個 CSS 解析器（選擇器、at-rule 的前綴一律原樣搬運），是一個**宣告的
 * 定位器**——足以回答「這一段文字是不是一條宣告、它的屬性名是什麼」，而那正是
 * 每一個改寫需要的全部。
 */

/** 一條宣告。`important` 與 `value` 分開，因為所有改寫都只動其中一個。 */
export interface Declaration {
  /** 屬性名，已轉小寫並去掉前後空白。 */
  readonly property: string;
  /** 值，已去掉 `!important` 與前後空白。 */
  readonly value: string;
  readonly important: boolean;
  /** 原樣的整條宣告（不含結尾的 `;`）。不改時原字搬回去，空白與註解都留著。 */
  readonly source: string;
}

/**
 * 走訪一份樣式表裡的每一條宣告。
 *
 * 回傳 `undefined` 表示這一條不動——**不動就是原字搬回去**，連空白與註解都保留。
 * 這一點是刻意的：改寫要能對一本書反覆套用而只在該動的地方留下痕跡，否則
 * 「frond 動過什麼」就查不出來了。
 */
export function mapStylesheet(
  css: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scan(css, map, { insideBlock: false });
}

/**
 * 走訪一份**宣告清單**——也就是 `style="…"` 屬性裡的那種，沒有大括號。
 *
 * 需要分成兩個入口，是因為同一段文字在兩種情境下的意思不同：`p { color: red }`
 * 在樣式表裡 `p` 是選擇器，在 style 屬性裡則整段都是宣告。
 */
export function mapDeclarationList(
  text: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scan(text, map, { insideBlock: true });
}

/**
 * `-epub-` 與 `-webkit-` 前綴的 `writing-mode`，補上一條無前綴的等價宣告。
 *
 * Firefox 兩種前綴都不認，於是只寫前綴的書（《入境大廳》那個形狀）在 Firefox
 * 上整本排成橫排（`docs/browser-quirks.md`）。這**不是覆寫書的宣告**：書的意圖
 * 沒有被改變，改的只是表達它的語法。
 *
 * 補一條而不是換掉原本那條。換掉在三家都會動，但拿掉的那一條萬一還有別的意義
 * （某家瀏覽器對前綴屬性有不同處置），差異就會被這個改寫吃掉——而補一條的代價
 * 只是多幾個位元組。
 */
export function normalisePrefixedWritingMode(css: string): string {
  return mapStylesheet(css, (declaration) => {
    const unprefixed = UNPREFIXED_WRITING_MODE.get(declaration.property);
    if (unprefixed === undefined) return undefined;
    return `${declaration.source};${unprefixed}: ${declaration.value}${
      declaration.important ? " !important" : ""
    }`;
  });
}

const UNPREFIXED_WRITING_MODE = new Map([
  ["-epub-writing-mode", "writing-mode"],
  ["-webkit-writing-mode", "writing-mode"],
]);

/**
 * 把 `page-break-*` 補上分欄版面下的等價宣告 `break-*`。
 *
 * 書用 `page-break-before: always` 分節是常態，而**分欄版面下 `page-break-*`
 * 不生效**——`page` 這個斷點類型講的是分頁媒體（列印），螢幕上的分欄要的是
 * `column`。不補的話書明明要求換頁的地方會接著排下去，那是書的意圖沒有被實現，
 * 不是 frond 忠實呈現。
 *
 * 與前綴那條同一個形狀：補一條、不換掉、意圖不變只換表達方式。
 */
export function normalisePageBreaks(css: string): string {
  return mapStylesheet(css, (declaration) => {
    const modern = MODERN_BREAK_PROPERTY.get(declaration.property);
    if (modern === undefined) return undefined;

    const value = COLUMN_BREAK_VALUE.get(declaration.value.toLowerCase());
    if (value === undefined) return undefined;

    return `${declaration.source};${modern}: ${value}${
      declaration.important ? " !important" : ""
    }`;
  });
}

const MODERN_BREAK_PROPERTY = new Map([
  ["page-break-before", "break-before"],
  ["page-break-after", "break-after"],
  ["page-break-inside", "break-inside"],
]);

/**
 * `page-break-*` 的值換算成 `break-*` 的值。
 *
 * `left` 與 `right` 指的是對開頁的左右頁，分欄版面裡沒有這個概念——退成單純的
 * 「換一欄」，那是最接近的意思。`auto` 與 `avoid` 兩邊同名。
 */
const COLUMN_BREAK_VALUE = new Map([
  ["always", "column"],
  ["left", "column"],
  ["right", "column"],
  ["avoid", "avoid"],
  ["auto", "auto"],
]);

/**
 * 拿掉指定屬性上的 `!important`。
 *
 * 這是「讀者設定被書擋住」那一格唯一有效的機制。外部樣式表打不贏書寫在
 * `style="…"` 裡的 `!important`——那不是優先權高低的問題，是層疊規則裡沒有任何
 * 位置贏得了它。所以要讓讀者贏，只能在書的宣告還是文字的時候把那個旗標拿掉。
 *
 * **只拿掉讀者實際覆寫過的那幾個屬性。** 讀者沒設字級時，書的
 * `font-size: 12px !important` 原樣留著——ADR-0003 的介入門檻是「讀者設定被書
 * 擋住」，沒有讀者設定就沒有東西被擋住，也就沒有介入的理由。
 */
export function demoteImportant(
  source: string,
  properties: ReadonlySet<string>,
  scope: CssScope = "stylesheet",
): string {
  return walk(source, scope, (declaration) =>
    declaration.important && properties.has(declaration.property)
      ? `${declaration.property}: ${declaration.value}`
      : undefined,
  );
}

/**
 * 改寫套用在哪一種文字上。
 *
 * 同一個改寫要能套在樣式表與 `style="…"` 屬性上，而那兩者的**文法不同**：樣式表
 * 裡 `p { … }` 的 `p` 是選擇器，style 屬性裡整段都是宣告。差別只在走訪器，所以
 * 用一個參數表達，而不是把每個改寫寫成兩份——兩份一定會漂開，而漂開的那一天，
 * 讀者的字級會在「書寫在樣式表裡」時生效、「書寫在 style 屬性裡」時失效。
 */
export type CssScope = "stylesheet" | "declarations";

function walk(
  source: string,
  scope: CssScope,
  map: (declaration: Declaration) => string | undefined,
): string {
  return scope === "stylesheet"
    ? mapStylesheet(source, map)
    : mapDeclarationList(source, map);
}

/**
 * 書的初始字級。`font-size` 的絕對值換算成 `rem` 時以它為基準。
 *
 * 16px 是每一家瀏覽器的 `font-size: medium`，也就是書什麼都不宣告時的字級。
 */
const INITIAL_FONT_SIZE = 16;

/** 1pt = 4/3 px。 */
const PX_PER_PT = 4 / 3;

/**
 * 把書寫死的絕對 `font-size` 換算成 `rem`。
 *
 * ## 為什麼光是拿掉 `!important` 不夠
 *
 * 讀者的字級設在 `html` 上，靠繼承往下傳。書只要在任何一個後代上寫了絕對值
 * （`p { font-size: 12px }`），那一段就脫離繼承鏈——讀者把字級調到 24px，正文
 * 仍然是 12px。這裡沒有 `!important` 的問題，是**絕對值本身**擋住了讀者。
 *
 * 換成 `rem` 之後，書宣告的每一個字級都變成「相對於讀者設定的幾倍」：`12px` 是
 * 0.75 倍、`24px` 是 1.5 倍。讀者調字級時整份文件按同一個比例縮放，而**書自己
 * 的字級層次完全保留**——標題仍然比正文大，比例一格不差。
 *
 * ## 為什麼是 `rem` 而不是 `em`
 *
 * `em` 相對於父元素，於是巢狀的絕對字級會連乘：`p` 的 0.75 倍套上 `span` 的
 * 0.625 倍變成 0.47 倍，而書本來要的是 0.625 倍。`rem` 一律相對於根元素，不會
 * 連乘，換算前後的比例逐項相同。
 *
 * ## 代價
 *
 * 這是這份清單裡**唯一改變了書的宣告的值**的一項，其餘幾項都只補宣告或拿旗標。
 * 換句話說，書要求「這一段永遠是 12px」這個意圖確實沒有被實現——但那個意圖與
 * user story 42（讀者調字級必須生效）直接衝突，而 ADR-0003 已經裁定讀者贏。
 * 保留的是可以保留的那一半：字級之間的**比例**。
 *
 * 與 `demoteImportant` 一樣，**只在讀者設了字級時才做**。
 */
export function relativiseFontSizes(
  source: string,
  scope: CssScope = "stylesheet",
): string {
  return walk(source, scope, (declaration) => {
    if (declaration.property !== "font-size") return undefined;

    const rem = toRem(declaration.value);
    if (rem === undefined) return undefined;

    return `font-size: ${rem}${declaration.important ? " !important" : ""}`;
  });
}

/**
 * 絕對長度換算成 `rem`。**只認整條值就是一個絕對長度的情況**。
 *
 * 已經是相對單位的（`em`、`rem`、`%`、`larger`）本來就跟著讀者走，不必動；
 * `calc()` 這類複合值不動，因為換算需要知道整個運算式的意思，而算錯比不算更糟。
 */
function toRem(value: string): string | undefined {
  const match = /^(-?\d*\.?\d+)(px|pt)$/i.exec(value.trim());
  if (match === null) return undefined;

  const amount = Number(match[1]);
  const pixels = match[2]!.toLowerCase() === "pt" ? amount * PX_PER_PT : amount;
  const rem = pixels / INITIAL_FONT_SIZE;

  // 收到小數點後四位。位數不收的話 12pt 這種換算會拖出一長串循環小數，讓改寫
  // 後的樣式表難讀，而那份文字是查問題時唯一看得到的東西。
  return `${Number(rem.toFixed(4))}rem`;
}

/**
 * 把值裡的 `url(…)` 換成解析器給的位址。
 *
 * 書的樣式表用相對路徑引用圖片與字型，而 frond 把內容以 `blob:` 供給
 * （ADR-0006）——`blob:` 沒有目錄結構，相對路徑一律解析失敗。這不是介入書的
 * 宣告，是把同一個引用換一種寫法表達。
 *
 * `resolve` 回傳 `undefined` 時原樣留著：那多半是 `data:` 或指向書外的絕對
 * 位址，兩者都不需要換。
 */

/**
 * 走訪一段 CSS，把每一條宣告交給 `map`。
 *
 * `insideBlock` 是整個走訪唯一的狀態機：在區塊外時，累積的文字是選擇器或
 * at-rule 的前綴（碰到 `{` 才知道）；在區塊內時，累積的文字是一條宣告（碰到
 * `;` 或 `}` 才知道）。巢狀的 at-rule（`@media` 裡面裝規則）靠著「碰到 `{` 就
 * 表示剛剛那段是選擇器」自然處理掉——那段文字裡就算有冒號也不會被當成宣告。
 */
function scan(
  source: string,
  map: (declaration: Declaration) => string | undefined,
  options: { insideBlock: boolean },
): string {
  let output = "";
  let pending = "";
  let depth = options.insideBlock ? 1 : 0;
  let index = 0;

  const flushDeclaration = (): void => {
    output += depth > 0 ? rewriteDeclaration(pending, map) : pending;
    pending = "";
  };

  while (index < source.length) {
    const character = source[index]!;

    // 註解、字串與括號整段原樣搬運：它們裡面的 `;` `{` `}` `:` 不是分隔符。
    const skipped = skipOpaque(source, index);
    if (skipped > index) {
      pending += source.slice(index, skipped);
      index = skipped;
      continue;
    }

    if (character === "{") {
      // 剛剛累積的是選擇器或 at-rule 的前綴，原樣搬運。
      output += pending;
      pending = "";
      output += character;
      depth += 1;
      index += 1;
      continue;
    }

    if (character === "}") {
      flushDeclaration();
      output += character;
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }

    if (character === ";") {
      flushDeclaration();
      output += character;
      index += 1;
      continue;
    }

    pending += character;
    index += 1;
  }

  flushDeclaration();
  return output;
}

/**
 * 註解、字串與括號——這三種東西裡面的分隔符不算分隔符。
 *
 * 回傳跳過之後的位置；不是這三種的話原樣回傳 `index`。括號一起處理是因為
 * `url(…)` 裡的分號很常見（`data:` URI 就有），而 `calc()` 裡的括號要成對數。
 */
function skipOpaque(source: string, index: number): number {
  const character = source[index]!;

  if (character === "/" && source[index + 1] === "*") {
    const end = source.indexOf("*/", index + 2);
    return end === -1 ? source.length : end + 2;
  }

  if (character === '"' || character === "'") {
    let cursor = index + 1;
    while (cursor < source.length) {
      if (source[cursor] === "\\") {
        cursor += 2;
        continue;
      }
      if (source[cursor] === character) return cursor + 1;
      cursor += 1;
    }
    return source.length;
  }

  if (character === "(") {
    let cursor = index + 1;
    let depth = 1;
    while (cursor < source.length && depth > 0) {
      const next = skipOpaque(source, cursor);
      if (next > cursor) {
        cursor = next;
        continue;
      }
      if (source[cursor] === "(") depth += 1;
      else if (source[cursor] === ")") depth -= 1;
      cursor += 1;
    }
    return cursor;
  }

  return index;
}

/** 把一段「屬性: 值」交給 `map`，不是宣告的話原樣搬回去。 */
function rewriteDeclaration(
  source: string,
  map: (declaration: Declaration) => string | undefined,
): string {
  const colon = topLevelColon(source);
  if (colon === -1) return source;

  // 註解可以插在屬性名的前後（`/* … */ margin: 0`），而屬性名是**扣掉註解之後**
  // 的那段文字。不扣的話 `margin` 會變成一個沒有人比對得到的字串，於是那條宣告
  // 對每一個改寫都是隱形的——不會報錯，只會漏掉。
  const property = stripComments(source.slice(0, colon)).trim().toLowerCase();
  if (property === "") return source;

  const rawValue = source.slice(colon + 1);
  const important = IMPORTANT.test(rawValue);
  const value = rawValue.replace(IMPORTANT, "").trim();

  const replacement = map({ property, value, important, source });
  if (replacement === undefined) return source;

  // 前導空白留給改寫後的文字，縮排才不會塌掉——那份文字是查問題時唯一看得到的
  // 東西，讀得下去有實際價值。
  const indent = /^\s*/.exec(source)?.[0] ?? "";
  return indent + replacement;
}

/** `!important`，前後允許空白，大小寫不拘。 */
const IMPORTANT = /\s*!\s*important\s*$/i;

/** 拿掉註解。只用在讀屬性名的時候——輸出的文字一律走原字，註解要留著。 */
function stripComments(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "*") {
      index = skipOpaque(source, index);
      continue;
    }
    output += source[index];
    index += 1;
  }

  return output;
}

/** 不在註解、字串或括號裡的第一個冒號。 */
function topLevelColon(source: string): number {
  let index = 0;
  while (index < source.length) {
    const skipped = skipOpaque(source, index);
    if (skipped > index) {
      index = skipped;
      continue;
    }
    if (source[index] === ":") return index;
    index += 1;
  }
  return -1;
}

/**
 * 把值裡的 `url(…)` 換成解析器給的位址。
 *
 * 書的樣式表用相對路徑引用圖片與字型，而 frond 把內容以 `blob:` 供給
 * （ADR-0006）——`blob:` 沒有目錄結構，相對路徑一律解析失敗。這不是介入書的
 * 宣告，是把同一個引用換一種寫法表達。
 *
 * `resolve` 回傳 `undefined` 時原樣留著：那多半是 `data:` 或指向書外的絕對
 * 位址，兩者都不需要換。
 *
 * 走訪與 `scan` 分開，因為它要看的是值裡面的括號而不是宣告的邊界——`@import`
 * 的 `url()` 根本不在任何一條宣告裡。
 */
export function rewriteUrls(
  source: string,
  resolve: (reference: string) => string | undefined,
): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "*") {
      const end = skipOpaque(source, index);
      output += source.slice(index, end);
      index = end;
      continue;
    }

    const match = URL_FUNCTION.exec(source.slice(index));
    if (match === null || match.index !== 0) {
      output += source[index];
      index += 1;
      continue;
    }

    const closing = skipOpaque(source, index + match[0].length - 1);
    const inside = source.slice(index + match[0].length, closing - 1);
    const reference = unquote(inside.trim());
    const resolved = reference === "" ? undefined : resolve(reference);

    output +=
      resolved === undefined
        ? source.slice(index, closing)
        : `url("${resolved.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
    index = closing;
  }

  return output;
}

/** `url(` ——大小寫不拘，`url` 與 `(` 之間不允許空白（CSS 的規定）。 */
const URL_FUNCTION = /^url\(/i;

function unquote(text: string): string {
  const first = text[0];
  if ((first === '"' || first === "'") && text.endsWith(first) && text.length >= 2) {
    return text.slice(1, -1);
  }
  return text;
}
