import { EpubOpenError, type EpubOpenFailure } from "./errors.ts";

/**
 * 讀 EPUB 封裝格式所需的那一點 XML。
 *
 * **不用 `DOMParser`**：`EpubBook` 零 DOM 依賴（ADR-0005），而那正是它能在 Node
 * 裡跑、在測試金字塔底層被測到的原因。
 *
 * **也不用 XML 函式庫**：frond 出貨時零 runtime 相依。這一支取代的是
 * `fast-xml-parser`，而它之所以沒有比原本的轉接層長多少，是因為原本那一層幾乎
 * 全是在把解析器的表述形狀（`:@`、`#text`、`@_` 前綴）翻譯回這裡要的三個問題：
 * 子元素、屬性、文字。自己解的話，那層翻譯整個消失。
 *
 * 要讀的方言很窄，窄到列得完：標籤、屬性、文字、CDATA、註解、處理指令、跳過
 * DOCTYPE、五個預定義實體與數值字元參照。樣本裡 1767 份 XML 文件沒有用到這之外
 * 的東西。
 *
 * ## 良構性與解析是同一趟
 *
 * 舊的實作要先叫一次 `XMLValidator` 再叫一次 `XMLParser`，因為那個解析器對不良
 * 構的輸入很寬容（少一個結束標籤會靜默地吃掉一整棵子樹）。自己寫就沒有那道裂縫
 * ——不良構的地方就是解析停下來的地方，一本壞書一定得到「這本書壞了」而不是
 * 「欄位讀不到」。那個靜默失敗正是這一層存在的理由。
 *
 * ## 命名空間前綴一律剝掉
 *
 * `dc:title` 的 `dc` 只是這份文件自己選的前綴，XML 規格允許書寫成任何字串（綁定
 * 才是語意）。照字面比對前綴的實作會在一本把它宣告成 `d:` 的書上讀不到書名，
 * 而那本書完全合規。剝掉前綴之後 `dc:title`、`opf:role`、`xml:lang` 各自變成
 * `title`、`role`、`lang`。`xmlns` 與 `xmlns:*` 本身則整個丟掉——它們宣告的是
 * 綁定，不是這份文件在講的事。
 *
 * ## 文件順序要保留
 *
 * 混合內容的順序不能丟：`<a>前<span>言</span>後</a>` 要讀得回「前言後」。這不是
 * 潔癖，是量到的：本機那批書裡，導覽文件的 1527 個目錄連結有 **73 個的標題帶著
 * 行內標籤**（5 本書），其中一本（《我的公寓》）**39 個目錄項目的文字全部包在
 * `<span>` 裡**——只讀節點自己那一層文字的實作，會讓那本書整份目錄的標題是空
 * 字串。另一本的第二層是 `<span><small>輯一</small>・儲藏室</span>`，順序丟掉
 * 之後標題會變成「・儲藏室輯一」。兩種都是靜默的錯：目錄長度對、href 對，只有
 * 字是壞的。
 */

export interface XmlElement {
  /** 第一個叫這個名字的子元素。 */
  child(name: string): XmlElement | undefined;
  /** 所有叫這個名字的子元素，依文件順序。 */
  children(name: string): readonly XmlElement[];
  attribute(name: string): string | undefined;
  /**
   * 元素底下**所有**文字，依文件順序接起來，前後空白去掉。沒有文字時是空字串。
   *
   * 「所有」是刻意的：只取節點自己那一層的話，`<a><span>序</span></a>` 這種目錄
   * 項目會讀出空字串——而那是量到的形狀，見檔頭。只提供這一個方法也是刻意的，
   * 多一個「只取自己那層」的方法，就多一個在實際的書上靜默讀空的選項。
   *
   * **中間的空白原樣保留，只去頭尾。** 兩邊都是必要的：不去頭尾的話，排版整齊的
   * `<dc:title>\n  書名\n</dc:title>` 會讀出帶換行的書名；而把每一段文字各自去
   * 空白再接起來（`fast-xml-parser` 的預設）會讓 `Chapter <em>One</em> Revised`
   * 變成 `ChapterOneRevised`——那是把有意義的詞間空白刪掉。
   */
  text(): string;
}

export interface XmlParseFailure {
  /** 解析失敗時要丟哪一種開書錯誤。 */
  readonly reason: EpubOpenFailure;
  /** 出現在錯誤訊息裡的檔案路徑。 */
  readonly label: string;
}

