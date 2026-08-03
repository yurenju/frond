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

import {
  isElement as isElementNode,
  isTextLike as isTextLikeNode,
  type TreeNode,
} from "../epub/tree.ts";

export function isElement(node: TreeNode): node is Element {
  return isElementNode(node);
}

export function isTextLike(node: TreeNode): boolean {
  return isTextLikeNode(node);
}
