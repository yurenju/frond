import { zip, type ZipEntry } from "./zip.ts";

/**
 * 由一份宣告式的規格組出 EPUB 的位元組。
 *
 * 這一層只知道「怎麼組一本合規的書」，不知道任何病症——病症在 `ailments.ts`
 * 裡表達成對同一份健康骨架的單點差異。這一刀是「一個 fixture 只帶一個病症」
 * 這條要求的實作方式：病症若散在組裝邏輯裡，遲早會有兩個病症共用一段
 * `if`，而 fixture 之間就開始互相污染。
 *
 * ## EPUB 版本
 *
 * 這一層認得兩種**版本**（`EpubVersion`）：EPUB 3 與 EPUB 2。它們在封裝層是兩種
 * 不同的形狀，不是同一份骨架加一份 NCX——後者是照規格推出來的形狀，是範本書
 * 而不是書實際的形狀（ADR-0010）。差異全部收在這個檔案裡，`ailments.ts` 只
 * 指定要哪一種。
 *
 * **不叫「載體」**：CONTEXT.md 把載體這個詞留給**導覽文件**（`nav.xhtml` 與
 * `toc.ncx`），而版本與導覽載體是兩件事——ADR-0010 的規則 3 講的正是「宣告 3.x
 * 卻只有 NCX」那一格，兩個詞混用就講不出那句話。#22 票上寫的是載體，那是
 * CONTEXT.md 收窄這個詞之前寫的。
 *
 * 版本只管**封裝層**：封裝文件、導覽文件、封面的宣告寫法。內容文件（XHTML）
 * 兩種版本共用同一份樣板。這條界線是刻意的——內容文件是 `Renderer` 看到的
 * 東西，讓它跟著版本分岔，每一個內容層的病症就要乘二。
 */

/** OCF 規定的容器 media type。 */
const MIMETYPE = "application/epub+zip";

/** 書內容所在的目錄。OCF 沒有規定名稱，EPUB 3 的慣例是 `EPUB/`。 */
const CONTENT_DIRECTORY = "EPUB";

const PACKAGE_DOCUMENT_PATH = "package.opf";
const STYLESHEET_PATH = "style.css";

/**
 * 固定的最後修改時間。EPUB 3 要求 `dcterms:modified`，而取「現在」會讓同一份
 * 輸入每次產生不同的位元組——ZIP 的 mtime 之外的第二個決定性破口。
 *
 * EPUB 2 沒有這個欄位，所以那條路上不寫它——也就沒有這個破口。
 */
const FIXED_MODIFIED = "2020-01-01T00:00:00Z";

/**
 * 封裝版本。支援範圍見 ADR-0010；`epub3` 指 EPUB 3.x，`epub2` 指 EPUB 2.0.1。
 */
export type EpubVersion = "epub3" | "epub2";

/**
 * 省略 `EpubSpec.epubVersion` 時的版本。這個預設值只有這一個定義——`ailments.ts`
 * 的 `epubVersionOf` 也讀它，兩邊各自寫一次 `?? "epub3"` 就會有第二處事實。
 */
export const DEFAULT_EPUB_VERSION: EpubVersion = "epub3";

/**
 * 每一種版本的導覽文件：manifest 的 id、預設路徑、media type。
 *
 * id 也跟著版本換，因為 `<spine toc="ncx">` 指過去的就是它——EPUB 2 的 NCX 掛著
 * `id="nav"` 讀起來像是 EPUB 3 的導覽文件改了副檔名，而那正是這一軸要避免的
 * 誤導。
 */
const NAVIGATION: Record<
  EpubVersion,
  { readonly id: string; readonly path: string; readonly mediaType: string }
> = {
  epub3: { id: "nav", path: "nav.xhtml", mediaType: "application/xhtml+xml" },
  epub2: { id: "ncx", path: "toc.ncx", mediaType: "application/x-dtbncx+xml" },
};

