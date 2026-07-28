import { describe, expect, test } from "vitest";
import {
  compareCfi,
  parseCfi,
  serializeCfi,
  type CfiComparison,
} from "../../../packages/frond/src/epub/index.ts";

/**
 * foliate-js 的 `tests/epubcfi-tests.js`（280 行，上游唯一的測試）當**驗收表**
 * 跑過一遍。
 *
 * ## 授權
 *
 * 這個檔案裡的 CFI 字串與比較案例逐字取自上游，所以它帶著上游的著作權聲明：
 *
 *     Copyright (c) 2022 John Factotum
 *     MIT License — https://github.com/johnfactotum/foliate-js
 *
 * MIT 要求的完整條文收在 repo 根目錄的 `THIRD-PARTY-NOTICES.md`。**這是整個
 * repo 裡唯一有這個義務的檔案**：`src/` 一行上游程式碼都沒有（ADR-0001），出貨
 * 的 npm 包也不含 `tests/`。
 *
 * **這是讀它的案例，不是讀它的程式碼**（ADR-0001：frond 是重新實作，不是 port）。
 * 那份檔案的價值在於它是 CFI 規格的一份**解讀紀錄**——哪些字串該解成什麼、哪個
 * 位置排在哪個位置前面。frond 的 oracle 仍然是規格本身；這份表的作用是「有沒有
 * 哪一條的解讀不一樣」，而不一樣的地方要逐條說清楚是規格解讀不同還是 frond 錯了。
 *
 * ## 逐條的結果
 *
 * foliate 的檔案分五個區塊：
 *
 * | # | 區塊 | 這張票 | 結果 |
 * | --- | --- | --- | --- |
 * | 1 | 用 `/6/4[chap01ref]` 在 OPF 上取元素 | **文法層之外**（`toElement` 要 DOM） | 字串本身的 parse／roundtrip 收在這裡 |
 * | 2 | XHTML 上的 offset 與 range 走 DOM 往返 | **文法層之外**（`toRange`／`fromRange` 要 DOM） | 同上；range 的文法在這裡驗 |
 * | 3 | FILTER_SKIP 包住選取範圍的回歸（上游 #100） | **文法層之外**（DOM 過濾器的行為） | 同上 |
 * | 4 | ID 斷言裡的特殊字元 | **正是這一層** | 全數一致 |
 * | 5 | `compare` 的七組 | **正是這一層** | 全數一致 |
 *
 * 第 1～3 區塊要的是「CFI ↔ DOM 位置」的對應，而那需要一份渲染好的文件，屬於
 * `Renderer`（#31 的界線）。它們的**字串**仍然是這一層的義務，所以照樣收進來
 * 跑 parse → serialize。
 *
 * **那份檔案裡出現的每一個 CFI 字串都在這裡跑過**，包含它兩個 10 次的迴圈——
 * 「大致跑過」與「跑過」的差別，正是驗收表存在的理由。
 *
 * **不一致的地方：一條都沒有。** 唯一需要說明的差異是正規化而不是解讀——見下面
 * 〈`^/` 這種多餘的逃逸〉。
 */

/** foliate 的兩個迴圈都跑 0…9。 */
const LOOP = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** parse → serialize 回到原字串（原字串補上 `epubcfi(…)` 之後）。 */
function roundtrips(cfi: string): void {
  expect(serializeCfi(parseCfi(cfi))).toBe(`epubcfi(${cfi})`);
}

describe("區塊 1：EPUB CFI 規格裡那個 OPF 的例子", () => {
  // foliate 拿這些字串去 OPF 上取元素（`toElement`），那一步要 DOM。字串本身
  // 是這一層的事：帶 id 斷言與不帶的兩種寫法都要讀得動，而且不能互相污染。
  test.for(["/6/4[chap01ref]", "/6/4"])("%s roundtrip 是 identity", (cfi: string) => {
    roundtrips(cfi);
  });

  test("帶斷言與不帶斷言指的是同一步", () => {
    // foliate 的斷言是「兩者取到同一個元素」。在文法層對應的事實是：索引相同、
    // 差別只在斷言，而斷言不影響位置。
    expect(compareCfi(parseCfi("/6/4[chap01ref]"), parseCfi("/6/4"))).toBe("equal");
  });

  test("id 斷言讀得出來", () => {
    const cfi = parseCfi("/6/4[chap01ref]");
    const step = cfi.kind === "point" ? cfi.path[0]?.steps[1] : undefined;

    expect(step?.index).toBe(4);
    expect(step?.assertion?.fields).toEqual(["chap01ref"]);
  });
});

