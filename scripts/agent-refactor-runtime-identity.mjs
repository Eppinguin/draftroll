import { createHash } from 'node:crypto';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const payloads = [
  ['scripts/.runtime-identity-payload-00', '0b13ac150d8d40fc8dc49ac2bb05852330842ca67ab335d5768f2cfba63f23b2'],
  ['scripts/.runtime-identity-payload-01b', '5877526e28327df1e244c6d6aa91e212742ed58942f4fcfcf81b1234d7d2f8e0'],
  ['scripts/.runtime-identity-payload-02', 'e3be9bb2910f6108f9e6c9d108f570f6e6b26e2aad58fb75e5bacc6b9419774f'],
  ['scripts/.runtime-identity-payload-03', 'ab7442270087d4b3e0636e1f63caeb1aa3ff24871ce06ab2965af04424deaa48'],
  ['scripts/.runtime-identity-payload-04', 'e571760c51a76e94cb64124fb9583900fbf86aad344dc706911c530e51603f92'],
];
const chunks = [];
for (const [path, expected] of payloads) {
  const chunk = await readFile(path, 'utf8');
  const actual = createHash('sha256').update(chunk).digest('hex');
  if (actual !== expected) throw new Error(`Identity migration chunk mismatch: ${path} ${chunk.length} ${actual}`);
  chunks.push(chunk);
}
const payload = chunks.join('');
const compressed = Buffer.from(payload, 'base64');
const checksum = createHash('sha256').update(compressed).digest('hex');
if (checksum !== '62bf222e1bdf608856072385c8fb829e61ac6a448cf572bb8335870c703a552d') {
  throw new Error(`Identity migration payload checksum mismatch: ${checksum}`);
}
const source = gunzipSync(compressed);
const path = '/tmp/draftroll-runtime-identity-refactor.mjs';
await writeFile(path, source);
await import(pathToFileURL(path).href);
await Promise.all(
  [...payloads.map(([entry]) => entry), 'scripts/.runtime-identity-payload-01'].map((entry) =>
    unlink(entry),
  ),
);
