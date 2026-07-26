/**
 * 把封裝文件裡的 `href` 對應到壓縮檔內的項目名稱。
 *
 * **這不是字串接合。** `href` 是 URL 而不是檔案系統路徑，要照 URL 的規則相對於
 * 引用它的那份文件解析。實證（#8 的留言）：一本 Kobo 通路的 EPUB 3，OPF 在
 * `OEBPS/content.opf`，manifest 裡有
 *
 * ```xml
 * <item id="js-kobo.js" href="../js/kobo.js" media-type="application/javascript"/>
 * ```
 *
 * 而 `js/kobo.js` 確實存在於封裝根。`OEBPS/` 接上 `../js/kobo.js` 得到的字面
 * `OEBPS/../js/kobo.js` 不是任何一個 ZIP 項目的名字，於是字串接合的實作會把這本
 * **合規的書**判成「OPF 指向不存在的檔案」。
 *
 * 借 WHATWG `URL` 的解析規則（零 DOM 依賴，Node 與瀏覽器都有它），它同時處理
 * `../` 與 percent-encoding——後者是另一個病症（`toc-href-percent-comma`）。
 *
 * ## 為什麼要一個哨兵目錄
 *
 * `URL` 在根目錄把多餘的 `..` 吃掉：`../../x` 相對於 `/OEBPS/a.opf` 解析成
 * `/x`，而不是失敗。那正好讓「跳出封裝根」這種不合規（也是路徑穿越的形狀）變得
 * 看不見。所以基底多墊一層哨兵目錄：解析後還在哨兵底下的才在封裝內，被吃掉那
 * 一層的就是跳出去了。
 */

const ORIGIN = "https://frond.invalid";

/** 墊在封裝根之上的一層。名字不會出現在任何回傳值裡。 */
const SENTINEL = "/__container__/";

export type ResolvedHref =
  /** 解析後落在封裝內，`path` 是壓縮檔內的項目名稱。 */
  | { readonly kind: "in-container"; readonly path: string }
  /** 絕對 URL——不在這個壓縮檔裡。EPUB 3 允許遠端資源，frond 不下載它。 */
  | { readonly kind: "remote"; readonly url: string }
  /** 解析後跳出封裝根。不合規。 */
  | { readonly kind: "outside-container" };

/**
 * @param href 原樣照抄的 href
 * @param fromArchivePath 引用它的那份文件在壓縮檔內的路徑
 */
export function resolveHref(href: string, fromArchivePath: string): ResolvedHref {
  const base = new URL(`${SENTINEL}${fromArchivePath}`, ORIGIN);

  let resolved: URL;
  try {
    resolved = new URL(href, base);
  } catch {
    // `URL` 只有在完全解析不出來時才丟——例如 href 是空字串以外的無效
    // 絕對 URL（`http://[`）。那種書的這一項指不到任何東西。
    return { kind: "outside-container" };
  }

  if (resolved.origin !== base.origin) {
    return { kind: "remote", url: resolved.href };
  }
  if (!resolved.pathname.startsWith(SENTINEL)) {
    return { kind: "outside-container" };
  }

  return {
    kind: "in-container",
    path: decodePath(resolved.pathname.slice(SENTINEL.length)),
  };
}

/**
 * ZIP 的項目名稱是原始位元組，不是 percent-encoded 的 URL，所以解析完要還原。
 *
 * 還原不了的（`%zz` 這種壞編碼）就原樣留著——那本書的 href 本來就寫壞了，而
 * 「查不到這個項目」比「開書時丟一個 `URIError`」好懂。
 */
function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}
