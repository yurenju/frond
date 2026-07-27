/**
 * EPUB CFI（Canonical Fragment Identifier）的**文法層**：字串與結構之間的來回，
 * 以及兩個 CFI 的先後比較。
 *
 * CFI 是書中的精確位置或範圍（CONTEXT.md），讀者的閱讀進度與 annotation 都靠它
 * 定位。
 *
 * CONTEXT.md 說「CFI 精確但不可比大小，fraction 可比大小但粗」——那句話講的是
 * **距離**：兩個 CFI 之間沒有「差多少」，也算不出百分比，那是 fraction 的事。
 * **先後仍然問得出來**，而且非問不可（user story 22：把 annotation 依書中順序
 * 排列）。所以這裡有 `compareCfi()` 而沒有任何相減。
 *
 * ## 這個模組的界線
 *
 * **CFI ↔ DOM 位置的對應不在這裡。** 那需要真的有一份渲染好的文件——把 CFI 走
 * 成一個 `Range`、或把讀者選取的一段文字寫成 CFI，都要數節點、要處理被過濾掉的
 * 節點、要合併相鄰的文字節點。那些屬於 `Renderer`（ADR-0005 的雙層切分）。
 *
 * 這樣切的收穫是這一層落在測試金字塔的底層：零 DOM，Vitest 在 Node 裡跑得完
 * （ADR-0009），而且它是 `Renderer` 定位那張票的 blocker，早做就不必回頭等。
 *
 * ## oracle 是規格，不是 foliate
 *
 * 這一層的正確性對 EPUB CFI 規格量，foliate 在這裡沒有特殊知識（ADR-0001 的
 * 測試金字塔第 1 層）。它的 `tests/epubcfi-tests.js` 當**驗收表**跑過一遍，
 * 逐條的結果記在 `tests/node/cfi/foliate-acceptance.test.ts`——那是讀它的案例，
 * 不是讀它的程式碼。
 *
 * ## 文法（規格的 ABNF，只留這一層要的部分）
 *
 * ```
 * fragment   = "epubcfi(" ( path | range ) ")"
 * range      = path "," local_path "," local_path
 * path       = { step | "!" } [ offset ]
 * step       = "/" integer [ "[" assertion "]" ]
 * offset     = ":" integer [ "[" assertion "]" ]
 * ```
 *
 * `!` 是**間接引用**：跨過它就換了一份文件（封裝文件 → 內容文件）。所以一條
 * 路徑在這裡表述成「被 `!` 切開的數段」（`CfiSegment`），而不是一串扁平的
 * step——那個邊界正是 compare 唯一會回答「不可比」的地方。
 */

/** 一個 CFI：書中的一個位置，或一段範圍。 */
export type Cfi = CfiPoint | CfiRange;

/** 單一位置。 */
export interface CfiPoint {
  readonly kind: "point";
  readonly path: CfiPath;
}

/**
 * 一段範圍——annotation 要用它標一段文字。
 *
 * 規格的形狀是「共同前綴 + 起 + 訖」（`parent,start,end`）而不是兩個完整的
 * CFI，因為一段 highlight 幾乎總是落在同一份文件裡，共用前綴讓它短得多。
 */
export interface CfiRange {
  readonly kind: "range";
  /** 起訖共用的前半段。 */
  readonly parent: CfiPath;
  /** 接在 `parent` 之後的起點。 */
  readonly start: CfiPath;
  /** 接在 `parent` 之後的終點。 */
  readonly end: CfiPath;
}

/**
 * 一條路徑，依間接引用（`!`）切成數段。
 *
 * 第一段落在封裝文件裡，之後每一段落在前一段最後一步所指的那份文件裡。至少
 * 一段。
 */
export type CfiPath = readonly CfiSegment[];

/** 同一份文件內的一串 step，可能以一個字元位移收尾。 */
export interface CfiSegment {
  readonly steps: readonly CfiStep[];
  /** 段尾的字元位移。沒有位移時是 `undefined`——那指的是節點本身。 */
  readonly offset: CfiOffset | undefined;
}

export interface CfiStep {
  /**
   * 子節點的序號。**偶數指元素、奇數指文字節點**，這是 CFI 的定址規則，不是
   * 陣列索引。
   */
  readonly index: number;
  /** `[…]`。step 上的斷言是 id。 */
  readonly assertion: CfiAssertion | undefined;
}

/** 字元位移（`:N`）——落在文字節點裡第 N 個字元之前。 */
export interface CfiOffset {
  readonly characters: number;
  /** `[…]`。位移上的斷言是前後文（`[前,後]`）。 */
  readonly assertion: CfiAssertion | undefined;
}

