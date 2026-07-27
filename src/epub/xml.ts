import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EpubOpenError, type EpubOpenFailure } from "./errors.ts";

/**
 * 讀 EPUB 封裝格式所需的那一點 XML。
 *
 * **不用 `DOMParser`**：`EpubBook` 零 DOM 依賴（ADR-0005），而那正是它能在 Node
 * 裡跑、在測試金字塔底層被測到的原因。fast-xml-parser 是純 JS。
 *
 * 這一層存在的理由是把 fast-xml-parser 的產物收成一個**只有三個問題**的介面：
 * 子元素、屬性、文字。沒有這一層的話，每一處讀 XML 的地方都要自己處理解析器的
 * 表述形狀，而那些形狀與 XML 本身無關，只與解析器的選項有關。
 *
 * ## 文件順序要保留（`preserveOrder`）
 *
 * 解析器預設會把同名的子元素收成一個鍵，於是**混合內容的順序就沒了**：
 * `<a>前<span>言</span>後</a>` 變成 `{ span: "言", "#text": "前後" }`，讀不回
 * 「前言後」。開著 `preserveOrder` 之後每個節點是 `{ 標籤: [子節點…] }`，文字
 * 節點是 `{ "#text": … }`，順序就是陣列的順序。
 *
 * 這不是潔癖，是量到的：本機那 33 本書裡，導覽文件的 1527 個目錄連結有 **73 個
 * 的標題帶著行內標籤**（5 本書），而其中一本（《我的公寓》）**39 個目錄項目的
 * 文字全部包在 `<span>` 裡**——只讀節點自己那一層 `#text` 的實作，會讓那本書
 * 整份目錄的標題是空字串。另一本的第二層是 `<span><small>輯一</small>・儲藏室
 * </span>`，順序丟掉之後標題會變成「・儲藏室輯一」。兩種都是靜默的錯：目錄長度
 * 對、href 對、只有字是壞的。
 *
 * ## 命名空間前綴一律剝掉
 *
 * `dc:title` 的 `dc` 只是這份文件自己選的前綴，XML 規格允許書寫成任何字串（綁定
 * 才是語意）。照字面比對前綴的實作會在一本把它宣告成 `d:` 的書上讀不到書名，
 * 而那本書完全合規。剝掉前綴之後 `dc:title`、`opf:role`、`xml:lang` 各自變成
 * `title`、`role`、`lang`。
 */

export interface XmlElement {
  /** 第一個叫這個名字的子元素。 */
  child(name: string): XmlElement | undefined;
  /** 所有叫這個名字的子元素，依文件順序。 */
  children(name: string): readonly XmlElement[];
  attribute(name: string): string | undefined;
  /**
   * 元素底下**所有**文字，依文件順序接起來（DOM 的 `textContent` 語意）。沒有
   * 文字時是空字串。
   *
   * 「所有」是刻意的，只取節點自己那一層的話，`<a><span>序</span></a>` 這種
   * 目錄項目會讀出空字串——而那是量到的形狀，見檔頭。只提供這一個方法也是
   * 刻意的：多一個「只取自己那層」的方法，就多一個在真實的書上靜默讀空的選項。
   */
  text(): string;
}

export interface XmlParseFailure {
  /** 解析失敗時要丟哪一種開書錯誤。 */
  readonly reason: EpubOpenFailure;
  /** 出現在錯誤訊息裡的檔案路徑。 */
  readonly label: string;
}

const TEXT_KEY = "#text";
const ATTRIBUTE_PREFIX = "@_";

/** `preserveOrder` 把屬性收在這個鍵底下，與子元素分開。 */
const ATTRIBUTES_KEY = ":@";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  removeNSPrefix: true,
  // 值一律當字串。開著的話書名 `2077` 會變成 number，而封裝文件裡沒有任何一個
  // 欄位是數字。
  parseTagValue: false,
  parseAttributeValue: false,
  // 見檔頭：導覽文件的標題常常包在行內標籤裡，順序丟掉就讀不回原本的字。
  preserveOrder: true,
});

export function parseXml(source: string, failure: XmlParseFailure): XmlElement {
  // XMLParser 對不良構的輸入很寬容（少一個結束標籤會靜默地吃掉一整棵子樹），
  // 所以良構性要另外問一次——否則一本壞書會變成「欄位讀不到」而不是「這本書
  // 壞了」，而那正是本票要避免的靜默失敗。
  const validity = XMLValidator.validate(source, { allowBooleanAttributes: false });
  if (validity !== true) {
    throw new EpubOpenError(
      failure.reason,
      `${failure.label} 不是良構的 XML：${validity.err.msg}（第 ${validity.err.line} 行）`,
    );
  }

  // 最外層是一串節點而不是單一根元素——XML 宣告（`<?xml … ?>`）也是其中一個。
  // 包成一個沒有名字的元素之後，取根元素與取任何一層子元素就是同一個動作。
  return element(parser.parse(source) as RawNode[], undefined);
}

/**
 * `preserveOrder` 的一個節點：恰好一個以標籤為名的鍵（值是子節點的陣列），屬性
 * 另外收在 `:@` 底下。文字節點的鍵是 `#text`，值是字串。
 */
type RawNode = Record<string, unknown>;

function element(
  nodes: readonly RawNode[],
  attributes: Record<string, unknown> | undefined,
): XmlElement {
  const children = (name: string): readonly XmlElement[] =>
    // 文字節點的鍵也是一個鍵（`#text`），但它的值是字串而不是子節點的陣列——
    // 當成元素往下走會拿到一個形狀不對的東西。文字要用 `text()`。
    name === TEXT_KEY
      ? []
      : nodes
          .filter((node) => node[name] !== undefined)
          .map((node) =>
            element(
              node[name] as RawNode[],
              node[ATTRIBUTES_KEY] as Record<string, unknown>,
            ),
          );

  return {
    child: (name) => children(name)[0],
    children,
    attribute: (name) => {
      const value = attributes?.[`${ATTRIBUTE_PREFIX}${name}`];
      return value === undefined ? undefined : String(value);
    },
    text: () => textOf(nodes),
  };
}

/** 依文件順序把整棵子樹的文字接起來。 */
function textOf(nodes: readonly RawNode[]): string {
  return nodes
    .map((node) => {
      const text = node[TEXT_KEY];
      if (text !== undefined) return String(text);
      // 一個節點只有一個標籤鍵（屬性在 `:@` 底下），所以往下走不必知道它叫
      // 什麼名字。
      const child = Object.entries(node).find(([key]) => key !== ATTRIBUTES_KEY);
      return child === undefined ? "" : textOf(child[1] as RawNode[]);
    })
    .join("");
}
