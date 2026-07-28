import { describe, expect, test } from "vitest";
import { CfiParseError, parseCfi, serializeCfi } from "../../../packages/frond/src/epub/index.ts";

/**
 * CFI 的文法：字串與結構之間的來回。
 *
 * oracle 是 EPUB CFI 規格本身（ADR-0001 的測試金字塔第 1 層）。foliate 的驗收表
 * 在隔壁那個檔案，這裡問的是那份表沒有問到的兩件事：**壞字串的處置**，以及
 * **roundtrip 的正規化規則**——後者不能是碰運氣碰出來的，不然存回去的閱讀進度
 * 每讀一次就換一個樣子。
 */

describe("parse 讀得出的結構", () => {
  test("間接引用把路徑切成數段", () => {
    // `!` 跨過去就換了一份文件（封裝文件 → 內容文件）。攤平成一串 step 的
    // 結構讀不出這件事，而那正是 compare 唯一會答「不可比」的地方。
    const cfi = parseCfi("epubcfi(/6/4!/4/2)");

    expect(cfi.kind).toBe("point");
    if (cfi.kind !== "point") return;
    expect(cfi.path.map((segment) => segment.steps.map((step) => step.index))).toEqual([
      [6, 4],
      [4, 2],
    ]);
  });

  test("字元位移收在它所屬的那一段上", () => {
    const cfi = parseCfi("epubcfi(/6/4!/4/2/1:37)");

    expect(cfi.kind).toBe("point");
    if (cfi.kind !== "point") return;
    expect(cfi.path[0]?.offset).toBeUndefined();
    expect(cfi.path[1]?.offset?.characters).toBe(37);
  });

  test("文字位置的斷言是前後文兩個欄位", () => {
    // step 上的 `[…]` 是 id，字元位移上的是 `[前,後]`——同一個文法，兩種用法。
    const cfi = parseCfi("epubcfi(/4/2/1:10[前の字,後の字])");
    const offset = cfi.kind === "point" ? cfi.path[0]?.offset : undefined;

    expect(offset?.assertion?.fields).toEqual(["前の字", "後の字"]);
  });

  test("參數（`;name=value`）讀得出來", () => {
    // side bias（`;s=b`）是規格允許的參數，實際的閱讀器會寫。不認得它的實作會
    // 把整串 `id;s=b` 當成 id——那是靜默的半對。
    const cfi = parseCfi("epubcfi(/4/2[chap1;s=b])");
    const assertion = cfi.kind === "point" ? cfi.path[0]?.steps[1]?.assertion : undefined;

    expect(assertion?.fields).toEqual(["chap1"]);
    expect(assertion?.parameters).toEqual([{ name: "s", value: "b" }]);
  });

  test("裸的路徑與帶 epubcfi(…) 的讀成同一個結構", () => {
    // 實際的書把它寫在 URL 的 fragment 裡（`#epubcfi(…)`），而規格的例子與
    // 程式裡傳來傳去的常常是裸的。
    expect(parseCfi("/6/4!/4/2")).toEqual(parseCfi("epubcfi(/6/4!/4/2)"));
  });

  test("範圍讀成三段", () => {
    const cfi = parseCfi("epubcfi(/6/4!/4,/2/1:0,/6/3:12)");

    expect(cfi.kind).toBe("range");
    if (cfi.kind !== "range") return;
    expect(cfi.parent).toHaveLength(2);
    expect(cfi.start[0]?.offset?.characters).toBe(0);
    expect(cfi.end[0]?.offset?.characters).toBe(12);
  });
});

describe("roundtrip 是 identity", () => {
  const CANONICAL = [
    "epubcfi(/6/4)",
    "epubcfi(/6/4[chap01ref])",
    "epubcfi(/6/4!/4/2/1:0)",
    "epubcfi(/6/4!/4/2/1:10[前,後])",
    "epubcfi(/4/2[chap1;s=b])",
    "epubcfi(/6/4!/4,/2/1:0,/6/3:12)",
    "epubcfi(/6/4!)",
    "epubcfi(/4/2[a^,b])",
    "epubcfi(/4/2[a^]b])",
    "epubcfi(/4/2[a^^b])",
    "epubcfi(/4/2[a^(b^)c])",
    "epubcfi(/4/2[a^;b^=c])",
  ];

  test.for(CANONICAL)("%s 寫回去一字不差", (cfi: string) => {
    expect(serializeCfi(parseCfi(cfi))).toBe(cfi);
  });

  test.for(CANONICAL)("%s 再走一趟仍然不變", (cfi: string) => {
    // identity 的意思是不動點。少了這一條，一個每次都多加一層逃逸的實作也會在
    // 上面那條裡全綠。
    const once = serializeCfi(parseCfi(cfi));

    expect(serializeCfi(parseCfi(once))).toBe(once);
  });
});

