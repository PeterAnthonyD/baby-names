import { useCallback, useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform, type PanInfo } from 'framer-motion';
import { api, type Card, type Filters, type Me, type Sex, type Verdict } from './api';
import { NameDetails } from './NameDetails';

const FILTERS_KEY = 'baby-names-filters';
const DEFAULT_FILTERS: Filters = { sex: 'any', popularity: 'any', letter: '' };
const SWIPE_DISTANCE = 110;

function loadFilters(): Filters {
  try {
    return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function Swipe({ me }: { me: Me }) {
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<Card[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState('');
  const seen = useRef(new Set<number>());
  const fetching = useRef(false);

  const refill = useCallback(
    async (replace = false) => {
      if (fetching.current) return;
      fetching.current = true;
      try {
        const { cards: fresh } = await api.deck(filters);
        setCards((current) => {
          const base = replace ? [] : current;
          const ids = new Set(base.map((c) => c.id));
          return [...base, ...fresh.filter((c) => !ids.has(c.id) && !seen.current.has(c.id))];
        });
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        fetching.current = false;
        setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    try {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
    } catch {
      // Filters just won't be remembered.
    }
    setLoading(true);
    refill(true);
  }, [filters, refill]);

  useEffect(() => {
    if (!loading && cards.length < 6) refill();
  }, [cards.length, loading, refill]);

  function decide(card: Card, verdict: Verdict) {
    seen.current.add(card.id);
    setCards((c) => c.filter((x) => x.id !== card.id));
    setHistory((h) => [card, ...h].slice(0, 20));
    api.vote(card.id, verdict).catch((err) => setError((err as Error).message));
  }

  async function undo() {
    const [last, ...rest] = history;
    if (!last) return;
    setHistory(rest);
    seen.current.delete(last.id);
    setCards((c) => [last, ...c]);
    await api.unvote(last.id).catch((err) => setError((err as Error).message));
  }

  const top = cards[0];

  return (
    <div className="swipe">
      <header className="swipe-head">
        <button className="ghost" onClick={() => setShowFilters((s) => !s)}>
          ⚙︎ Filters{filterCount(filters) ? ` (${filterCount(filters)})` : ''}
        </button>
        <button className="ghost" onClick={() => setShowAdd(true)}>
          ＋ Add a name
        </button>
      </header>

      {showFilters && <FilterBar filters={filters} onChange={setFilters} />}
      {me.partners.length === 0 && (
        <p className="banner">
          Share code <strong>{me.inviteCode}</strong> so your partner can join. It's on the Family tab.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="stack">
        {loading && <p className="muted center">Finding names…</p>}
        {!loading && !top && (
          <div className="empty">
            <p>You've seen every name that fits these filters.</p>
            <button className="ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>
              Clear filters
            </button>
          </div>
        )}
        {cards
          .slice(0, 3)
          .reverse()
          .map((card) => (
            <SwipeCard
              key={card.id}
              card={card}
              lastName={me.lastName}
              dataYear={me.dataYear}
              isTop={card.id === top?.id}
              onDecide={(v) => decide(card, v)}
            />
          ))}
      </div>

      <div className="actions">
        <button className="round undo" onClick={undo} disabled={!history.length} aria-label="Undo">
          ↶
        </button>
        <button className="round pass" disabled={!top} onClick={() => top && fling(top, 'pass')} aria-label="Pass">
          ✕
        </button>
        <button className="round love" disabled={!top} onClick={() => top && fling(top, 'love')} aria-label="Love">
          ♥
        </button>
        <button className="round like" disabled={!top} onClick={() => top && fling(top, 'like')} aria-label="Like">
          ✓
        </button>
      </div>

      {showAdd && (
        <AddName
          onClose={() => setShowAdd(false)}
          onAdded={(card) => {
            seen.current.delete(card.id);
            setCards((c) => [card, ...c.filter((x) => x.id !== card.id)]);
            setShowAdd(false);
          }}
        />
      )}
    </div>
  );

  // Buttons animate the top card off-screen the same way a swipe does.
  function fling(card: Card, verdict: Verdict) {
    window.dispatchEvent(new CustomEvent('fling', { detail: { id: card.id, verdict } }));
  }
}

function filterCount(f: Filters) {
  return Number(f.sex !== 'any') + Number(f.popularity !== 'any') + Number(Boolean(f.letter));
}

function SwipeCard(props: {
  card: Card;
  lastName: string;
  dataYear: number;
  isTop: boolean;
  onDecide: (v: Verdict) => void;
}) {
  const { card, isTop, onDecide } = props;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const likeOpacity = useTransform(x, [20, SWIPE_DISTANCE], [0, 1]);
  const passOpacity = useTransform(x, [-SWIPE_DISTANCE, -20], [1, 0]);
  const loveOpacity = useTransform(y, [-SWIPE_DISTANCE, -20], [1, 0]);
  const leaving = useRef(false);

  const leave = useCallback(
    (verdict: Verdict) => {
      if (leaving.current) return;
      leaving.current = true;
      if (verdict === 'love') animate(y, -900, { duration: 0.25 });
      else animate(x, verdict === 'like' ? 600 : -600, { duration: 0.25 });
      setTimeout(() => onDecide(verdict), 200);
    },
    [x, y, onDecide],
  );

  useEffect(() => {
    if (!isTop) return;
    const onFling = (e: Event) => {
      const { id, verdict } = (e as CustomEvent).detail;
      if (id === card.id) leave(verdict);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') leave('like');
      if (e.key === 'ArrowLeft') leave('pass');
      if (e.key === 'ArrowUp') leave('love');
    };
    window.addEventListener('fling', onFling);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('fling', onFling);
      window.removeEventListener('keydown', onKey);
    };
  }, [isTop, card.id, leave]);

  function onDragEnd(_: unknown, info: PanInfo) {
    const { offset, velocity } = info;
    if (offset.y < -SWIPE_DISTANCE && Math.abs(offset.y) > Math.abs(offset.x)) leave('love');
    else if (offset.x > SWIPE_DISTANCE || velocity.x > 800) leave('like');
    else if (offset.x < -SWIPE_DISTANCE || velocity.x < -800) leave('pass');
    else {
      animate(x, 0, { type: 'spring', stiffness: 400, damping: 30 });
      animate(y, 0, { type: 'spring', stiffness: 400, damping: 30 });
    }
  }

  return (
    <motion.div
      className={`card sex-${card.sex}`}
      style={{ x, y, rotate, zIndex: isTop ? 2 : 1 }}
      drag={isTop}
      dragElastic={0.9}
      dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
      onDragEnd={onDragEnd}
      initial={{ scale: 0.96 }}
      animate={{ scale: isTop ? 1 : 0.96 }}
    >
      <motion.span className="stamp like" style={{ opacity: likeOpacity }}>
        LIKE
      </motion.span>
      <motion.span className="stamp pass" style={{ opacity: passOpacity }}>
        PASS
      </motion.span>
      <motion.span className="stamp love" style={{ opacity: loveOpacity }}>
        LOVE
      </motion.span>
      {card.addedBy && <span className="added">Added by {card.addedBy}</span>}
      <h2 className="name">{card.name}</h2>
      {props.lastName && (
        <p className="full-name">
          {card.name} {props.lastName}
        </p>
      )}
      <NameDetails card={card} dataYear={props.dataYear} />
    </motion.div>
  );
}

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  return (
    <div className="filters">
      <div className="segmented small">
        {(
          [
            ['any', 'Both'],
            ['F', 'Girl'],
            ['M', 'Boy'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} className={filters.sex === value ? 'on' : ''} onClick={() => set({ sex: value })}>
            {label}
          </button>
        ))}
      </div>
      <div className="row">
        <select value={filters.popularity} onChange={(e) => set({ popularity: e.target.value as Filters['popularity'] })}>
          <option value="any">Any popularity</option>
          <option value="top100">Top 100</option>
          <option value="top1000">Top 1000</option>
          <option value="rare">Less common</option>
        </select>
        <select value={filters.letter} onChange={(e) => set({ letter: e.target.value })}>
          <option value="">Any letter</option>
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => (
            <option key={l} value={l}>
              Starts with {l}
            </option>
          ))}
        </select>
      </div>
      <p className="muted small-text">Unisex names show up for both girls and boys.</p>
    </div>
  );
}

function AddName({ onClose, onAdded }: { onClose: () => void; onAdded: (card: Card) => void }) {
  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex>('U');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { card } = await api.addName(name, sex);
      onAdded(card);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <form className="sheet form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h3>Add a name</h3>
        <p className="muted">It goes to the front of both your decks, marked as added by you.</p>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={30} autoFocus />
        </label>
        <div className="segmented small">
          {(
            [
              ['U', 'Either'],
              ['F', 'Girl'],
              ['M', 'Boy'],
            ] as const
          ).map(([value, label]) => (
            <button type="button" key={value} className={sex === value ? 'on' : ''} onClick={() => setSex(value)}>
              {label}
            </button>
          ))}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
