import { sha1, SHA1_LENGTH } from "../sha1.ts";
import type { EpubContainer } from "./container.ts";
import { EpubResourceError } from "./errors.ts";
import { resolveHref } from "./resource-path.ts";
import { parseXml } from "./xml.ts";

/**
 * 混淆過的字型——書把字型檔的開頭幾個位元組打亂，讓它不能被當成一份獨立的字型
 * 取用。**這不是加密**：演算法是公開的，金鑰就寫在書裡（是書自己的 unique
 * identifier），目的是嵌入授權而不是保密。
 *
 * 哪些項目被混淆、用哪一套，宣告在 `META-INF/encryption.xml` 裡。
 *
 * ## 支援的邊界：只做 IDPF 那一套
 *
 * | 演算法 | URI | frond |
 * | --- | --- | --- |
 * | IDPF（EPUB 規格自己定的） | `http://www.idpf.org/2008/embedding` | 解得開 |
 * | Adobe | `http://ns.adobe.com/pdf/enc#RC` | **明確錯誤** |
 * | 其他（DRM 之類真的加密） | — | **明確錯誤** |
 *
 * 兩套的金鑰推導與長度都不同（IDPF：identifier 去空白後取 SHA-1 得 20 位元組，
 * 蓋前 1040 個位元組；Adobe：把 identifier 裡的 UUID 當十六進位讀成 16 位元組，
 * 蓋前 1024 個），所以拿一套去解另一套**一定**得到壞位元組，而不是「差不多」。
 *
 * **實證的狀態要講清楚：本專案沒有取得任何混淆字型的實證。** 那 33 本樣本裡
 * `META-INF/encryption.xml` 一本都沒有，內嵌字型也是零本——所以「哪一套比較常見」
 * 這件事在這裡既沒被證實也沒被否證，這條邊界是照規格劃的，不是照量到的數字。
 * 這與 ADR-0010 對 `primary-writing-mode` 的處理是同一種紀律：沒有實證就說沒有，
 * 不假裝有。
 *
 * **要翻案需要什麼**：一本 Adobe 那套的書。屆時要補的是金鑰推導與長度兩處，
 * 以及一份新的合成 fixture（ADR-0007：一個病症一個檔），不是把這裡的錯誤拿掉。
 */

/** OCF 宣告混淆與加密的地方。 */
const ENCRYPTION_PATH = "META-INF/encryption.xml";

/** `CipherReference URI` 的基底是封裝根，與 `container.xml` 的 `full-path` 相同。 */
const CONTAINER_ROOT = "";

/** IDPF 的字型混淆演算法。 */
const IDPF_ALGORITHM = "http://www.idpf.org/2008/embedding";

/** IDPF 只蓋檔案開頭這麼多位元組，其餘原樣——52 × 20，剛好是金鑰的整數倍。 */
const IDPF_OBFUSCATED_LENGTH = 1040;

export interface FontObfuscation {
  /**
   * 這一項若被混淆過就還原，否則原樣回傳。
   *
   * 做成「問一次就好」而不是「先問有沒有、再自己解」，是因為後者會讓每一個取
   * 位元組的地方都要記得問——而漏問的症狀是滿頁豆腐字，不是例外。
   */
  restore(path: string, bytes: Uint8Array): Uint8Array;
}

/**
 * 讀 `META-INF/encryption.xml`，得到「這本書的哪些項目被混淆過」。
 *
 * 沒有這個檔案是常態（樣本裡 33 本全部沒有），此時每一項都原樣回傳。
 */
export function readFontObfuscation(
  container: EpubContainer,
  identifier: string | undefined,
): FontObfuscation {
  const declarations = container.has(ENCRYPTION_PATH)
    ? readDeclarations(container.text(ENCRYPTION_PATH))
    : new Map<string, string>();

  return {
    restore(path, bytes) {
      const algorithm = declarations.get(path);
      if (algorithm === undefined) return bytes;
      if (algorithm !== IDPF_ALGORITHM) {
        throw new EpubResourceError(
          "unsupported-obfuscation",
          `${path} 用 ${algorithm} 混淆或加密過，frond 只解得開 IDPF 那一套（${IDPF_ALGORITHM}）`,
        );
      }
      if (identifier === undefined) {
        throw new EpubResourceError(
          "missing-obfuscation-key",
          `${path} 是 IDPF 混淆過的，但這本書沒有 unique identifier，金鑰推不出來`,
        );
      }
      return unmask(bytes, idpfKey(identifier));
    },
  };
}

/** 壓縮檔內的路徑 → 宣告的演算法 URI。 */
function readDeclarations(source: string): ReadonlyMap<string, string> {
  const document = parseXml(source, {
    reason: "malformed-container",
    label: ENCRYPTION_PATH,
  });

  const declarations = new Map<string, string>();
  for (const data of document.child("encryption")?.children("EncryptedData") ?? []) {
    const algorithm = data.child("EncryptionMethod")?.attribute("Algorithm");
    const uri = data.child("CipherData")?.child("CipherReference")?.attribute("URI");
    if (algorithm === undefined || uri === undefined) continue;

    // URI 是相對於封裝根的 URL，一樣可能被編碼過（字型的檔名常帶空白），所以
    // 走與 manifest、TOC 同一條解析。
    const resolved = resolveHref(uri, CONTAINER_ROOT);
    if (resolved.kind !== "in-container") continue;
    declarations.set(resolved.path, algorithm);
  }
  return declarations;
}

/**
 * IDPF 的金鑰：unique identifier **去掉所有空白**之後的 UTF-8 位元組取 SHA-1。
 *
 * 去空白是規格明訂的（U+0020、U+0009、U+000D、U+000A）——書把 identifier 折行
 * 寫在 XML 裡是常見的，不去掉的話同一本書在不同排版下會推出不同的金鑰。
 */
function idpfKey(identifier: string): Uint8Array {
  // 逐個列出規格點名的那四個碼位，而不是寫 `\s`：`\s` 還包含 U+00A0 之類的
  // 空白，多去掉一個字元就是一把完全不同的金鑰。
  const stripped = identifier.replaceAll(/[\u0020\u0009\u000d\u000a]/g, "");
  return sha1(new TextEncoder().encode(stripped));
}

/**
 * 把金鑰循環蓋在檔案開頭的 1040 個位元組上。XOR 自己是自己的反運算，所以混淆與
 * 還原是同一個動作——但**只有前 1040 個位元組**，蓋過頭會毀掉字型的其餘部分。
 */
function unmask(bytes: Uint8Array, key: Uint8Array): Uint8Array {
  const restored = Uint8Array.from(bytes);
  const end = Math.min(restored.length, IDPF_OBFUSCATED_LENGTH);
  for (let index = 0; index < end; index += 1) {
    restored[index] = restored[index]! ^ key[index % SHA1_LENGTH]!;
  }
  return restored;
}