describe("區塊 2：XHTML 上的位移與範圍", () => {
  // foliate 用這些字串在三份等價的 XHTML 上做 DOM 往返。DOM 那半邊是
  // `Renderer` 的事；這裡驗的是同一批字串在文法層讀得動、寫得回去。
  const POINTS = [
    "/4[body01]/10[para05]/3:10",
    "/4[body01]/16[svgimg]",
    "/4[body01]/10[para05]/1:0",
    "/4[body01]/10[para05]/2/1:0",
    "/4[body01]/10[para05]/2/1:3",
  ];

  test.for(POINTS)("%s roundtrip 是 identity", (cfi: string) => {
    roundtrips(cfi);
  });

  test("字元位移讀成數字，不是字串", () => {
    const cfi = parseCfi("/4[body01]/10[para05]/3:10");
    const segment = cfi.kind === "point" ? cfi.path[0] : undefined;

    expect(segment?.offset?.characters).toBe(10);
    expect(segment?.steps.map((step) => step.index)).toEqual([4, 10, 3]);
  });

  test("range CFI 的三段各自讀得出來", () => {
    // foliate 那個迴圈跑 `/4/10,/3:i,/3:i+1`——共同前綴加起訖，annotation 標
    // 一段文字用的就是這個形狀。
    const cfi = parseCfi("/4/10,/3:0,/3:1");

    expect(cfi.kind).toBe("range");
    if (cfi.kind !== "range") return;
    expect(cfi.parent[0]?.steps.map((step) => step.index)).toEqual([4, 10]);
    expect(cfi.start[0]?.offset?.characters).toBe(0);
    expect(cfi.end[0]?.offset?.characters).toBe(1);
  });

  test.for(LOOP)("/4/10,/3:%i,/3:… roundtrip 是 identity", (index: number) => {
    roundtrips(`/4/10,/3:${index},/3:${index + 1}`);
  });
});

describe("區塊 3：FILTER_SKIP 的回歸（上游 #100）", () => {
  // 那條回歸講的是 DOM 過濾器怎麼算位移，整條屬於 Renderer。它產出的 CFI 字串
  // 是 range，收在這裡確認文法層讀得動——包含「起訖落在同一個文字節點上」這種
  // 最窄的範圍。
  test.for(["/4/2[test-skip-1],/1:3,/1:8", "/4/4[test-skip-2],/1:3,/1:8"])(
    "%s roundtrip 是 identity",
    (cfi: string) => {
      roundtrips(cfi);
    },
  );

  test("起訖相同的範圍與那個點不是同一個東西", () => {
    // 範圍即使塌成一個點，它仍然是範圍——kind 分得出來，序列化也寫得回去。
    const collapsed = parseCfi("/4/2,/1:3,/1:3");

    expect(collapsed.kind).toBe("range");
    expect(serializeCfi(collapsed)).toBe("epubcfi(/4/2,/1:3,/1:3)");
  });
});

