/**
 * A synthetic vertical Traditional Chinese book, for the screenshots in the README and on
 * the demo site.
 *
 * ## Why it is not in `AILMENTS`
 *
 * The synthetic fixture list is governed three ways: ADR-0007's table,
 * `single-ailment.test.ts`'s set equality against `REQUIRED_BY_ADR_0007`, and a set of
 * probes asserting "this ailment appears in exactly these files". That governance exists
 * for the sake of **red-light readability** — when a test goes red, the filename says
 * which ailment has come back.
 *
 * This book is not an ailment, nor a control for any ailment; it exists because "the
 * characters in the screenshots have to be Traditional Chinese". Forcing it into that list
 * would put a file that exists for display among a set of files that exist entirely for
 * testing, and the next person reading that table would have to work that out for
 * themselves. So it takes its own route: the same `buildEpub()`, a different purpose.
 *
 * It shares this directory with the fixtures because this is the home of the **synthetic
 * book generator**; what is governed is `ailments.ts`'s list, not this directory.
 * `tsconfig.build.json` excludes the whole directory from the shipped artifact, so this
 * file never reaches consumers.
 *
 * ## Why the book is synthetic
 *
 * The commercially circulating books on hand are copyrighted (ADR-0007), and a screenshot
 * would capture their text along with everything else. Synthetic content does not have
 * that problem, and what the screenshots are there to show — vertical layout, punctuation
 * resolving to vertical glyphs, lines running right to left — is just as visible in a
 * synthetic book.
 */

import { buildEpub, type SectionSpec } from "./epub.ts";

/**
 * A named face rather than a generic family, for the same reason as the synthetic
 * fixtures: the three browsers do not agree on CJK resolution for generics (#4).
 * `Noto Serif CJK TC` is bound by the test image's fontconfig
 * (`docker/fontconfig/75-frond-cjk.conf`), so screenshots taken in the container are
 * reproducible.
 */
const STYLESHEET = `html {
  writing-mode: vertical-rl;
  font-family: "Noto Serif CJK TC";
  line-height: 1.9;
}

body {
  margin: 0;
}

h1 {
  line-height: 1.5;
  font-weight: normal;
  letter-spacing: 0.2em;
}

p {
  margin: 0 0 1em;
  text-indent: 1em;
}
`;

/**
 * Synthetic prose written for this project. Every paragraph deliberately contains
 * punctuation (`、` `。`) and quotation marks (`「」`) — those marks have to resolve to
 * rotated glyphs when vertical, and they are where right and wrong are visible at a glance
 * in a screenshot (`docs/browser-quirks.md` records that WebKit gets this case wrong).
 */
