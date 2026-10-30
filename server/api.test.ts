import { beforeAll, describe, expect, it } from 'vitest';
import { handleApi } from './api.js';
import { pgliteDb } from './pglite.js';

const db = pgliteDb();

async function call(method: string, path: string, token: string | null = null, body: unknown = null) {
  const [p, qs] = path.split('?');
  const res = await handleApi(db, { method, path: p, query: new URLSearchParams(qs), token, body });
  return res as { status: number; body: any };
}

let petey = '';
let wife = '';

beforeAll(async () => {
  petey = (await call('POST', '/api/family', null, { displayName: 'Petey', lastName: 'Smith' })).body.token;
  const me = await call('GET', '/api/me', petey);
  wife = (await call('POST', '/api/join', null, { code: me.body.inviteCode.toLowerCase(), displayName: 'Wife' })).body.token;
}, 60_000);

describe('api', () => {
  it('seeds the SSA names and pairs both people', async () => {
    const [{ count }] = await db.query<{ count: number }>('select count(*)::int as count from names');
    expect(count).toBeGreaterThan(20_000);
    const me = await call('GET', '/api/me', petey);
    expect(me.body).toMatchObject({ displayName: 'Petey', lastName: 'Smith', partners: ['Wife'] });
  });

  it('rejects requests without a valid token', async () => {
    expect((await call('GET', '/api/deck')).status).toBe(401);
    expect((await call('GET', '/api/deck', 'nope')).status).toBe(401);
    expect((await call('POST', '/api/join', null, { code: 'ZZZZZZ', displayName: 'x' })).status).toBe(404);
  });

  it('filters the deck', async () => {
    const top = await call('GET', '/api/deck?sex=F&popularity=top100&limit=50', petey);
    expect(top.body.cards.length).toBe(50);
    for (const c of top.body.cards) {
      expect(c.rank).toBeLessThanOrEqual(100);
      expect(['F', 'U']).toContain(c.sex);
    }
    const letter = await call('GET', '/api/deck?letter=q', petey);
    expect(letter.body.cards.every((c: any) => c.name.startsWith('Q'))).toBe(true);
  });

  it('computes matches and disagreements', async () => {
    const id = async (name: string) =>
      (await db.query<{ id: number }>('select id from names where name = $1', [name]))[0].id;
    const [emma, ava, liam, noah] = await Promise.all(['Emma', 'Ava', 'Liam', 'Noah'].map(id));
    const v = (t: string, nameId: number, verdict: string) => call('POST', '/api/vote', t, { nameId, verdict });
    await v(petey, emma, 'love');
    await v(wife, emma, 'like');
    await v(petey, ava, 'like');
    await v(wife, ava, 'pass');
    await v(petey, liam, 'pass');
    await v(wife, liam, 'love');
    await v(petey, noah, 'like');

    const r = (await call('GET', '/api/results', petey)).body;
    expect(r.matches.map((x: any) => x.name)).toEqual(['Emma']);
    expect(r.onlyMe.map((x: any) => x.name)).toEqual(['Ava']);
    expect(r.onlyThem.map((x: any) => x.name)).toEqual(['Liam']);
    expect(r.waitingOnThem.map((x: any) => x.name)).toEqual(['Noah']);

    const w = (await call('GET', '/api/results', wife)).body;
    expect(w.onlyMe.map((x: any) => x.name)).toEqual(['Liam']);
    expect(w.waitingOnMe).toBe(1);

    // Noah (liked by Petey) is first in the wife's deck; voted names never come back.
    const deck = (await call('GET', '/api/deck?limit=100', wife)).body.cards;
    expect(deck[0].name).toBe('Noah');
    expect(deck.some((c: any) => ['Emma', 'Ava', 'Liam'].includes(c.name))).toBe(false);

    await call('DELETE', `/api/vote?nameId=${noah}`, petey);
    expect((await call('GET', '/api/results', petey)).body.waitingOnThem).toEqual([]);
  });

  it('puts added names at the front of both decks, ignoring filters', async () => {
    const added = await call('POST', '/api/names', petey, { name: 'zephyrine', sex: 'F' });
    expect(added.body.card).toMatchObject({ name: 'Zephyrine', addedBy: 'Petey' });
    const again = await call('POST', '/api/names', wife, { name: 'Zephyrine' });
    expect(again.body.card.id).toBe(added.body.card.id);

    // An SSA name added by hand reuses the existing entry.
    const olivia = await call('POST', '/api/names', wife, { name: 'olivia' });
    expect(olivia.body.card).toMatchObject({ name: 'Olivia', addedBy: 'Wife' });
    expect(olivia.body.card.rank).not.toBeNull();

    const deck = (await call('GET', '/api/deck?sex=M&popularity=rare&letter=b', petey)).body.cards;
    expect(deck.slice(0, 2).map((c: any) => c.name).sort()).toEqual(['Olivia', 'Zephyrine']);

    // Custom names are private to the family.
    const other = (await call('POST', '/api/family', null, { displayName: 'Other' })).body.token;
    const otherDeck = (await call('GET', '/api/deck?letter=z&limit=100', other)).body.cards;
    expect(otherDeck.some((c: any) => c.name === 'Zephyrine')).toBe(false);
    expect((await call('POST', '/api/vote', other, { nameId: added.body.card.id, verdict: 'like' })).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/names', petey, { name: '<script>' })).status).toBe(400);
    expect((await call('POST', '/api/vote', petey, { nameId: 1, verdict: 'meh' })).status).toBe(400);
  });
});

describe('ratings', () => {
  const id = async (name: string) =>
    (await db.query<{ id: number }>('select id from names where name = $1 and household_id is null', [name]))[0].id;

  it('only offers names one of you liked, and keeps re-asking', async () => {
    const emma = await id('Emma'); // both like (from the earlier test)
    const liam = await id('Liam'); // only the wife loves it
    const ava = await id('Ava'); // only Petey likes it
    const caleb = await id('Caleb'); // nobody voted

    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const next = (await call('GET', '/api/rate/next', petey)).body;
      seen.add(next.card.name);
    }
    expect(seen.has('Caleb')).toBe(false);
    expect(seen.has('Emma') && seen.has('Liam') && seen.has('Ava')).toBe(true);

    expect((await call('POST', '/api/rate', petey, { nameId: caleb, score: 3 })).status).toBe(404);
    expect((await call('POST', '/api/rate', petey, { nameId: emma, score: 6 })).status).toBe(400);

    // Rated names still come back; skip excludes the one just shown.
    await call('POST', '/api/rate', petey, { nameId: emma, score: 5 });
    const after = new Set<string>();
    for (let i = 0; i < 60; i++) after.add((await call('GET', '/api/rate/next', petey)).body.card.name);
    expect(after.has('Emma')).toBe(true);
    const skipped = (await call('GET', `/api/rate/next?skip=${emma},${liam},${ava}`, petey)).body;
    expect(['Emma', 'Liam', 'Ava']).not.toContain(skipped.card?.name);
  });

  it('ranks by the average of each person’s latest three ratings', async () => {
    const emma = await id('Emma');
    const liam = await id('Liam');
    // Petey: Emma 5 (above), then 1, 4, 4 -> last three = 1,4,4 -> 3.0
    for (const score of [1, 4, 4]) await call('POST', '/api/rate', petey, { nameId: emma, score });
    await call('POST', '/api/rate', wife, { nameId: emma, score: 4 });
    await call('POST', '/api/rate', wife, { nameId: liam, score: 5 });

    const rows = (await call('GET', '/api/rankings', petey)).body.rows;
    const byName = Object.fromEntries(rows.map((r: any) => [r.name, r]));
    expect(byName.Emma).toMatchObject({ mine: 3, theirs: 4, combined: 3.5, myVote: 'love', theirVote: 'like' });
    expect(byName.Liam).toMatchObject({ mine: null, theirs: 5, combined: 5, myVote: 'pass', theirVote: 'love' });

    const wifeRows = (await call('GET', '/api/rankings', wife)).body.rows;
    expect(wifeRows.find((r: any) => r.name === 'Emma')).toMatchObject({ mine: 4, theirs: 3 });
  });
});