describe("區塊 4：ID 斷言裡的特殊字元", () => {
  /** foliate 的案例：字串 → 那些斷言解開之後的值。 */
  const ESCAPED = [
    {
      cfi: "/6/4[chap0^]!/1ref^^]",
      fields: [["chap0]!/1ref^"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/3:10",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/16[s^]^[vgimg]",
      fields: [["body0]!/1^"], ["s][vgimg"]],
    },
    // 底下三條的重點是**斷言收在哪裡**：`]` 之後緊接著 `/` 或 `:`。斷言的收尾
    // 判斷若被逃逸弄糊塗，後面那個 `:0` 會被吞進斷言裡，而結果仍然是一個
    // 「解得動」的 CFI——只是指到別的地方。
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/1:0",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:0",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
    {
      cfi: "/4[body0^]!/1^^]/10[para^]/0^,/5]/2/1:3",
      fields: [["body0]!/1^"], ["para]/0,/5"]],
    },
  ] as const;

  test.for(ESCAPED)("$cfi 的斷言解得對", ({ cfi, fields }: (typeof ESCAPED)[number]) => {
    const parsed = parseCfi(cfi);
    const assertions =
      parsed.kind === "point"
        ? parsed.path.flatMap((segment) =>
            segment.steps.flatMap((step) =>
              step.assertion === undefined ? [] : [step.assertion.fields],
            ),
          )
        : [];

    // `^]` 是 `]`、`^^` 是 `^`，而 `!` 與 `/` 在斷言裡是字面——它們不需要逃逸，
    // 所以逃逸與否都是同一個字元。
    expect(assertions).toEqual(fields.map((field) => [...field]));
  });

  test.for(ESCAPED)("$cfi roundtrip 是 identity", ({ cfi }: (typeof ESCAPED)[number]) => {
    roundtrips(cfi);
  });

  test("`^/` 這種多餘的逃逸會被正規化掉——這是唯一的差異", () => {
    // foliate 的檔案裡同一個 id 出現兩種寫法：`[para^]/0^,/5]` 與
    // `[para^]/0^,^/5]`，後者多逃逸了一個 `/`。規格只要求逃逸
    // `^ [ ] ( ) , ; =`，所以兩種寫法**解出來是同一個 id**，而 frond 寫回去
    // 一律用不多逃逸的那一種。
    //
    // 這是正規化，不是解讀不同：兩邊對「這個 id 是什麼」的答案完全一致。
    const redundant = "/4[body0^]!/1^^]/10[para^]/0^,^/5],/3:0,/3:1";
    const canonical = "/4[body0^]!/1^^]/10[para^]/0^,/5],/3:0,/3:1";

    expect(serializeCfi(parseCfi(redundant))).toBe(`epubcfi(${canonical})`);
    expect(parseCfi(redundant)).toEqual(parseCfi(canonical));
  });

  test.for(LOOP)(
    "帶多餘逃逸的那個迴圈，第 %i 圈也只差那一個 ^",
    (index: number) => {
      // foliate 第二個 10 次迴圈的形狀。每一圈都要解得動、而且只在 `^/` 那一處
      // 與輸入不同——跑一圈就宣稱「全數一致」，等於沒有檢查位移那個數字。
      const redundant = `/4[body0^]!/1^^]/10[para^]/0^,^/5],/3:${index},/3:${index + 1}`;
      const canonical = `/4[body0^]!/1^^]/10[para^]/0^,/5],/3:${index},/3:${index + 1}`;

      expect(serializeCfi(parseCfi(redundant))).toBe(`epubcfi(${canonical})`);
    },
  );

  test("多餘逃逸的那條再 parse 一次就穩定了", () => {
    // roundtrip 是 identity 的意思是「正規化過的字串是不動點」。第一次可能被
    // 改寫，之後就不會再變——不然存回去的進度會每讀一次就換一個樣子。
    const once = serializeCfi(parseCfi("/4[para^]/0^,^/5]"));

    expect(serializeCfi(parseCfi(once))).toBe(once);
  });
});

describe("區塊 5：compare 的七組", () => {
  /** foliate 的表，原樣照抄——包含它期望的 -1／0／1。 */
  const TABLE = [
    { a: "/6/4!/10", b: "/6/4!/10", foliate: 0 },
    { a: "/6/4!/2/3:0", b: "/6/4!/2", foliate: 1 },
    { a: "/6/4!/2/4/6/8/10/3:0", b: "/6/4!/4", foliate: -1 },
    {
      a: "/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]",
      b: "/6/4!/4/10",
      foliate: 0,
    },
    {
      a: "/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]",
      b: "/6/4!/4/12",
      foliate: -1,
    },
    { a: "/6/4", b: "/6/4!/2", foliate: -1 },
    { a: "/6/4!/2", b: "/6/4!/2!/2", foliate: -1 },
  ] as const;

  /** foliate 的 -1／0／1 對到 frond 的哪一個答案。 */
  const AS_FROND: Record<number, CfiComparison> = {
    [-1]: "before",
    0: "equal",
    1: "after",
  };

  test.for(TABLE)(
    "compare($a, $b) === $foliate",
    ({ a, b, foliate }: (typeof TABLE)[number]) => {
      expect(compareCfi(parseCfi(a), parseCfi(b))).toBe(AS_FROND[foliate]);
    },
  );

  test.for(TABLE)(
    "compare($b, $a) 是反過來的答案",
    ({ a, b, foliate }: (typeof TABLE)[number]) => {
      // foliate 沒有測對稱性。反過來問一次是白拿的：一個把 a、b 記反的實作在
      // 上面那七條裡有三條會照樣綠。
      expect(compareCfi(parseCfi(b), parseCfi(a))).toBe(AS_FROND[-foliate]);
    },
  );

  test("第 4 組同時證明斷言不參與比較", () => {
    // 那一組的 a 帶著三個斷言、b 一個都沒有，而期望是 0。規格說索引才是權威，
    // 斷言是書改版後回復位置用的冗餘。
    const withAssertions = parseCfi(
      "/6/4[chap0^]!/1ref^^]!/4[body01^^]/10[para^]^,05^^]",
    );

    expect(compareCfi(withAssertions, parseCfi("/6/4!/4/10"))).toBe("equal");
  });

  test("第 5 組同時證明範圍與點比得起來", () => {
    // a 是 range、b 是 point，foliate 期望 -1。frond 拿範圍的**起點**去比，
    // 起點相同時才比終點——所以這一條在兩邊得到同一個答案。
    const range = parseCfi(
      "/6/4[chap0^]!/1ref^^]!/4[body01^^],/10[para^]^,05^^],/15:10[foo^]]",
    );

    expect(range.kind).toBe("range");
    expect(compareCfi(range, parseCfi("/6/4!/4/12"))).toBe("before");
  });
});
