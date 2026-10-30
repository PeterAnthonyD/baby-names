import { DATA_YEAR, NAMES_TSV } from './namesData.js';

// The smallest database surface the API needs, so production (Neon) and
// tests/local dev (PGlite) can share the same code.
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

const SCHEMA = `
create table if not exists households (
  id uuid primary key,
  invite_code text unique not null,
  last_name text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists members (
  id uuid primary key,
  household_id uuid not null references households(id) on delete cascade,
  display_name text not null,
  token text unique not null,
  created_at timestamptz not null default now()
);
create table if not exists names (
  id serial primary key,
  name text not null,
  sex char(1) not null check (sex in ('F', 'M', 'U')),
  rank int,
  recent int not null default 0,
  trend text,
  peak_year int,
  household_id uuid references households(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists names_ssa_unique on names (lower(name)) where household_id is null;
create unique index if not exists names_custom_unique on names (household_id, lower(name)) where household_id is not null;
create table if not exists household_names (
  household_id uuid not null references households(id) on delete cascade,
  name_id int not null references names(id) on delete cascade,
  added_by uuid references members(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (household_id, name_id)
);
create table if not exists votes (
  member_id uuid not null references members(id) on delete cascade,
  name_id int not null references names(id) on delete cascade,
  verdict text not null check (verdict in ('pass', 'like', 'love')),
  updated_at timestamptz not null default now(),
  primary key (member_id, name_id)
);
create index if not exists votes_name on votes (name_id);
alter table names add column if not exists peak_rank int;
alter table names add column if not exists prev_rank int;
create table if not exists ratings (
  id bigserial primary key,
  member_id uuid not null references members(id) on delete cascade,
  name_id int not null references names(id) on delete cascade,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now()
);
create index if not exists ratings_member_name on ratings (member_id, name_id, created_at desc);
create table if not exists meta (key text primary key, value text not null);
`;

// Changes whenever server/namesData.ts is rebuilt, so a deploy with new data
// reloads the names automatically. The suffix forces a reload for logic changes.
const SEED_VERSION = `${DATA_YEAR}-${NAMES_TSV.length}-4`;
const BATCH = 4000;

let ready: Promise<void> | null = null;

// Creates tables and loads the SSA names on first use, so a fresh database
// needs no manual setup step.
export function ensureReady(db: Db): Promise<void> {
  ready ??= setup(db).catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

async function setup(db: Db) {
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await db.query(stmt);
  }
  const [seeded] = await db.query<{ value: string }>(`select value from meta where key = 'seed_version'`);
  if (seeded?.value === SEED_VERSION) return;

  const rows = NAMES_TSV.split('\n').map((line) => line.split('\t'));
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db.query(
      `insert into names (name, sex, rank, recent, trend, peak_year, peak_rank, prev_rank)
       select * from unnest($1::text[], $2::text[], $3::int[], $4::int[], $5::text[], $6::int[], $7::int[], $8::int[])
       on conflict (lower(name)) where household_id is null
       do update set sex = excluded.sex, rank = excluded.rank, recent = excluded.recent,
                     trend = excluded.trend, peak_year = excluded.peak_year,
                     peak_rank = excluded.peak_rank, prev_rank = excluded.prev_rank`,
      [
        chunk.map((r) => r[0]),
        chunk.map((r) => r[1]),
        chunk.map((r) => (r[2] ? Number(r[2]) : null)),
        chunk.map((r) => Number(r[3])),
        chunk.map((r) => r[4]),
        chunk.map((r) => Number(r[5])),
        chunk.map((r) => Number(r[6])),
        chunk.map((r) => (r[7] ? Number(r[7]) : null)),
      ],
    );
  }
  // Remove names dropped from the list since the last seed (e.g. placeholders
  // like "Unknown", or names that fell below the popularity cut). Names you
  // added yourselves, and names either of you already swiped, are kept.
  await db.query(
    `delete from names n where n.household_id is null and not (lower(n.name) = any($1::text[]))
       and not exists (select 1 from votes v where v.name_id = n.id)
       and not exists (select 1 from household_names hn where hn.name_id = n.id)`,
    [rows.map((r) => r[0].toLowerCase())],
  );
  await db.query(
    `insert into meta (key, value) values ('seed_version', $1)
     on conflict (key) do update set value = excluded.value`,
    [SEED_VERSION],
  );
}
