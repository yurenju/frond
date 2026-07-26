/**
 * fixture 用的散文。全部是為這個專案寫的合成文字——**絕不 commit 版權內的
 * 書**（ADR-0007），而合成內容沒有這個問題。
 *
 * 日文的理由有兩個：直排是它的原生形態（也是最難的一格），而且句讀點
 * （`、` `。`）在直排下必須取到旋轉過的字符，那是測試環境唯一有牙齒的
 * 鑑別點（見 docs/test-environment.md）。段落刻意都放進句讀點。
 */

export interface Prose {
  readonly title: string;
  readonly paragraphs: readonly string[];
}

export const PROSE: readonly Prose[] = [
  {
    title: "朝の光",
    paragraphs: [
      "窓の外に、静かな朝の光が差しこんでいた。",
      "机の上には、読みかけの本が一冊、開いたまま置かれている。",
      "彼女は湯気の立つ茶碗を手に取り、ゆっくりと息をついた。",
    ],
  },
  {
    title: "坂の道",
    paragraphs: [
      "坂をのぼりきると、海がひらけて見えた。",
      "風は冷たく、けれども日ざしはやわらかい。",
      "遠くで、汽笛が一度だけ鳴った。",
    ],
  },
  {
    title: "夜の駅",
    paragraphs: [
      "終電の駅は、思ったよりも静かだった。",
      "白い灯りの下で、時刻表の文字がにじんで見える。",
      "明日もまた、この道を歩くのだろう。",
    ],
  },
];

/**
 * 把一段散文組成 XHTML 的 `<body>` 內容。
 *
 * `anchorIds` 把段落編號（從 1 起算）對到要掛上去的 `id`。**只有被指到的那幾
 * 段會長出 id**，其餘逐字元不變。它服務的是巢狀 TOC：第二層指的是 Section
 * **裡面**的位置，而指向不存在的 id 會讓那份 fixture 除了「TOC 有兩層」之外
 * 多帶一個病症。
 *
 * 整份都掛 id 也能達到同樣效果，但那讓 fixture 與健康骨架的差異比單點差異需要
 * 的更大，而多出來的 id 沒有任何東西指得到——實際的書（Sigil）也只在被目錄指
 * 到的那個位置放 id。
 *
 * 省略時輸出與加入這個參數之前逐字元相同——既有 fixture 的位元組不因為它而
 * 漂掉。
 */
export function proseBody(
  prose: Prose,
  anchorIds: ReadonlyMap<number, string> = new Map(),
): string {
  return [
    `    <h1>${prose.title}</h1>`,
    ...prose.paragraphs.map((paragraph, index) => {
      const id = anchorIds.get(index + 1);
      return id === undefined
        ? `    <p>${paragraph}</p>`
        : `    <p id="${id}">${paragraph}</p>`;
    }),
  ].join("\n");
}