const CHAPTERS: readonly {
  readonly title: string;
  readonly paragraphs: readonly string[];
}[] = [
  {
    title: "渡口",
    paragraphs: [
      "船還沒有來，霧就先到了。",
      "老人把竹篙靠在牆邊，說：「今天的水比昨天高一寸。」",
      "他說這話的時候並沒有看水，而是看著對岸那排還沒亮燈的屋子。屋子的輪廓在霧裡是軟的，像有人用手指把邊緣抹開了一遍。",
      "我把行李放下，坐在石階上等。石頭是涼的，霧是暖的，兩種溫度隔著一層布。",
      "階上有幾道深色的痕跡，是長年被水浸過又曬乾的地方。腳踩上去會滑，所以每個等船的人都站得很開，像事先商量過。",
      "「你是要去對岸？」老人問。他問的方式不像在問，比較像在確認一件他已經知道的事。",
      "我說是。他點點頭，又說：「那就等。這裡只有等這一件事可以做。」",
      "霧在水面上移動的速度比想像中快。它不是飄過去的，是整片一起挪，像一張被拖動的紙。",
      "遠處傳來一聲汽笛，短促、乾澀，聽不出方向。老人抬了抬下巴，說那不是我們的船。",
      "我問那是誰的。他沒有回答，把竹篙換到另一隻手上。",
      "後來我才明白，在這個渡口，很多問題的答案就是不回答——不是不知道，是說了也沒有用。",
      "又過了一會，水面上出現一個黑點。老人站起來，拍了拍褲子上的灰。",
      "「來了。」他說。",
    ],
  },
  {
    title: "鎮上",
    paragraphs: [
      "鎮上只有一條街，走到底是山，回過頭來是水。",
      "街不長，走完大概十分鐘，但每一家店的門都開著，所以走起來像走了很久。",
      "賣麵的把爐火撥旺，蒸氣往上竄，把招牌上的字燻得看不清楚。那塊招牌大概已經燻了很多年，字的筆畫裡積著一層油亮的黑。",
      "我坐下來，點了一碗。她沒有問我要什麼，直接就下了麵。",
      "「外地來的。」她說。這一句同樣不是問句。",
      "我把那個名字說出來，問她認不認識。",
      "「你要找的人，前年就搬走了。」她一邊擦手一邊說，語氣裡沒有惋惜，只是陳述。",
      "我問搬去哪裡。她想了一下，說：「往山那邊。再往上就沒有路了，所以應該還在。」",
      "麵端上來的時候湯還在滾。我低頭吃，聽見外面有人推著車經過，輪子壓在石板上，一格一格地響。",
      "「這條街以前更熱鬧。」她忽然說，「船一天有四班。」",
      "我問現在幾班。她伸出兩根手指，然後把其中一根收回去。",
      "我道了謝，把碗裡的湯喝完。天色暗得很快，像有人把燈一盞一盞地關掉。",
    ],
  },
  {
    title: "回程",
    paragraphs: [
      "回程的船上人很少，只有我和一個抱著紙箱的年輕人。",
      "他把箱子放在膝上，兩隻手一直扶著，彷彿裡面裝的是會碎的東西。",
      "船開了以後他才鬆手，但也只鬆了一隻。",
      "「花。」他忽然對我說，「送我媽的。」",
      "我點點頭。他好像覺得這樣解釋不夠，又補了一句：「這裡買不到，要到對岸去買。」",
      "我說那很遠。他說習慣了，一年也就兩次。",
      "水面很靜。船走過的地方裂開一道白線，然後又慢慢合起來，像什麼都沒有發生過。",
      "我想起那個沒有找到的人，想起賣麵的收回去的那根手指，想起老人不回答的那個問題。",
      "這些事之間沒有關係，但它們發生在同一天，於是就被綁在一起了。",
      "年輕人在中途下了船。他把箱子重新抱好，一步一步走上碼頭，背影一直沒有回頭。",
      "上岸的時候霧散了。我回頭看那個渡口，老人還站在原來的位置。",
      "他大概不是在等船。他只是站在那裡，因為那是他站著的地方。",
    ],
  },
];

const readingOrder: readonly SectionSpec[] = CHAPTERS.map((chapter, index) => ({
  path: `section-${index + 1}.xhtml`,
  title: chapter.title,
  body: [
    `    <h1>${chapter.title}</h1>`,
    ...chapter.paragraphs.map((paragraph) => `    <p>${paragraph}</p>`),
  ].join("\n"),
}));

/** Produces this book's bytes. Deterministic like the fixtures — the identifier is not random. */
export function buildDemoBook(): Uint8Array {
  return buildEpub({
    title: "渡口",
    language: "zh-TW",
    identifier: "urn:uuid:frond-demo-zh-tw",
    // Vertical Chinese books almost always declare rtl. This book is playing "a normal
    // book" rather than a control, so it declares the real-world shape — `vertical-japanese`
    // deliberately leaves it out because it has to be `ppd-rtl-vertical`'s control, and
    // that reason does not apply here.
    pageProgressionDirection: "rtl",
    stylesheet: STYLESHEET,
    readingOrder,
  });
}