/**
 * 封面的宣告寫法。**兩條路都要走得通，而且不是按版本分派**——樣本裡有一本
 * EPUB 3 的封面只有舊寫法（ADR-0010）。所以這是獨立的一軸，不由版本推得。
 */
export type CoverNotation = "cover-image-property" | "meta-name";

const COVER_ID = "cover-image";

/**
 * TOC 的第二層——掛在某個 Section 底下的子項目。
 *
 * 位置用 fragment 而不是另一個檔案的路徑：樣本裡那本巢狀的 EPUB 2（Sigil →
 * calibre）第二層指的正是同一份 Section 內的 id，而且**同一份 NCX 裡帶 fragment
 * 與不帶的混用**——省略 `fragment` 就是不帶的那一種。
 */
export interface TocSubitemSpec {
  readonly title: string;
  /**
   * 這個子項目指向 Section 內的哪個 id。省略時指向 Section 的開頭，也就是與
   * 上一層同一個 href——那是實際的書裡確實出現的形狀，不是缺陷。
   *
   * 給了值時，Section 的 `body` 裡必須真的有那個 id，否則這份 fixture 帶的是
   * 「TOC 指向不存在的錨點」這第二個病症。
   */
  readonly fragment?: string;
}

export interface SectionSpec {
  /** 相對於內容目錄的路徑，例如 `section-1.xhtml`。 */
  readonly path: string;
  readonly title: string;
  /** XHTML 的 `<body>` 內容，已是合法的 XML。 */
  readonly body: string;
  /**
   * TOC 指向這個 Section 時所用的 href，相對於導覽文件。省略時由路徑推得。
   * 病症 fixture 用它表達「TOC 的 href 與 Section 的實際位置寫法不同」。
   *
   * 兩種版本共用這個欄位：EPUB 3 寫進 `nav.xhtml` 的 `<a href>`，EPUB 2 寫進
   * NCX 的 `<content src>`。實測的壞 TOC 正是長在 NCX 上（ADR-0010、#23）。
   */
  readonly navHref?: string;
  /**
   * 這個 Section 在 TOC 裡的子項目。省略或空陣列時 TOC 在這一項上是平的。
   *
   * 巢狀是 TOC 的層次，不是 readingOrder 的層次——readingOrder 永遠是平的一
   * 串。兩種載體表達同一棵樹的形狀不同（`<ol>` 套 `<ol>` 對 navPoint 套
   * navPoint），所以各自有各自的解析錯法（#23）。
   */
  readonly subitems?: readonly TocSubitemSpec[];
}

export interface ResourceSpec {
  /**
   * manifest 寫出去的 href，同時決定這份資源放在壓縮檔的哪裡。相對於封裝文件
   * ——而封裝文件就在內容目錄裡，所以 `images/plate.png` 這種寫法照舊。
   *
   * 允許 `../` 走到封裝根：`../js/reader.js` 的 href 落在壓縮檔的 `js/reader.js`
   * 上，而那是實際通路書（Kobo）的形狀，合規且解得開（#8 的 comment、#23）。
   * 走出封裝根的路徑會被擋下來——那才是真的不合規。
   */
  readonly path: string;
  readonly mediaType: string;
  readonly contents: Uint8Array;
}

export interface CoverSpec extends ResourceSpec {
  /**
   * 用哪一種寫法宣告它，可以兩種都給——實際的書常態是兩種都寫（樣本裡 30 本）。
   * 空陣列等於「有圖但沒有任何宣告指向它」，那是沒有意義的形狀，會被擋下來。
   */
  readonly declaredBy: readonly CoverNotation[];
}

