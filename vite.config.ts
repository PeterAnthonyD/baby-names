import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Serves /api/* from server/api.ts during `npm run dev`. Uses DATABASE_URL when
// set, otherwise an in-memory database that resets on restart.
function devApi(): Plugin {
  return {
    name: 'dev-api',
    configureServer(server) {
      let dbPromise: Promise<import('./server/db').Db> | null = null;
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        dbPromise ??= process.env.DATABASE_URL
          ? server.ssrLoadModule('/server/pg.ts').then((m) => m.pgDb())
          : server.ssrLoadModule('/server/pglite.ts').then((m) => m.pgliteDb());
        const { handleApi } = await server.ssrLoadModule('/server/api.ts');
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const text = Buffer.concat(chunks).toString();
        const url = new URL(req.url, 'http://localhost');
        const auth = req.headers.authorization;
        const result = await handleApi(await dbPromise, {
          method: req.method ?? 'GET',
          path: url.pathname,
          query: url.searchParams,
          token: auth?.startsWith('Bearer ') ? auth.slice(7) : null,
          body: text ? JSON.parse(text) : null,
        });
        res.statusCode = result.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result.body));
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), devApi()],
  server: { host: true },
});