/**
 * `[…]` 裡的斷言。**規格說索引才是權威，斷言是書改版之後用來回復位置的冗餘**
 * ——所以 frond 讀得出它、寫得回去，但 `compareCfi()` 不看它。
 *
 * 欄位以逗號分隔：step 上只有一個（那是 id），字元位移上有兩個（`[前,後]` 的
 * 前後文）。攤成 `id` 與 `before`/`after` 兩組欄位的話，同一個 `[…]` 就要有
 * 兩種型別，而它們在文法上是同一個東西。
 */
export interface CfiAssertion {
  /** 逗號分隔的各欄位，`^` 逃逸已解開。 */
  readonly fields: readonly string[];
  /** `;name=value`，依出現順序。 */
  readonly parameters: readonly CfiParameter[];
}

export interface CfiParameter {
  readonly name: string;
  readonly value: string;
}

/**
 * 兩個 CFI 的先後。
 *
 * **`"incomparable"` 不是錯誤，是答案。** 回一個 `-1`／`0`／`1` 的 API 沒有位置
 * 講這件事，於是消費端會把「這兩個位置沒有先後」靜默地當成「相等」或「在前
 * 面」——annotation 的排序看起來是對的，只是順序是編出來的。回字串而不是數字
 * 也是刻意的：`sort(compareCfi)` 這種寫法會直接型別錯誤，而不是在執行期把
 * `undefined` 當成 0。
 */
export type CfiComparison = "before" | "equal" | "after" | "incomparable";

/** CFI 字串壞在哪裡。 */
export type CfiParseFailure =
  /** 不是 `epubcfi(…)`，也不是一條以 `/` 開頭的路徑。 */
  | "not-a-cfi"
  /** `/` 後面沒有接數字。 */
  | "malformed-step"
  /** `:` 後面沒有接數字。 */
  | "malformed-offset"
  /** `[` 沒有對應的 `]`。 */
  | "unterminated-assertion"
  /** 逗號的數量不對——範圍必須是 `parent,start,end` 三段。 */
  | "malformed-range"
  /**
   * 時間位移（`~`）與空間位移（`@`）。文法認得它們，frond v1 不做——它們定位
   * 的是影音的時間點與圖片上的座標，而 v1 只渲染 XHTML 內容文件。
   *
   * 這一格**明確拒絕而不是忽略**：忽略掉位移之後剩下的路徑是一個合法但指到
   * 別處的 CFI，而那正是「靜默回一個半對的結構」。
   */
  | "unsupported-offset"
  /** 出現了文法裡沒有的字元。 */
  | "unexpected-character";

export class CfiParseError extends Error {
  readonly reason: CfiParseFailure;

  constructor(reason: CfiParseFailure, message: string) {
    super(message);
    this.name = "CfiParseError";
    this.reason = reason;
  }
}

const WRAPPER_PREFIX = "epubcfi(";
const WRAPPER_SUFFIX = ")";

/** 斷言裡必須逃逸的字元（規格 2.3）。 */
const MUST_ESCAPE = new Set(["^", "[", "]", "(", ")", ",", ";", "="]);

const ESCAPE = "^";

/**
 * 把 CFI 字串讀成結構。
 *
 * 輸入可以帶 `epubcfi(…)` 也可以不帶：實際的書把它寫在 URL 的 fragment 裡
 * （`#epubcfi(/6/4!/4/2)`），而規格的例子與程式裡傳來傳去的常常是裸的路徑。
 * 輸出一律帶（見 `serializeCfi`）。
 *
 * @throws CfiParseError 壞掉的字串給明確錯誤，不回一個半對的結構
 */
export function parseCfi(source: string): Cfi {
  const parts = splitTopLevel(unwrap(source));

  if (parts.length === 1) {
    return { kind: "point", path: parsePath(parts[0]!, source) };
  }
  if (parts.length === 3) {
    return {
      kind: "range",
      parent: parsePath(parts[0]!, source),
      start: parsePath(parts[1]!, source),
      end: parsePath(parts[2]!, source),
    };
  }
  throw new CfiParseError(
    "malformed-range",
    `${source} 有 ${parts.length - 1} 個逗號；範圍必須恰好是 parent,start,end 三段`,
  );
}

