import { randomBytes, randomUUID } from 'node:crypto';
import { ensureReady, type Db } from './db.js';
import { DATA_YEAR, TREND_YEARS } from './namesData.js';

export type ApiRequest = {
  method: string;
  path: string; // e.g. "/api/deck"
  query: URLSearchParams;
  token: string | null;
  body: unknown;
};
export type ApiResponse = { status: number; body: unknown };

export type Verdict = 'pass' | 'like' | 'love';
const VERDICTS: Verdict[] = ['pass', 'like', 'love'];

type Member = { id: string; household_id: string; display_name: string };

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });

export async function handleApi(db: Db, req: ApiRequest): Promise<ApiResponse> {
  try {
    await ensureReady(db);
    const route = `${req.method} ${req.path.replace(/\/+$/, '')}`;
    switch (route) {
      case 'GET /api/health':
        return ok({ ok: true });
      case 'POST /api/family':
        return ok(await createFamily(db, req.body));
      case 'POST /api/join':
        return ok(await joinFamily(db, req.body));
      case 'POST /api/family/members':
        return ok(await familyMembers(db, req.body));
      case 'GET /api/me':
        return ok(await me(db, await auth(db, req)));
      case 'PATCH /api/family':
        return ok(await updateFamily(db, await auth(db, req), req.body));
      case 'GET /api/deck':
        return ok(await deck(db, await auth(db, req), req.query));
      case 'POST /api/vote':
        return ok(await vote(db, await auth(db, req), req.body));
      case 'DELETE /api/vote':
        return ok(await unvote(db, await auth(db, req), req.query));
      case 'POST /api/names':
        return ok(await addName(db, await auth(db, req), req.body));
      case 'GET /api/results':
        return ok(await results(db, await auth(db, req)));
      case 'GET /api/rate/next':
        return ok(await nextToRate(db, await auth(db, req), req.query));
      case 'POST /api/rate':
        return ok(await rate(db, await auth(db, req), req.body));
      case 'POST /api/reset':
        return ok(await reset(db, await auth(db, req), req.body));
      case 'GET /api/rankings':
        return ok(await rankings(db, await auth(db, req)));
      default:
        return { status: 404, body: { error: 'Not found' } };
    }
  } catch (err) {
    if (err instanceof HttpError) return { status: err.status, body: { error: err.message } };
    console.error(err);
    return { status: 500, body: { error: 'Something went wrong' } };
  }
}

// ---------- helpers ----------

function field(body: unknown, key: string, max = 40): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `Missing ${key}`);
  return value.trim().slice(0, max);
}

