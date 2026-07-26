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

/** 把一段散文組成 XHTML 的 `<body>` 內容。 */
export function proseBody(prose: Prose): string {
  return [
    `    <h1>${prose.title}</h1>`,
    ...prose.paragraphs.map((paragraph) => `    <p>${paragraph}</p>`),
  ].join("\n");
}