export function parseXml(source: string, failure: XmlParseFailure): XmlElement {
  return element(new Reader(source, failure).document());
}

/** 元素節點。文字節點就是字串，不另外包一層。 */
interface Node {
  readonly name: string;
  readonly attributes: ReadonlyMap<string, string>;
  readonly children: readonly (Node | string)[];
}

function element(node: Node): XmlElement {
  const children = (name: string): readonly XmlElement[] =>
    node.children
      .filter((child): child is Node => typeof child !== "string" && child.name === name)
      .map(element);

  return {
    child: (name) => children(name)[0],
    children,
    attribute: (name) => node.attributes.get(name),
    // 去空白只在這裡做一次。做在遞迴裡的話，中間每一段文字都會各自被修掉，而那
    // 正是上面那個 `ChapterOneRevised` 的來源。
    text: () => textOf(node).trim(),
  };
}

function textOf(node: Node): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : textOf(child)))
    .join("");
}

/** 這五個是 XML 自己定義的，不需要 DTD 宣告。其餘具名實體原樣留著（見 `entity`）。 */
const PREDEFINED_ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
]);

/** 名稱的第一個字元不能是這些。其餘位置的合法性由掃描器停在哪裡決定。 */
const INVALID_NAME_START = /[0-9.\-]/;

/** 名稱在這些字元處結束。它們也是名稱裡不能出現的字元。 */
const NAME_END = /[\s/>=<&"']/;

const WHITESPACE = /\s/;

const CDATA_OPEN = "<![CDATA[";
const CDATA_CLOSE = "]]>";

class Reader {
  private readonly source: string;
  private readonly failure: XmlParseFailure;
  private at = 0;

  constructor(source: string, failure: XmlParseFailure) {
    this.source = source;
    this.failure = failure;
  }

  document(): Node {
    // UTF-8 的 BOM 解碼之後是一個 U+FEFF。留著的話它會被當成根元素前的文字。
    const start = this.source.charCodeAt(0) === 0xfeff ? 1 : 0;
    this.at = start;

    const roots: Node[] = [];
    while (this.at < this.source.length) {
      if (this.source[this.at] !== "<") {
        // 根元素之外只能有空白。這裡比 `fast-xml-parser` 的驗證器嚴格——它讓
        // `<a/>tail` 與 `<a/><b/>` 兩者都過關，而兩者都不是良構的 XML。樣本裡
        // 1767 份文件沒有一份踩到，所以嚴格買得到「壞書會出聲」而不必付代價。
        if (this.until("<").trim() !== "") this.fail("根元素之外有文字");
        continue;
      }
      const node = this.markup(roots.length > 0, start);
      if (node === undefined) continue;
      if (roots.length > 0) {
        this.fail(`一份 XML 只能有一個根元素，這裡出現第二個 <${node.name}>`);
      }
      roots.push(node);
    }
    if (roots.length === 0) this.fail("這份文件裡沒有根元素");

    // 包成一個沒有名字的元素之後，取根元素與取任何一層子元素就是同一個動作。
    return { name: "", attributes: new Map(), children: roots };
  }

  /** 讀一段 `<` 開頭的東西。回傳 `undefined` 代表那是註解／處理指令／DOCTYPE。 */
  private markup(rootSeen: boolean, documentStart = -1): Node | undefined {
    if (this.peek("<!--")) {
      this.upTo("-->", "註解沒有結束");
      return undefined;
    }
    if (this.peek(CDATA_OPEN)) this.fail("根元素之外不能有 CDATA");
    if (this.peek("<!DOCTYPE")) {
      this.skipDoctype();
      return undefined;
    }
    if (this.peek("<!")) this.fail("看不懂的宣告");
    if (this.peek("<?")) {
      // XML 宣告只能在最前面。它與其餘處理指令的差別僅在於此，所以位置就是唯一
      // 要檢查的事——內容（version、encoding）frond 一概不用：位元組一律當 UTF-8
      // 解，那是 `container.ts` 的決定。
      //
      // 比對前綴是不夠的：`<?xml-stylesheet?>` 也以 `<?xml` 開頭，而它是一般的
      // 處理指令，出現在哪裡都合法。目標名稱要**整個**是 `xml` 才算宣告。
      if (this.isDeclaration() && this.at !== documentStart) {
        this.fail("XML 宣告只能出現在文件最前面");
      }
      this.upTo("?>", "處理指令沒有結束");
      return undefined;
    }
    if (this.peek("</")) this.fail("多出來的結束標籤");
    if (rootSeen) this.fail("根元素之外不能有元素");
    return this.startTag();
  }

  private startTag(): Node {
    this.at += 1; // '<'
    const name = this.name("標籤");
    const attributes = this.attributes(name);

    if (this.peek("/>")) {
      this.at += 2;
      return { name, attributes, children: [] };
    }
    this.at += 1; // '>'，由 attributes() 保證

    const children: (Node | string)[] = [];
    for (;;) {
      if (this.at >= this.source.length) this.fail(`<${name}> 沒有結束標籤`);

      if (this.source[this.at] !== "<") {
        children.push(this.decode(this.until("<")));
        continue;
      }
      if (this.peek("</")) {
        this.at += 2;
        const closing = this.name("結束標籤");
        this.skipWhitespace();
        if (!this.peek(">")) this.fail(`</${closing}> 沒有正確結束`);
        this.at += 1;
        // 大小寫不同就是不同的名稱——XML 不是 HTML。
        if (closing !== name) this.fail(`<${name}> 的結束標籤寫成 </${closing}>`);
        return { name, attributes, children };
      }
      if (this.peek(CDATA_OPEN)) {
        this.at += CDATA_OPEN.length;
        children.push(this.upTo(CDATA_CLOSE, "CDATA 沒有結束"));
        continue;
      }
      const child = this.markup(false);
      if (child !== undefined) children.push(child);
    }
  }

  /** 讀完屬性，游標停在 `>` 或 `/>` 上。 */
  private attributes(tag: string): ReadonlyMap<string, string> {
    const attributes = new Map<string, string>();
    const seen = new Set<string>();
    for (;;) {
      const before = this.at;
      this.skipWhitespace();
      if (this.peek("/>") || this.peek(">")) return attributes;
      if (this.at >= this.source.length) this.fail(`<${tag}> 的標籤沒有正確結束`);
      // 沒有空白隔開就不是新的屬性——`<a x="1"y="2">` 不是良構的。
      if (this.at === before) this.fail(`<${tag}> 的屬性之間少了空白`);

      const raw = this.rawName("屬性");
      this.skipWhitespace();
      // 布林屬性（`<a disabled>`）是 HTML 的寫法，XML 一律要有值。放行的話一份用
      // HTML 心智寫出來的導覽文件會被當成合規，而瀏覽器會拒絕渲染它。
      if (!this.peek("=")) this.fail(`屬性 ${raw} 沒有值`);
      this.at += 1;
      this.skipWhitespace();

      const quote = this.source[this.at];
      if (quote !== '"' && quote !== "'") this.fail(`屬性 ${raw} 的值沒有加引號`);
      this.at += 1;
      const value = this.upTo(quote, `屬性 ${raw} 的引號沒有結束`);

      // 重複的屬性在文件裡沒有一個「正確答案」——後面蓋掉前面是解析器的選擇，不是
      // 規格的。所以它是錯誤，不是可以靜默處理的情況。比的是**原本的名稱**：
      // `dc:x` 與 `opf:x` 在 XML 裡是兩個不同的屬性。
      if (seen.has(raw)) this.fail(`屬性 ${raw} 出現了兩次`);
      seen.add(raw);
      if (raw === "xmlns" || raw.startsWith("xmlns:")) continue;

      const name = stripPrefix(raw);
      const decoded = this.decode(value);
      // 剝掉前綴之後才撞名的情況。**同一個值就不是問題**——`<html xml:lang="zh"
      // lang="zh">` 是 XHTML 的標準寫法，兩個屬性本來就在講同一件事，樣本裡每一份
      // 導覽文件都這樣寫。值不同才是真的答不出 `attribute("lang")` 該給哪一個，
      // 而那要出聲，不是挑一個。
      const existing = attributes.get(name);
      if (existing !== undefined && existing !== decoded) {
        this.fail(`剝掉前綴之後有兩個屬性都叫 ${name}，而它們的值不同`);
      }
      attributes.set(name, decoded);
    }
  }

  /** 把實體與數值字元參照換成字元。 */
  private decode(raw: string): string {
    if (!raw.includes("&")) return raw;

    let out = "";
    let at = 0;
    for (;;) {
      const amp = raw.indexOf("&", at);
      if (amp < 0) return out + raw.slice(at);
      out += raw.slice(at, amp);

      const end = raw.indexOf(";", amp);
      const reference = end < 0 ? "" : raw.slice(amp + 1, end);
      if (reference === "" || WHITESPACE.test(reference)) {
        // 裸的 `&` 是良構性錯誤，不是一個可以照抄的字元。放行的話瀏覽器會拒絕
        // 渲染同一份文件，而那時候症狀離病因很遠。
        this.fail("文字裡有沒有結束的 &，它要寫成 &amp;");
      }
      out += entity(reference);
      at = end + 1;
    }
  }

  private name(kind: string): string {
    return stripPrefix(this.rawName(kind));
  }

  private rawName(kind: string): string {
    const start = this.at;
    while (this.at < this.source.length && !NAME_END.test(this.source[this.at]!)) {
      this.at += 1;
    }
    const raw = this.source.slice(start, this.at);
    if (raw === "") this.fail(`${kind}的名稱是空的`);
    if (INVALID_NAME_START.test(raw[0]!)) this.fail(`${kind}的名稱 ${raw} 不合法`);
    return raw;
  }

  /**
   * 跳過 DOCTYPE，包含內部子集。
   *
   * 樣本裡 17 份導覽文件與 1 份 NCX 有 DOCTYPE。內部子集（`[ … ]`）裡可以有 `>`
   * ——`<!ENTITY foo "bar">` 就是——所以不能看到第一個 `>` 就停。裡面宣告的實體
   * frond 不展開：那條路通往 billion laughs，而樣本裡沒有一本書用它。
   */
  private skipDoctype(): void {
    this.at += "<!DOCTYPE".length;
    let inSubset = false;
    while (this.at < this.source.length) {
      const char = this.source[this.at]!;
      this.at += 1;
      if (char === "[") inSubset = true;
      else if (char === "]") inSubset = false;
      else if (char === ">" && !inSubset) return;
    }
    this.fail("DOCTYPE 沒有結束");
  }

  private peek(token: string): boolean {
    return this.source.startsWith(token, this.at);
  }

  private isDeclaration(): boolean {
    if (!this.peek("<?xml")) return false;
    const after = this.source[this.at + "<?xml".length];
    return after === undefined || after === "?" || WHITESPACE.test(after);
  }

  private skipWhitespace(): void {
    while (this.at < this.source.length && WHITESPACE.test(this.source[this.at]!)) {
      this.at += 1;
    }
  }

  /** 讀到 `token` 為止（不含），游標停在 `token` 上。讀不到就讀到文件結尾。 */
  private until(token: string): string {
    const end = this.source.indexOf(token, this.at);
    const stop = end < 0 ? this.source.length : end;
    const text = this.source.slice(this.at, stop);
    this.at = stop;
    return text;
  }

  /** 讀到 `token` 為止（不含），游標停在 `token` 之後。讀不到就丟錯。 */
  private upTo(token: string, complaint: string): string {
    const end = this.source.indexOf(token, this.at);
    if (end < 0) this.fail(complaint);
    const text = this.source.slice(this.at, end);
    this.at = end + token.length;
    return text;
  }

  private fail(detail: string): never {
    const line = this.source.slice(0, this.at).split("\n").length;
    throw new EpubOpenError(
      this.failure.reason,
      `${this.failure.label} 不是良構的 XML：${detail}（第 ${line} 行）`,
    );
  }
}

/**
 * 一個實體參照換成的字元。
 *
 * 認得的只有五個預定義實體與數值字元參照。**認不得的原樣留著**（`&nbsp;` 還是
 * `&nbsp;`）而不是丟錯：它可能由 DOCTYPE 的內部子集宣告過，而 frond 不展開那些
 * 宣告。丟錯會讓一本合規的書開不起來，留著最多是標題裡多一串字——後者看得見，
 * 前者整本消失。
 */
function entity(reference: string): string {
  const predefined = PREDEFINED_ENTITIES.get(reference);
  if (predefined !== undefined) return predefined;

  if (reference.startsWith("#")) {
    const hex = reference.startsWith("#x") || reference.startsWith("#X");
    const digits = reference.slice(hex ? 2 : 1);
    const code = /^[0-9a-fA-F]+$/.test(digits) ? Number.parseInt(digits, hex ? 16 : 10) : Number.NaN;
    // 代理對的那一段（U+D800–U+DFFF）不是字元，`String.fromCodePoint` 會丟錯。
    if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) {
      return String.fromCodePoint(code);
    }
  }
  return `&${reference};`;
}

/** `dc:title` → `title`。前綴是文件自己選的字串，不是語意。 */
function stripPrefix(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}
