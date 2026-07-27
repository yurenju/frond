import { unzipSync, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { EpubOpenError } from "../../../src/epub/errors.ts";
import { readZip } from "../../../src/epub/zip.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * 手寫的 ZIP reader 對 `fflate` 逐位元組比對。
 *
 * `fflate` 是**對照實作**（CONTEXT.md）：它只在測試裡出現，frond 出貨時零 runtime
 * 相依。拿它當答案來源而不是手寫預期值，是因為手寫的預期值只驗證得了「我理解的
 * ZIP 格式」——而讀錯格式的實作會用同一套誤解去寫測試，兩邊一起錯，測試照樣綠。
 *
 * 合成 fixture 一律 stored（ADR-0007 的決定性），所以**光靠它們驗不到 deflate**，
 * 而樣本裡 3309 個項目有 3308 個是 deflate。這裡因此用 `fflate` 現壓一批：壓縮
 * 的那一側也是對照實作，frond 只負責讀。
 */

const encoder = new TextEncoder();

function bytes(text: string): Uint8Array {
  return encoder.encode(text);
}

/** DOS 時間戳的原點。固定住，壓縮檔的位元組才不會每跑一次就換一批。 */
const DOS_EPOCH = Date.UTC(1980, 0, 1);

/** 拿 fflate 壓一份。 */
function archiveOf(
  contents: Record<string, Uint8Array>,
  level: 0 | 1 | 6 | 9 = 6,
): Uint8Array {
  return zipSync(contents, { level, mtime: DOS_EPOCH });
}

async function entriesOf(archive: Uint8Array): Promise<Record<string, Uint8Array>> {
  const read = await readZip(archive);
  return Object.fromEntries(read);
}

async function reasonOf(archive: Uint8Array): Promise<string | undefined> {
  try {
    await readZip(archive);
    return undefined;
  } catch (error) {
    return error instanceof EpubOpenError ? error.reason : `不是 EpubOpenError：${error}`;
  }
}

describe("對 fflate 逐位元組比對", () => {
  const CONTENTS: Record<string, Uint8Array> = {
    // 空檔案：長度 0 的 deflate 區塊是最容易寫錯的一格。
    "empty.txt": bytes(""),
    "mimetype": bytes("application/epub+zip"),
    "META-INF/container.xml": bytes(`<?xml version="1.0"?><container/>`),
    // 高度可壓縮：deflate 一定用得上回頭參照。
    "OEBPS/repeated.xhtml": bytes("<p>同一段話</p>".repeat(500)),
    // 幾乎壓不動：deflate 會退回 stored 區塊，那是另一條解碼路徑。
    "OEBPS/random.bin": Uint8Array.from({ length: 4096 }, (_, index) => (index * 2654435761) % 256),
    // 跨過 32 KB 的滑動視窗，回頭參照會指到更早的區塊。
    "OEBPS/long.xhtml": bytes("章節內容。".repeat(20_000)),
    "OEBPS/深層/路徑/名稱.xhtml": bytes("<p>路徑有非 ASCII 字元</p>"),
  };

  // level 0 是 stored，其餘是 deflate 的三種壓縮強度——同一份輸入在不同強度下
  // 是不同的位元流，而解碼器要三種都吃得下。
  for (const level of [0, 1, 6, 9] as const) {
    test(`壓縮強度 ${level} 的每一項都解得回原本的位元組`, async () => {
      const archive = archiveOf(CONTENTS, level);
      const read = await entriesOf(archive);

      expect(Object.keys(read).sort()).toEqual(Object.keys(CONTENTS).sort());
      for (const [path, expected] of Object.entries(CONTENTS)) {
        expect(read[path], path).toEqual(expected);
      }
    });
  }

  test("與 fflate 自己讀出來的結果一致", async () => {
    const archive = archiveOf(CONTENTS);
    const oracle = unzipSync(archive);
    const read = await entriesOf(archive);

    expect(Object.keys(read).sort()).toEqual(Object.keys(oracle).sort());
    for (const path of Object.keys(oracle)) {
      expect(read[path], path).toEqual(oracle[path]);
    }
  });

  test.each(syntheticFixtures.map((fixture) => fixture.name))(
    "合成 fixture %s 與 fflate 讀出來的一致",
    async (name) => {
      const archive = buildFixture(name);
      const oracle = unzipSync(archive);
      const read = await entriesOf(archive);

      expect(Object.keys(read).sort()).toEqual(Object.keys(oracle).sort());
      for (const path of Object.keys(oracle)) {
        expect(read[path], path).toEqual(oracle[path]);
      }
    },
  );
});

describe("壞掉的壓縮檔要出聲", () => {
  test("空的位元組不是 ZIP", async () => {
    expect(await reasonOf(new Uint8Array(0))).toBe("not-a-zip");
  });

  test("別的檔案不是 ZIP", async () => {
    expect(await reasonOf(bytes("這是一份純文字，不是壓縮檔"))).toBe("not-a-zip");
  });

  test("截斷的壓縮檔不是 ZIP", async () => {
    const archive = archiveOf({ "a.txt": bytes("內容".repeat(100)) });
    expect(await reasonOf(archive.slice(0, archive.length - 10))).toBe("not-a-zip");
  });

  test("內容壞掉時 CRC 會抓到", async () => {
    const archive = archiveOf({ "a.txt": bytes("內容".repeat(1000)) });
    const damaged = archive.slice();
    // 翻掉壓縮資料正中間的一個位元組。位置要算出來而不是猜——第一個 local file
    // header 固定 30 個位元組，後面接檔名與 extra field。翻在別處（例如 central
    // directory）測到的會是另一種壞法。
    const view = new DataView(damaged.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    const middle = start + Math.floor((archive.length - start) / 4);
    damaged[middle] = damaged[middle]! ^ 0xff;

    // 不驗 CRC 的實作會靜默地吐出壞掉的位元組——一本下載到一半的書會變成
    // 「這一章是亂碼」，而那時候沒有人查得到根因在解壓。
    expect(await reasonOf(damaged)).toBe("not-a-zip");
  });

  test("EOCD 的簽章出現在內容裡也找得到真的那一個", async () => {
    // `PK\x05\x06` 出現在某一項的資料中間。只比簽章不比長度的實作會停在這裡，
    // 然後把後面真正的目錄當成不存在。
    const decoy = new Uint8Array([0x50, 0x4b, 0x05, 0x06, ...new Array(40).fill(0)]);
    const archive = archiveOf({ "decoy.bin": decoy, "a.txt": bytes("內容") }, 0);
    const read = await entriesOf(archive);
    expect(read["a.txt"]).toEqual(bytes("內容"));
    expect(read["decoy.bin"]).toEqual(decoy);
  });
});

describe("是 ZIP 但 frond 不讀的功能", () => {
  /** 把 central directory 每一項的某個 16 bit 欄位改掉。 */
  function patchCentralDirectory(archive: Uint8Array, offset: number, value: number): Uint8Array {
    const patched = archive.slice();
    const view = new DataView(patched.buffer);
    for (let at = 0; at < patched.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint16(at + offset, value, true);
    }
    return patched;
  }

  const ARCHIVE = archiveOf({ "a.txt": bytes("內容") });

  test("加密的項目開不起來，而且說得出原因", async () => {
    // general purpose flag 在 central directory record 的第 8 個位元組。
    expect(await reasonOf(patchCentralDirectory(ARCHIVE, 8, 0x0001))).toBe(
      "unsupported-zip-feature",
    );
  });

  test("不認得的壓縮方法開不起來，而且說得出原因", async () => {
    // 壓縮方法在第 10 個位元組。14 是 LZMA——合法的 ZIP，frond 不讀。
    expect(await reasonOf(patchCentralDirectory(ARCHIVE, 10, 14))).toBe(
      "unsupported-zip-feature",
    );
  });

  test("ZIP64 開不起來，而且說得出原因", async () => {
    // 長度欄位滿格代表真正的值在 ZIP64 的 extra field 裡。照字面讀會得到 4 GB。
    const patched = ARCHIVE.slice();
    const view = new DataView(patched.buffer);
    for (let at = 0; at < patched.length - 4; at += 1) {
      if (view.getUint32(at, true) === 0x02014b50) view.setUint32(at + 24, 0xffffffff, true);
    }
    expect(await reasonOf(patched)).toBe("unsupported-zip-feature");
  });
});

describe("目錄項目", () => {
  test("不會出現在表裡", async () => {
    // `zip(1)` 一類的工具會替每一層目錄寫一個空項目。收進表裡的話 `has("OEBPS/")`
    // 會回答「有」，而那個路徑取不出任何位元組。
    const archive = archiveOf({ "OEBPS/": new Uint8Array(0), "OEBPS/a.txt": bytes("內容") });
    const read = await entriesOf(archive);
    expect(Object.keys(read)).toEqual(["OEBPS/a.txt"]);
  });
});