describe('names list', () => {
  it('has no placeholders or obvious errors', async () => {
    const junk = await db.query<{ name: string }>(
      `select name from names where lower(name) in ('unknown', 'baby', 'babyboy', 'infant', 'male', 'notnamed', 'jr', 'willliam')`,
    );
    expect(junk).toEqual([]);
  });
});

describe('reset', () => {
  const counts = async () =>
    (
      await db.query<{ petey: number; wife: number; ratings: number; added: number }>(
        `select
           (select count(*)::int from votes v join members m on m.id = v.member_id where m.display_name = 'Petey') as petey,
           (select count(*)::int from votes v join members m on m.id = v.member_id where m.display_name = 'Wife') as wife,
           (select count(*)::int from ratings) as ratings,
           (select count(*)::int from household_names) as added`,
      )
    )[0];

  it('clears just your own swipes and ratings', async () => {
    const before = await counts();
    expect(before.petey).toBeGreaterThan(0);
    expect(before.wife).toBeGreaterThan(0);
    await call('POST', '/api/reset', petey, { scope: 'me' });
    const after = await counts();
    expect(after.petey).toBe(0);
    expect(after.wife).toBe(before.wife);
    expect(after.added).toBe(before.added);
  });

  it('clears the whole family but keeps you paired', async () => {
    await call('POST', '/api/reset', wife, { scope: 'family' });
    const after = await counts();
    expect(after).toMatchObject({ petey: 0, wife: 0, added: 0 });
    expect((await call('GET', '/api/me', petey)).body.partners).toEqual(['Wife']);
    const deck = (await call('GET', '/api/deck?letter=z&limit=100', petey)).body.cards;
    expect(deck.some((c: any) => c.name === 'Zephyrine')).toBe(false);
    expect((await call('POST', '/api/reset', petey, { scope: 'all' })).status).toBe(400);
  });
});