export interface EpubSpec {
  /**
   * 封裝版本。省略時是 `"epub3"`——現有的 fixture 全部落在這一格，而預設值讓
   * 它們的位元組不因為版本這一軸的出現而漂掉。
   */
  readonly epubVersion?: EpubVersion;
  readonly title: string;
  /** BCP 47 語言標籤。區域字面的選擇由它驅動，見 docs/test-environment.md。 */
  readonly language: string;
  /** 固定的 unique identifier。不可取亂數——那是決定性的破口。 */
  readonly identifier: string;
  readonly stylesheet: string;
  /** readingOrder。EPUB 封裝格式裡叫 `<spine>`，那是規格的線上格式用詞。 */
  readonly readingOrder: readonly SectionSpec[];
  /**
   * 省略時不寫出這個屬性，等同規格的預設值 `ltr`。刻意區分「沒宣告」與
   * 「宣告成 ltr」——`ppd-rtl-vertical` 的病症就在這個屬性上。
   *
   * EPUB 2 沒有這個屬性，兩者一起給會被擋下來。
   */
  readonly pageProgressionDirection?: "ltr" | "rtl";
  /** 導覽文件的路徑，相對於內容目錄。預設值隨版本而不同，見 `NAVIGATION`。 */
  readonly navigationPath?: string;
  /** 省略時這本書沒有封面。那不是缺陷，是一種要測到的形狀（ADR-0010）。 */
  readonly cover?: CoverSpec;
  readonly resources?: readonly ResourceSpec[];
}

export function buildEpub(spec: EpubSpec): Uint8Array {
  const epubVersion = spec.epubVersion ?? DEFAULT_EPUB_VERSION;
  assertCoherent(spec, epubVersion);

  const navigationPath = spec.navigationPath ?? NAVIGATION[epubVersion].path;
  // 封面的位元組與其他資源走同一條路，只有 manifest 那一側不同（見
  // packageDocument）。封面排在前面，讓壓縮檔的項目順序穩定。
  const resources = [
    ...(spec.cover === undefined ? [] : [spec.cover]),
    ...(spec.resources ?? []),
  ];

  const entries: ZipEntry[] = [
    // mimetype 必須是第一個項目、且未壓縮（zip.ts 一律 stored，所以後半自動
    // 成立）。閱讀器靠固定位移嗅出這是不是 EPUB。
    { path: "mimetype", contents: encode(MIMETYPE) },
    { path: "META-INF/container.xml", contents: encode(containerXml()) },
    {
      path: contentPath(PACKAGE_DOCUMENT_PATH),
      contents: encode(packageDocument(spec, epubVersion, navigationPath)),
    },
    {
      path: contentPath(navigationPath),
      contents: encode(
        epubVersion === "epub2"
          ? navigationControlFile(spec, navigationPath)
          : navigationDocument(spec, navigationPath),
      ),
    },
    { path: contentPath(STYLESHEET_PATH), contents: encode(spec.stylesheet) },
    ...spec.readingOrder.map((section) => ({
      path: contentPath(section.path),
      contents: encode(sectionDocument(spec, section)),
    })),
    ...resources.map((resource) => ({
      path: contentPath(resource.path),
      contents: resource.contents,
    })),
  ];

  return zip(entries);
}

/**
 * 版本與其他欄位的組合是不是講得通（EPUB 版本 × 封面宣告寫法）。
 *
 * 這裡丟錯而不是靜默修正：不合規的組合產生的書**看起來是好的**（多一個屬性、
 * 多一個欄位），沒有任何下游測試會紅，而它會被當成「書實際的形狀」拿去測解析。
 */
function assertCoherent(spec: EpubSpec, epubVersion: EpubVersion): void {
  if (epubVersion === "epub2" && spec.pageProgressionDirection !== undefined) {
    throw new Error(
      "EPUB 2 沒有 page-progression-direction（ADR-0010：EPUB 2 一律落在「書沒說」那一格）",
    );
  }

  if (spec.cover === undefined) return;

  if (spec.cover.declaredBy.length === 0) {
    throw new Error("封面至少要有一種宣告寫法，否則沒有任何東西指向它");
  }
  if (epubVersion === "epub2" && spec.cover.declaredBy.includes("cover-image-property")) {
    throw new Error(
      'EPUB 2 的 manifest 沒有 properties 屬性，封面只能走 <meta name="cover">',
    );
  }
}