/**
 * 把結構寫回字串。
 *
 * `parseCfi` → `serializeCfi` 是 identity，**除了三種正規化**——三者都是「同一個
 * 位置的兩種寫法」收斂成一種，不是資訊遺失：
 *
 * 1. **一律補上 `epubcfi(…)`**。裸的路徑進來，帶包裝出去。
 * 2. **多餘的逃逸被丟掉**。`^/` 與 `/` 在斷言裡是同一個字元（規格只要求逃逸
 *    `^ [ ] ( ) , ; =` 那幾個），輸出只逃逸該逃逸的。
 * 3. **前導零被丟掉**。`/06` 與 `/6` 是同一步。
 * 4. **沒有值的參數補上 `=`**。`[a;b]` 寫回去是 `[a;b=]`。
 */
export function serializeCfi(cfi: Cfi): string {
  const body =
    cfi.kind === "point"
      ? writePath(cfi.path)
      : `${writePath(cfi.parent)},${writePath(cfi.start)},${writePath(cfi.end)}`;

  return `${WRAPPER_PREFIX}${body}${WRAPPER_SUFFIX}`;
}

/**
 * 兩個 CFI 在書中的先後（user story 22：把 annotation 依書中順序排列）。
 *
 * 範圍以「起點，起點相同再比終點」定序——與點的比較是同一套，因為一個點就是
 * 起訖相同的範圍。所以一個落在某個範圍**裡面**的點會排在那個範圍之後（起點
 * 相同、終點比較前面），而不是「不可比」：讀者要的是一份穩定的排序，而重疊的
 * annotation 在書中確實有一個共同的起點。
 *
 * ## 斷言不參與比較
 *
 * 兩個 CFI 的索引相同、`[…]` 不同時，答案是 `"equal"`。規格說索引才是權威，
 * 斷言是書改版後用來回復位置的冗餘——拿它當比較的依據，會讓同一個位置因為書
 * 換了一版就變成兩個不同的位置。
 *
 * ## 什麼時候不可比
 *
 * 兩者對**同一個節點**的說法不相容時，這一層沒有辦法排序，也不該猜：
 *
 * - 一邊在那個節點上跨進另一份文件（`!`），另一邊繼續往它的子節點走。兩個位置
 *   落在不同的文件裡，而文件之間的先後不是這個字串講得出來的。
 * - 一邊落在那個節點的文字裡（`:N`），另一邊落在它的某個子節點上。誰先誰後
 *   取決於那個子節點在內容裡的位置，而那要有文件才知道。
 *
 * 兩種都得等 `Renderer` 把文件解出來才有答案，所以在文法層它們是
 * `"incomparable"`，不是 `"equal"`。
 */
export function compareCfi(a: Cfi, b: Cfi): CfiComparison {
  const byStart = comparePaths(startOf(a), startOf(b));
  return byStart === "equal" ? comparePaths(endOf(a), endOf(b)) : byStart;
}

function startOf(cfi: Cfi): CfiPath {
  return cfi.kind === "point" ? cfi.path : concat(cfi.parent, cfi.start);
}

function endOf(cfi: Cfi): CfiPath {
  return cfi.kind === "point" ? cfi.path : concat(cfi.parent, cfi.end);
}

/**
 * 把範圍的起（訖）接到共同前綴後面，得到一條完整的路徑。
 *
 * 接的位置是**前綴的最後一段裡面**：`/6/4!/4` 加上 `/10` 是 `/6/4!/4/10`，不是
 * 多一段。接錯的話那個位置會跑到另一份文件裡去。
 */
function concat(parent: CfiPath, local: CfiPath): CfiPath {
  const [first, ...rest] = local;
  if (first === undefined) return parent;

  const last = parent[parent.length - 1];
  if (last === undefined) return local;

  return [
    ...parent.slice(0, -1),
    { steps: [...last.steps, ...first.steps], offset: first.offset },
    ...rest,
  ];
}

function comparePaths(a: CfiPath, b: CfiPath): CfiComparison {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const left = a[index];
    const right = b[index];
    // 一邊先走完：短的那一條是長的那一條的前綴，也就是它的祖先，排在前面。
    if (left === undefined) return "before";
    if (right === undefined) return "after";

    const order = compareSegments(left, right, {
      leftContinues: index < a.length - 1,
      rightContinues: index < b.length - 1,
    });
    if (order !== "equal") return order;
  }
  return "equal";
}

/** 這一段之後還有沒有下一段——也就是這一段的結尾有沒有跨進另一份文件。 */
interface Continuation {
  readonly leftContinues: boolean;
  readonly rightContinues: boolean;
}

