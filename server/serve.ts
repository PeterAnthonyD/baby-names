// Production server for Render: serves the built app from dist/ and the API.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { handleApi } from './api.js';
import { pgDb } from './pg.js';

const db = pgDb();
const dist = new URL('../dist/', import.meta.url).pathname;
const port = Number(process.env.PORT) || 3000;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname.startsWith('/api/')) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      res.writeHead(400).end();
      return;
    }
    const auth = req.headers.authorization;
    const result = await handleApi(db, {
      method: req.method ?? 'GET',
      path: url.pathname,
      query: url.searchParams,
      token: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
      body,
    });
    res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(result.body));
    return;
  }

  // Static files, falling back to index.html for app routes.
  const path = normalize(join(dist, decodeURIComponent(url.pathname)));
  const file = path.startsWith(dist) && extname(path) ? path : join(dist, 'index.html');
  try {
    const data = await readFile(file);
    const cache = file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Listening on ${port}`));
