import type { EpubSpec, SectionSpec } from "./epub.ts";
import { encodePng } from "./png.ts";
import { PROSE, proseBody } from "./prose.ts";

/**
 * 病症清單。**一個病症一個檔，檔名即病症名**（ADR-0007）。
 *
 * 每個病症表達成對同一份健康骨架的**單點差異**——其餘部分保持健康。這條紀律
 * 是這批 fixture 的全部價值：測試紅燈時檔名就說明了是哪一種病復發。兩個病症
 * 一旦擠進同一個檔案，紅燈就要重新花時間查是哪一項造成的，那正是真書的缺點。
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
 * 書排成什麼樣」。真書大多用 generic 宣告，那是 #4 的範圍，不該污染合成
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

const healthySections: readonly SectionSpec[] = PROSE.map((prose, index) => ({
  path: `section-${index + 1}.xhtml`,
  title: prose.title,
  body: proseBody(prose),
}));

/**
 * 健康的骨架。identifier 固定不取亂數——UUID 是決定性最容易被破壞的地方。
 */
function baseSpec(name: string): EpubSpec {
  return {
    title: `frond fixture — ${name}`,
    language: "ja",
    identifier: `urn:uuid:frond-fixture-${name}`,
    stylesheet: HEALTHY_STYLESHEET,
    readingOrder: healthySections,
  };
}

export interface Ailment {
  /** 病症名，也是檔名（不含 `.epub`）。 */
  readonly name: string;
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
    afflict: (base) => {
      const path = "section-2,continued.xhtml";
      return {
        ...base,
        readingOrder: base.readingOrder.map((section, index) =>
          index === 1
            ? {
                ...section,
                path,
                // 只有 nav 這一側編碼。兩側都編碼的話字串比對就直接成功，
                // 這個 fixture 也就不帶病了。
                navHref: path.replaceAll(",", "%2c"),
              }
            : section,
        ),
      };
    },
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
] as const satisfies readonly Ailment[];

/** 病症名。也是 `<name>.epub` 這個檔名。 */
export type AilmentName = (typeof AILMENTS)[number]["name"];

const IMAGE_PATH = "images/plate.png";

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
  return ailment.afflict(baseSpec(ailment.name));
}