/**
 * 一份相對於封裝文件的 href 落在壓縮檔的哪一項上。
 *
 * `..` 在這裡**要真的收掉**，不能字串接上去了事：`EPUB/../js/reader.js` 這個
 * 字面上的項目名不存在於任何壓縮檔裡，而寫成那樣的書是好書（#8 的 comment）。
 * 這正是「把 href 當字串接在內容目錄後面」會對一本好書誤報的那一步。
 */
function contentPath(path: string): string {
  const segments: string[] = [CONTENT_DIRECTORY];
  for (const segment of path.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (segments.length === 0) {
      throw new Error(`href 走出了封裝根，不合規：${path}`);
    }
    segments.pop();
  }
  return segments.join("/");
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${contentPath(PACKAGE_DOCUMENT_PATH)}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function manifestItem(
  id: string,
  resource: ResourceSpec,
  properties: string,
): string {
  return `    <item id="${id}" href="${resource.path}" media-type="${resource.mediaType}"${properties}/>`;
}

function coverProperties(cover: CoverSpec): string {
  return cover.declaredBy.includes("cover-image-property")
    ? ' properties="cover-image"'
    : "";
}

function packageDocument(
  spec: EpubSpec,
  epubVersion: EpubVersion,
  navigationPath: string,
): string {
  const epub2 = epubVersion === "epub2";

  const manifest = [
    // EPUB 3 用 properties="nav" 標出導覽文件；EPUB 2 沒有這個屬性，靠 spine 的
    // toc 屬性指向 NCX 的 id。
    `    <item id="${NAVIGATION[epubVersion].id}" href="${navigationPath}" media-type="${NAVIGATION[epubVersion].mediaType}"${epub2 ? "" : ' properties="nav"'}/>`,
    `    <item id="stylesheet" href="${STYLESHEET_PATH}" media-type="text/css"/>`,
    ...spec.readingOrder.map(
      (section, index) =>
        `    <item id="${sectionId(index)}" href="${section.path}" media-type="application/xhtml+xml"/>`,
    ),
    // 封面自己一項，不參與 resource-N 的編號。混在一起編號的話，一本書加上
    // 封面就會讓其他資源的 id 整批位移，而 id 是 <meta name="cover"> 指過來的
    // 東西——位移之後封面指向另一個資源，而那不會有任何東西報錯。
    ...(spec.cover === undefined ? [] : [manifestItem(COVER_ID, spec.cover, coverProperties(spec.cover))]),
    ...(spec.resources ?? []).map((resource, index) =>
      manifestItem(`resource-${index + 1}`, resource, ""),
    ),
  ].join("\n");

  const readingOrder = spec.readingOrder
    .map((_, index) => `    <itemref idref="${sectionId(index)}"/>`)
    .join("\n");

  const direction =
    spec.pageProgressionDirection === undefined
      ? ""
      : ` page-progression-direction="${spec.pageProgressionDirection}"`;

  const metadata = [
    // EPUB 2 的 dc:identifier 帶 opf:scheme 宣告它自稱是哪一種識別碼。frond 不
    // 解讀它（ADR-0010），但實際的書會寫，而 calibre 產的書正是這個形狀。
    `    <dc:identifier id="pub-id"${epub2 ? ' opf:scheme="uuid"' : ""}>${escapeXml(spec.identifier)}</dc:identifier>`,
    `    <dc:title>${escapeXml(spec.title)}</dc:title>`,
    `    <dc:language>${spec.language}</dc:language>`,
    // EPUB 3 才有 dcterms:modified。EPUB 2 這條路上沒有它的位置，那個固定
    // 時間戳因此也不出現。
    ...(epub2 ? [] : [`    <meta property="dcterms:modified">${FIXED_MODIFIED}</meta>`]),
    // <meta name="cover"> 指的是 manifest 項目的 **id**，不是它的 href。
    ...(spec.cover !== undefined && spec.cover.declaredBy.includes("meta-name")
      ? [`    <meta name="cover" content="${COVER_ID}"/>`]
      : []),
  ].join("\n");

  // EPUB 2 的 metadata 要宣告 opf 前綴才能用 opf:scheme；EPUB 3 不需要。
  const metadataNamespaces = epub2
    ? ' xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf"'
    : ' xmlns:dc="http://purl.org/dc/elements/1.1/"';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${epub2 ? "2.0" : "3.0"}" unique-identifier="pub-id"${epub2 ? "" : ` xml:lang="${spec.language}"`}>
  <metadata${metadataNamespaces}>
${metadata}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${epub2 ? ` toc="${NAVIGATION[epubVersion].id}"` : ""}${direction}>
${readingOrder}
  </spine>
</package>
`;
}

/**
 * 要寫出去的 TOC 的一個節點。**兩種載體共用這棵樹**——形狀的差異全部在渲染那
 * 一步，不在樹上。分開建兩棵的話，「同一個 TOC 在 nav 與 NCX 上長成兩種形狀」
 * 這件事就只是巧合，而巢狀的那兩份 fixture 正是要拿來對照的一對（#23）。
 *
 * 名字帶 `Spec` 是為了與**讀回來**的那一棵分開：`tests/node/support/epub-archive.ts`
 * 匯出的 `TocNode` 是解析產出物得到的節點，多帶一個 `archivePath`。兩者是同一
 * 個概念的兩端，但形狀不同，共用一個名字只會讓人以為它們可以互換。
 */
interface TocSpecNode {
  readonly title: string;
  /** 相對於導覽文件的 href。 */
  readonly href: string;
  readonly children: readonly TocSpecNode[];
}

function tocTree(spec: EpubSpec, navigationPath: string): readonly TocSpecNode[] {
  return spec.readingOrder.map((section) => {
    const href = section.navHref ?? relativeHref(section.path, navigationPath);
    return {
      title: section.title,
      href,
      children: (section.subitems ?? []).map((subitem) => ({
        title: subitem.title,
        href: subitem.fragment === undefined ? href : `${href}#${subitem.fragment}`,
        children: [],
      })),
    };
  });
}

