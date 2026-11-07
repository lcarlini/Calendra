/**
 * Run the news proxy on your own machine (no Cloudflare account needed):
 *
 *   ALLOWED_ORIGINS=http://localhost:8080 node backend/news-proxy/server.mjs
 *
 * Binds to 127.0.0.1 by default, so only this computer can reach it. Set HOST to change that.
 * ALLOWED_ORIGINS is a comma-separated list of the exact origins of the pages allowed to read it.
 */
import http from 'node:http';
import worker from './worker.js';

const port = Number(process.env.PORT || 8791);
const host = process.env.HOST || '127.0.0.1';
const env = { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '' };

if (!env.ALLOWED_ORIGINS) {
  console.warn('ALLOWED_ORIGINS is empty: browsers will be refused. Example: ALLOWED_ORIGINS=http://localhost:8080');
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = `http://${req.headers.host || `${host}:${port}`}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      if (!headers.has('x-forwarded-for')) headers.set('x-forwarded-for', req.socket.remoteAddress || 'local');
      const response = await worker.fetch(new Request(url, { method: req.method, headers }), env);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal error' }));
    }
  });
}

if (process.argv[1] && /server\.mjs$/.test(process.argv[1])) {
  createServer().listen(port, host, () =>
    console.log(`Calendra news proxy on http://${host}:${port} (origins: ${env.ALLOWED_ORIGINS || 'none'})`)
  );
}
