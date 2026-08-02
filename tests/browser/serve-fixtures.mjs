import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((value, index, values) => {
    if (!value.startsWith('--')) return [value, ''];
    const next = values[index + 1];
    return [value.slice(2), next && !next.startsWith('--') ? next : 'true'];
  }),
);
const port = Number(args.get('port') ?? 4173);
const role = args.get('role') ?? 'host';
const root = resolve(process.cwd(), 'dist-browser');

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.woff2', 'font/woff2'],
  ['.glb', 'model/gltf-binary'],
]);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
  if (url.pathname === '/health') {
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('ok');
    return;
  }

  let pathname = url.pathname;
  if (role === 'host' && (pathname === '/' || pathname === '/host.html')) pathname = '/host.html';
  if (role === 'host' && (pathname === '/blocked.html' || pathname === '/connect-blocked.html'))
    pathname = '/host.html';
  if (role === 'overlay' && pathname === '/') pathname = '/overlay.html';

  const safePath = normalize(pathname)
    .replace(/^([.][.][/\\])+/, '')
    .replace(/^[/\\]+/, '');
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root) || !isFile(filePath)) {
    response.writeHead(404, securityHeaders(role, url.pathname));
    response.end('Not found');
    return;
  }

  response.writeHead(200, {
    ...securityHeaders(role, url.pathname),
    'content-type': mimeTypes.get(extname(filePath)) ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(filePath).pipe(response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Draftroll ${role} fixture listening on http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function securityHeaders(serverRole, pathname) {
  const common = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  if (serverRole === 'overlay') {
    return {
      ...common,
      'content-security-policy': [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "style-src-attr 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' data: blob:",
        "connect-src 'self'",
        "worker-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'none'",
        'frame-ancestors http://127.0.0.1:4173',
      ].join('; '),
      'cross-origin-resource-policy': 'cross-origin',
    };
  }

  const frameSource = pathname === '/blocked.html' ? "'none'" : 'http://127.0.0.1:4174';
  const connectSource =
    pathname === '/connect-blocked.html'
      ? "'self'"
      : "'self' http://127.0.0.1:8787 ws://127.0.0.1:8787";
  return {
    ...common,
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "style-src-attr 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src ${connectSource}`,
      `frame-src ${frameSource}`,
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}
