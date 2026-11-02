// A static server for the demo page: the page and its loader from graphics/demo/web, the wasm
// module given on the command line, and the window and WebGPU hosts from their packages.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const web = dirname(fileURLToPath(import.meta.url));
const repo = resolve(web, '../../..');
const roots = [resolve(repo, 'platform/window/browser'), resolve(repo, 'gpu/webgpu/browser')];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.ts': 'text/javascript', '.wasm': 'application/wasm' };

export async function serve(wasmPath, port = 0) {
  const wasm = await readFile(wasmPath);
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      let file;
      if (pathname === '/') file = resolve(web, 'index.html');
      else if (pathname === '/demo.js') file = resolve(web, 'demo.js');
      else if (pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      else if (pathname === '/demo.wasm') { response.writeHead(200, { 'content-type': types['.wasm'] }); response.end(wasm); return; }
      else {
        const candidate = resolve(repo, '.' + pathname);
        if (roots.some(root => candidate.startsWith(root + sep)) && ['.js', '.ts'].includes(extname(candidate))) file = candidate;
      }
      if (!file) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': types[extname(file)] });
      response.end(await readFile(file));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  const listening = Promise.withResolvers();
  server.once('error', listening.reject);
  server.listen(port, '127.0.0.1', listening.resolve);
  await listening.promise;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [wasm, port] = process.argv.slice(2);
  if (!wasm) throw new Error('Usage: node web/serve.mjs DEMO.wasm [PORT]');
  const server = await serve(wasm, Number(port ?? 8040));
  console.log(`The demo is at http://127.0.0.1:${server.address().port}/ (a WebGPU browser; Ctrl+C stops)`);
}
