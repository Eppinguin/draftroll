import type { ComparisonOperator, DiceDialect } from '../../protocol/src/index';

/**
 * Union of supported dice-expression AST nodes.
 *
 * @public
 */
export type AstNode = NumberNode | UnaryNode | BinaryNode | DiceNode | SetNode | ParentheticalNode;

/**
 * Source span shared by every AST node.
 *
 * @public
 */
export interface AstNodeBase {
  annotations: string[];
}

/**
 * Numeric literal AST node.
 *
 * @public
 */
export interface NumberNode extends AstNodeBase {
  type: 'number';
  value: number;
}

/**
 * Unary-expression AST node.
 *
 * @public
 */
export interface UnaryNode extends AstNodeBase {
  type: 'unary';
  operator: '+' | '-';
  operand: AstNode;
}

/**
 * Operators accepted by binary expression nodes.
 *
 * @public
 */
export type BinaryOperator =
  | '+'
  | '-'
  | '*'
  | '/'
  | '//'
  | '%'
  | '=='
  | '='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>=';

/**
 * Binary-expression AST node.
 *
 * @public
 */
export interface BinaryNode extends AstNodeBase {
  type: 'binary';
  operator: BinaryOperator;
  left: AstNode;
  right: AstNode;
}

/**
 * Parenthesized-expression AST node.
 *
 * @public
 */
export interface ParentheticalNode extends AstNodeBase {
  type: 'parenthetical';
  value: AstNode;
  modifiers: SetOperation[];
}

/**
 * Set-expression AST node.
 *
 * @public
 */
export interface SetNode extends AstNodeBase {
  type: 'set';
  values: AstNode[];
  modifiers: SetOperation[];
}

/**
 * Dice-term AST node with modifier operations.
 *
 * @public
 */
export interface DiceNode extends AstNodeBase {
  type: 'dice';
  count: number;
  sides: number | 'F';
  percentile: boolean;
  modifiers: SetOperation[];
}

/**
 * Selector predicates accepted by set operations.
 *
 * @public
 */
export type SelectorType =
  | 'literal'
  | 'highest'
  | 'lowest'
  | 'greater'
  | 'less'
  | 'greater-equal'
  | 'less-equal'
  | 'not-equal';

/**
 * Selector predicate attached to a set operation.
 *
 * @public
 */
export interface SetSelector {
  type: SelectorType;
  target: number;
}

/**
 * Modifier operations supported by the expression AST.
 *
 * @public
 */
export type SetOperationType =
  | 'keep'
  | 'drop'
  | 'reroll'
  | 'reroll-once'
  | 'reroll-add'
  | 'explode'
  | 'minimum'
  | 'maximum'
  | 'success-count';

/**
 * One normalized modifier attached to a dice or set node.
 *
 * @public
 */
export interface SetOperation {
  type: SetOperationType;
  selector: SetSelector;
  /** Original notation, useful to preserve aliases such as kh/dl. */
  notation?: string;
}

/**
 * Legacy modifier alias retained for integrations importing this type.
 *
 * @public
 */
export type DiceModifier = SetOperation;

/**
 * Parsed expression, AST, source text, and optional trailing comment.
 *
 * @public
 */
export interface ParsedExpression {
  source: string;
  expression: string;
  annotation: string | null;
  comment: string | null;
  ast: AstNode;
  dialect: DiceDialect;
}

/**
 * Returns the comparison operator represented by a selector, when applicable.
 *
 * @public
 */
export function selectorToComparison(selector: SetSelector): ComparisonOperator | null {
  switch (selector.type) {
    case 'literal':
      return '=';
    case 'greater':
      return '>';
    case 'less':
      return '<';
    case 'greater-equal':
      return '>=';
    case 'less-equal':
      return '<=';
    case 'not-equal':
      return '!=';
    case 'highest':
    case 'lowest':
      return null;
  }
}
