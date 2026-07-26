/**
 * 開書失敗的原因。
 *
 * 這是一個**封閉的字串聯集**而不是自由文字：訊息是給人看的，會隨著措辭改寫，
 * 消費端不該去比對它。書櫃要能在拿到錯誤時分辨「這個檔案根本不是書」與「這本書
 * 的封裝壞了」——前者可以直接不收進書櫃，後者值得提示讀者這本書有問題。
 */
export type EpubOpenFailure =
  /** 位元組不是 ZIP——最常見的是拿到別的檔案，或下載到一半。 */
  | "not-a-zip"
  /** ZIP 開得起來，但裡面沒有 `META-INF/container.xml`，所以不是 OCF 容器。 */
  | "missing-container"
  /** 容器在，但不是良構的 XML 或沒有指出封裝文件。 */
  | "malformed-container"
  /** 容器指到的封裝文件不在壓縮檔內。 */
  | "missing-package-document"
  /** 封裝文件不是良構的 XML，或缺少必要的元素。 */
  | "malformed-package-document"
  /** 封裝格式的版本不在支援範圍內（ADR-0010：OEBPS 1.2 與 OEB 1.0 明確拒絕）。 */
  | "unsupported-package-version"
  /** manifest 指向壓縮檔內不存在的檔案。 */
  | "missing-resource"
  /** manifest 的 href 解析之後跳出封裝根——不合規，也是路徑穿越的形狀。 */
  | "resource-outside-container"
  /** readingOrder 指向 manifest 沒有的 id，那一格內容不存在。 */
  | "unknown-reading-order-item";

/**
 * 開書失敗。**明確的錯誤，而不是靜默失敗或半開的狀態**（#8）——`EpubBook` 要嘛
 * 完整地開起來，要嘛丟這個錯，不存在「開了一半」的實例。
 */
export class EpubOpenError extends Error {
  readonly reason: EpubOpenFailure;

  constructor(reason: EpubOpenFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EpubOpenError";
    this.reason = reason;
  }
}
