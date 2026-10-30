import type { Card, Me } from './api';

const SEX_LABEL = { F: 'Girl', M: 'Boy', U: 'Girl or boy' } as const;

// Popularity at a glance: rank now, best rank ever (and when), and how the
// rank moved over the last few years. Ranks are within the name's sex.
export function NameDetails({ card, me }: { card: Card; me: Pick<Me, 'dataYear' | 'trendYears'> }) {
  const since = me.dataYear - me.trendYears;
  const sexWord = card.sex === 'F' ? 'girls' : card.sex === 'M' ? 'boys' : 'girls/boys';

  if (!card.peakRank) {
    return (
      <ul className="details">
        <li>{SEX_LABEL[card.sex]}</li>
        <li>Not in the SSA records</li>
      </ul>
    );
  }

  return (
    <>
      <ul className="details">
        <li>{SEX_LABEL[card.sex]}</li>
      </ul>
      <div className="stats">
        <Stat value={card.rank ? `#${card.rank.toLocaleString()}` : '—'} label={`${sexWord}, ${me.dataYear}`} />
        <Stat value={`#${card.peakRank.toLocaleString()}`} label={`peak, in ${card.peakYear}`} />
        <Trend card={card} since={since} />
      </div>
    </>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'up' | 'down' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Trend({ card, since }: { card: Card; since: number }) {
  const { rank, prevRank } = card;
  if (!rank && !prevRank) return <Stat value="—" label={`unranked since ${since}`} />;
  if (!rank) return <Stat value="↘ Gone" label={`was #${prevRank!.toLocaleString()} in ${since}`} tone="down" />;
  if (!prevRank) return <Stat value="↗ New" label={`unranked in ${since}`} tone="up" />;
  const moved = prevRank - rank; // positive = climbing
  // Ignore small wobbles: under 3 places or 5% of the rank.
  if (Math.abs(moved) < Math.max(3, rank * 0.05)) return <Stat value="→ Steady" label={`since ${since}`} />;
  return (
    <Stat
      value={`${moved > 0 ? '↗ +' : '↘ −'}${Math.abs(moved).toLocaleString()}`}
      label={`places since ${since}`}
      tone={moved > 0 ? 'up' : 'down'}
    />
  );
}
