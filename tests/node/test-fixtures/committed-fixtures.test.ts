import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { sha256 } from "../support/hash.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * repo 裡的 fixture 檔案與產生器是否還一致。
 *
 * fixture 進 repo（合成內容無版權問題，ADR-0007），於是就有了兩份事實：產生器
 * 與那批位元組。這條測試讓它們沒有機會分家——改了產生器卻忘了 `npm run
 * fixtures`，這裡會紅，訊息直接說明要跑什麼。
 *
 * 這條之所以能成立，是因為產出是決定性的。沒有決定性的話它每次都紅。
 */

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

describe("repo 裡的 fixture", () => {
  test.for(syntheticFixtures)(
    "$fileName 與產生器的產出一致",
    async (fixture: (typeof syntheticFixtures)[number]) => {
      const committed = await readFile(join(FIXTURE_DIRECTORY, fixture.fileName));

      expect(
        sha256(committed),
        `${fixture.fileName} 與產生器不一致。跑 \`npm run fixtures\` 重新產生。`,
      ).toBe(sha256(buildFixture(fixture.name)));
    },
  );

  test("目錄裡沒有多出來的 .epub", async () => {
    // 病症改名或刪除時，舊檔案會留在原地變成孤兒——沒有任何測試會用到它，但
    // 它看起來仍像一份有效的 fixture。
    const found = (await readdir(FIXTURE_DIRECTORY)).filter((name) =>
      name.endsWith(".epub"),
    );

    expect([...found].sort()).toEqual(
      syntheticFixtures.map((fixture) => fixture.fileName).sort(),
    );
  });
});
