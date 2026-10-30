import { PGlite } from '@electric-sql/pglite';
import type { Db } from './db.js';

// In-memory Postgres for tests and `npm run dev` without a DATABASE_URL.
export function pgliteDb(): Db {
  const pg = new PGlite();
  return { query: async (text, params) => (await pg.query(text, params)).rows as never };
}
