import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { AILMENTS, specFor, type AilmentName } from "./ailments.ts";
import { buildEpub } from "./epub.ts";

/**
 * 合成 fixture 產生器——**一個病症一個檔，檔名即病症名**（ADR-0007）。
 *
 * 這是測試用書的第一層，也是主力。合成 fixture 的價值在於可控與可命名：每個
 * 檔案精確重現一個已知的病，測試失敗時檔名就說明了是哪一種病復發。
 *
 * 這支產生器**對外發佈供消費端使用**（#1 的散佈段落），所以下面這幾個匯出是
 * 產出物的一部分而不是內部細節：那份病症清單本身就是這個專案最有價值的知識
 * 之一，不該鎖在測試目錄裡。
 *
 * ## 決定性
 *
 * 同一份輸入產生**逐位元組相同**的檔案。這不是可重現性衛生，是硬需求：fixture
 * 一重新產生，所有幾何數字都會跟著漂，而漂動的原因與 frond 的程式碼無關。四個
 * 破口都被顯式壓掉——ZIP 的 mtime 與外部屬性、deflate 的實作差異（一律
 * stored）、`dcterms:modified`、以及 identifier（固定字串而非 UUID）。
 * `tests/node/test-fixtures/determinism.test.ts` 用重複產生比 hash 證明它。
 */

export type { Ailment, AilmentName } from "./ailments.ts";
export type { EpubSpec, SectionSpec, ResourceSpec } from "./epub.ts";

export interface SyntheticFixture {
  readonly name: AilmentName;
  /** 一句話說明這個檔案編碼的是哪一種病。 */
  readonly description: string;
  readonly fileName: string;
}

export const syntheticFixtures: readonly SyntheticFixture[] = AILMENTS.map(
  (ailment) => ({
    name: ailment.name,
    description: ailment.description,
    fileName: `${ailment.name}.epub`,
  }),
);

/** 產生一份 fixture 的 EPUB 位元組。 */
export function buildFixture(name: AilmentName): Uint8Array {
  const ailment = AILMENTS.find((candidate) => candidate.name === name);
  if (ailment === undefined) {
    throw new Error(
      `未知的病症 ${name}。已知的有：${AILMENTS.map((candidate) => candidate.name).join(", ")}`,
    );
  }
  return buildEpub(specFor(ailment));
}

/** 把整批 fixture 寫進 `directory`，回傳寫出的檔案路徑。 */
export async function writeFixtures(directory: string): Promise<string[]> {
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const fixture of syntheticFixtures) {
    const path = join(directory, fixture.fileName);
    await writeFile(path, buildFixture(fixture.name));
    written.push(path);
  }
  return written;
}
