import { describe, expect, test } from "vitest";
import { unzipSync } from "fflate";
import {
  buildFixture,
  syntheticFixtures,
  type AilmentName,
} from "../../../src/test-fixtures/index.ts";

/**
 * 產生器的驗收：產出物必須是真的 EPUB，不是「腳本沒丟例外」。
 *
 * 解壓一律用 fflate 而不是自己那支 writer 的反向操作——用自己的 reader 讀
 * 自己的 writer，任何對 ZIP 格式的誤解都會在兩邊同時成立，測試照樣全綠。
 */

const ZIP_LOCAL_HEADER_SIZE = 30;
const ZIP_LOCAL_HEADER_SIGNATURE = 0x04034b50;
const ZIP_STORED = 0;

describe("EPUB 封裝格式", () => {
  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s 解得開，且是一份合規的 OCF 容器",
    (name: AilmentName) => {
      const archive = buildFixture(name);
      const entries = unzipSync(archive);

      expect(Object.keys(entries)).toContain("META-INF/container.xml");
    },
  );

  test.for(syntheticFixtures.map((fixture) => fixture.name))(
    "%s 的第一個項目是未壓縮的 mimetype",
    (name: AilmentName) => {
      // OCF 要求 mimetype 是壓縮檔的第一個項目、以 stored 存放、不帶 extra
      // field。這條不是形式主義：閱讀器（與 `file(1)`）靠位元組 30 起的固定
      // 位置嗅出這是不是 EPUB，項目一旦被壓縮或挪位就嗅不到了。
      const archive = buildFixture(name);
      const view = new DataView(
        archive.buffer,
        archive.byteOffset,
        archive.byteLength,
      );

      expect(view.getUint32(0, true)).toBe(ZIP_LOCAL_HEADER_SIGNATURE);
      expect(view.getUint16(8, true)).toBe(ZIP_STORED);
      expect(view.getUint16(28, true)).toBe(0); // extra field length

      const nameLength = view.getUint16(26, true);
      const decoder = new TextDecoder();
      expect(
        decoder.decode(
          archive.subarray(
            ZIP_LOCAL_HEADER_SIZE,
            ZIP_LOCAL_HEADER_SIZE + nameLength,
          ),
        ),
      ).toBe("mimetype");
      expect(
        decoder.decode(
          archive.subarray(
            ZIP_LOCAL_HEADER_SIZE + nameLength,
            ZIP_LOCAL_HEADER_SIZE + nameLength + "application/epub+zip".length,
          ),
        ),
      ).toBe("application/epub+zip");
    },
  );
});
