import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as CANNON from 'cannon-es';
import { runTsc } from './lib/load-typescript.mjs';

const projectRoot = resolve(new URL('..', import.meta.url).pathname);
// Keep the transient compiler project under node_modules so an already-running
// Vite playground does not treat its tsconfig creation/removal as app changes.
const tempRoot = await mkdtemp(join(projectRoot, 'node_modules/.coin-physics-'));
const outDir = join(tempRoot, 'build');
const configPath = join(tempRoot, 'tsconfig.json');

try {
  await writeFile(
    configPath,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'Node',
          rootDir: join(projectRoot, 'src'),
          outDir,
          strict: true,
          skipLibCheck: true,
          esModuleInterop: true,
        },
        include: [
          join(projectRoot, 'src/physics-shapes.ts'),
          join(projectRoot, 'src/collider-data.ts'),
          join(projectRoot, 'src/resting-physics.ts'),
        ],
      },
      null,
      2,
    ),
  );

  const compile = runTsc(['-p', configPath], { cwd: projectRoot });
  if (compile.status !== 0) {
    process.stderr.write(compile.stdout);
    process.stderr.write(compile.stderr);
    throw new Error('Coin physics compilation failed');
  }
  await writeFile(join(outDir, 'package.json'), '{"type":"commonjs"}\n');

  const require = createRequire(import.meta.url);
  const { createDiePhysicsShape } = require(join(outDir, 'physics-shapes.js'));
  const { minimumRestingAlignment, readRestingAlignment, releaseUnstableRestPose } = require(
    join(outDir, 'resting-physics.js'),
  );
  const coinShape = createDiePhysicsShape('coin');
  assert.ok(coinShape instanceof CANNON.Cylinder, 'coin uses a Cannon cylinder');

  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) });
  world.solver.iterations = 20;
  const material = new CANNON.Material('shared-dice');
  world.addContactMaterial(
    new CANNON.ContactMaterial(material, material, {
      friction: 0.2,
      restitution: 0.08,
    }),
  );

  const coin = new CANNON.Body({ mass: 0.42, material, shape: coinShape });
  coin.position.set(-1.7, 0, 0);
  coin.velocity.set(4, 0, 0);
  coin.linearDamping = 0;
  coin.angularDamping = 0;

  const d6 = new CANNON.Body({
    mass: 1.12,
    material,
    shape: createDiePhysicsShape('d6'),
  });
  d6.position.set(0, 0, 0);
  d6.linearDamping = 0;
  d6.angularDamping = 0;

  world.addBody(coin);
  world.addBody(d6);
  for (let frame = 0; frame < 120; frame += 1) world.step(1 / 120);

  assert.ok(d6.velocity.x > 0.35, 'coin transfers momentum to the d6');
  assert.ok(coin.velocity.x < 3, 'the d6 changes the coin trajectory');
  assert.ok(
    Math.abs(coin.position.z) < 0.1 && Math.abs(d6.position.z) < 0.1,
    'head-on contact remains stable',
  );

  function settleFromEdge(kind, positionY, edgeQuaternion) {
    const settlingWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
    settlingWorld.solver.iterations = 32;
    const settlingMaterial = new CANNON.Material(`settling-${kind}`);
    settlingWorld.addContactMaterial(
      new CANNON.ContactMaterial(settlingMaterial, settlingMaterial, {
        friction: 0.28,
        restitution: 0.12,
      }),
    );
    const floor = new CANNON.Body({
      mass: 0,
      material: settlingMaterial,
      shape: new CANNON.Plane(),
    });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    settlingWorld.addBody(floor);

    const body = new CANNON.Body({
      mass: kind === 'coin' ? 0.42 : 1.12,
      material: settlingMaterial,
      shape: createDiePhysicsShape(kind),
    });
    body.position.set(0, positionY, 0);
    body.quaternion.copy(edgeQuaternion);
    body.linearDamping = 0.095;
    body.angularDamping = 0.085;
    body.allowSleep = true;
    body.sleepSpeedLimit = 0.09;
    body.sleepTimeLimit = 0.72;
    settlingWorld.addBody(body);
    body.sleep();

    const correctionAxis = new CANNON.Vec3();
    const initialAlignment = readRestingAlignment(kind, body.quaternion, correctionAxis);
    assert.ok(
      initialAlignment < minimumRestingAlignment(kind),
      `${kind} fixture starts on an unstable edge`,
    );
    for (let frame = 0; frame < 720; frame += 1) {
      const alignment = readRestingAlignment(kind, body.quaternion, correctionAxis);
      if (alignment < minimumRestingAlignment(kind)) releaseUnstableRestPose(body, correctionAxis);
      settlingWorld.step(1 / 120);
    }
    const finalAlignment = readRestingAlignment(kind, body.quaternion, correctionAxis);
    assert.ok(
      finalAlignment >= minimumRestingAlignment(kind),
      `${kind} resolves onto a supporting face (alignment ${finalAlignment})`,
    );
    return finalAlignment;
  }

  const coinAlignment = settleFromEdge(
    'coin',
    0.73,
    new CANNON.Quaternion().setFromEuler(Math.PI / 2, 0, 0),
  );
  const d6Alignment = settleFromEdge(
    'd6',
    0.78,
    new CANNON.Quaternion().setFromEuler(0, 0, Math.PI / 4),
  );

  function settleNaturalThrow(kind, index) {
    const settlingWorld = new CANNON.World({ gravity: new CANNON.Vec3(0, -20.5, 0) });
    settlingWorld.solver.iterations = 32;
    const settlingMaterial = new CANNON.Material(`natural-${kind}`);
    settlingWorld.addContactMaterial(
      new CANNON.ContactMaterial(settlingMaterial, settlingMaterial, {
        friction: 0.28,
        restitution: 0.24,
      }),
    );
    const floor = new CANNON.Body({
      mass: 0,
      material: settlingMaterial,
      shape: new CANNON.Plane(),
    });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    settlingWorld.addBody(floor);
    const body = new CANNON.Body({
      mass: kind === 'coin' ? 0.42 : 1.12,
      material: settlingMaterial,
      shape: createDiePhysicsShape(kind),
    });
    body.position.set(0, 2.4 + index * 0.08, 0);
    body.quaternion.setFromEuler(0.37 + index * 0.19, 0.61 + index * 0.13, 0.29 + index * 0.17);
    body.velocity.set(0.9 - index * 0.08, 1.4, -0.65 + index * 0.06);
    body.angularVelocity.set(4.2 + index * 0.4, 2.7 - index * 0.16, -3.8 + index * 0.31);
    body.linearDamping = 0.095;
    body.angularDamping = 0.085;
    settlingWorld.addBody(body);
    const correctionAxis = new CANNON.Vec3();
    for (let frame = 0; frame < 1_080; frame += 1) {
      settlingWorld.step(1 / 120);
      if (body.position.y < 1.35 && Math.abs(body.velocity.y) < 0.65) {
        body.velocity.x *= 0.997;
        body.velocity.z *= 0.997;
        body.angularVelocity.scale(0.993, body.angularVelocity);
      }
      if (frame < 60) continue;
      const alignment = readRestingAlignment(kind, body.quaternion, correctionAxis);
      if (alignment < minimumRestingAlignment(kind)) releaseUnstableRestPose(body, correctionAxis);
    }
    const finalAlignment = readRestingAlignment(kind, body.quaternion, correctionAxis);
    assert.ok(
      finalAlignment >= minimumRestingAlignment(kind),
      `${kind} natural throw finishes on a supporting face (alignment ${finalAlignment}, speed ${body.velocity.length()}, angular ${body.angularVelocity.length()})`,
    );
    return finalAlignment;
  }

  const naturalAlignments = Object.fromEntries(
    ['coin', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'].map((kind, index) => [
      kind,
      settleNaturalThrow(kind, index),
    ]),
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: [
          'production cylinder collider',
          'coin-to-d6 momentum transfer',
          'coin edge-balance release',
          'd6 edge-balance release',
          'supporting-face settlement for every physical kind',
        ],
        finalVelocity: { coin: coin.velocity.x, d6: d6.velocity.x },
        finalAlignment: { coin: coinAlignment, d6: d6Alignment },
        naturalAlignments,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
