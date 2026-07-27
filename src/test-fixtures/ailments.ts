import {
  DEFAULT_EPUB_VERSION,
  type EpubSpec,
  type EpubVersion,
  type SectionSpec,
} from "./epub.ts";
import { encodePng } from "./png.ts";
import { PROSE, proseBody } from "./prose.ts";

/**
 * 病症清單。**一個病症一個檔，檔名即病症名**（ADR-0007）。
 *
 * 每個病症表達成對同一份健康骨架的**單點差異**——其餘部分保持健康。這條紀律
 * 是這批 fixture 的全部價值：測試紅燈時檔名就說明了是哪一種病復發。兩個病症
 * 一旦擠進同一個檔案，紅燈就要重新花時間查是哪一項造成的——那正是拿實際的書
 * 當 fixture 的缺點。
 *
 * ## EPUB 版本是第二個軸
 *
 * 病症之外還有 **EPUB 版本**：EPUB 3（預設）與 EPUB 2（ADR-0010）。版本寫在
 * **檔名的後綴**上——沒有後綴就是 EPUB 3，`-epub2` 就是 EPUB 2。這讓 committed
 * fixture 與檔名維持一對一（那是紅燈可讀性的來源），也讓同一個病症在兩種版本
 * 上的兩份檔案並排時看得出是一對。
 *
 * 後綴與 `epubVersion` 欄位是兩處事實，靠 `epub-version.test.ts` 釘住它們一致。
 *
 * ## 對照組
 *
 * 六個橫排病症的對照組是這裡的健康骨架本身（`baseSpec`），直排三個的對照組是
 * `vertical-japanese`。`vertical-japanese` 刻意**不宣告**
 * page-progression-direction，雖然真實的直排日文書幾乎都是 rtl——因為它要當
 * 對照組，就必須讓 `ppd-rtl-vertical` 與它之間只差那一個屬性。
 *
 * ## 為什麼指名字面
 *
 * 需要可預期排版的 fixture 一律指名 `"Noto Serif CJK JP"`，不寫 generic
 * family、也不寫 generic 當 fallback。三家瀏覽器對 generic family 的 CJK 解析
 * 並不一致（#4），用 generic 的話量到的會是「瀏覽器挑了哪套字型」而不是「這本
 * 書排成什麼樣」。實際的書大多用 generic 宣告，那是 #4 的範圍，不該污染合成
 * fixture 的可控性。
 */

const NAMED_FACE = '"Noto Serif CJK JP"';

/**
 * 健康的樣式表。刻意**不宣告** font-size、width、color、background 與
 * writing-mode——那四項各自是一個病症，骨架碰了就沒有對照組了。
 */
const HEALTHY_STYLESHEET = `html {
  font-family: ${NAMED_FACE};
  line-height: 1.8;
}

body {
  margin: 0;
}

h1 {
  line-height: 1.4;
}

p {
  margin: 0 0 1em;
  text-indent: 1em;
}
`;

/** 直排的宣告，寫在 `html` 上——這是正確的位置。 */
const VERTICAL_ON_HTML = `
html {
  writing-mode: vertical-rl;
}
`;

/**
 * 直排的宣告，寫在 `<body>` 上。InDesign 產出的書就是這樣，而只讀 `<html>` 的
 * library 會判定成橫排。這不是覆寫書，是 library **讀得不夠**——瀏覽器有照書
 * 做（ADR-0003）。
 */
const VERTICAL_ON_BODY = `
body {
  writing-mode: vertical-rl;
}
`;

/**
 * 直排的宣告，屬性名**只有前綴的版本**——無前綴的 `writing-mode` 一次都沒有
 * 出現。《入境大廳》（Adobe InDesign 17.0.1 產、EPUB 3）就是這個形狀，而
 * Firefox 兩種前綴都不認，於是那本書在 Firefox 上整本排成橫排
 * （docs/browser-quirks.md 的〈`-epub-` 與 `-webkit-` 前綴的 `writing-mode`，
 * Firefox 不認〉）。
 *
 * 與 `VERTICAL_ON_BODY` 是彼此的對照組，病的不是同一件事：那一份病在宣告的
 * **位置**（三家都照書做，是 library 只讀 `documentElement` 讀得不夠），這一份
 * 病在宣告的**語法**（沒有人讀得不夠，是 Firefox 根本沒收到這個宣告）。
 *
 * 冒號後留一個空白，雖然那本書寫的是無空白——無空白是另一格已經量過的事實
 * （三家都認，見同一份文件），寫進來就變成兩個軸疊在同一個檔案上。
 */
