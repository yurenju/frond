import type { EpubContainer } from "./container.ts";
import { EpubOpenError } from "./errors.ts";
import type { ManifestItem } from "./package-document.ts";
import { resolveHref } from "./resource-path.ts";

/**
 * manifest 宣告的資源，**每一項都已經對應到壓縮檔內真實存在的項目**。
 *
 * 這一層是「書怎麼宣告」與「檔案在哪裡」之間的那一刀：上面的 `EpubBook` 只問
 * 「id 是這個的資源在哪裡」，不必再碰 href、相對解析或壓縮檔。
 *
 * ## 為什麼在開書時就整份查一次
 *
 * 「OPF 指向不存在的檔案」是本票要給明確錯誤的三種壞書之一（#8）。等到讀者翻到
 * 那一頁才發現，錯誤會在離原因很遠的地方冒出來——那正是「靜默失敗或半開的
 * 狀態」。整份查一次的代價只是一次雜湊表查表乘上 manifest 的長度。
 */
export interface Resource {
  readonly id: string;
  /** 壓縮檔內的路徑。遠端資源沒有本地路徑，是 `undefined`。 */
  readonly path: string | undefined;
  readonly mediaType: string;
  readonly properties: readonly string[];
}

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
    if (resolved.kind === "in-container" && !container.has(resolved.path)) {
      throw new EpubOpenError(
        "missing-resource",
        `manifest 的 ${item.id} 指向壓縮檔內不存在的 ${resolved.path}（href="${item.href}"）`,
      );
    }

    resources.set(item.id, {
      id: item.id,
      // 遠端資源在 EPUB 3 是合規的（宣告 properties="remote-resources" 的影音）。
      // frond 這一刀不下載它，但也不能因為它而拒絕整本書。
      path: resolved.kind === "in-container" ? resolved.path : undefined,
      mediaType: item.mediaType,
      properties: item.properties,
    });
  }

  return resources;
}
