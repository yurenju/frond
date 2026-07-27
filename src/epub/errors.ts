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
  /**
   * 是 ZIP，但用了 frond 不讀的功能：ZIP64、加密、deflate 以外的壓縮方法、
   * 多磁碟區（`src/epub/zip.ts`）。
   *
   * **與 `not-a-zip` 分開，因為書櫃該做的事不同**：那一格代表這個檔案根本不是
   * 書，可以直接不收；這一格代表這確實是一本書，只是 frond 開不了它——那值得
   * 讓讀者知道，也值得回報上來。
   */
  | "unsupported-zip-feature"
  /** ZIP 開得起來，但裡面沒有 `META-INF/container.xml`，所以不是 OCF 容器。 */
  | "missing-container"
  /**
   * `META-INF/` 底下的容器層檔案壞了：`container.xml` 不是良構的 XML、沒有指出
   * 封裝文件，或 `encryption.xml` 不是良構的 XML。
   */
  | "malformed-container"
  /** 容器指到的封裝文件不在壓縮檔內。 */
  | "missing-package-document"
  /** 封裝文件不是良構的 XML，或缺少必要的元素。 */
  | "malformed-package-document"
  /** 封裝格式的版本不在支援範圍內（ADR-0010：OEBPS 1.2 與 OEB 1.0 明確拒絕）。 */
  | "unsupported-package-version"
  /**
   * 導覽文件（`nav.xhtml` 或 `toc.ncx`）不是良構的 XML。
   *
   * 這一格**是錯誤而不是空 TOC**，與「一份導覽文件都沒有」不同：沒有宣告、或
   * 宣告了卻缺檔，都只是這本書沒有目錄；而宣告了、檔案也在、卻讀不動，是這本
   * 書壞了。量到的依據是那 33 本書的導覽文件（兩種載體）**全部良構**——放寬
   * 這一格買不到任何一本已知的書，卻會讓「目錄整份讀不出來」變成靜默的。
   */
  | "malformed-navigation-document"
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

/**
 * 取一份資源的位元組失敗的原因。
 *
 * 與 `EpubOpenFailure` 分開，因為**時機不同**：那些是開書時的壞法，一發生就沒有
 * `EpubBook` 實例；這些發生在書已經開好之後，只有那一項資源拿不到。一本帶著不
 * 支援的混淆字型的書照樣開得起來、照樣讀得完——讀者要的是書打得開（ADR-0010）。
 */
export type EpubResourceFailure =
  /** 壓縮檔內沒有這個路徑。 */
  | "missing-resource"
  /**
   * 這一項被混淆過，但不是 IDPF 那套演算法。
   *
   * **不吐出壞掉的位元組。** 一個壞字型檔在畫面上的症狀是滿頁豆腐字，而那時候
   * 沒有人查得到根因在解碼——所以這裡寧可讓消費端拿到一個說得出原因的錯誤。
   */
  | "unsupported-obfuscation"
  /** 這一項被 IDPF 演算法混淆過，但這本書沒有 unique identifier，金鑰推不出來。 */
  | "missing-obfuscation-key";

/** 取一份資源的位元組失敗。書仍然是開著的。 */
export class EpubResourceError extends Error {
  readonly reason: EpubResourceFailure;

  constructor(reason: EpubResourceFailure, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EpubResourceError";
    this.reason = reason;
  }
}
