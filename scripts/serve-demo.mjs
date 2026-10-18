// Serves demo/ over HTTP. Content scripts don't run on file:// pages by default,
// so the demo needs a real origin. Run with `npm run demo` (PORT=... to change the port).
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'demo');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml',
};

/** Starts the server and resolves once it is listening. */
export function serveDemo(port = 8080) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) return void res.writeHead(403).end();
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      await stat(file);
    } catch {
      return void res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
    createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8080;
  await serveDemo(port);
  console.log(`Demo page: http://localhost:${port}/`);
}
