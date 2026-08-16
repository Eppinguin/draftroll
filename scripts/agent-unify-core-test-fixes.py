from pathlib import Path


def replace_once(path: str, before: str, after: str, label: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(before)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    target.write_text(source.replace(before, after, 1))


replace_once(
    'scripts/test-common-dice-helpers.mjs',
    "  assert.equal(encounterTable.renderAs, 'spinner');",
    "  assert.equal(encounterTable.renderAs, 'token');",
    'table-draw non-physical render hint',
)

replace_once(
    'scripts/test-coin-physics.mjs',
    """          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(projectRoot, 'src'),
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,""",
    """          target: 'ES2023',
          lib: ['ES2023', 'DOM'],
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: projectRoot,
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,""",
    'coin physics compiler root/lib',
)
replace_once(
    'scripts/test-coin-physics.mjs',
    """  const { createDiePhysicsShape } = require(join(outDir, 'physics-shapes.js'));
  const {
    markUnobstructedTableDice,
    minimumRestingAlignment,
    readRestingAlignment,
    releaseUnstableRestPose,
  } = require(join(outDir, 'resting-physics.js'));""",
    """  const { createDiePhysicsShape } = require(join(outDir, 'src/physics-shapes.js'));
  const {
    markUnobstructedTableDice,
    minimumRestingAlignment,
    readRestingAlignment,
    releaseUnstableRestPose,
  } = require(join(outDir, 'src/resting-physics.js'));""",
    'coin physics compiled module paths',
)

print('Remaining core test expectations migrated.')
