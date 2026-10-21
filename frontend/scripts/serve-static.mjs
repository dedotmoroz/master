import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proxyPublicApi } from './public-proxy.mjs';
import { proxyAuthentication } from './auth-proxy.mjs';
import { proxyOrders, orderRoute } from './orders-proxy.mjs';

// Preview only: serves files from out, without importing Next.js or running React.
const root = await realpath(fileURLToPath(new URL('../out/', import.meta.url))).catch(() => {
  console.error('Static export not found. Run npm run build first.');
  process.exit(1);
});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const port=Number(process.env.PREVIEW_PORT||4178);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid PREVIEW_PORT');
createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const requestUrl = new URL(req.url, 'http://localhost');
  if(orderRoute(requestUrl.pathname,req.method)||requestUrl.pathname.startsWith('/api/v1/bids/')||requestUrl.pathname.startsWith('/api/v1/guest-orders')||requestUrl.pathname.startsWith('/api/v1/customer/orders')||requestUrl.pathname.startsWith('/api/v1/contractor/bids')){
    await proxyOrders(req,res,requestUrl);return;
  }
  if(requestUrl.pathname.startsWith('/api/v1/auth/')) {
    await proxyAuthentication(req,res,requestUrl); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) { await proxyPublicApi(req,res,url); return; }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (path !== root && !path.startsWith(root + sep)) throw new Error('Outside export');
    let target = await realpath(path);
    if (target !== root && !target.startsWith(root + sep)) throw new Error('Outside export');
    if ((await stat(target)).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(308, { Location: url.pathname + '/' + url.search }); res.end(); return;
      }
      target = await realpath(resolve(target, 'index.html'));
    }
    if (!target.startsWith(root + sep)) throw new Error('Outside export');
    const body = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(resolve(root, '404.html')));
  }
}).listen(port, '127.0.0.1', () => console.log(`Static export: http://127.0.0.1:${port} (files from out; no Next server)`));