const VERTICAL_ON_BODY_PREFIXED = `
body {
  -epub-writing-mode: vertical-rl;
  -webkit-writing-mode: vertical-rl;
}
`;

/**
 * 骨架的那幾個 Section。
 *
 * `anchorIdsOf` 決定第 index 個 Section 的哪幾個段落要帶 id，預設一個都不帶。
 * 巢狀 TOC 那兩份靠它取得錨點，而**不是**自己再走一次 `PROSE`——那樣就有兩處
 * 在假設「readingOrder 的第 n 項對到 PROSE 的第 n 項」，而其中一處遲早會先動過
 * readingOrder（`percentEncodedComma` 就改了 `path`），假設會靜默地錯。
 */
function healthySections(
  anchorIdsOf: (index: number) => ReadonlyMap<number, string> = () => new Map(),
): readonly SectionSpec[] {
  return PROSE.map((prose, index) => ({
    path: `section-${index + 1}.xhtml`,
    title: prose.title,
    body: proseBody(prose, anchorIdsOf(index)),
  }));
}

/**
 * 這份 fixture 的 EPUB 版本。
 *
 * 存在的理由是型別而不是預設值：`AILMENTS` 用 `as const` 保留字面型別，所以
 * 省略了 `epubVersion` 的那幾筆連這個屬性都沒有，`ailment.epubVersion` 在
 * 那個聯集型別上讀不出來。這個函式把它放寬成 `Ailment` 再讀。預設值本身只有
 * `epub.ts` 的 `DEFAULT_EPUB_VERSION` 一個定義。
 */
export function epubVersionOf(ailment: Ailment): EpubVersion {
  return ailment.epubVersion ?? DEFAULT_EPUB_VERSION;
}

/**
 * 健康的骨架。identifier 固定不取亂數——UUID 是決定性最容易被破壞的地方。
 */
function baseSpec(ailment: Ailment): EpubSpec {
  return {
    epubVersion: epubVersionOf(ailment),
    title: `frond fixture — ${ailment.name}`,
    language: "ja",
    identifier: `urn:uuid:frond-fixture-${ailment.name}`,
    stylesheet: HEALTHY_STYLESHEET,
    readingOrder: healthySections(),
  };
}

export interface Ailment {
  /** 病症名，也是檔名（不含 `.epub`）。版本不是預設值時，名字要帶後綴。 */
  readonly name: string;
  /**
   * 封裝版本。省略時是 `"epub3"`——省略而不是每一筆都寫，是為了讓既有的十份
   * fixture 不因為這一軸的出現而改變位元組。
   */
  readonly epubVersion?: EpubVersion;
  /** 一句話說明這個檔案編碼的是哪一種病。 */
  readonly description: string;
  /** 把病加到健康的骨架上。改動限於單點——那是這批 fixture 的全部價值。 */
  readonly afflict: (base: EpubSpec) => EpubSpec;
}

// `as const satisfies` 而不是 `: readonly Ailment[]`：後者會把 name 放寬成
// string，於是 buildFixture("typo") 通得過型別檢查、留到執行期才炸。
export const AILMENTS = [
  {
    name: "vertical-japanese",
    description:
      "健康的直排日文書——直排三個病症的對照組，也是 Renderer 直排測試與 foliate spike 的用書",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_HTML,
    }),
  },
  {
    name: "writing-mode-on-body",
    description:
      "直排宣告在 <body> 而非 <html>（InDesign 產出的書），只讀 <html> 的 library 會判成橫排",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_BODY,
    }),
  },
  {
    name: "font-size-important",
    description:
      "書用 font-size !important 蓋掉讀者的字級——讀者的能力被書擋掉，frond 必須贏",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  font-size: 12px !important;
}