describe("正規化的四條規則", () => {
  // 「roundtrip 是 identity」的例外只有這四種，而且每一種都是「同一個位置的
  // 兩種寫法收斂成一種」，不是資訊遺失。規則寫在 `serializeCfi` 的註解上。
  const NORMALIZED = [
    { rule: "補上 epubcfi(…)", input: "/6/4", output: "epubcfi(/6/4)" },
    { rule: "丟掉多餘的逃逸", input: "epubcfi(/4/2[a^/b])", output: "epubcfi(/4/2[a/b])" },
    { rule: "丟掉前導零", input: "epubcfi(/06/4:007)", output: "epubcfi(/6/4:7)" },
    { rule: "沒有值的參數補 =", input: "epubcfi(/4/2[a;b])", output: "epubcfi(/4/2[a;b=])" },
  ] as const;

  test.for(NORMALIZED)(
    "$rule：$input → $output",
    ({ input, output }: (typeof NORMALIZED)[number]) => {
      expect(serializeCfi(parseCfi(input))).toBe(output);
    },
  );

  test.for(NORMALIZED)(
    "$rule 之後就是不動點",
    ({ output }: (typeof NORMALIZED)[number]) => {
      expect(serializeCfi(parseCfi(output))).toBe(output);
    },
  );
});

describe("壞掉的 CFI 給明確錯誤", () => {
  const BROKEN = [
    { reason: "not-a-cfi", cfi: "" },
    { reason: "not-a-cfi", cfi: "6/4" },
    { reason: "not-a-cfi", cfi: "epubcfi/6/4" },
    { reason: "not-a-cfi", cfi: "epubcfi(6/4)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/4/)" },
    { reason: "malformed-step", cfi: "epubcfi(/6/4:3/2)" },
    { reason: "malformed-offset", cfi: "epubcfi(/6/4:)" },
    { reason: "malformed-offset", cfi: "epubcfi(/6/4:3:5)" },
    { reason: "unterminated-assertion", cfi: "epubcfi(/6/4[chap01)" },
    { reason: "unterminated-assertion", cfi: "epubcfi(/6/4[chap01^])" },
    { reason: "malformed-range", cfi: "epubcfi(/6/4,/2)" },
    { reason: "malformed-range", cfi: "epubcfi(/6/4,/2,/4,/6)" },
    { reason: "unexpected-character", cfi: "epubcfi(/6/4 /2)" },
    { reason: "unexpected-character", cfi: "epubcfi(/6/4#2)" },
  ] as const;

  test.for(BROKEN)(
    "$cfi → $reason",
    ({ cfi, reason }: (typeof BROKEN)[number]) => {
      // 「不靜默回一個半對的結構」的意思是：讀不動的字串要當場說讀不動，而不是
      // 把讀得懂的那一半交出去——一個半對的 CFI 會把讀者送到別的地方，而那看
      // 起來像是「進度存壞了」而不是「這個字串壞了」。
      expect(() => parseCfi(cfi)).toThrow(CfiParseError);
      try {
        parseCfi(cfi);
        expect.unreachable("應該丟 CfiParseError");
      } catch (error) {
        expect((error as CfiParseError).reason).toBe(reason);
      }
    },
  );
});

describe("文法認得但 v1 不做的位移", () => {
  test.for(["epubcfi(/6/4!/4~23.5)", "epubcfi(/6/4!/4~23.5@10:20)"])(
    "%s 的時間位移明確拒絕",
    (cfi: string) => {
      // 忽略掉位移之後剩下的路徑是一個合法、但指到別處的 CFI——那正是「靜默回
      // 一個半對的結構」。v1 只渲染 XHTML 內容文件，影音的時間點沒有意義。
      try {
        parseCfi(cfi);
        expect.unreachable("應該丟 CfiParseError");
      } catch (error) {
        expect((error as CfiParseError).reason).toBe("unsupported-offset");
      }
    },
  );

  test("空間位移（@）也一樣", () => {
    try {
      parseCfi("epubcfi(/6/4!/4@10:20)");
      expect.unreachable("應該丟 CfiParseError");
    } catch (error) {
      expect((error as CfiParseError).reason).toBe("unsupported-offset");
    }
  });
});
