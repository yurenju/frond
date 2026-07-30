import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { sha256 } from "../support/hash.ts";
import { buildFixture, syntheticFixtures } from "../../../src/test-fixtures/index.ts";

/**
 * Whether the fixture files in the repo still agree with the generator.
 *
 * The fixtures live in the repo (synthetic content raises no copyright question,
 * ADR-0007), which creates two sources of truth: the generator and those bytes. This
 * test gives them no chance to drift apart — change the generator and forget
 * `npm run fixtures` and this goes red, with a message saying exactly what to run.
 *
 * It only works because the output is deterministic. Without that it would be red every
 * time.
 */

const FIXTURE_DIRECTORY = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
);

describe("the fixtures in the repo", () => {
  test.for(syntheticFixtures)(
    "$fileName matches what the generator produces",
    async (fixture: (typeof syntheticFixtures)[number]) => {
      const committed = await readFile(join(FIXTURE_DIRECTORY, fixture.fileName));

      expect(
        sha256(committed),
        `${fixture.fileName} does not match the generator. Run \`npm run fixtures\` to regenerate.`,
      ).toBe(sha256(buildFixture(fixture.name)));
    },
  );

  test("no surplus .epub in the directory", async () => {
    // When an ailment is renamed or deleted, the old file stays behind as an orphan — no
    // test uses it, yet it still looks like a valid fixture.
    const found = (await readdir(FIXTURE_DIRECTORY)).filter((name) =>
      name.endsWith(".epub"),
    );

    expect([...found].sort()).toEqual(
      syntheticFixtures.map((fixture) => fixture.fileName).sort(),
    );
  });
});
