import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Card, type Me, type RankingRow } from './api';
import { NameDetails } from './NameDetails';

type Mode = 'rate' | 'list';
type Sort = 'combined' | 'mine' | 'theirs';

const SCORE_LABELS = ['', 'Not for us', 'Meh', 'Maybe', 'Really like', 'Love it'];

export function Rank({ me, partner }: { me: Me; partner: string }) {
  const [mode, setMode] = useState<Mode>('rate');
  return (
    <div className="rank">
      <h1>Rank</h1>
      <div className="segmented">
        <button className={mode === 'rate' ? 'on' : ''} onClick={() => setMode('rate')}>
          Rate names
        </button>
        <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
          Rank list
        </button>
      </div>
      {mode === 'rate' ? <Rate me={me} /> : <RankList me={me} partner={partner} />}
    </div>
  );
}

// Shows one liked name at a time, picked at random by the server. Names come
// back again later, so scores keep shifting as your feelings do.
function Rate({ me }: { me: Me }) {
  const [card, setCard] = useState<(Card & { myScore: number | null; timesRated: number }) | null>(null);
  const [poolSize, setPoolSize] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [count, setCount] = useState(0);
  const recent = useRef<number[]>([]);
  const poolSizeRef = useRef<number | null>(null);

  const next = useCallback(async () => {
    try {
      // Skip the last few shown so the same name doesn't come right back.
      const keep = Math.max(0, Math.min(3, (poolSizeRef.current ?? 0) - 1));
      const res = await api.nextToRate(recent.current.slice(0, keep));
      poolSizeRef.current = res.poolSize;
      setPoolSize(res.poolSize);
      setCard(res.card);
      if (res.card) recent.current = [res.card.id, ...recent.current].slice(0, 3);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    next();
  }, [next]);

  async function score(value: number) {
    if (!card) return;
    setCount((c) => c + 1);
    await api.rate(card.id, value).catch((err) => setError((err as Error).message));
    next();
  }

  if (error) return <p className="error">{error}</p>;
  if (poolSize === null) return <p className="muted center">Loading…</p>;
  if (!card)
    return <p className="muted center">Like a few names on the Swipe tab first. Any name either of you likes shows up here.</p>;

  return (
    <div className="rate">
      <div className="rate-card">
        {card.addedBy && <span className="added">Added by {card.addedBy}</span>}
        <h2 className="name">{card.name}</h2>
        {me.lastName && (
          <p className="full-name">
            {card.name} {me.lastName}
          </p>
        )}
        <NameDetails card={card} me={me} />
        <p className="muted small-text rate-history">
          {card.timesRated
            ? `You've rated this ${card.timesRated} time${card.timesRated === 1 ? '' : 's'}, averaging ${card.myScore}`
            : 'First time rating this one'}
        </p>
      </div>
      <p className="rate-question">How much do you like it?</p>
      <div className="scores">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`score s${n}`} onClick={() => score(n)}>
            <strong>{n}</strong>
            <span>{SCORE_LABELS[n]}</span>
          </button>
        ))}
      </div>
      <button className="link" onClick={next}>
        Skip
      </button>
      {count > 0 && <p className="muted small-text center-text">{count} rated this session</p>}
    </div>
  );
}

function RankList({ me, partner }: { me: Me; partner: string }) {
  const [rows, setRows] = useState<RankingRow[] | null>(null);
  const [sort, setSort] = useState<Sort>('combined');
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .rankings()
      .then((r) => setRows(r.rows))
      .catch((err) => setError((err as Error).message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted center">Loading…</p>;

  const value = (r: RankingRow) => r[sort];
  const rated = rows
    .filter((r) => value(r) !== null)
    .sort((a, b) => value(b)! - value(a)! || (b.combined ?? 0) - (a.combined ?? 0) || a.name.localeCompare(b.name));
  const unrated = rows.length - rated.length;

  return (
    <div>
      <div className="segmented small sort">
        {(
          [
            ['combined', 'Both of us'],
            ['mine', 'Mine'],
            ['theirs', partner],
          ] as const
        ).map(([s, label]) => (
          <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
            {label}
          </button>
        ))}
      </div>
      {rated.length === 0 ? (
        <p className="muted center">
          {sort === 'theirs' ? `${partner} hasn't rated any names yet.` : 'Rate some names to build the list.'}
        </p>
      ) : (
        <ol className="list ranked">
          {rated.map((r, i) => (
            <li key={r.id}>
              <span className="place">{i + 1}</span>
              <div className="list-name">
                <strong>{r.name}</strong>
                {me.lastName && <span className="muted"> {me.lastName}</span>}
                <div className="small-text muted">
                  You {r.mine ?? '–'} · {partner} {r.theirs ?? '–'}
                  {sort === 'combined' && (r.mine === null || r.theirs === null) && ' · one rating so far'}
                </div>
              </div>
              <span className="avg">{value(r)!.toFixed(1)}</span>
            </li>
          ))}
        </ol>
      )}
      {unrated > 0 && (
        <p className="muted small-text">
          {unrated} liked name{unrated === 1 ? '' : 's'} not rated yet{sort === 'theirs' ? ` by ${partner}` : ''}.
        </p>
      )}
    </div>
  );
}
