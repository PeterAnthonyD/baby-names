import type { Card } from './api';

const SEX_LABEL = { F: 'Girl', M: 'Boy', U: 'Either' } as const;
const TREND_LABEL = { up: '↗ Rising', down: '↘ Falling', flat: '→ Steady' } as const;

export function NameDetails({ card, dataYear }: { card: Card; dataYear: number }) {
  const sexWord = card.sex === 'F' ? 'girls' : card.sex === 'M' ? 'boys' : 'babies';
  return (
    <ul className="details">
      <li>{SEX_LABEL[card.sex]}</li>
      {card.rank ? (
        <li>
          #{card.rank.toLocaleString()} for {sexWord} in {dataYear}
        </li>
      ) : (
        <li>{card.peakYear ? 'Not in recent lists' : 'Your own pick'}</li>
      )}
      {card.trend && card.rank && <li>{TREND_LABEL[card.trend]}</li>}
      {card.peakYear && <li>Peaked in {card.peakYear}</li>}
    </ul>
  );
}