p {
  font-size: 12px !important;
}
`,
    }),
  },
  {
    name: "fixed-width-800",
    description: "固定寬度 800px，小螢幕上右半邊的內容被裁掉讀不到",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  width: 800px;
}
`,
    }),
  },
  {
    name: "toc-href-percent-comma",
    description:
      "nav 的 href 把檔名裡的逗號編碼成 %2c，manifest 用字面的逗號——沒有正規化就點目錄靜默無反應",
    afflict: percentEncodedComma,
  },
  {
    name: "toc-href-parent-prefix",
    description:
      "導覽文件在子目錄，TOC 的 href 帶 ../ 前綴——相對於封裝文件解析就會對不上",
    afflict: (base) => ({
      ...base,
      navigationPath: "nav/nav.xhtml",
    }),
  },
  {
    name: "ppd-rtl-vertical",
    description: "直排且 page-progression-direction=rtl——翻頁方向與定位軸都要鏡射",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_HTML,
      pageProgressionDirection: "rtl",
    }),
  },
  {
    name: "hardcoded-colors",
    description: "寫死前景與背景色，讀者的夜間模式失效",
    afflict: (base) => ({
      ...base,
      stylesheet: `${base.stylesheet}
body {
  color: #000000;
  background-color: #ffffff;
}
`,
    }),
  },
  {
    name: "huge-single-section",
    description:
      "整本書只有一個巨大的 Section——分頁效能與整書索引（fraction）的壓力點",
    afflict: (base) => ({
      ...base,
      readingOrder: [
        {
          path: "section-1.xhtml",
          title: "長い一日",
          body: hugeBody(),
        },
      ],
    }),
  },
  {
    name: "empty-and-image-only-sections",
    description:
      "一個空的 Section 與一個只有圖片的 Section——分頁與定位在沒有文字時的邊界",
    afflict: (base) => ({
      ...base,
      readingOrder: [
        base.readingOrder[0]!,
        { path: "section-2.xhtml", title: "白紙", body: "" },
        {
          path: "section-3.xhtml",
          title: "図版",
          body: `    <img src="${IMAGE_PATH}" alt="市松模様の図版"/>`,
        },
      ],
      resources: [
        {
          path: IMAGE_PATH,
          mediaType: "image/png",
          contents: PLATE_IMAGE,
        },
      ],
    }),
  },
  {
    name: "healthy-epub2",
    epubVersion: "epub2",
    description:
      "健康的 EPUB 2 骨架（OPF 2.0 + NCX，沒有頁面推進方向）——EPUB 2 這條路上所有病症的對照組",
    // 差異在版本本身而不在內容上：這一份與 EPUB 3 的健康骨架之間只差版本，
    // 所以 afflict 什麼也不加。
    afflict: (base) => base,
  },
  {
    name: "cover-image-property",
    description:
      "封面走 EPUB 3 的 manifest properties=\"cover-image\"——書櫃縮圖的主要來源",
    afflict: (base) => ({
      ...base,
      cover: { ...COVER_RESOURCE, declaredBy: ["cover-image-property"] },
    }),
  },
  {
    name: "cover-meta-name-epub2",
    epubVersion: "epub2",
    description:
      "封面走 EPUB 2 的 <meta name=\"cover\">——EPUB 2 沒有 properties，只有這條路",
    afflict: coverByMetaName,
  },
  {
    name: "toc-href-percent-comma-epub2",
    epubVersion: "epub2",
    description:
      "同一個 %2c 長在 NCX 的 content src 上——樣本裡那 48 個小寫 %2c 正是這個載體上的形狀",
    // 與 EPUB 3 那一份共用同一個 afflict。病症的形狀（同一個字元、同樣小寫、
    // 同樣只有一側編碼）因此不可能在兩份之間漂開——各寫一次就會。
    afflict: percentEncodedComma,
  },
  {
    name: "toc-href-parent-prefix-epub2",
    epubVersion: "epub2",
    description:
      "NCX 在子目錄，content src 帶 ../ 前綴——相對於封裝文件解析就會對不上",
    // 目錄叫 `toc/` 而不是 `nav/`：CONTEXT.md 把 nav 留給 EPUB 3 的那份導覽
    // 文件，拿它裝 NCX 讀起來像是同一份檔案改了副檔名。
    afflict: (base) => ({
      ...base,
      navigationPath: "toc/toc.ncx",
    }),
  },
  {
    name: "nested-toc",
    description:
      "nav.xhtml 的巢狀 TOC——<ol> 套在 <li> 裡面，兩層，第二層混用帶 fragment 與不帶的 href",
    afflict: nestedToc,
  },
  {
    name: "nested-toc-epub2",
    epubVersion: "epub2",
    description:
      "NCX 的巢狀 TOC——navPoint 套 navPoint，兩層，playOrder 跨層連續",
    // 與 EPUB 3 那一份是同一棵樹的兩種載體寫法。共用 afflict 讓「同一個 TOC 在
    // 兩種載體上長成兩種形狀」成為可以並排對照的一對，而不是兩份各自寫出來、
    // 剛好長得像的樹。
    afflict: nestedToc,
  },
  {
    name: "manifest-href-parent-prefix",
    description:
      "manifest 的 href 帶 ../ 走到封裝根、目標確實存在——這是好書，用來擋「OPF 指向不存在的檔案」的誤報",
    afflict: (base) => ({
      ...base,
      resources: [
        {
          path: ROOT_SCRIPT_PATH,
          // 照實際那本通路書寫的 media type。EPUB 3.3 改推 text/javascript，
          // 但 fixture 要演的是書實際的形狀。
          mediaType: "application/javascript",
          contents: ROOT_SCRIPT,
        },
      ],
    }),
  },
  {
    name: "writing-mode-prefixed-only",
    description:
      "直排只用 -epub- 與 -webkit- 前綴的屬性名宣告，無前綴的一次都沒有——Firefox 收不到這個宣告，整本橫排",
    afflict: (base) => ({
      ...base,
      stylesheet: base.stylesheet + VERTICAL_ON_BODY_PREFIXED,
    }),
  },
  {
    name: "obfuscated-font-idpf",
    description:
      "字型用 IDPF 演算法混淆過，由 META-INF/encryption.xml 宣告——解錯不會丟錯，症狀是讀者那一頁全是豆腐字",
    afflict: (base) => ({
      ...base,
      resources: [
        {
          path: FONT_PATH,
          mediaType: "font/otf",
          contents: FONT_BYTES,
          obfuscation: "idpf",
        },
      ],
    }),
  },
  {
    name: "cover-meta-name",
    description:
      "EPUB 3 的封面只用 <meta name=\"cover\"> 宣告，manifest 不帶 properties——按版本分派封面的實作會讓這本書沒有縮圖",
    afflict: coverByMetaName,
  },
  {
    name: "writing-mode-behind-import",
    description:
      "內容文件 <link> 的樣式表只有一行 @import 字串，排版意圖全在被 import 的那一份裡——不展開 @import 的實作會讓整份樣式表消失，整本排成橫排",
    afflict: verticalBehindImport,
  },
  {
    name: "hidden-trailing-notes",
    description:
      "一節的正文之後跟著 display:none 的註腳，文件順序的最後一個文字節點因此畫不出來——拿它當內容的終點會把整節的頁數壓成 1，讀者翻不過第一頁",
    afflict: hiddenTrailingNotes,
  },
  {
    name: "plate-taller-than-page",
    description:
      "圖版比一頁還高，而且包在一層沒有宣告高度的 div 裡——百分比的 max-block-size 在這裡解析不出來，圖的下半被裁掉而且翻不出來",
    afflict: plateTallerThanPage,
  },
  {
    name: "table-taller-than-page",
    description:
      "表格比一頁還高——Chromium 把它切到相鄰的欄，Firefox 與 WebKit 不切，於是下半被裁掉讀不到（三家分歧，釘住現況）",
    afflict: tableTallerThanPage,
  },
] as const satisfies readonly Ailment[];

