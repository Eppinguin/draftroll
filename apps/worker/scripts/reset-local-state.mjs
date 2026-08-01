import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const statePath = resolve(process.cwd(), '.wrangler/state');
await rm(statePath, { recursive: true, force: true });
console.log(`Removed local Wrangler state: ${statePath}`);
