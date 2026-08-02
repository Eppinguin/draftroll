import assert from 'node:assert/strict';
import { runTsc } from './lib/load-typescript.mjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
const tempRoot = await mkdtemp(join(tmpdir(), 'draftroll-validation-diagnostics-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

function applySuggestion(source, suggestion) {
  assert.ok(suggestion.range, 'expected an editor-applicable suggestion range');
  assert.equal(typeof suggestion.replacement, 'string');
  return source.slice(0, suggestion.range.start.offset)
    + suggestion.replacement
    + source.slice(suggestion.range.end.offset);
}

try {
  await writeFile(configPath, JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      rootDir: join(projectRoot, 'packages'),
      outDir,
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      lib: ['ES2023', 'DOM', 'DOM.Iterable'],
    },
    include: [join(projectRoot, 'packages/**/*.ts')],
  }, null, 2));

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('TypeScript compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const core = await import(pathToFileURL(join(outDir, 'core/src/index.js')).href);
  const sdk = await import(pathToFileURL(join(outDir, 'sdk/src/index.js')).href);
  const { DiceEngine, DiceLimitError, DiceSyntaxError, DICE_DIAGNOSTIC_CODES } = core;
  const { Draftroll } = sdk;

  const engine = new DiceEngine();
  const valid = engine.validate('2d20kh1 + 5');
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.diagnostics, []);
  assert.equal(valid.parsed.expression, '2d20kh1 + 5');

  const multilineSource = '\n  2d6wat';
  const unexpected = engine.validate(multilineSource);
  assert.equal(unexpected.valid, false);
  assert.equal(unexpected.diagnostics.length, 1);
  assert.equal(unexpected.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.unexpectedToken);
  assert.deepEqual(unexpected.diagnostics[0].range.start, { offset: 6, line: 2, column: 6 });
  assert.deepEqual(unexpected.diagnostics[0].range.end, { offset: 7, line: 2, column: 7 });
  assert.ok(unexpected.diagnostics[0].suggestions[0].message.includes('unexpected token'));
  assert.ok(unexpected.error instanceof DiceSyntaxError);
  assert.equal(unexpected.error.code, unexpected.diagnostics[0].code);
  assert.deepEqual(unexpected.error.range, unexpected.diagnostics[0].range);

  const empty = engine.validate('   ');
  assert.equal(empty.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.emptyExpression);
  assert.equal(empty.diagnostics[0].range.start.offset, 0);
  assert.equal(empty.diagnostics[0].range.end.offset, 3);
  assert.ok(empty.diagnostics[0].suggestions.length > 0);

  const invalidCount = engine.validate('1.5d6');
  assert.equal(invalidCount.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.invalidDiceCount);
  assert.deepEqual(
    [invalidCount.diagnostics[0].range.start.offset, invalidCount.diagnostics[0].range.end.offset],
    [0, 3],
  );

  const invalidSides = engine.validate('d0');
  assert.equal(invalidSides.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.invalidDiceSides);
  assert.deepEqual(
    [invalidSides.diagnostics[0].range.start.offset, invalidSides.diagnostics[0].range.end.offset],
    [1, 2],
  );

  const missingSides = engine.validate('2d');
  assert.equal(missingSides.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedDiceSides);
  assert.equal(missingSides.diagnostics[0].range.start.offset, 2);
  assert.equal(missingSides.diagnostics[0].range.end.offset, 2);

  const missingParenthesisSource = '2d6 + (1d4';
  const missingParenthesis = engine.validate(missingParenthesisSource);
  assert.equal(missingParenthesis.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedClosingParenthesis);
  assert.equal(missingParenthesis.diagnostics[0].range.start.offset, missingParenthesisSource.length);
  const parenthesisFix = missingParenthesis.diagnostics[0].suggestions.find((entry) => entry.replacement === ')');
  assert.equal(engine.validate(applySuggestion(missingParenthesisSource, parenthesisFix)).valid, true);

  const missingModifierSource = '2d6kh';
  const missingModifier = engine.validate(missingModifierSource);
  assert.equal(missingModifier.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedModifierCount);
  const modifierFix = missingModifier.diagnostics[0].suggestions.find((entry) => entry.replacement === '1');
  assert.equal(engine.validate(applySuggestion(missingModifierSource, modifierFix)).valid, true);

  const expectedPrimary = engine.validate('1 +');
  assert.equal(expectedPrimary.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedPrimary);

  const expectedSetDelimiter = engine.validate('(1, 2 3)');
  assert.equal(expectedSetDelimiter.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedSetDelimiter);

  const expectedSelector = engine.validate('1d6r');
  assert.equal(expectedSelector.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedSelectorValue);

  const comparison = engine.validate('4d6cs>=');
  assert.equal(comparison.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedComparisonValue);
  assert.ok(comparison.diagnostics[0].suggestions[0].message.includes('>='));

  const expectedModifierValue = engine.validate('1d6mi');
  assert.equal(expectedModifierValue.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedModifierValue);

  const annotationSource = '1d6 [fire';
  const annotation = engine.validate(annotationSource);
  assert.equal(annotation.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.unterminatedAnnotation);
  const annotationFix = annotation.diagnostics[0].suggestions.find((entry) => entry.replacement === ']');
  assert.equal(engine.validate(applySuggestion(annotationSource, annotationFix)).valid, true);

  const tooLong = new DiceEngine({ limits: { maxExpressionLength: 5 } }).validate('1d6+20');
  assert.equal(tooLong.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expressionTooLong);
  assert.ok(tooLong.error instanceof DiceLimitError);
  assert.deepEqual(
    [tooLong.diagnostics[0].range.start.offset, tooLong.diagnostics[0].range.end.offset],
    [5, 6],
  );

  const hugeNumber = engine.validate('9'.repeat(309));
  assert.equal(hugeNumber.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.numberTooLarge);

  const hugeInteger = engine.validate(`d${'9'.repeat(20)}`);
  assert.equal(hugeInteger.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.integerTooLarge);

  const tooDeep = new DiceEngine({ limits: { maxAstDepth: 4 } }).validate('(((1)))');
  assert.equal(tooDeep.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.astDepthExceeded);
  assert.ok(tooDeep.error instanceof DiceLimitError);

  const tooManyModifiers = new DiceEngine({ limits: { maxModifiers: 1 } }).validate('4d6kh3dl1');
  assert.equal(tooManyModifiers.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.tooManyModifiers);
  assert.ok(tooManyModifiers.error instanceof DiceLimitError);
  assert.deepEqual(
    [tooManyModifiers.diagnostics[0].range.start.offset, tooManyModifiers.diagnostics[0].range.end.offset],
    [6, 9],
  );

  const sdkValidation = new Draftroll().validate('2d6kh');
  assert.equal(sdkValidation.valid, false);
  assert.equal(sdkValidation.diagnostics[0].code, DICE_DIAGNOSTIC_CODES.expectedModifierCount);

  console.log('validation diagnostics tests passed');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
