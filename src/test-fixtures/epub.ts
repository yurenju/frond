import { zip, type ZipEntry } from "./zip.ts";

/**
 * 由一份宣告式的規格組出 EPUB 3 的位元組。
 *
 * 這一層只知道「怎麼組一本合規的書」，不知道任何病症——病症在 `ailments.ts`
 * 裡表達成對同一份健康骨架的單點差異。這一刀是「一個 fixture 只帶一個病症」
 * 這條要求的實作方式：病症若散在組裝邏輯裡，遲早會有兩個病症共用一段
 * `if`，而 fixture 之間就開始互相污染。
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
 */
const FIXED_MODIFIED = "2020-01-01T00:00:00Z";

export interface SectionSpec {
  /** 相對於內容目錄的路徑，例如 `section-1.xhtml`。 */
  readonly path: string;
  readonly title: string;
  /** XHTML 的 `<body>` 內容，已是合法的 XML。 */
  readonly body: string;
  /**
   * TOC 指向這個 Section 時所用的 href，相對於導覽文件。省略時由路徑推得。
   * 病症 fixture 用它表達「TOC 的 href 與 Section 的實際位置寫法不同」。
   */
  readonly navHref?: string;
  /** 這個 Section 不進 TOC。用於「TOC 不必涵蓋整個 readingOrder」的情形。 */
  readonly omitFromToc?: boolean;
}

export interface ResourceSpec {
  /** 相對於內容目錄的路徑，例如 `images/plate.png`。 */
  readonly path: string;
  readonly mediaType: string;
  readonly contents: Uint8Array;
}

export interface EpubSpec {
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
   */
  readonly pageProgressionDirection?: "ltr" | "rtl";
  /** 導覽文件的路徑，相對於內容目錄。預設 `nav.xhtml`。 */
  readonly navigationPath?: string;
  readonly resources?: readonly ResourceSpec[];
}

export function buildEpub(spec: EpubSpec): Uint8Array {
  const navigationPath = spec.navigationPath ?? "nav.xhtml";
  const resources = spec.resources ?? [];

  const entries: ZipEntry[] = [
    // mimetype 必須是第一個項目、且未壓縮（zip.ts 一律 stored，所以後半自動
    // 成立）。閱讀器靠固定位移嗅出這是不是 EPUB。
    { path: "mimetype", contents: encode(MIMETYPE) },
    { path: "META-INF/container.xml", contents: encode(containerXml()) },
    {
      path: contentPath(PACKAGE_DOCUMENT_PATH),
      contents: encode(packageDocument(spec, navigationPath, resources)),
    },
    {
      path: contentPath(navigationPath),
      contents: encode(navigationDocument(spec, navigationPath)),
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

function contentPath(path: string): string {
  return `${CONTENT_DIRECTORY}/${path}`;
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

function packageDocument(
  spec: EpubSpec,
  navigationPath: string,
  resources: readonly ResourceSpec[],
): string {
  const manifest = [
    `    <item id="nav" href="${navigationPath}" media-type="application/xhtml+xml" properties="nav"/>`,
    `    <item id="stylesheet" href="${STYLESHEET_PATH}" media-type="text/css"/>`,
    ...spec.readingOrder.map(
      (section, index) =>
        `    <item id="${sectionId(index)}" href="${section.path}" media-type="application/xhtml+xml"/>`,
    ),
    ...resources.map(
      (resource, index) =>
        `    <item id="resource-${index + 1}" href="${resource.path}" media-type="${resource.mediaType}"/>`,
    ),
  ].join("\n");

  const readingOrder = spec.readingOrder
    .map((_, index) => `    <itemref idref="${sectionId(index)}"/>`)
    .join("\n");

  const direction =
    spec.pageProgressionDirection === undefined
      ? ""
      : ` page-progression-direction="${spec.pageProgressionDirection}"`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${spec.language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${escapeXml(spec.identifier)}</dc:identifier>
    <dc:title>${escapeXml(spec.title)}</dc:title>
    <dc:language>${spec.language}</dc:language>
    <meta property="dcterms:modified">${FIXED_MODIFIED}</meta>
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${direction}>
${readingOrder}
  </spine>
</package>
`;
}

function navigationDocument(spec: EpubSpec, navigationPath: string): string {
  const items = spec.readingOrder
    .filter((section) => !section.omitFromToc)
    .map(
      (section) =>
        `        <li><a href="${section.navHref ?? relativeHref(section.path, navigationPath)}">${escapeXml(section.title)}</a></li>`,
    )
    .join("\n");

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
