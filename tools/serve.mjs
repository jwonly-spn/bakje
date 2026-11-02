// 박제관 사이트(docs/)를 이 PC에서 미리 보기: node tools/serve.mjs [포트]
// 실제 사이트처럼 /bakje/ 아래에서 열린다(http://127.0.0.1:<포트>/bakje/).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const PORT = Number(process.argv[2] || 5320);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/' ) { res.writeHead(302, { Location: '/bakje/' }); return res.end(); }
  if (!p.startsWith('/bakje/')) { res.writeHead(404); return res.end('not found'); }
  p = p.slice('/bakje'.length);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`박제관 미리 보기: http://127.0.0.1:${PORT}/bakje/`));
