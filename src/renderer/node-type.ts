/**
 * The node type tests, narrowed to the DOM.
 *
 * The numbers themselves, and the reasoning about which node types count as what, live in
 * `src/epub/tree.ts` — they are properties of the addressing rule rather than of the DOM, and
 * that is the layer the rule now runs at.
 *
 * What is left here is the one thing TypeScript needs and the tree layer cannot give:
 * `isElement` as a **type guard**. `section-view.ts` writes `isElement(target) ? target :
 * target.parentElement`, and `text-index.ts` reads `child.localName`; both need `Element`,
 * not "some node reporting type 1". The guard cannot be written at the tree layer because
 * there is no `Element` there to narrow to — a tree that is not a DOM has no such type.
 */

import { isElement as isElementNode, isTextLike as isTextLikeNode } from "../epub/tree.ts";

/**
 * The parameter is `Node`, not `TreeNode`, and that is load-bearing rather than tidiness:
 * widening it would let this guard assert that a node from the **other** tree is a DOM
 * `Element`, which is a lie the compiler would then propagate to `.parentElement` and
 * `.localName`. Callers that hold a `TreeNode` want `isElement` from `../epub/tree.ts`, which
 * answers the question without claiming a type it cannot know.
 */
export function isElement(node: Node): node is Element {
  return isElementNode(node);
}

export function isTextLike(node: Node): boolean {
  return isTextLikeNode(node);
}