/** 這棵樹有幾層。全平的 TOC 是 1，NCX 的 `dtb:depth` 要寫的就是這個數字。 */
function tocDepth(nodes: readonly TocSpecNode[]): number {
  return nodes.reduce(
    (deepest, node) => Math.max(deepest, 1 + tocDepth(node.children)),
    0,
  );
}

/**
 * `nav.xhtml` 的巢狀寫法：子清單是**掛在 `<li>` 裡面**的另一個 `<ol>`，不是
 * `<li>` 的兄弟。放成兄弟的話 XHTML 仍然良構、瀏覽器也畫得出來，但那棵樹是平
 * 的——這是這個載體最典型的寫錯法，而它在只有一層的 TOC 上看不出來。
 */
function navigationItems(nodes: readonly TocSpecNode[], indent: number): string {
  const pad = " ".repeat(indent);
  return nodes
    .map((node) => {
      const anchor = `<a href="${node.href}">${escapeXml(node.title)}</a>`;
      if (node.children.length === 0) return `${pad}<li>${anchor}</li>`;
      return [
        `${pad}<li>${anchor}`,
        `${pad}  <ol>`,
        navigationItems(node.children, indent + 4),
        `${pad}  </ol>`,
        `${pad}</li>`,
      ].join("\n");
    })
    .join("\n");
}

