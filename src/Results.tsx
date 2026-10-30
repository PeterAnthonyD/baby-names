import { useCallback, useEffect, useState } from 'react';
import { api, type Me, type ResultRow, type Results as ResultsData, type Verdict } from './api';

type View = 'matches' | 'onlyMe' | 'onlyThem' | 'waiting';

const ICON: Record<Verdict, string> = { love: '♥', like: '✓', pass: '✕' };

export function Results({ partner, hasPartner, me }: { partner: string; hasPartner: boolean; me: Me }) {
  const [data, setData] = useState<ResultsData | null>(null);
  const [view, setView] = useState<View>('matches');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api
      .results()
      .then(setData)
      .catch((err) => setError((err as Error).message));
  }, []);

  useEffect(load, [load]);

  async function change(row: ResultRow, verdict: Verdict) {
    await api.vote(row.id, verdict);
    load();
  }

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted center">Loading…</p>;

  const views: [View, string, ResultRow[]][] = [
    ['matches', 'Both like', data.matches],
    ['onlyMe', 'Only you', data.onlyMe],
    ['onlyThem', `Only ${partner}`, data.onlyThem],
    ['waiting', `${partner} hasn't seen`, data.waitingOnThem],
  ];
  const rows = views.find(([v]) => v === view)![2];

  const empty: Record<View, string> = {
    matches: hasPartner ? 'No matches yet. Keep swiping!' : `Matches show up once ${partner.toLowerCase()} joins.`,
    onlyMe: `No names you like that ${partner} passed on.`,
    onlyThem: `No names ${partner} likes that you passed on.`,
    waiting: `${partner} has seen everything you liked.`,
  };

  return (
    <div className="results">
      <h1>Results</h1>
      {data.waitingOnMe > 0 && (
        <p className="banner">
          {partner} liked {data.waitingOnMe} name{data.waitingOnMe === 1 ? '' : 's'} you haven't seen yet. They're at the
          front of your deck.
        </p>
      )}
      <div className="chips">
        {views.map(([v, label, list]) => (
          <button key={v} className={`chip ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
            {label} <span className="count">{list.length}</span>
          </button>
        ))}
      </div>
      {view === 'onlyThem' && rows.length > 0 && (
        <p className="muted small-text">Changed your mind? Tap ✓ or ♥ to make it a match.</p>
      )}
      {rows.length === 0 ? (
        <p className="muted center">{empty[view]}</p>
      ) : (
        <ul className="list">
          {rows.map((row) => (
            <li key={row.id}>
              <div className="list-name">
                <strong>{row.name}</strong>
                {me.lastName && <span className="muted"> {me.lastName}</span>}
                <div className="small-text muted">
                  {row.addedBy ? `Added by ${row.addedBy}` : row.rank ? `#${row.rank.toLocaleString()} in ${me.dataYear}` : 'Uncommon'}
                  {row.theirs && ` · ${partner}: ${ICON[row.theirs]}`}
                </div>
              </div>
              <div className="mini-vote" aria-label="Your vote">
                {(['pass', 'like', 'love'] as const).map((v) => (
                  <button
                    key={v}
                    className={`${v} ${row.mine === v ? 'on' : ''}`}
                    onClick={() => change(row, v)}
                    aria-label={v}
                  >
                    {ICON[v]}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
