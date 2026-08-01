import type { RollTreeNode } from '../../protocol/src/index';

/**
 * Callback invoked for each node during roll-tree traversal.
 *
 * @public
 */
export type RollTreeVisitor = (node: RollTreeNode, parent: RollTreeNode | null) => void;

/**
 * Depth-first, left-to-right traversal of an evaluated roll tree.
 *
 * @public
 */
export function walkRollTree(root: RollTreeNode, visitor: RollTreeVisitor): void {
  const visit = (node: RollTreeNode, parent: RollTreeNode | null): void => {
    visitor(node, parent);
    if (node.kind === 'dice' || node.kind === 'set') {
      for (const child of node.children) visit(child, node);
    } else if (node.kind === 'parenthetical' || node.kind === 'unary') {
      visit(node.child, node);
    } else if (node.kind === 'binary') {
      visit(node.left, node);
      visit(node.right, node);
    }
  };
  visit(root, null);
}

/**
 * Returns the first roll-tree node that satisfies a predicate.
 *
 * @public
 */
export function findRollNode(root: RollTreeNode, predicate: (node: RollTreeNode) => boolean): RollTreeNode | null {
  let match: RollTreeNode | null = null;
  walkRollTree(root, (node) => {
    if (!match && predicate(node)) match = node;
  });
  return match;
}

/**
 * Returns every roll-tree node that satisfies a predicate.
 *
 * @public
 */
export function filterRollNodes(root: RollTreeNode, predicate: (node: RollTreeNode) => boolean): RollTreeNode[] {
  const matches: RollTreeNode[] = [];
  walkRollTree(root, (node) => {
    if (predicate(node)) matches.push(node);
  });
  return matches;
}

/**
 * Returns the leftmost terminal node in an evaluated roll tree.
 *
 * @public
 */
export function leftmostRollNode(root: RollTreeNode): RollTreeNode {
  let current = root;
  while (true) {
    if (current.kind === 'binary') current = current.left;
    else if (current.kind === 'parenthetical' || current.kind === 'unary') current = current.child;
    else if ((current.kind === 'dice' || current.kind === 'set') && current.children.length > 0) current = current.children[0];
    else return current;
  }
}

/**
 * Returns the rightmost terminal node in an evaluated roll tree.
 *
 * @public
 */
export function rightmostRollNode(root: RollTreeNode): RollTreeNode {
  let current = root;
  while (true) {
    if (current.kind === 'binary') current = current.right;
    else if (current.kind === 'parenthetical' || current.kind === 'unary') current = current.child;
    else if ((current.kind === 'dice' || current.kind === 'set') && current.children.length > 0) current = current.children[current.children.length - 1];
    else return current;
  }
}
