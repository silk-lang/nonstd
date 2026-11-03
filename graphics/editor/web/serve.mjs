import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json' };
export async function serve(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      const file = resolve(root, '.' + (path === '/' ? '/web/index.html' : path));
      if (!file.startsWith(root + sep) || !types[extname(file)]) { res.writeHead(404); res.end(); return; }
      const data = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)], 'cache-control': 'no-store' }); res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.argv[2] || 8050));
  console.log(`Silk editor: http://127.0.0.1:${server.address().port}`);
}