/** 病症名。也是 `<name>.epub` 這個檔名。 */
export type AilmentName = (typeof AILMENTS)[number]["name"];

/**
 * TOC 的 href 把檔名裡的逗號編碼成 `%2c`，manifest 與壓縮檔的項目名用字面的
 * 逗號。**只有 TOC 這一側編碼**——兩側都編碼的話字串比對就直接成功，這個
 * fixture 也就不帶病了。
 *
 * 樣本裡那本 EPUB 2（簡中、calibre 產）有 48 個這種 href，全部小寫 `%2c`、逗號
 * 都在檔名中段，而編碼**只發生在 NCX 上**：同一個檔案在 manifest 與 zip 的項目
 * 名裡都是字面的逗號。這個函式因此被兩份 fixture 共用——nav 那一份與 NCX 那
 * 一份，差的只有載體。
 */
function percentEncodedComma(base: EpubSpec): EpubSpec {
  const path = "section-2,continued.xhtml";
  return {
    ...base,
    readingOrder: base.readingOrder.map((section, index) =>
      index === 1
        ? { ...section, path, navHref: path.replaceAll(",", "%2c") }
        : section,
    ),
  };
}

/**
 * 封面只用 `<meta name="cover">` 宣告。
 *
 * EPUB 2 那一份與 EPUB 3 那一份共用它——它們是並排的一對，而兩份 fixture 之間
 * 唯一該有的差別是版本。各寫一次 inline 的話，「差別只有版本」是巧合而不是
 * 結構，於是「EPUB 3 也要認舊寫法」這件事就沒有東西釘得住（ADR-0007）。
 */
