import type { NormalizedDieResult, NormalizedRollResult, RollTreeNode } from '../../protocol/src/index';

/**
 * Controls human-readable result formatting.
 *
 * @public
 */
export interface FormatRollOptions {
  style?: 'plain' | 'markdown' | 'compact';
  includeComment?: boolean;
  includeAuthority?: boolean;
}


/**
 * Strategy for converting normalized roll data to text.
 *
 * @public
 */
export interface RollStringifier {
  stringify(result: NormalizedRollResult): string;
}

/**
 * Default human-readable roll stringifier.
 *
 * @public
 */
export class DefaultRollStringifier implements RollStringifier {
  /**
   * Creates a DefaultRollStringifier instance.
   */
  constructor(private readonly options: FormatRollOptions = {}) {}

  /**
   * Stringify.
   */
  stringify(result: NormalizedRollResult): string {
    return formatRollResult(result, this.options);
  }
}

/**
 * Formats a normalized roll using a supplied roll stringifier.
 *
 * @param result - Normalized roll to format.
 * @param stringifier - Strategy object or callback; defaults to {@link DefaultRollStringifier}.
 * @returns Human-readable roll text.
 *
 * @public
 */
export function stringifyRoll(
  result: NormalizedRollResult,
  stringifier: RollStringifier | ((result: NormalizedRollResult) => string) = new DefaultRollStringifier(),
): string {
  return typeof stringifier === 'function' ? stringifier(result) : stringifier.stringify(result);
}

/**
 * Formats a normalized roll for logs, chat, or accessible text output.
 *
 * @param result - Normalized roll to render.
 * @param options - Style and optional authority or comment inclusion.
 * @returns A deterministic textual representation of the roll.
 *
 * @public
 */
export function formatRollResult(result: NormalizedRollResult, options: FormatRollOptions = {}): string {
  const style = options.style ?? 'plain';
  const expression = result.expression ?? formatTree(result.tree, result.dice, style);
  const rendered = result.tree ? formatTree(result.tree, result.dice, style) : formatDiceList(result.dice, style);
  const total = style === 'markdown' ? `\`${result.total}\`` : String(result.total);
  const prefix = options.includeAuthority ? `[${result.authority}] ` : '';
  const comment = options.includeComment !== false && result.comment ? ` ${result.comment}` : '';
  if (style === 'compact') return `${prefix}${expression} = ${total}${comment}`;
  return `${prefix}${rendered || expression} = ${total}${comment}`;
}

function formatTree(tree: RollTreeNode | undefined, dice: readonly NormalizedDieResult[], style: NonNullable<FormatRollOptions['style']>): string {
  if (!tree) return '';
  const byId = new Map(dice.map((die) => [die.id, die]));
  const annotation = tree.annotations.length ? ` [${tree.annotations.join(', ')}]` : '';
  let text: string;
  switch (tree.kind) {
    case 'literal': text = String(tree.literal); break;
    case 'die': {
      const die = byId.get(tree.dieId);
      text = die ? formatDie(die, style) : String(tree.value);
      break;
    }
    case 'dice': {
      const notation = `${tree.count}d${tree.percentile ? '%' : tree.sides}`;
      text = `${notation} (${tree.children.map((child) => formatTree(child, dice, style)).join(', ')})`;
      break;
    }
    case 'set': text = `(${tree.children.map((child) => formatTree(child, dice, style)).join(', ')})`; break;
    case 'parenthetical': text = `(${formatTree(tree.child, dice, style)})`; break;
    case 'unary': text = `${tree.operator}${formatTree(tree.child, dice, style)}`; break;
    case 'binary': text = `${formatTree(tree.left, dice, style)} ${tree.operator} ${formatTree(tree.right, dice, style)}`; break;
  }
  return `${tree.kept ? text : dropped(text, style)}${annotation}`;
}

function formatDiceList(dice: readonly NormalizedDieResult[], style: NonNullable<FormatRollOptions['style']>): string {
  return dice.map((die) => formatDie(die, style)).join(', ');
}

function formatDie(die: NormalizedDieResult, style: NonNullable<FormatRollOptions['style']>): string {
  const value = String(die.result);
  return die.kept ? value : dropped(value, style);
}

function dropped(value: string, style: NonNullable<FormatRollOptions['style']>): string {
  return style === 'markdown' ? `~~${value}~~` : `(${value} dropped)`;
}
