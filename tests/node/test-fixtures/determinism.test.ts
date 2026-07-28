import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { sha256 } from "../support/hash.ts";
import {
  buildFixture,
  syntheticFixtures,
  writeFixtures,
} from "../../../packages/frond/src/test-fixtures/index.ts";

/**
 * 決定性是硬需求，不是可重現性衛生。
 *
 * fixture 一重新產生，所有幾何數字都會跟著漂，而漂動的原因與 frond 的程式碼
 * 無關——跨瀏覽器差分與不變量會同時變色，查不出原因，然後沒有人再相信這套
 * 測試。所以這裡**產兩次、比 hash**，而不是宣稱它是決定性的。
 *
 * ZIP 的 mtime 是最常見的破口，但不是唯一的：`dcterms:modified`、UUID 形式的
 * identifier、以及 deflate 在不同 zlib 版本下的輸出差異都會讓位元組漂掉。
 * 這條斷言蓋住前三個；第四個由 `zip.ts` 一律 stored 從根上移除。
 */

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "frond-fixtures-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("決定性", () => {
  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s 產兩次是逐位元組相同的",
    (name) => {
      expect(sha256(buildFixture(name))).toBe(sha256(buildFixture(name)));
    },
  );

  test("寫進兩個不同的目錄，內容仍逐位元組相同", async () => {
    // 中間隔開一個毫秒刻度。這條抓的是毫秒解析度的破口——典型的是有人把
    // `dcterms:modified` 改成 `new Date().toISOString()`。ZIP 的時間戳是
    // 兩秒解析度，等不起，由下一條直接釘住位元組。
    const first = await temporaryDirectory();
    const second = await temporaryDirectory();

    const writtenFirst = await writeFixtures(first);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const writtenSecond = await writeFixtures(second);

    expect(writtenFirst.length).toBe(syntheticFixtures.length);
    expect(writtenSecond.length).toBe(syntheticFixtures.length);

    for (const fixture of syntheticFixtures) {
      const before = await readFile(join(first, fixture.fileName));
      const after = await readFile(join(second, fixture.fileName));
      expect(sha256(after), fixture.fileName).toBe(sha256(before));
    }
  });

  test("產出物裡沒有任何時間戳指向現在", async () => {
    // ZIP 的每個項目都帶 MS-DOS 時間戳。取「現在」是最常見的破口，而它只在
    // 跨越一秒之後才看得出來——上面那條靠等待抓，這條直接把時間戳釘在 DOS
    // 時間的原點上，讓破口在同一次執行內就可見。
    const archive = buildFixture(syntheticFixtures[0]!.name);
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);

    expect(view.getUint16(10, true)).toBe(0x0000); // 00:00:00
    expect(view.getUint16(12, true)).toBe(0x0021); // 1980-01-01
  });
});
