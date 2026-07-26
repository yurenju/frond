import { unzipSync } from "fflate";
import { EpubOpenError } from "./errors.ts";
import { parseXml } from "./xml.ts";

/**
 * OCF 容器——一本 EPUB 的外殼：一個 ZIP，加上 `META-INF/container.xml` 指出封裝
 * 文件在哪裡。
 *
 * 這一層之所以自成一個模組，是因為它是**唯一知道「書是一個壓縮檔」的地方**。
 * 它之上的每一層都只看得到「路徑 → 位元組」這張表，於是解壓的實作（現在是
 * fflate 全解到記憶體）可以換成串流或 range request，而不必動到任何解析的
 * 程式碼。
 *
 * 零 DOM 依賴（ADR-0005）：fflate 是純 JS，`URL` 是 WHATWG 的標準物件，兩者在
 * Node 與瀏覽器都在。
 */

const CONTAINER_PATH = "META-INF/container.xml";

export interface EpubContainer {
  /** 封裝文件（OPF）在壓縮檔內的路徑。 */
  readonly packageDocumentPath: string;
  /** 壓縮檔內所有項目的路徑，供診斷用。 */
  readonly entryPaths: readonly string[];
  has(path: string): boolean;
  bytes(path: string): Uint8Array;
  text(path: string): string;
}

export function openContainer(archive: Uint8Array): EpubContainer {
  const entries = unzip(archive);
  const decoder = new TextDecoder();

  const has = (path: string): boolean => entries[path] !== undefined;
  const bytes = (path: string): Uint8Array => {
    const found = entries[path];
    if (found === undefined) {
      throw new EpubOpenError(
        "missing-resource",
        `壓縮檔內沒有 ${path}`,
      );
    }
    return found;
  };
  const text = (path: string): string => decoder.decode(bytes(path));

  if (!has(CONTAINER_PATH)) {
    // 沒有 container.xml 就沒有入口。一個沒有它的 ZIP 可能是任何東西——
    // 一個 .cbz、一個 .docx、一個作者自己壓的資料夾。
    throw new EpubOpenError(
      "missing-container",
      `這個壓縮檔沒有 ${CONTAINER_PATH}，不是 EPUB 的 OCF 容器`,
    );
  }

  const packageDocumentPath = readPackageDocumentPath(text(CONTAINER_PATH));
  if (!has(packageDocumentPath)) {
    // 容器指到一個不存在的封裝文件。這與「manifest 指向不存在的檔案」是兩件
    // 不同的壞法：這裡壞的是入口本身，整本書一頁都讀不到。
    throw new EpubOpenError(
      "missing-package-document",
      `${CONTAINER_PATH} 指向 ${packageDocumentPath}，但壓縮檔內沒有這一項`,
    );
  }

  return {
    packageDocumentPath,
    entryPaths: Object.keys(entries),
    has,
    bytes,
    text,
  };
}

function unzip(archive: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(archive);
  } catch (cause) {
    throw new EpubOpenError(
      "not-a-zip",
      "這些位元組不是 ZIP，EPUB 的容器格式是 ZIP",
      { cause },
    );
  }
}

/**
 * `container.xml` 裡的第一個 rootfile 就是封裝文件。
 *
 * OCF 允許多個 rootfile（同一份內容的多種表述），但 EPUB 規定第一個
 * `application/oebps-package+xml` 的那一個是**這本書**。frond 只讀那一個。
 */
function readPackageDocumentPath(source: string): string {
  const container = parseXml(source, {
    reason: "malformed-container",
    label: CONTAINER_PATH,
  });

  const rootfiles = container.child("container")?.child("rootfiles");
  const fullPath = rootfiles?.children("rootfile")[0]?.attribute("full-path");
  if (fullPath === undefined || fullPath === "") {
    throw new EpubOpenError(
      "malformed-container",
      `${CONTAINER_PATH} 沒有指出封裝文件的位置（<rootfile full-path>）`,
    );
  }
  return fullPath;
}
