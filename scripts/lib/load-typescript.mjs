import { execFileSync, spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Resolves the TypeScript compiler API.
 *
 * The workspace declares `typescript` as a devDependency, so a plain resolution
 * from this file succeeds in every normal checkout. Locating the `tsc` binary on
 * PATH is only a fallback for environments that run these scripts against a
 * globally installed compiler -- it must never be the primary path, because a
 * missing binary yields a bogus `<root>/lib/typescript.js` instead of an error.
 *
 * @returns {import('typescript')} The TypeScript compiler API namespace.
 */
export function loadTypeScript() {
  try {
    return require('typescript');
  } catch (localResolutionError) {
    const located = locateGlobalCompiler();
    if (!located) {
      throw new Error(
        'TypeScript is required by this script but could not be resolved. ' +
          'Install workspace dependencies (`pnpm install`) or provide a global `tsc` on PATH.',
        { cause: localResolutionError },
      );
    }
    return require(located);
  }
}

/**
 * Resolves the `tsc` executable to spawn for compilation.
 *
 * Prefers the workspace-local binary so the scripts do not depend on a global
 * install being present on PATH, which silently breaks local runs.
 *
 * @returns {string} A path to `tsc`, falling back to the bare command name.
 */
export function resolveTscCommand() {
  for (const candidate of ['typescript/bin/tsc']) {
    try {
      return require.resolve(candidate);
    } catch {
      // Fall through to the PATH lookup below.
    }
  }
  return 'tsc';
}

/**
 * Runs the TypeScript compiler and returns a normalized result.
 *
 * `spawnSync` yields `undefined` streams when the binary cannot be launched, so
 * callers that write `result.stdout` straight to stderr crash with a confusing
 * `ERR_INVALID_ARG_TYPE` that hides the real failure. This always returns strings.
 *
 * @param {string[]} args Arguments passed to `tsc`.
 * @param {{ cwd?: string }} [options] Spawn options.
 * @returns {{ status: number, stdout: string, stderr: string }} The compiler outcome.
 */
export function runTsc(args, options = {}) {
  const command = resolveTscCommand();
  const spawnArgs = command.endsWith('.js') ? [command, ...args] : args;
  const file = command.endsWith('.js') ? process.execPath : command;
  const result = spawnSync(file, spawnArgs, { encoding: 'utf8', ...options });
  if (result.error) {
    return { status: 1, stdout: '', stderr: `Failed to run TypeScript compiler: ${result.error.message}\n` };
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * Finds `lib/typescript.js` next to a `tsc` executable on PATH.
 *
 * @returns {string | null} An absolute module path, or null when unavailable.
 */
function locateGlobalCompiler() {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  let output;
  try {
    output = execFileSync(locator, ['tsc'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // No `tsc` on PATH. Some shells also exit 0 while printing a "not found"
    // message, which the existence check below rejects.
    return null;
  }
  const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!first) return null;
  let executable;
  try {
    executable = realpathSync(first);
  } catch {
    return null;
  }
  const modulePath = resolve(dirname(executable), '../lib/typescript.js');
  try {
    return require.resolve(modulePath);
  } catch {
    return null;
  }
}
