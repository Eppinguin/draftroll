import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const main = await readFile(join(root, 'src/main.ts'), 'utf8');
const launch = await readFile(join(root, 'src/physical-launch.ts'), 'utf8');
const worker = await readFile(join(root, 'src/roll-worker.ts'), 'utf8');
const physicalPlanner = await readFile(join(root, 'src/physical-roll-planner.ts'), 'utf8');
const dice = await readFile(join(root, 'src/dice.ts'), 'utf8');
const physicsShapes = await readFile(join(root, 'src/physics-shapes.ts'), 'utf8');
const physicalDice = await readFile(join(root, 'src/physical-dice.ts'), 'utf8');
const restingPhysics = await readFile(join(root, 'src/resting-physics.ts'), 'utf8');
const colliders = await readFile(join(root, 'src/collider-data.ts'), 'utf8');
const renderer = await readFile(join(root, 'packages/renderer/src/index.ts'), 'utf8');
const overlay = await readFile(join(root, 'packages/overlay/src/index.ts'), 'utf8');
const playground = await readFile(join(root, 'index.html'), 'utf8');
const guide = await readFile(join(root, 'docs/NATURAL_TARGET_PHYSICS.md'), 'utf8');
const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
const wrangler = await readFile(join(root, 'apps/worker/wrangler.jsonc'), 'utf8');

assert.match(dice, /getTargetNormal\(value: number\)/);
assert.match(dice, /getResultSymmetryRotation\(fromValue: number, toValue: number\)/);
assert.match(
  physicsShapes,
  /createPhysicalDieCollider\(createCanonicalPhysicalDieDefinition\(kind\), sizeScale\)/,
);
assert.match(physicalDice, /collider\.kind === 'cylinder'[\s\S]*?new CANNON\.Cylinder/);
assert.match(dice, /this\.kind === 'coin'[\s\S]*?Math\.PI/);
assert.match(launch, /participant\.coinLike[\s\S]*?rollingX \* 1\.22/);
assert.match(renderer, /normalized === 'd2'[\s\S]{0,100}'coin'/);
assert.match(physicalPlanner, /allWellSeated[\s\S]*?releaseUnstableRestPose/);
assert.match(restingPhysics, /minimumRestingAlignment/);
assert.match(
  restingPhysics,
  /closest support state is already determined by the natural trajectory/,
);
assert.doesNotMatch(restingPhysics, /activeTargets|requested result/);
assert.match(dice, /mapsShape/);
assert.match(main, /function applyShapeSymmetryTargets/);
assert.match(main, /baseQuaternion[\s\S]*?\.multiply\(symmetry\)/);
assert.match(main, /createLockedTableTrajectory/);
assert.match(physicalPlanner, /updateLockedBodies/);
assert.match(physicalPlanner, /CANNON\.Body\.KINEMATIC/);
assert.match(main, /targetingMethod: activeTargeting\.length === 1/);
assert.match(main, /targetingCounts/);
assert.match(main, /'symmetry', 'relabel', 'fixed'/);
assert.doesNotMatch(main, /targetingMethod: 'shape-symmetry'/);
assert.match(main, /const mainThreadPhysicalPlanner = new PhysicalRollPlanner/);
assert.match(main, /mainThreadPhysicalPlanner\.simulate/);
assert.doesNotMatch(main, /buildRollPlanSync|cloneDynamicBody|contactSimilarity/);
assert.doesNotMatch(main, /Natural target planner failed to settle the requested faces/);
assert.doesNotMatch(main, /mapLandingFaceToValue/);
assert.doesNotMatch(main, /workerless-assisted-target/);
assert.doesNotMatch(worker, /applyTargetAssistance/);
assert.doesNotMatch(worker, /applyMicroOrientationCorrection/);
assert.doesNotMatch(worker, /searchCandidate/);
assert.doesNotMatch(worker, /targetNormals/);
assert.match(worker, /entries: PlanEntry\[\]/);
assert.match(worker, /landings: landings\.buffer/);
assert.doesNotMatch(worker, /AdditionalPhysical|additionalTransforms|additionalLandings/);

