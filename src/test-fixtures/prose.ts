/**
 * The prose used by the fixtures. All of it is synthetic text written for this project —
 * **copyrighted books are never committed** (ADR-0007), and synthetic content does not
 * have that problem.
 *
 * There are two reasons for Japanese: vertical is its native form (and the hardest case),
 * and the punctuation marks (`、` `。`) have to resolve to rotated glyphs when vertical,
 * which is the only discriminator in the test environment with any teeth (see
 * docs/test-environment.md). Every paragraph deliberately contains punctuation.
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
 * Assembles a piece of prose into the content of an XHTML `<body>`.
 *
 * `anchorIds` maps a paragraph number (counting from 1) to the `id` to attach. **Only
 * the paragraphs named grow an id**, and the rest are character-for-character unchanged.
 * It serves the nested TOC: the second level points at a position **inside** a Section,
 * and pointing at a non-existent id would give that fixture a second ailment beyond "the
 * TOC has two levels".
 *
 * Attaching ids throughout would achieve the same effect, but it would make the fixture
 * differ from the healthy skeleton by more than a single-point difference requires, and
 * the surplus ids would have nothing pointing at them — real books (Sigil) likewise only
 * put an id at the position the table of contents points to.
 *
 * When omitted the output is character-for-character identical to what it was before this
 * parameter was added — existing fixtures' bytes do not drift because of it.
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