function coverByMetaName(base: EpubSpec): EpubSpec {
  return { ...base, cover: { ...COVER_RESOURCE, declaredBy: ["meta-name"] } };
}

/**
 * 被 `@import` 進來的那一份樣式表。內容目錄底下，與 `style.css` 同一層——照樣本
 * 裡那條工具鏈的形狀（`item/style/book-style.css` 旁邊放著它 import 的那幾份）。
 */
const IMPORTED_STYLESHEET_PATH = "book-style.css";

/**
 * 排版意圖整份搬到被 `@import` 進來的樣式表裡，`style.css` 只剩那一行 `@import`。
 *
 * 這是樣本裡四本書的形狀（九歌112年散文選、創業投資聖經、原子習慣、大器可以晚
 * 成，同一條 Kadokawa／BookCreator 工具鏈）：內容文件只 `<link>` 一支聚合檔，而
 * 那支檔案除了 `@charset` 之外**只有 `@import` 字串**——`@import "style-standard.css";`
 * 這種寫法裡一個 `url(` 都沒有。只認 `url()` 的實作因此連相對路徑都不必解就已經
 * 輸了：那份樣式表整份消失，四本直排書全部排成橫排。
 *
 * ## 與 `vertical-japanese` 是一對
 *
 * 兩份宣告的內容**逐字元相同**（`HEALTHY_STYLESHEET` 加 `VERTICAL_ON_HTML`），
 * 唯一的差別是那些位元組放在哪一個檔案裡。差別若不只這一項，「為什麼一本直排
 * 一本橫排」就不再只有 `@import` 這一個解釋。
 *
 * 引號寫法而不是 `@import url(book-style.css)`：字串寫法才是樣本量到的那一種。
 * `url()` 寫法是同一支展開器的另一個分支，測它不需要一份 fixture——那是純字串
 * 函式的事（`tests/node/renderer/css.test.ts`）。
 *
 * `@charset` 刻意不寫，儘管那四本書都有。它會讓這個檔案疊上第二個軸（一份內嵌
 * 進 `<style>` 的樣式表裡的 `@charset` 是不是還算數），而那件事在實書掃描裡驗，
 * 不在這裡。
 */
function verticalBehindImport(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `@import "${IMPORTED_STYLESHEET_PATH}";\n`,
    resources: [
      {
        path: IMPORTED_STYLESHEET_PATH,
        mediaType: "text/css",
        contents: new TextEncoder().encode(base.stylesheet + VERTICAL_ON_HTML),
      },
    ],
  };
}

/**
 * 正文之後跟著一段 `display: none` 的註腳。
 *
 * 樣本裡的常態：註腳放在正文**後面**、平常藏起來，讀者點上標才顯示（《投資最重要
 * 的事》的 `.hide`、`.footnote`，同樣的形狀在另外幾本上也量到）。整份
 * `nav.xhtml` 被藏起來也是同一個形狀。
 *
 * 病症是**文件順序的最後一個文字節點畫不出來**：拿它的矩形（全零）當「內容延伸
 * 到哪裡」的答案，整節的頁數會被算成 1，於是讀者只讀得到第一頁
 * （`section-view.ts` 的 `lastPageWithContent`）。
 *
 * ## 為什麼這一節的正文特別長
 *
 * 長度不是第二個病症，是**症狀成立的前提**：只有一頁的節，「頁數被壓成 1」與
 * 正確答案是同一個數字，於是這份 fixture 什麼也證明不了。所以正文必須排得出
 * 好幾頁——`PAGINATING_PARAGRAPH_COUNT` 就是為此而存在的那個數字。
 *
 * 只動最後一節，前兩節保持健康：`huge-single-section` 才是「readingOrder 只有
 * 一個 Section」那個病症，這一份把 readingOrder 也改掉的話，兩份 fixture 在
 * 探針上就分不開了（`single-ailment.test.ts`）。
 */
function hiddenTrailingNotes(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `${base.stylesheet}
.note {
  display: none;
}
`,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? { ...section, body: paginatingBodyWithHiddenNotes(section.title) }
        : section,
    ),
  };
}

