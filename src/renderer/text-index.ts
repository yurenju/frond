/**
 * The DOM-typed face of `src/epub/text-nodes.ts`.
 *
 * The traversal, its filter, and the reasoning about why there may only ever be one of it
 * all live down there — none of that needs a browser, and a Worker reading the same section
 * as bytes has to walk it identically or a reader's note lands in the wrong paragraph.
 *
 * What is here is the DOM's vocabulary: taking `Document` and giving back `Text`, so
 * `section-view.ts` and `renderer.ts` keep measuring rectangles on the type they already
 * hold. `document.body` is also taken from the DOM rather than searched for, because the DOM
 * already answers that question authoritatively.
 */

import {
  charactersBeforeIn,
  countCharactersIn,
  positionAtCharacterIn,
  textNodesUnder,
} from "../epub/text-nodes.ts";

/**
 * The text nodes in this document, in document order.
 *
 * Returns an empty array when `body` does not exist (a parse failure or an empty document) —
 * that is not an error; `empty-and-image-only-sections` demonstrates exactly this case.
 *
 * The nodes coming back are the ones that went in, so they are this document's own `Text`
 * nodes; the cast is the way back from the structural subset the tree layer walks (see
 * `src/epub/tree.ts`).
 */
export function textNodesIn(document: Document): readonly Text[] {
  const body = document.body;
  if (body === null) return [];
  return textNodesUnder(body) as readonly Text[];
}

/** How many characters this document has. */
export function countCharacters(document: Document): number {
  return countCharactersIn(textNodesIn(document));
}

/** How many characters precede some position. */
export function charactersBefore(
  nodes: readonly Text[],
  node: Node,
  offset: number,
): number {
  return charactersBeforeIn(nodes, node, offset);
}

/** Where character `target` falls. */
export function positionAtCharacter(
  nodes: readonly Text[],
  target: number,
): { readonly node: Text; readonly offset: number } | undefined {
  return positionAtCharacterIn(nodes, target) as
    | { readonly node: Text; readonly offset: number }
    | undefined;
}
