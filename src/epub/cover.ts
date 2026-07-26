import type { EpubContainer } from "./container.ts";
import type { Resource } from "./resources.ts";

/**
 * 封面圖——書櫃的縮圖來源。
 *
 * **先 `properties="cover-image"`，再 `<meta name="cover">`，兩者都沒有就是這本書
 * 沒有封面**（ADR-0010）。順序是這樣，但**不按版本分派**：樣本裡有一本 EPUB 3 的
 * 封面只有舊寫法，按版本分派的實作會讓那本書沒有封面。
 *
 * 「沒有封面」不是錯誤。指到的 id 不存在、或那個資源拿不到位元組時同樣回報沒有
 * 封面——書的封裝宣告與內容不一致是常態，而一本指壞了封面的書仍然讀得完。
 */
export interface CoverImage {
  /** 壓縮檔內的路徑，供診斷用。 */
  readonly path: string;
  readonly mediaType: string;
  /** 書櫃要的是圖本身，不是一個路徑——它手上只有這本書的位元組。 */
  readonly bytes: Uint8Array;
  /** 是哪一種寫法找到它的。兩條路都走得通，而回報走的是哪一條讓它可觀測。 */
  readonly foundBy: CoverNotation;
}

export type CoverNotation = "cover-image-property" | "meta-name";

export function readCover(
  resources: ReadonlyMap<string, Resource>,
  coverMetaId: string | undefined,
  container: EpubContainer,
): CoverImage | undefined {
  const byProperty = [...resources.values()].find((resource) =>
    resource.properties.includes("cover-image"),
  );
  const byMeta = coverMetaId === undefined ? undefined : resources.get(coverMetaId);

  // 依序試，**取不到就換下一條**——「找到一個宣告」與「拿得到那張圖」是兩件事，
  // 把前者當成後者會讓一本兩種寫法都寫了、而新寫法指到遠端（或指到一張不在包裡
  // 的圖）的書沒有封面。
  for (const [resource, foundBy] of [
    [byProperty, "cover-image-property"],
    [byMeta, "meta-name"],
  ] as const) {
    if (resource?.location.kind !== "in-container") continue;
    return {
      path: resource.location.path,
      mediaType: resource.mediaType,
      bytes: container.bytes(resource.location.path),
      foundBy,
    };
  }

  return undefined;
}
