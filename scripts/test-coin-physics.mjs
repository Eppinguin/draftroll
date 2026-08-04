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

  console.log(
    JSON.stringify(
      {
        ok: true,
        tested: ['production cylinder collider', 'coin-to-d6 momentum transfer'],
        finalVelocity: { coin: coin.velocity.x, d6: d6.velocity.x },
      },
      null,
      2,
    ),
  );
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