function navigationDocument(spec: EpubSpec, navigationPath: string): string {
  const items = navigationItems(tocTree(spec, navigationPath), 8);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${spec.language}" lang="${spec.language}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(spec.title)}</title>
  </head>
  <body>
    <nav epub:type="toc">
      <h1>${escapeXml(spec.title)}</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`;
}

/**
 * EPUB 2 的導覽文件——NCX（Navigation Control file for XML，出自 DAISY）。
 *
 * 它不是 XHTML：navPoint 的層次就是 TOC 的層次，標籤在 `<navLabel><text>`，
 * 位置在 `<content src>`。`nav.xhtml` 的巢狀是 `<ol>` 套 `<ol>`，這裡是
 * navPoint 套 navPoint——形狀不同，所以各自有各自的解析錯法（#23）。
 */
function navigationControlFile(spec: EpubSpec, navigationPath: string): string {
  const tree = tocTree(spec, navigationPath);

  // playOrder 是 NCX 自己宣告的閱讀順序，與 navPoint 的文件順序在合規的書裡
  // 一致——**包括巢狀的部分**：它是整棵樹拉平後的序號，不是每一層各自從 1 重
  // 數。frond 不靠它排序，但實際的書都會寫（樣本裡那本是 1..48 連續），少了它
  // 就與實際的書不同。
  let playOrder = 0;
  const renderNavPoints = (nodes: readonly TocSpecNode[], indent: number): string => {
    const pad = " ".repeat(indent);
    return nodes
      .map((node) => {
        playOrder += 1;
        // 先把自己的序號記下來再往下走：子項目會把計數器推上去，而樣板字串是
        // 在子項目算完之後才取值的。少了這一行，父項目拿到的是子樹用掉的最後
        // 一個序號。
        const order = playOrder;
        // 子項目**寫在 navPoint 裡面**，不是它的兄弟——那是 NCX 表達層次的唯一
        // 方式，也是這個載體最典型的寫錯法。
        const children =
          node.children.length === 0
            ? ""
            : `\n${renderNavPoints(node.children, indent + 2)}`;
        return `${pad}<navPoint id="navpoint-${order}" playOrder="${order}">
${pad}  <navLabel><text>${escapeXml(node.title)}</text></navLabel>
${pad}  <content src="${node.href}"/>${children}
${pad}</navPoint>`;
      })
      .join("\n");
  };

  const navPoints = renderNavPoints(tree, 4);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE ncx PUBLIC "-//NISO//DTD ncx 2005-1//EN" "http://www.daisy.org/z3986/2005/ncx-2005-1.dtd">
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${spec.language}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(spec.identifier)}"/>
    <meta name="dtb:depth" content="${tocDepth(tree)}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(spec.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`;
}

function sectionDocument(spec: EpubSpec, section: SectionSpec): string {
  const stylesheet = relativeHref(STYLESHEET_PATH, section.path);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${spec.language}" lang="${spec.language}">
  <head>
    <meta charset="utf-8"/>
    <title>${escapeXml(section.title)}</title>
    <link rel="stylesheet" type="text/css" href="${stylesheet}"/>
  </head>
  <body>
${section.body}
  </body>
</html>
`;
}

function sectionId(index: number): string {
  return `section-${index + 1}`;
}

/**
 * 由 `from` 這份文件看向 `target` 的相對 href。兩者都是相對於內容目錄的路徑。
 *
 * 這裡不用 `node:path`：EPUB 的 href 是 URL 而不是檔案系統路徑，在 Windows 上
 * `path.relative` 會給出 `\` 分隔的結果。
 */
function relativeHref(target: string, from: string): string {
  const fromSegments = from.split("/").slice(0, -1);
  const targetSegments = target.split("/");

  let shared = 0;
  while (
    shared < fromSegments.length &&
    shared < targetSegments.length - 1 &&
    fromSegments[shared] === targetSegments[shared]
  ) {
    shared += 1;
  }

  return [
    ...Array<string>(fromSegments.length - shared).fill(".."),
    ...targetSegments.slice(shared),
  ].join("/");
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