/**
 * 排得出好幾頁的正文，加上尾巴那一段藏起來的註腳。
 *
 * 段落數固定不取亂數（決定性）。這個值要讓正文在 800x600、16px、雙欄之下超過
 * 一頁——實測落在四頁上下，餘裕足以吸收字型度量的小幅變動而不會退回一頁，而
 * 一旦退回一頁，這份 fixture 就不再帶病（見 `hiddenTrailingNotes`）。
 */
const PAGINATING_PARAGRAPH_COUNT = 80;

/** 註腳幾則。兩則就夠——要的是「尾巴上有藏起來的文字」，不是數量。 */
const HIDDEN_NOTE_COUNT = 2;

function paginatingBodyWithHiddenNotes(title: string): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);

  return [
    `    <h1>${title}</h1>`,
    ...Array.from(
      { length: PAGINATING_PARAGRAPH_COUNT },
      (_, index) => `    <p>${sentences[index % sentences.length]}</p>`,
    ),
    // 註腳在正文之後，而且是**最後**的東西——病症的全部重點在這個位置上。
    ...Array.from(
      { length: HIDDEN_NOTE_COUNT },
      (_, index) =>
        `    <div class="note" id="note-${index + 1}"><p>${
          sentences[index % sentences.length]
        }</p></div>`,
    ),
  ].join("\n");
}

const TALL_PLATE_PATH = "images/tall-plate.png";

/**
 * 一張**比一頁還高**的圖版，包在一層沒有宣告高度的 div 裡。
 *
 * 樣本裡的圖版寫法（四本書共七節）：
 *
 * ```html
 * <div class="pic"><span><img src="…"/></span></div>
 * ```
 * ```css
 * .pic { text-align: center; margin: 1.5em auto; width: 98% }
 * .pic img { max-width: 100% }
 * ```
 *
 * 書自己只管了**行內軸**（`max-width`），區塊軸沒有上限——那本來是 frond 的
 * `cap-overflowing-boxes` 該補的一格。但 `max-block-size: 100%` 在這個形狀下
 * **解析不出來**：百分比的 max-height 需要一個確定的包含塊尺寸，而 `.pic` 是
 * `height: auto`，於是整條宣告被當成 `none`，圖照樣撐出去再被 `overflow: hidden`
 * 裁掉（`src/renderer/layout.ts` 有實測數字）。
 *
 * **包裝那一層是這份 fixture 的重點，不是裝飾。** 圖直接放在 `<body>` 底下時
 * 同一個機制也成立（layout.ts 把 body 的 block-size 設成 auto），但那樣就少掉
 * 「書自己包了一層」這個實際的形狀，而修法一旦改成「只處理 body 的直接子元素」，
 * 沒有包裝的 fixture 會通過而實際的書照壞。
 *
 * 圖的長寬比刻意極端（64 × 720），而且最下面留一條深色帶：下半被裁掉的時候，
 * 那條帶子會從畫面上消失，判讀截圖時一眼看得出來。
 */
function plateTallerThanPage(base: EpubSpec): EpubSpec {
  return {
    ...base,
    stylesheet: `${base.stylesheet}
.plate {
  margin: 1.5em auto;
  text-align: center;
}

.plate img {
  max-inline-size: 100%;
}
`,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? {
            ...section,
            body: `${section.body}
    <div class="plate"><img src="${TALL_PLATE_PATH}" alt="縦長の図版"/></div>`,
          }
        : section,
    ),
    resources: [
      {
        path: TALL_PLATE_PATH,
        mediaType: "image/png",
        contents: TALL_PLATE_IMAGE,
      },
    ],
  };
}

/**
 * 縱長的圖版。720px 高，比 800x600 的 viewport 在區塊軸上放得下的長度還長。
 *
 * 最下面那一條深色帶（最後 8%）是判讀用的：圖沒有被裁掉的時候它在畫面上，被裁
 * 掉的時候它不在。橫紋讓「有沒有被壓扁」也看得出來——等距的紋路變密就是被壓扁了。
 */
const TALL_PLATE_IMAGE = encodePng({
  width: 64,
  height: 720,
  sample: (_x, y) => (y >= 662 ? 0x10 : (y >> 5) % 2 === 0 ? 0x30 : 0xe0),
});