function compareSegments(
  a: CfiSegment,
  b: CfiSegment,
  continuation: Continuation,
): CfiComparison {
  const shared = Math.min(a.steps.length, b.steps.length);
  for (let index = 0; index < shared; index += 1) {
    const left = a.steps[index]!.index;
    const right = b.steps[index]!.index;
    if (left !== right) return left < right ? "before" : "after";
  }

  if (a.steps.length !== b.steps.length) {
    const shorterIsLeft = a.steps.length < b.steps.length;
    const shorter = shorterIsLeft ? a : b;
    const shorterContinues = shorterIsLeft
      ? continuation.leftContinues
      : continuation.rightContinues;

    // 短的那一條在這個節點上換了文件，或落進了它的文字裡，而長的那一條往它的
    // 子節點走——兩種都要有文件才排得出先後。
    if (shorterContinues || shorter.offset !== undefined) return "incomparable";
    return shorterIsLeft ? "before" : "after";
  }

  return compareOffsets(a.offset, b.offset);
}

/**
 * 位移的先後。**沒有位移的排在有位移的前面**：`/2` 指的是節點本身，`/2:0` 指的
 * 是它裡面的第一個字元，而節點的開頭在它的內容之前。
 */
function compareOffsets(
  a: CfiOffset | undefined,
  b: CfiOffset | undefined,
): CfiComparison {
  if (a === undefined && b === undefined) return "equal";
  if (a === undefined) return "before";
  if (b === undefined) return "after";
  if (a.characters === b.characters) return "equal";
  return a.characters < b.characters ? "before" : "after";
}

function unwrap(source: string): string {
  if (source.startsWith(WRAPPER_PREFIX) && source.endsWith(WRAPPER_SUFFIX)) {
    // 裡面的 `)` 一定是逃逸過的（規格要求），所以最後一個字元就是收尾。
    return source.slice(WRAPPER_PREFIX.length, -WRAPPER_SUFFIX.length);
  }
  if (source.startsWith("/")) return source;

  throw new CfiParseError(
    "not-a-cfi",
    `${JSON.stringify(source)} 不是 CFI——要嘛是 epubcfi(…)，要嘛是一條以 / 開頭的路徑`,
  );
}

