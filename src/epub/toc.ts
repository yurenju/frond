import type { EpubContainer } from "./container.ts";
import type { PackageDocument } from "./package-document.ts";
import { resolveHref, type ResolvedHref } from "./resource-path.ts";
import { parseXml, type XmlElement } from "./xml.ts";
import type { Resource } from "./resources.ts";

/**
 * TOC——書的目錄：有層次的標題與位置對照（CONTEXT.md）。
 *
 * **TOC 是概念，導覽文件是承載它的那份檔案**，而 frond 支援兩種載體：EPUB 3 的
 * `nav.xhtml` 與 EPUB 2 的 `toc.ncx`。這個模組把兩者讀成同一棵樹，於是消費端的
 * 目錄程式碼不必分兩套（user story 14）。
 *
 * 兩種載體表達同一棵樹的形狀不同，錯法也不同：
 *
 * | | `nav.xhtml` | `toc.ncx` |
 * | --- | --- | --- |
 * | 標籤與位置 | 同一個 `<a>` 帶著兩者 | `<navLabel><text>` 與 `<content src>` 是兩個子元素 |
 * | 層次 | `<ol>` 開在 `<li>` **裡面** | navPoint 直接套 navPoint |
 *
 * 所以底下兩個 collect 函式各自獨立——把它們合成一個「遞迴找標籤」的通用實作
 * 會同時失去兩件事：`<nav>` 之外的 `<a>`（landmarks）會被收進 TOC，而子清單
 * 放錯位置（`<li>` 的兄弟而不是裡面）的導覽文件會靜默地變成一串平的。
 *
 * ## href 走的是與 manifest 同一條正規化
 *
 * 每一項的 href 都交給 `resolveHref()`，基底是**導覽文件自己**在壓縮檔內的位置
 * ——不是封裝文件的位置，兩者不一定在同一個目錄裡（`toc-href-parent-prefix`）。
 * `%2c` 與 `../` 兩種病症因此由同一份實作處理，這裡不做任何字串處理。
 */

/** 承載 TOC 的那份檔案是哪一種。 */
export type NavigationVehicle = "nav" | "ncx";

/**
 * TOC 讀自哪一份導覽文件（user story 15）。
 *
 * 兩份都在是常態（樣本裡 31 本 EPUB 3 全部都有），而 ADR-0010 規定不合併、不
 * 交叉驗證——所以「用了哪一份」是消費端唯一能據以查證不一致的線索。frond 給
 * 事實，要不要提示讀者是消費端的政策（ADR-0002）。
 */
export interface NavigationDocument {
  readonly vehicle: NavigationVehicle;
  /** 在壓縮檔內的路徑。 */
  readonly path: string;
}

/** TOC 的一個項目。子項目在 `children` 底下，深度不限。 */
export interface TocItem {
  /** 目錄上顯示的標題。 */
  readonly label: string;
  /** 導覽文件裡原樣照抄的 href，供診斷——病症就寫在這裡。 */
  readonly href: string;
  /**
   * href 解析之後指向哪裡。落在封裝內時帶著 `path` 與 `fragment`，那就是消費端
   * 跳轉要的兩個值。
   *
   * 型別直接沿用解析器的產物，而不是攤成 `path?` 與 `fragment?`：TOC 指到遠端
   * （書裡放了外部連結）或指到封裝外（書寫壞了）都不該讓一本書開不起來，而把
   * 那兩種都壓成 `undefined` 會讓消費端分不出「這是外部連結」與「這本書的目錄
   * 寫壞了」。
   */
  readonly target: ResolvedHref;
  readonly children: readonly TocItem[];
}

export interface Toc {
  readonly items: readonly TocItem[];
  /** 一份導覽文件都找不到時是 `undefined`，此時 `items` 是空的。 */
  readonly readFrom: NavigationDocument | undefined;
}

const NCX_MEDIA_TYPE = "application/x-dtbncx+xml";

/** 空的 TOC。一本沒有目錄的書仍然讀得完（ADR-0010）。 */
const NO_TOC: Toc = { items: [], readFrom: undefined };

export function readToc(
  packageDocument: PackageDocument,
  resources: ReadonlyMap<string, Resource>,
  container: EpubContainer,
): Toc {
  const navigation = pickNavigationDocument(packageDocument, resources);
  if (navigation === undefined) return NO_TOC;

  const document = parseXml(container.text(navigation.path), {
    reason: "malformed-navigation-document",
    label: navigation.path,
  });

  const items =
    navigation.vehicle === "ncx"
      ? collectNcx(document.child("ncx")?.child("navMap"))
      : collectNav(pickTocNav(document));

  return { items: resolveTargets(items, navigation.path), readFrom: navigation };
}

/**
 * 哪一份檔案承載這本書的 TOC。順序照 ADR-0010〈導覽文件的優先順序〉：
 *
 * 1. 宣告 3.x 時 `properties="nav"` 贏，NCX 完全忽略
 * 2. 宣告 2.x 時只有 NCX 這條路
 * 3. 宣告 3.x 卻找不到 nav 時**退回 NCX**，不丟錯
 *
 * 「找得到」的意思包含**那一項真的在壓縮檔裡**：宣告了卻缺檔的導覽文件與沒有
 * 宣告是同一格（少的是目錄不是內容），所以這裡繼續往下找而不是丟錯。
 *
 * ## NCX 的兩種指法
 *
 * `<spine toc>` 是封裝文件對 NCX 的正式指法，但**書不一定寫**：那 33 本書全部
 * 在 manifest 上宣告了 NCX，只有 27 本用 `<spine toc>` 指向它——6 本只能靠
 * media type 找到。那 6 本都有 nav 所以實際上走不到第 3 條，但少了 media type
 * 這條後援，一本「宣告 3.x、沒有 nav、NCX 也沒被指到」的書就會沒有目錄，而它的
 * 每一個零件在野外都是常態。
 *
 * media type 不是在發明第四條規則：ADR-0010 說的是「哪一份載體贏」，沒有說
 * 「怎麼在 manifest 裡認出它」，而 `application/x-dtbncx+xml` 是 NCX 的註冊
 * media type，一本書裡不會有第二個候選。（`tests/node/support/epub-archive.ts`
 * 刻意**不**做這條後援，理由相反：那一層讀的是我們自己產的 fixture，寬容會讓
 * 產生器漏寫 `<spine toc>` 時沒有東西亮紅燈。）
 */