function optionalField(body: unknown, key: string, max = 40): string {
  const value = (body as Record<string, unknown> | null)?.[key];
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function auth(db: Db, req: ApiRequest): Promise<Member> {
  if (!req.token) throw new HttpError(401, 'Not signed in');
  const [member] = await db.query<Member>(
    'select id, household_id, display_name from members where token = $1',
    [req.token],
  );
  if (!member) throw new HttpError(401, 'Not signed in');
  return member;
}

// No 0/O/1/I so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function inviteCode(): string {
  const bytes = randomBytes(6);
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

async function addMember(db: Db, householdId: string, displayName: string) {
  const token = randomBytes(24).toString('base64url');
  await db.query('insert into members (id, household_id, display_name, token) values ($1, $2, $3, $4)', [
    randomUUID(),
    householdId,
    displayName,
    token,
  ]);
  return token;
}

// ---------- family ----------

async function createFamily(db: Db, body: unknown) {
  const displayName = field(body, 'displayName');
  const lastName = optionalField(body, 'lastName');
  const id = randomUUID();
  for (let attempt = 0; ; attempt++) {
    try {
      await db.query('insert into households (id, invite_code, last_name) values ($1, $2, $3)', [
        id,
        inviteCode(),
        lastName,
      ]);
      break;
    } catch (err) {
      if (attempt >= 3) throw err; // invite code collision is the only expected failure
    }
  }
  return { token: await addMember(db, id, displayName) };
}

async function householdByCode(db: Db, body: unknown) {
  const code = field(body, 'code', 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const [household] = await db.query<{ id: string }>('select id from households where invite_code = $1', [code]);
  if (!household) throw new HttpError(404, 'No family with that code');
  return household;
}

// Joins as a new person, or with memberId signs back in as someone already in
// the family (new phone, cleared browser). The family code is the only secret,
// so anyone who has it can do either.
async function joinFamily(db: Db, body: unknown) {
  const household = await householdByCode(db, body);
  const memberId = (body as Record<string, unknown> | null)?.memberId;
  if (typeof memberId === 'string') {
    const [member] = await db.query<{ token: string }>(
      'select token from members where id::text = $1 and household_id = $2',
      [memberId, household.id],
    );
    if (!member) throw new HttpError(404, 'That person is not in this family');
    return { token: member.token };
  }
  return { token: await addMember(db, household.id, field(body, 'displayName')) };
}

async function familyMembers(db: Db, body: unknown) {
  const household = await householdByCode(db, body);
  const members = await db.query<{ id: string; displayName: string }>(
    'select id, display_name as "displayName" from members where household_id = $1 order by created_at',
    [household.id],
  );
  return { members };
}

async function me(db: Db, member: Member) {
  const [household] = await db.query<{ invite_code: string; last_name: string }>(
    'select invite_code, last_name from households where id = $1',
    [member.household_id],
  );
  const partners = await db.query<{ display_name: string }>(
    'select display_name from members where household_id = $1 and id <> $2 order by created_at',
    [member.household_id, member.id],
  );
  return {
    displayName: member.display_name,
    inviteCode: household.invite_code,
    lastName: household.last_name,
    partners: partners.map((p) => p.display_name),
    dataYear: DATA_YEAR,
    trendYears: TREND_YEARS,
  };
}

async function updateFamily(db: Db, member: Member, body: unknown) {
  await db.query('update households set last_name = $1 where id = $2', [
    optionalField(body, 'lastName'),
    member.household_id,
  ]);
  return me(db, member);
}

// ---------- deck ----------

export type Card = {
  id: number;
  name: string;
  sex: 'F' | 'M' | 'U';
  rank: number | null;
  trend: 'up' | 'down' | 'flat' | null;
  peakYear: number | null;
  peakRank: number | null;
  prevRank: number | null;
  addedBy: string | null;
};

const CARD_COLUMNS = `n.id, n.name, n.sex, n.rank, n.trend, n.peak_year as "peakYear",
  n.peak_rank as "peakRank", n.prev_rank as "prevRank", am.display_name as "addedBy"`;

async function deck(db: Db, member: Member, query: URLSearchParams): Promise<{ cards: Card[] }> {
  const params: unknown[] = [member.id, member.household_id];
  const filters: string[] = [];

  const sex = query.get('sex');
  if (sex === 'F' || sex === 'M') {
    params.push(sex);
    filters.push(`n.sex in ($${params.length}, 'U')`);
  }
  const popularity = query.get('popularity');
  if (popularity === 'top100') filters.push('n.rank <= 100');
  else if (popularity === 'top1000') filters.push('n.rank <= 1000');
  else if (popularity === 'rare') filters.push('(n.rank > 1000 or n.rank is null)');
  const letter = query.get('letter');
  if (letter && /^[A-Za-z]$/.test(letter)) {
    params.push(letter.toUpperCase());
    filters.push(`upper(left(n.name, 1)) = $${params.length}`);
  }
  const limit = Math.min(Number(query.get('limit')) || 30, 100);

  // Names either of you added always come first and ignore filters. Next come
  // names your partner has already swiped, whatever they chose, so you catch
  // up with them without learning their answer. The rest is a random
  // draw weighted toward popular names (weighted sampling: random()^(1/weight)),
  // so the deck isn't mostly one-off spellings.
  const cards = await db.query<Card>(
    `select ${CARD_COLUMNS}
     from names n
     left join household_names hn on hn.name_id = n.id and hn.household_id = $2
     left join members am on am.id = hn.added_by
     where (n.household_id is null or n.household_id = $2)
       and not exists (select 1 from votes v where v.member_id = $1 and v.name_id = n.id)
       and (hn.name_id is not null ${filters.length ? `or (${filters.join(' and ')})` : 'or true'})
     order by
       (hn.name_id is not null) desc,
       exists (
         select 1 from votes v join members m on m.id = v.member_id
         where m.household_id = $2 and m.id <> $1 and v.name_id = n.id
       ) desc,
       power(random(), 1.0 / power(n.recent + 20, 0.7)) desc
     limit ${limit}`,
    params,
  );
  return { cards };
}

async function vote(db: Db, member: Member, body: unknown) {
  const nameId = Number((body as Record<string, unknown> | null)?.nameId);
  const verdict = (body as Record<string, unknown> | null)?.verdict as Verdict;
  if (!Number.isInteger(nameId)) throw new HttpError(400, 'Missing nameId');
  if (!VERDICTS.includes(verdict)) throw new HttpError(400, 'Verdict must be pass, like or love');
  const [name] = await db.query(
    'select id from names where id = $1 and (household_id is null or household_id = $2)',
    [nameId, member.household_id],
  );
  if (!name) throw new HttpError(404, 'No such name');
  await db.query(
    `insert into votes (member_id, name_id, verdict) values ($1, $2, $3)
     on conflict (member_id, name_id) do update set verdict = excluded.verdict, updated_at = now()`,
    [member.id, nameId, verdict],
  );
  return { ok: true };
}

async function unvote(db: Db, member: Member, query: URLSearchParams) {
  const nameId = Number(query.get('nameId'));
  if (!Number.isInteger(nameId)) throw new HttpError(400, 'Missing nameId');
  await db.query('delete from votes where member_id = $1 and name_id = $2', [member.id, nameId]);
  return { ok: true };
}

// ---------- names you add ----------

async function addName(db: Db, member: Member, body: unknown): Promise<{ card: Card }> {
  const raw = field(body, 'name', 30);
  if (!/^[\p{L}][\p{L}'’ -]*$/u.test(raw)) throw new HttpError(400, 'Use letters only');
  const name = raw.charAt(0).toUpperCase() + raw.slice(1);
  const sexInput = (body as Record<string, unknown> | null)?.sex;
  const sex = sexInput === 'F' || sexInput === 'M' ? sexInput : 'U';

  // Reuse the SSA entry (or an earlier custom one) when the name already exists.
  let [existing] = await db.query<{ id: number }>(
    `select id from names where lower(name) = lower($1) and (household_id is null or household_id = $2)
     order by household_id nulls first limit 1`,
    [name, member.household_id],
  );
  if (!existing) {
    [existing] = await db.query<{ id: number }>(
      'insert into names (name, sex, household_id) values ($1, $2, $3) returning id',
      [name, sex, member.household_id],
    );
  }
  await db.query(
    `insert into household_names (household_id, name_id, added_by) values ($1, $2, $3)
     on conflict (household_id, name_id) do nothing`,
    [member.household_id, existing.id, member.id],
  );
  const [card] = await db.query<Card>(
    `select ${CARD_COLUMNS} from names n
     join household_names hn on hn.name_id = n.id and hn.household_id = $2
     left join members am on am.id = hn.added_by
     where n.id = $1`,
    [existing.id, member.household_id],
  );
  return { card };
}

// ---------- results ----------

export type ResultRow = Card & { mine: Verdict | null; theirs: Verdict | null };

const score = (v: Verdict | null) => (v === 'love' ? 2 : v === 'like' ? 1 : 0);
const likes = (v: Verdict | null) => v === 'like' || v === 'love';

async function results(db: Db, member: Member) {
  // With two of you, "theirs" is your partner's vote. With more members it is
  // the most enthusiastic vote among them.
  const rows = await db.query<ResultRow & { theirs_score: number | null; mine_v: Verdict | null }>(
    `select ${CARD_COLUMNS},
       max(case when v.member_id = $1 then v.verdict end) as mine,
       max(case when v.member_id <> $1 then
         case v.verdict when 'love' then 2 when 'like' then 1 else 0 end end) as theirs_score
     from votes v
     join members m on m.id = v.member_id and m.household_id = $2
     join names n on n.id = v.name_id
     left join household_names hn on hn.name_id = n.id and hn.household_id = $2
     left join members am on am.id = hn.added_by
     group by n.id, n.name, n.sex, n.rank, n.trend, n.peak_year, n.peak_rank, n.prev_rank, am.display_name`,
    [member.id, member.household_id],
  );
  const list: ResultRow[] = rows.map(({ theirs_score, ...r }) => ({
    ...r,
    theirs: theirs_score == null ? null : (['pass', 'like', 'love'] as const)[theirs_score],
  }));

  const byName = (a: ResultRow, b: ResultRow) => a.name.localeCompare(b.name);
  const matches = list
    .filter((r) => likes(r.mine) && likes(r.theirs))
    .sort((a, b) => score(b.mine) + score(b.theirs) - (score(a.mine) + score(a.theirs)) || byName(a, b));
  const onlyMe = list.filter((r) => likes(r.mine) && r.theirs === 'pass').sort(byName);
  const onlyThem = list.filter((r) => likes(r.theirs) && r.mine === 'pass').sort(byName);
  const waitingOnThem = list.filter((r) => likes(r.mine) && r.theirs === null).sort(byName);
  // Only a count, never which names or how they voted, so it can't sway you.
  const unseenByMe = list.filter((r) => r.theirs !== null && r.mine === null).length;
  const bothPassed = list.filter((r) => r.mine === 'pass' && r.theirs === 'pass').sort(byName);

  return { matches, onlyMe, onlyThem, waitingOnThem, unseenByMe, bothPassed };
}

// ---------- ratings ----------

// Every 1-5 rating is kept. A person's score for a name is the average of
// their last RECENT_RATINGS ratings, so it keeps moving as you re-rate.
const RECENT_RATINGS = 3;

// The pool is every name either of you liked or loved, limited to names you
// have swiped yourself so it never shows you your partner's picks early.
// `household` and `member` are the SQL parameters holding those ids, e.g. "$2".
const pool = (household: string, member: string) => `
  select distinct v.name_id from votes v
  join members m on m.id = v.member_id
  where m.household_id = ${household} and v.verdict in ('like', 'love')
    and exists (select 1 from votes mv where mv.member_id = ${member} and mv.name_id = v.name_id)`;

async function nextToRate(db: Db, member: Member, query: URLSearchParams) {
  const skip = (query.get('skip') ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);

  // Random pick, weighted: a name you've never rated is 6x as likely as one
  // you just rated, and a rated name's weight grows back over a day. Weighted
  // sampling via random()^(1/weight). The client skips the last few shown.
  const [card] = await db.query<Card & { myScore: number | null; timesRated: number }>(
    `with pool as (${pool('$2', '$1')}),
     mine as (
       select name_id, count(*)::int as times, max(created_at) as last_at
       from ratings where member_id = $1 group by name_id
     )
     select ${CARD_COLUMNS}, coalesce(mine.times, 0) as "timesRated",
       (select round(avg(score)::numeric, 1)::float from (
          select score from ratings r where r.member_id = $1 and r.name_id = n.id
          order by created_at desc limit ${RECENT_RATINGS}) s) as "myScore"
     from pool
     join names n on n.id = pool.name_id
     left join mine on mine.name_id = n.id
     left join household_names hn on hn.name_id = n.id and hn.household_id = $2
     left join members am on am.id = hn.added_by
     where not (n.id = any($3::int[]))
     order by power(random(), 1.0 / case
       when mine.name_id is null then 6
       else 1 + least(extract(epoch from now() - mine.last_at) / 3600, 24) / 6 end) desc
     limit 1`,
    [member.id, member.household_id, skip],
  );
  const [{ size }] = await db.query<{ size: number }>(`select count(*)::int as size from (${pool('$1', '$2')}) p`, [
    member.household_id,
    member.id,
  ]);
  return { card: card ?? null, poolSize: size };
}

async function rate(db: Db, member: Member, body: unknown) {
  const nameId = Number((body as Record<string, unknown> | null)?.nameId);
  const score = Number((body as Record<string, unknown> | null)?.score);
  if (!Number.isInteger(nameId)) throw new HttpError(400, 'Missing nameId');
  if (!Number.isInteger(score) || score < 1 || score > 5) throw new HttpError(400, 'Score must be 1 to 5');
  const [inPool] = await db.query(`select 1 from (${pool('$1', '$2')}) p where name_id = $3`, [
    member.household_id,
    member.id,
    nameId,
  ]);
  if (!inPool) throw new HttpError(404, 'Only names you have swiped and one of you liked can be rated');
  await db.query('insert into ratings (member_id, name_id, score) values ($1, $2, $3)', [member.id, nameId, score]);
  return { ok: true };
}

export type RankingRow = Card & {
  mine: number | null;
  theirs: number | null;
  combined: number | null;
  myVote: Verdict | null;
  theirVote: Verdict | null;
};

async function rankings(db: Db, member: Member): Promise<{ rows: RankingRow[] }> {
  // Per person: average of their latest ratings. "theirs" averages the other
  // members (just your partner for a couple). Combined averages whoever rated.
  const rows = await db.query<RankingRow>(
    `with pool as (${pool('$2', '$1')}),
     recent as (
       select r.member_id, r.name_id, r.score,
         row_number() over (partition by r.member_id, r.name_id order by r.created_at desc) as rn
       from ratings r join members m on m.id = r.member_id
       where m.household_id = $2
     ),
     per_member as (
       select member_id, name_id, avg(score) as score from recent
       where rn <= ${RECENT_RATINGS} group by member_id, name_id
     )
     select ${CARD_COLUMNS},
       round(avg(pm.score) filter (where pm.member_id = $1)::numeric, 1)::float as mine,
       round(avg(pm.score) filter (where pm.member_id <> $1)::numeric, 1)::float as theirs,
       round(avg(pm.score)::numeric, 1)::float as combined,
       (select verdict from votes where member_id = $1 and name_id = n.id) as "myVote",
       (select max(v.verdict) from votes v join members m on m.id = v.member_id
         where m.household_id = $2 and m.id <> $1 and v.name_id = n.id) as "theirVote"
     from pool
     join names n on n.id = pool.name_id
     left join per_member pm on pm.name_id = n.id
     left join household_names hn on hn.name_id = n.id and hn.household_id = $2
     left join members am on am.id = hn.added_by
     group by n.id, n.name, n.sex, n.rank, n.trend, n.peak_year, n.peak_rank, n.prev_rank, am.display_name`,
    [member.id, member.household_id],
  );
  return { rows };
}

// ---------- reset ----------

// "me" clears your own swipes and ratings. "family" clears both of yours plus
// the names you added; the family, its code and both sign-ins stay.
async function reset(db: Db, member: Member, body: unknown) {
  const scope = (body as Record<string, unknown> | null)?.scope;
  if (scope === 'me') {
    await db.query('delete from votes where member_id = $1', [member.id]);
    await db.query('delete from ratings where member_id = $1', [member.id]);
  } else if (scope === 'family') {
    const members = 'select id from members where household_id = $1';
    await db.query(`delete from votes where member_id in (${members})`, [member.household_id]);
    await db.query(`delete from ratings where member_id in (${members})`, [member.household_id]);
    await db.query('delete from household_names where household_id = $1', [member.household_id]);
    await db.query('delete from names where household_id = $1', [member.household_id]);
  } else {
    throw new HttpError(400, 'Scope must be me or family');
  }
  return { ok: true };
}
