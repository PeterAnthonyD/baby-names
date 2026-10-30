import pg from 'pg';
import type { Db } from './db.js';

export function pgDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  // Render's internal URLs don't use SSL; its external URLs need it.
  const ssl = /\.render\.com/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
  return { query: async (text, params) => (await pool.query(text, params)).rows as never };
}