function pickNavigationDocument(
  packageDocument: PackageDocument,
  resources: ReadonlyMap<string, Resource>,
): NavigationDocument | undefined {
  const pathOf = (resource: Resource | undefined): string | undefined =>
    resource?.location.kind === "in-container" ? resource.location.path : undefined;

  if (packageDocument.metadata.epubVersion === "epub3") {
    const nav = [...resources.values()].find((resource) =>
      resource.properties.includes("nav"),
    );
    const path = pathOf(nav);
    if (path !== undefined) return { vehicle: "nav", path };
  }

  const declared =
    packageDocument.readingOrderTocId === undefined
      ? undefined
      : resources.get(packageDocument.readingOrderTocId);
  const ncx =
    declared ??
    [...resources.values()].find((resource) => resource.mediaType === NCX_MEDIA_TYPE);

  const path = pathOf(ncx);
  return path === undefined ? undefined : { vehicle: "ncx", path };
}

/**
 * `nav.xhtml` 裡的哪一個 `<nav>` 是 TOC。
 *
 * 靠 `epub:type="toc"` 認（命名空間前綴由 `xml.ts` 剝掉，所以屬性名是 `type`）。
 * 量到的：31 本有 nav 的書裡 **27 本的導覽文件不只一個 `<nav>`**（多半還有
 * landmarks 與 page-list），而 31 本全部都在 TOC 那一個上宣告了 `epub:type`。
 * 拿第一個 `<nav>` 當 TOC 的實作會在那 27 本上有機會撿到別的清單。
 *
 * 找不到宣告時退回第一個 `<nav>`——那是「書沒說」而不是「書沒有目錄」，而樣本
 * 裡沒有一本落在這一格，所以這條後援是為了未量到的書留的，不是為了樣本。
 *
 * `<nav>` 一律當成 `<body>` 的直接子元素找（量到的：31/31 都是）。往下遞迴找
 * 的話會多收到內容文件裡的清單，那不是 TOC。
 */
function pickTocNav(document: XmlElement): XmlElement | undefined {
  const navs = document.child("html")?.child("body")?.children("nav") ?? [];
  return (
    navs.find((nav) => (nav.attribute("type") ?? "").split(/\s+/).includes("toc")) ??
    navs[0]
  );
}

/** 尚未解析 href 的一個節點。 */
interface RawTocItem {
  readonly label: string;
  readonly href: string;
  readonly children: readonly RawTocItem[];
}

/**
 * `nav.xhtml` 的 TOC：`<ol>` 裡的每個 `<li>` 是一項，標籤與位置同在 `<a>` 上，
 * 子清單是**開在 `<li>` 裡面**的另一個 `<ol>`。
 *
 * 「裡面」是重點：放成 `<li>` 的兄弟時 XHTML 一樣良構、瀏覽器一樣畫得出來，但
 * 那棵樹是平的。照 `<li>` 的邊界收子項目，放錯位置的書就會在深度上看得出來。
 *
 * 沒有 `<a>` 的 `<li>`（EPUB 3 允許用 `<span>` 表示不可跳轉的標題）跳過不收：
 * 樣本裡一個都沒有，而收了它就要發明一個「沒有位置的目錄項目」的表述。
 */
function collectNav(nav: XmlElement | undefined): readonly RawTocItem[] {
  const items = (list: XmlElement | undefined): readonly RawTocItem[] =>
    (list?.children("li") ?? []).flatMap((li) => {
      const anchor = li.child("a");
      if (anchor === undefined) return [];
      return [
        {
          label: anchor.text().trim(),
          href: anchor.attribute("href") ?? "",
          children: items(li.child("ol")),
        },
      ];
    });

  return items(nav?.child("ol"));
}

/**
 * NCX 的 TOC：標籤在 `<navLabel><text>`，位置在 `<content src>`，兩者是 navPoint
 * 的兩個**不同**子元素——湊錯（例如拿 navPoint 的 id 當標籤）在平的 TOC 上看
 * 不出來。層次是 navPoint 直接套 navPoint，中間沒有容器元素。
 *
 * `playOrder` 不讀：frond 依文件順序，而 ADR-0010 把 NCX 的 `pageList` 與
 * `navList` 排除在 v1 之外，`playOrder` 同理——它是 NCX 自己宣告的順序，與文件
 * 順序在合規的書裡一致，不一致時沒有理由相信它。
 */
function collectNcx(navMap: XmlElement | undefined): readonly RawTocItem[] {
  return (navMap?.children("navPoint") ?? []).map((navPoint) => ({
    label: navPoint.child("navLabel")?.child("text")?.text().trim() ?? "",
    href: navPoint.child("content")?.attribute("src") ?? "",
    children: collectNcx(navPoint),
  }));
}

/** 把每一項的 href 解析成壓縮檔內的位置，層次原樣保留。 */
function resolveTargets(
  items: readonly RawTocItem[],
  navigationPath: string,
): readonly TocItem[] {
  return items.map((item) => ({
    label: item.label,
    href: item.href,
    target: resolveHref(item.href, navigationPath),
    children: resolveTargets(item.children, navigationPath),
  }));
}