/** 依**不在斷言裡**的逗號切開。斷言裡的逗號是欄位分隔，不是範圍分隔。 */
function splitTopLevel(body: string): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let inAssertion = false;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index]!;
    if (character === ESCAPE) {
      // 逃逸序列整組原樣搬過去，解逃逸留到讀斷言的時候。
      current += character + (body[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (character === "[") inAssertion = true;
    else if (character === "]") inAssertion = false;
    else if (character === "," && !inAssertion) {
      parts.push(current);
      current = "";
      continue;
    }
    current += character;
  }

  parts.push(current);
  return parts;
}

/** 讀的位置。用一個游標而不是一路回傳新索引，讓每個 read 函式只回傳它讀到的東西。 */
interface Cursor {
  readonly text: string;
  index: number;
}

function parsePath(text: string, source: string): CfiPath {
  if (!text.startsWith("/") && !text.startsWith("!")) {
    throw new CfiParseError(
      "not-a-cfi",
      `${source} 裡的 ${JSON.stringify(text)} 不是一條路徑——路徑要以 / 或 ! 開頭`,
    );
  }

  const cursor: Cursor = { text, index: 0 };
  const segments: CfiSegment[] = [];
  let steps: CfiStep[] = [];
  let offset: CfiOffset | undefined;

  while (cursor.index < text.length) {
    const character = text[cursor.index]!;

    if (character === "/") {
      if (offset !== undefined) {
        // `:5/2` ——位移之後不可能再往下走，字元沒有子節點。
        throw new CfiParseError(
          "malformed-step",
          `${source} 在字元位移之後還有 step，位移只能收尾`,
        );
      }
      steps.push(readStep(cursor, source));
      continue;
    }

    if (character === "!") {
      cursor.index += 1;
      segments.push({ steps, offset });
      steps = [];
      offset = undefined;
      continue;
    }

    if (character === ":") {
      if (offset !== undefined) {
        throw new CfiParseError(
          "malformed-offset",
          `${source} 的同一段裡有兩個字元位移`,
        );
      }
      offset = readOffset(cursor, source);
      continue;
    }

    if (character === "~" || character === "@") {
      throw new CfiParseError(
        "unsupported-offset",
        `${source} 帶著${character === "~" ? "時間" : "空間"}位移（${character}），frond v1 只做 XHTML 內容文件的字元位移`,
      );
    }

    throw new CfiParseError(
      "unexpected-character",
      `${source} 的第 ${cursor.index + 1} 個字元 ${JSON.stringify(character)} 不在 CFI 的文法裡`,
    );
  }

  segments.push({ steps, offset });
  return segments;
}

function readStep(cursor: Cursor, source: string): CfiStep {
  cursor.index += 1; // "/"
  const digits = readDigits(cursor);
  if (digits === undefined) {
    throw new CfiParseError(
      "malformed-step",
      `${source} 的 / 後面沒有接數字`,
    );
  }
  return { index: digits, assertion: readAssertion(cursor, source) };
}

function readOffset(cursor: Cursor, source: string): CfiOffset {
  cursor.index += 1; // ":"
  const digits = readDigits(cursor);
  if (digits === undefined) {
    throw new CfiParseError(
      "malformed-offset",
      `${source} 的 : 後面沒有接數字`,
    );
  }
  return { characters: digits, assertion: readAssertion(cursor, source) };
}

function readDigits(cursor: Cursor): number | undefined {
  const start = cursor.index;
  while (cursor.index < cursor.text.length && isDigit(cursor.text[cursor.index]!)) {
    cursor.index += 1;
  }
  if (cursor.index === start) return undefined;
  // 前導零在這裡收掉，`/06` 與 `/6` 是同一步（見 serializeCfi 的正規化規則）。
  return Number(cursor.text.slice(start, cursor.index));
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

/**
 * `[…]`。不在 `[` 上就是沒有斷言。
 *
 * 切欄位與解逃逸**必須在同一趟裡做**：`,` 是欄位分隔而 `^,` 是逗號本身，先整
 * 段解完逃逸再切的話兩者就分不出來了——而「id 裡有逗號」是規格明文允許、
 * foliate 的驗收表也演到的形狀。
 */
function readAssertion(cursor: Cursor, source: string): CfiAssertion | undefined {
  if (cursor.text[cursor.index] !== "[") return undefined;
  cursor.index += 1;

  const fields: string[] = [];
  const parameters: CfiParameter[] = [];
  let current = "";
  /** 已經讀到 `;` 之後了嗎——也就是現在讀的是參數而不是欄位。 */
  let parameterName: string | undefined;
  let inParameters = false;

  const finish = (): void => {
    if (!inParameters) {
      fields.push(current);
    } else if (parameterName !== undefined) {
      parameters.push({ name: parameterName, value: current });
    } else if (current !== "") {
      // `;name` 沒有帶值。補一個空的而不是丟掉它——寫回去時會多一個 `=`，
      // 那是 serializeCfi 記著的正規化之一。
      parameters.push({ name: current, value: "" });
    }
    current = "";
    parameterName = undefined;
  };

  for (;;) {
    if (cursor.index >= cursor.text.length) {
      throw new CfiParseError(
        "unterminated-assertion",
        `${source} 的 [ 沒有對應的 ]`,
      );
    }
    const character = cursor.text[cursor.index]!;
    cursor.index += 1;

    if (character === ESCAPE) {
      current += cursor.text[cursor.index] ?? "";
      cursor.index += 1;
      continue;
    }
    if (character === "]") {
      finish();
      break;
    }
    if (character === "," && !inParameters) {
      fields.push(current);
      current = "";
      continue;
    }
    if (character === ";") {
      finish();
      inParameters = true;
      continue;
    }
    if (character === "=" && inParameters && parameterName === undefined) {
      parameterName = current;
      current = "";
      continue;
    }
    current += character;
  }

  return { fields, parameters };
}

function writePath(path: CfiPath): string {
  return path.map(writeSegment).join("!");
}

function writeSegment(segment: CfiSegment): string {
  const steps = segment.steps
    .map((step) => `/${step.index}${writeAssertion(step.assertion)}`)
    .join("");
  const offset =
    segment.offset === undefined
      ? ""
      : `:${segment.offset.characters}${writeAssertion(segment.offset.assertion)}`;

  return steps + offset;
}

function writeAssertion(assertion: CfiAssertion | undefined): string {
  if (assertion === undefined) return "";

  const fields = assertion.fields.map(escape).join(",");
  const parameters = assertion.parameters
    .map((parameter) => `;${escape(parameter.name)}=${escape(parameter.value)}`)
    .join("");

  return `[${fields}${parameters}]`;
}

/**
 * 只逃逸規格點名的那幾個字元。
 *
 * 「只」是重點：多逃逸幾個不會讓別人讀不懂，但會讓 roundtrip 不再是 identity
 * ——而 identity 是這一層唯一能自我驗證的性質。
 */
function escape(text: string): string {
  return [...text]
    .map((character) => (MUST_ESCAPE.has(character) ? ESCAPE + character : character))
    .join("");
}