/**
 * 一個**比一頁還高的表格**。
 *
 * 樣本裡三本書共九節是這個形狀（《幽靈帝國拜占庭》、《激進市場》、
 * 《FIRE．致富實踐》），最嚴重的一節表格高 3115px 而一欄只有 552px。
 *
 * 與 `plate-taller-than-page` 是一對，而且**必須是兩份**：兩者都是「比一欄還高的
 * 盒子」，但三家瀏覽器對它們的處置不同——圖片那一份可以靠 `max-block-size` 縮下來
 * （`max-height` 對替換元素有效），表格不行（`max-height` 對表格是**下限**而不是
 * 上限，表格照內容長）。所以圖片那一份 frond 修得掉，表格這一份修不掉，而
 * Chromium 與另外兩家在表格上還分歧（`docs/browser-quirks.md`）。合在一份檔案裡
 * 的話「哪一種盒子修得掉」就分不出來了。
 *
 * 刻意**不加任何 CSS**：一個沒有樣式的 `<table>` 就已經帶著這個病症，多一條規則
 * 只會在同一個檔案上疊第二個軸。
 */
function tableTallerThanPage(base: EpubSpec): EpubSpec {
  return {
    ...base,
    readingOrder: base.readingOrder.map((section, index) =>
      index === base.readingOrder.length - 1
        ? { ...section, body: `${section.body}\n${tallTable()}` }
        : section,
    ),
  };
}

/**
 * 表格幾列。列數要讓表格明顯超過一欄的區塊軸長度（800x600 之下約 552px）——
 * 一列大約 29px，所以 30 列排得出八百多 px，餘裕足以吸收字型度量的變動。
 */
const TALL_TABLE_ROW_COUNT = 30;

function tallTable(): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);

  return [
    `    <table>`,
    `      <tbody>`,
    ...Array.from({ length: TALL_TABLE_ROW_COUNT }, (_, index) => {
      const ordinal = index + 1;
      return `        <tr><td>${ordinal}</td><td>${sentences[index % sentences.length]}</td></tr>`;
    }),
    `      </tbody>`,
    `    </table>`,
  ].join("\n");
}

/**
 * 每個 Section 在 TOC 裡掛幾個子項目。
 *
 * 形狀照樣本裡那本巢狀的 EPUB 2（繁中，Sigil → calibre）縮小：那本是 52 個
 * navPoint、深度 2、頂層 14 個第二層 38 個，而且**不是每個頂層都有子項目**。
 * 這裡是 3 個頂層、4 個第二層，最後一個頂層沒有子項目——同樣的形狀，數量縮到
 * 骨架的三個 Section 上。
 */
const NESTED_TOC_SUBITEM_COUNTS = [2, 2, 0];

/** 第二層的序數，長度就是 `NESTED_TOC_SUBITEM_COUNTS` 的最大值。合成文字。 */
const SUBITEM_ORDINALS = ["一", "二"];

/** 第 index 個 Section 的第 subindex 個子項目指向哪個 id。 */
function subitemAnchorId(index: number, subindex: number): string {
  return `part-${index + 1}-${subindex + 1}`;
}

/**
 * 把 TOC 撐成兩層。readingOrder 不動——巢狀是 **TOC 的層次**，不是閱讀順序的
 * 層次，兩者混為一談正是這個病症最容易被實作錯的地方。
 *
 * **每個子項目都指向自己的錨點**，沒有兩項共用同一個目標。第一個子項目若省略
 * fragment，它的 href 會與父項目一字不差，而「父子同一個目標」是票沒有要求的
 * 額外性質——會去重的實作把那一項靜默吃掉之後，測試看起來仍然是對的。
 *
 * 「帶 fragment 與不帶的混用」這個真書性質仍然成立，而且在同一份導覽文件裡：
 * 三個頂層都不帶，四個第二層都帶。錨點由 `healthySections` 一起寫進段落，所以
 * 每一個 fragment 都指得到真的 id——指不到的話這份 fixture 就多帶了「TOC 指向
 * 不存在的位置」這第二個病症。
 */
