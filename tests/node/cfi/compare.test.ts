import { describe, expect, test } from "vitest";
import { compareCfi, parseCfi, type Cfi } from "../../../packages/frond/src/epub/index.ts";

/**
 * 兩個 CFI 在書中的先後（user story 22：把 annotation 依書中順序排列）。
 *
 * foliate 的七組在隔壁那個檔案。這裡問的是那七組沒有問到的三件事：**排序真的
 * 用得上嗎**、**不可比表達得出來嗎**、以及**比較是不是自洽的**（反對稱、遞移）。
 */

function order(a: string, b: string): string {
  return compareCfi(parseCfi(a), parseCfi(b));
}

describe("同一份文件裡的先後", () => {
  const PAIRS = [
    { a: "/6/4!/4/2", b: "/6/4!/4/6", why: "同一層的兄弟，序號小的在前" },
    { a: "/6/4!/4/2", b: "/6/4!/6/2", why: "祖先那一層就分出先後了" },
    { a: "/6/4!/4/2/1:3", b: "/6/4!/4/2/1:9", why: "同一個文字節點，位移小的在前" },
    { a: "/6/4!/4/2", b: "/6/4!/4/2/1:0", why: "節點本身在它的內容之前" },
    { a: "/6/4!/4/2", b: "/6/4!/4/2/2", why: "祖先在後代之前" },
    { a: "/6/2!/4", b: "/6/4!/2", why: "不同的 Section，封裝文件那一層決定" },
  ] as const;

  test.for(PAIRS)("$why", ({ a, b }: (typeof PAIRS)[number]) => {
    expect(order(a, b)).toBe("before");
    expect(order(b, a)).toBe("after");
  });

  test("完全一樣的兩個是 equal", () => {
    expect(order("/6/4!/4/2/1:3", "/6/4!/4/2/1:3")).toBe("equal");
  });

  test("只差斷言的兩個也是 equal", () => {
    // 規格說索引才是權威，斷言是書改版後回復位置用的冗餘。拿它當比較依據，
    // 同一個位置會因為書換了一版就變成兩個位置。
    expect(order("/6/4[chapA]!/4/2", "/6/4[chapB]!/4/2")).toBe("equal");
  });
});

describe("annotation 排得起來", () => {
  test("一串 CFI 排出來就是書中的順序", () => {
    // 這是 user story 22 的樣子：消費端手上是一堆存下來的 annotation，要照書中
    // 順序列出來。
    const shuffled = [
      "epubcfi(/6/8!/4/2/1:5)",
      "epubcfi(/6/4!/4/6)",
      "epubcfi(/6/4!/4/2/1:12)",
      "epubcfi(/6/4!/4/2/1:3)",
    ].map((cfi) => parseCfi(cfi));

    const sorted = [...shuffled].sort((a: Cfi, b: Cfi) =>
      compareCfi(a, b) === "before" ? -1 : compareCfi(a, b) === "after" ? 1 : 0,
    );

    expect(
      sorted.map((cfi) => (cfi.kind === "point" ? cfi.path[1]?.offset?.characters : -1)),
    ).toEqual([3, 12, undefined, 5]);
  });

  test("重疊的兩段 highlight 仍然排得出先後", () => {
    // 起點相同時比終點。重疊在 annotation 上是常態（畫重點常常疊著畫），這裡
    // 若回「不可比」，消費端的清單就排不出來了。
    const shorter = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:5)");
    const longer = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:9)");

    expect(compareCfi(shorter, longer)).toBe("before");
    expect(compareCfi(longer, shorter)).toBe("after");
  });

  test("範圍與它自己的起點比得出先後", () => {
    const point = parseCfi("epubcfi(/6/4!/4/2/1:0)");
    const range = parseCfi("epubcfi(/6/4!/4/2,/1:0,/1:9)");

    // 起點相同、終點是那個點本身比較前面——所以點排在範圍前面。
    expect(compareCfi(point, range)).toBe("before");
  });
});

describe("不可比表達得出來", () => {
  test("一邊跨進另一份文件，另一邊往子節點走", () => {
    // `/6/4!/2`：走到 /6/4，跟著它的引用進到另一份文件，那裡的 /2。
    // `/6/4/2`：封裝文件裡 /6/4 的子節點 /2。
    // 兩個位置根本不在同一份文件裡，這個字串本身講不出誰先誰後——硬回一個
    // 大小就是編的。
    expect(order("/6/4!/2", "/6/4/2")).toBe("incomparable");
    expect(order("/6/4/2", "/6/4!/2")).toBe("incomparable");
  });

  test("一邊落在文字裡，另一邊落在子節點上", () => {
    // `/4/2:5` 是節點 /4/2 的文字裡第 5 個字元；`/4/2/6` 是它的子節點。誰先誰
    // 後取決於那個子節點在內容裡的位置，而那要有文件才知道。
    expect(order("/4/2:5", "/4/2/6")).toBe("incomparable");
    expect(order("/4/2/6", "/4/2:5")).toBe("incomparable");
  });

  test("不可比不會退化成 equal", () => {
    // 這是這個回傳型別存在的全部理由：`-1／0／1` 的 API 沒有位置講「沒有先後」，
    // 於是它會被靜默地說成 0，而消費端的排序看起來是對的、順序卻是編的。
    expect(order("/6/4!/2", "/6/4/2")).not.toBe("equal");
  });

  test("差異在前面就分出來時，後面的不相容不影響答案", () => {
    // 不可比只在**兩者對同一個節點的說法不相容**時發生。序號在更前面就分開的
    // 兩條路徑，後面長什麼樣都不重要。
    expect(order("/6/2!/2", "/6/4/2")).toBe("before");
  });
});

describe("比較自己要自洽", () => {
  const SAMPLE = [
    "/6/4",
    "/6/4!/2",
    "/6/4!/2/1:0",
    "/6/4!/2/1:7",
    "/6/4!/4",
    "/6/6",
    "/6/4!/2,/1:0,/1:3",
  ];

  test("反對稱：a 在 b 前，等於 b 在 a 後", () => {
    for (const a of SAMPLE) {
      for (const b of SAMPLE) {
        const forward = order(a, b);
        const backward = order(b, a);
        const mirrored =
          forward === "before" ? "after" : forward === "after" ? "before" : forward;

        expect(backward, `${a} 與 ${b}`).toBe(mirrored);
      }
    }
  });

  test("自己跟自己一定是 equal", () => {
    for (const cfi of SAMPLE) {
      expect(order(cfi, cfi), cfi).toBe("equal");
    }
  });

  test("遞移：a 在 b 前、b 在 c 前，則 a 在 c 前", () => {
    // 排序要能用，遞移性就不能破。這一組全部落在同一份文件裡，所以沒有不可比
    // 的格子——遞移在有不可比時本來就不成立，那是那個答案的意義。
    const comparable = SAMPLE.filter((cfi) => !cfi.includes(","));
    for (const a of comparable) {
      for (const b of comparable) {
        for (const c of comparable) {
          if (order(a, b) === "before" && order(b, c) === "before") {
            expect(order(a, c), `${a} → ${b} → ${c}`).toBe("before");
          }
        }
      }
    }
  });
});
