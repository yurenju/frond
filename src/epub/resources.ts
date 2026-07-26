import type { EpubContainer } from "./container.ts";
import { EpubOpenError } from "./errors.ts";
import type { ManifestItem } from "./package-document.ts";
import { resolveHref } from "./resource-path.ts";

/**
 * manifest 宣告的資源——**宣告在哪裡**，以及那裡**有沒有東西**。
 *
 * 這一層是「書怎麼宣告」與「檔案在哪裡」之間的那一刀：上面的 `EpubBook` 只問
 * 「id 是這個的資源在哪裡」，不必再碰 href、相對解析或壓縮檔。
 *
 * ## 宣告了卻不在壓縮檔裡，不等於這本書開不起來
 *
 * 這一層**不因為缺檔而拒絕整本書**。缺檔只在那一項落在 readingOrder 上時才致命
 * ——那時讀者是真的少了一段內容，由 `epub-book.ts` 丟 `missing-resource`。
 *
 * 依據是量到的數字，不是推論。拿樣本那 33 本繁中／簡中商業書打過兩輪：
 *
 * - 照原本「manifest 缺任一項就拒開」的規則，**33/33 全開得起來**——這批書裡沒有
 *   一本是靠那條規則擋下來的，它的收益是零
 * - 把任何一項**不在 readingOrder 上**的資源從壓縮檔裡拿掉（一張插圖、一份 CSS、
 *   一份 NCX），**33/33 整本開不起來**。而這批書的 manifest 共 3045 項，其中
 *   **1467 項**不在 readingOrder 上，每一項都是一個能讓整本書打不開的單點
 *
 * 一本漏了裝飾用插圖的書仍然讀得完，而「這本書打不開」是讀者最不能接受的失效
 * 方式。權衡的方向由 ADR-0010 定：讀者要的是書打得開。
 *
 * 跳出封裝根（`resource-outside-container`）**仍然當場拒書**。它與缺檔不同：那是
 * 不合規，也是路徑穿越的形狀，而樣本裡一本都沒有——放寬它沒有任何量到的好處。
 */
export interface Resource {
  readonly id: string;
  readonly location: ResourceLocation;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

/**
 * 一項資源實際落在哪裡。
 *
 * 「宣告的位置」與「那裡有沒有東西」分開表達，因為兩者的處置不同：缺檔要不要
 * 致命取決於誰在用它，而遠端資源在 manifest 上本來就合規。把兩者都壓成
 * `path: undefined` 會讓上層分不出「書寫錯了」與「這一項本來就不在包裡」。
 */
export type ResourceLocation =
  /** 在壓縮檔內，而且那一項確實存在。 */
  | { readonly kind: "in-container"; readonly path: string }
  /** 解析得出壓縮檔內的位置，但那一項不存在。`path` 是書宣告的位置，供診斷。 */
  | { readonly kind: "missing"; readonly path: string }
  /** 絕對 URL。EPUB 3 允許遠端資源（`properties="remote-resources"`），frond 不下載它。 */
  | { readonly kind: "remote" };

export function resolveResources(
  manifest: readonly ManifestItem[],
  container: EpubContainer,
): ReadonlyMap<string, Resource> {
  const resources = new Map<string, Resource>();

  for (const item of manifest) {
    const resolved = resolveHref(item.href, container.packageDocumentPath);

    if (resolved.kind === "outside-container") {
      throw new EpubOpenError(
        "resource-outside-container",
        `manifest 的 ${item.id} 指向封裝外：href="${item.href}"`,
      );
    }

    resources.set(item.id, {
      id: item.id,
      location:
        resolved.kind === "remote"
          ? { kind: "remote" }
          : container.has(resolved.path)
            ? { kind: "in-container", path: resolved.path }
            : { kind: "missing", path: resolved.path },
      mediaType: item.mediaType,
      properties: item.properties,
    });
  }

  return resources;
}
