import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EpubOpenError, type EpubOpenFailure } from "./errors.ts";

/**
 * 讀 EPUB 封裝格式所需的那一點 XML。
 *
 * **不用 `DOMParser`**：`EpubBook` 零 DOM 依賴（ADR-0005），而那正是它能在 Node
 * 裡跑、在測試金字塔底層被測到的原因。fast-xml-parser 是純 JS。
 *
 * 這一層存在的理由是把 fast-xml-parser 的產物（巢狀的 plain object，單一子元素
 * 是物件、多個是陣列、純文字元素直接是字串）收成一個**只有三個問題**的介面：
 * 子元素、屬性、文字。沒有這一層的話，每一處讀 XML 的地方都要自己處理那三種
 * 形狀，而漏掉「單一 vs 多個」正是解析 manifest 時最典型的錯法——只有一個
 * `<item>` 的書會走進另一條分支。
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
  /** 元素的文字內容。沒有文字時是空字串。 */
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

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ATTRIBUTE_PREFIX,
  removeNSPrefix: true,
  // 值一律當字串。開著的話書名 `2077` 會變成 number，而封裝文件裡沒有任何一個
  // 欄位是數字。
  parseTagValue: false,
  parseAttributeValue: false,
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

  return element(parser.parse(source) as Record<string, unknown>);
}

function element(raw: Record<string, unknown>): XmlElement {
  const children = (name: string): readonly XmlElement[] =>
    asArray(raw[name]).map(toElement);

  return {
    child: (name) => children(name)[0],
    children,
    attribute: (name) => {
      const value = raw[`${ATTRIBUTE_PREFIX}${name}`];
      return value === undefined ? undefined : String(value);
    },
    text: () => {
      const value = raw[TEXT_KEY];
      return value === undefined ? "" : String(value);
    },
  };
}

/** 只有文字的元素在解析結果裡直接是字串，不是物件。 */
function toElement(raw: unknown): XmlElement {
  if (typeof raw === "object" && raw !== null) {
    return element(raw as Record<string, unknown>);
  }
  return element({ [TEXT_KEY]: raw });
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
