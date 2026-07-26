import { zipSync } from "fflate";

/**
 * 手工組出一本書的位元組，供 `EpubBook` 的測試餵那些**沒有 fixture 的形狀**。
 *
 * 合成 fixture（`tests/fixtures/*.epub`）是主力，一個病症一個檔（ADR-0007），
 * 而它們一律是**合規且開得起來**的書——產生器連「EPUB 2 帶 page-progression-
 * direction」這種組合都擋著不讓產出。壞書因此在那一層產不出來：不是 zip、缺
 * `META-INF/container.xml`、OPF 指向不存在的檔案，這些形狀沒有一種能由那支產生器
 * 表達，而它們正是本票錯誤處理那條驗收要餵的東西。
 *
 * 所以這裡的書**逐位元組由測試自己寫**：OPF 的全文寫在測試裡，這一層只負責打包。
 * 這也讓斷言的期望值有獨立來源——不是拿產生器的反向操作去驗它自己。
 *
 * 這批書刻意**不進 `tests/fixtures/`**：它們只服務單一條錯誤路徑，不需要跨
 * runner 共用，也不該佔一個「病症」的名字。真正需要進 repo 的形狀（例如
 * manifest 的 `../`）由 #23 產。
 */

export interface HandmadeEntry {
  /** 壓縮檔內的路徑，一律以 `/` 分隔。 */
  readonly path: string;
  readonly contents: string | Uint8Array;
}

export interface HandmadeBook {
  /** 封裝文件在壓縮檔內的位置。省略時是 `OEBPS/content.opf`。 */
  readonly packageDocumentPath?: string;
  /** 封裝文件的全文。 */
  readonly packageDocument: string;
  /**
   * 覆寫 `META-INF/container.xml` 的內容。省略時寫一份指向
   * `packageDocumentPath` 的合規容器；給 `null` 則整份不寫（缺容器的壞書）。
   */
  readonly container?: string | null;
  /** 除了容器與封裝文件之外還要放進去的項目。 */
  readonly entries?: readonly HandmadeEntry[];
}

export function handmadeBook(book: HandmadeBook): Uint8Array {
  const packageDocumentPath = book.packageDocumentPath ?? "OEBPS/content.opf";
  const entries: HandmadeEntry[] = [
    { path: "mimetype", contents: "application/epub+zip" },
    ...(book.container === null
      ? []
      : [
          {
            path: "META-INF/container.xml",
            contents: book.container ?? containerXml(packageDocumentPath),
          },
        ]),
    { path: packageDocumentPath, contents: book.packageDocument },
    ...(book.entries ?? []),
  ];

  return pack(entries);
}

/** 把項目打包成 ZIP，不加任何 EPUB 的假設——連 `mimetype` 都不補。 */
export function pack(entries: readonly HandmadeEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {};
  for (const entry of entries) {
    files[entry.path] =
      typeof entry.contents === "string"
        ? encoder.encode(entry.contents)
        : entry.contents;
  }
  // level 0（stored）：這批書不進 repo，體積無所謂，而未壓縮的位元組在測試失敗
  // 時可以直接用眼睛看。
  return zipSync(files, { level: 0 });
}

function containerXml(packageDocumentPath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${packageDocumentPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

/**
 * 一份最小但合規的 EPUB 3 封裝文件。
 *
 * 需要「除了某一處以外都健康」的壞書時從這裡改一處——與 fixture 產生器同一條
 * 紀律（單點差異），只是這裡的單點差異寫在測試裡而不是病症清單裡。
 */
export function packageDocument(options: {
  readonly version?: string;
  readonly metadata?: string;
  readonly manifest?: string;
  readonly readingOrder?: string;
  readonly readingOrderAttributes?: string;
}): string {
  const version = options.version ?? "3.0";
  const metadata =
    options.metadata ??
    `    <dc:identifier id="pub-id">urn:uuid:frond-handmade</dc:identifier>
    <dc:title>手で組んだ本</dc:title>
    <dc:language>ja</dc:language>`;
  const manifest =
    options.manifest ??
    `    <item id="section-1" href="section-1.xhtml" media-type="application/xhtml+xml"/>`;
  const readingOrder = options.readingOrder ?? `    <itemref idref="section-1"/>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${metadata}
  </metadata>
  <manifest>
${manifest}
  </manifest>
  <spine${options.readingOrderAttributes ?? ""}>
${readingOrder}
  </spine>
</package>
`;
}

/** 一份最小的 XHTML 內容文件。 */
export function sectionDocument(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ja" lang="ja">
  <head><meta charset="utf-8"/><title>${title}</title></head>
  <body><p>${title}</p></body>
</html>
`;
}