function nestedToc(base: EpubSpec): EpubSpec {
  const sections = healthySections(
    (index) =>
      new Map(
        Array.from(
          { length: NESTED_TOC_SUBITEM_COUNTS[index] ?? 0 },
          (_, subindex) => [subindex + 1, subitemAnchorId(index, subindex)],
        ),
      ),
  );

  return {
    ...base,
    readingOrder: sections.map((section, index) => {
      const count = NESTED_TOC_SUBITEM_COUNTS[index] ?? 0;
      if (count === 0) return section;

      return {
        ...section,
        subitems: Array.from({ length: count }, (_, subindex) => ({
          title: `${section.title}・${SUBITEM_ORDINALS[subindex]!}`,
          fragment: subitemAnchorId(index, subindex),
        })),
      };
    }),
  };
}

/**
 * 封裝根上的一份資源，manifest 用 `../` 指過去。
 *
 * 形狀取自一本實際的通路書（Kobo，EPUB 3）：OPF 在 `OEBPS/content.opf`，manifest
 * 裡有 `href="../js/kobo.js"`，而 `js/kobo.js` 確實存在於 ZIP 根目錄。照 URL
 * 規則解析是 `js/kobo.js`，落在封裝內，**合規且解得開**。
 *
 * 把 href 當字串接在內容目錄後面的實作會去找 `EPUB/../js/reader.js` 這個字面上
 * 的項目名，找不到，然後把一本好書判成「OPF 指向不存在的檔案」。這份 fixture
 * 擋的就是那個誤報。
 */
const ROOT_SCRIPT_PATH = "../js/reader.js";

const ROOT_SCRIPT = new TextEncoder().encode(
  "// frond fixture：內容不重要，位置才是——這個檔案在封裝根，manifest 用 ../ 指到它。\n",
);

const IMAGE_PATH = "images/plate.png";

const FONT_PATH = "fonts/obfuscated.otf";

/**
 * 混淆過的那份「字型」。
 *
 * **它不是一份真的 OTF**，而這是刻意的：這份 fixture 演的病症是**解碼那一步**
 * ——金鑰推導、蓋住的範圍、以及蓋過頭有沒有毀掉後面的位元組。真的字型會多帶
 * 兩個軸（授權，以及「這份字型長什麼樣」），而那兩個軸與解碼無關。要測「書用
 * 自己的字型排出來長什麼樣」的話，那是 Renderer 的票，需要的也是另一份 fixture。
 *
 * 長度刻意超過 1040：混淆只蓋開頭那 1040 個位元組，蓋過頭是最容易寫錯的一步，
 * 而檔案若不夠長，那個錯就沒有東西照得出來。內容是決定性的等差序列，不是亂數。
 */
const FONT_BYTES = Uint8Array.from({ length: 1200 }, (_, index) => (index * 31 + 7) % 256);

const COVER_PATH = "images/cover.png";

/**
 * 封面圖。與內文的圖版（`PLATE_IMAGE`）刻意**不同尺寸也不同圖樣**——書櫃縮圖
 * 抓錯圖片時，抓到的是內文插圖這件事必須一眼看得出來，兩張長一樣就看不出來。
 * 直立的長寬比也是書封的形狀。
 */
const COVER_RESOURCE = {
  path: COVER_PATH,
  mediaType: "image/png",
  contents: encodePng({
    width: 100,
    height: 160,
    // 一個帶邊框的漸層：邊框證明圖沒有被裁掉，漸層的方向證明沒有被上下翻轉。
    sample: (x, y) =>
      x < 6 || y < 6 || x >= 94 || y >= 154 ? 0x10 : 0x40 + Math.floor(y * 0.75),
  }),
} as const;

/**
 * 圖版。市松模様——一眼看得出有沒有畫出來、也看得出有沒有被拉伸，而且不必
 * 引入任何有版權的素材。
 */
const PLATE_IMAGE = encodePng({
  width: 96,
  height: 128,
  sample: (x, y) => (((x >> 4) + (y >> 4)) % 2 === 0 ? 0x20 : 0xe0),
});

/** 一個 Section 能有多長。段落數刻意固定，決定性不能靠亂數。 */
const HUGE_PARAGRAPH_COUNT = 1200;

function hugeBody(): string {
  const sentences = PROSE.flatMap((prose) => prose.paragraphs);
  return [
    "    <h1>長い一日</h1>",
    ...Array.from(
      { length: HUGE_PARAGRAPH_COUNT },
      (_, index) => `    <p>${sentences[index % sentences.length]}</p>`,
    ),
  ].join("\n");
}

/** 把病加到健康的骨架上，組出這個病症的完整 EpubSpec。 */
export function specFor(ailment: Ailment): EpubSpec {
  return ailment.afflict(baseSpec(ailment));
}