assert.match(
  renderer,
  /const presentationMode =\s*entries\[0\]\.tableMode[\s\S]*?preservePreviousDice[\s\S]*?table\.mode === 'concurrent'[\s\S]*?'add'\s*:\s*'replace'/,
);
assert.match(main, /function appendTableRoll/);
assert.match(main, /\(isRolling \|\| hasCast\)/);
assert.match(main, /sampleActiveLaunchStates/);
assert.match(main, /tableReplanPaused/);
assert.match(main, /const lockedTrajectory = isRolling[\s\S]*?createLockedTableTrajectory/);
assert.match(main, /createLockedTableTrajectory\(activePlan, planTime, existingPhysicalCount\)/);
assert.match(
  main,
  /buildRollPlan\([\s\S]{0,220}existingPhysicalCount,[\s\S]{0,120}lockedTrajectory/,
);
assert.match(main, /hasPendingPhysicalVisuals/);
assert.match(main, /createStaticTablePlan/);
assert.match(main, /Keep the completed plan while the table remains visible/);
assert.match(overlay, /table: options\.table \? \{ \.\.\.options\.table \} : undefined/);
assert.match(playground, /id="sdk-second-delay"[^>]*value="80"/);
assert.match(playground, /fully dynamic simultaneous throw/);
assert.match(guide, /Qvisible\(t\) = Q\(t\) · S/);
assert.match(guide, /post-impact target torque/);

function parseCollider(name) {
  const match = colliders.match(
    // `[\s\S]` rather than `.` so the literal still matches once the formatter wraps it
    // across multiple lines.
    new RegExp(`export const ${name}_COLLIDER: ColliderData = (\\{[\\s\\S]*?\\});`),
  );
  assert.ok(match, `${name} collider missing`);
  // The literal is TypeScript, not JSON: keys are unquoted and the formatter adds trailing
  // commas. Normalize both so this keeps working regardless of how the source is wrapped.
  const normalized = match[1]
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(normalized);
}

const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scale = (a, amount) => a.map((value) => value * amount);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const length = (a) => Math.sqrt(dot(a, a));
const normalize = (a) => scale(a, 1 / Math.max(1e-12, length(a)));
const average = (points) => scale(points.reduce(add, [0, 0, 0]), 1 / points.length);
const transpose = (matrix) => matrix[0].map((_value, column) => matrix.map((row) => row[column]));
const multiply = (a, b) => a.map((row) => transpose(b).map((column) => dot(row, column)));
const applyMatrix = (matrix, vector) => matrix.map((row) => dot(row, vector));

function logicalNormals(kind) {
  if (kind === 'd6')
    return [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
  const data = parseCollider(kind.toUpperCase());
  if (kind === 'd4') return data.vertices.map(normalize);
  const groups = [];
  for (const face of data.faces) {
    const points = face.map((index) => data.vertices[index]);
    let normal = normalize(cross(subtract(points[1], points[0]), subtract(points[2], points[0])));
    const center = average(points);
    if (dot(normal, center) < 0) normal = scale(normal, -1);
    const plane = dot(normal, center);
    const existing = groups.find(
      (group) => dot(group.normal, normal) > 0.999 && Math.abs(group.plane - plane) < 0.02,
    );
    if (!existing) groups.push({ normal, plane });
  }
  return groups.map((group) => group.normal);
}

function basis(primary, secondary) {
  const x = normalize(primary);
  let y = subtract(secondary, scale(x, dot(x, secondary)));
  if (length(y) < 1e-8) return null;
  y = normalize(y);
  const z = normalize(cross(x, y));
  y = normalize(cross(z, x));
  return transpose([x, y, z]); // columns
}

function findSymmetry(normals, fromIndex, toIndex) {
  const sourcePrimary = normals[fromIndex];
  const targetPrimary = normals[toIndex];
  for (let sourceIndex = 0; sourceIndex < normals.length; sourceIndex += 1) {
    if (sourceIndex === fromIndex) continue;
    const sourceDot = dot(sourcePrimary, normals[sourceIndex]);
    const sourceBasis = basis(sourcePrimary, normals[sourceIndex]);
    if (!sourceBasis) continue;
    for (let targetIndex = 0; targetIndex < normals.length; targetIndex += 1) {
      if (targetIndex === toIndex) continue;
      if (Math.abs(sourceDot - dot(targetPrimary, normals[targetIndex])) > 1e-4) continue;
      const targetBasis = basis(targetPrimary, normals[targetIndex]);
      if (!targetBasis) continue;
      const rotation = multiply(targetBasis, transpose(sourceBasis));
      const mapsShape = normals.every((normal) => {
        const transformed = applyMatrix(rotation, normal);
        return normals.some((candidate) => dot(transformed, candidate) > 0.9995);
      });
      if (mapsShape && dot(applyMatrix(rotation, sourcePrimary), targetPrimary) > 0.9995)
        return rotation;
    }
  }
  return null;
}

for (const kind of ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']) {
  const normals = logicalNormals(kind);
  assert.equal(normals.length, Number(kind.slice(1)), `${kind} logical normal count`);
  for (let from = 0; from < normals.length; from += 1) {
    for (let to = 0; to < normals.length; to += 1) {
      if (from === to) continue;
      assert.ok(findSymmetry(normals, from, to), `${kind} symmetry ${from + 1} -> ${to + 1}`);
    }
  }
}

assert.match(workspace, /esbuild:\s*true/);
assert.match(workspace, /workerd:\s*true/);
assert.match(wrangler, /"compatibility_date":\s*"2026-07-29"/);

const packageFiles = [
  'package.json',
  'packages/core/package.json',
  'packages/protocol/package.json',
  'packages/client/package.json',
  'packages/renderer/package.json',
  'packages/themes/package.json',
  'packages/overlay/package.json',
  'packages/sdk/package.json',
  'packages/server/package.json',
  'apps/worker/package.json',
];
for (const file of packageFiles) {
  const parsed = JSON.parse(await readFile(join(root, file), 'utf8'));
  assert.equal(parsed.version, '0.1.0', `${file} version changed`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      tested: [
        'shape-symmetry exact-result targeting',
        'all result-to-result symmetries for d4/d6/d8/d10/d12/d20',
        'physical d2 cylinder with coin-specific exact-result symmetry and launch flip',
        'canonical and generated dice share one hand-launch generator',
        'result-independent edge/corner resting-pose release',
        'constant local-space trajectory rotation',
        'no post-impact target torque assistance',
        'no final orientation correction',
        'no runtime face-label remapping',
        'kinematic continuation of unresolved already-visible dice',
        'dynamic collisions with previously settled dice',
        'persistent in-flight and settled table additions',
        'workerless fallback uses the same shape-symmetry path',
        'playground defaults to a fully dynamic parallel test',
        'unchanged versions and deployment configuration',
      ],
    },
    null,
    2,
  ),
);
