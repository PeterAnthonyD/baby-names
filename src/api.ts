export type Verdict = 'pass' | 'like' | 'love';
export type Sex = 'F' | 'M' | 'U';

export type Card = {
  id: number;
  name: string;
  sex: Sex;
  rank: number | null;
  trend: 'up' | 'down' | 'flat' | null;
  peakYear: number | null;
  addedBy: string | null;
};

export type ResultRow = Card & { mine: Verdict | null; theirs: Verdict | null };

export type Me = {
  displayName: string;
  inviteCode: string;
  lastName: string;
  partners: string[];
  dataYear: number;
};

export type Results = {
  matches: ResultRow[];
  onlyMe: ResultRow[];
  onlyThem: ResultRow[];
  waitingOnThem: ResultRow[];
  waitingOnMe: number;
  bothPassed: ResultRow[];
};

export type RankingRow = Card & {
  mine: number | null;
  theirs: number | null;
  combined: number | null;
  myVote: Verdict | null;
  theirVote: Verdict | null;
};

export type Filters = { sex: 'any' | 'F' | 'M'; popularity: 'any' | 'top100' | 'top1000' | 'rare'; letter: string };

const TOKEN_KEY = 'baby-names-token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the session lasts until the tab closes.
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong');
  return data as T;
}

export const api = {
  createFamily: (displayName: string, lastName: string) =>
    request<{ token: string }>('POST', '/api/family', { displayName, lastName }),
  join: (code: string, displayName: string) => request<{ token: string }>('POST', '/api/join', { code, displayName }),
  me: () => request<Me>('GET', '/api/me'),
  setLastName: (lastName: string) => request<Me>('PATCH', '/api/family', { lastName }),
  deck: (filters: Filters, limit = 30) => {
    const q = new URLSearchParams({ limit: String(limit) });
    if (filters.sex !== 'any') q.set('sex', filters.sex);
    if (filters.popularity !== 'any') q.set('popularity', filters.popularity);
    if (filters.letter) q.set('letter', filters.letter);
    return request<{ cards: Card[] }>('GET', `/api/deck?${q}`);
  },
  vote: (nameId: number, verdict: Verdict) => request('POST', '/api/vote', { nameId, verdict }),
  unvote: (nameId: number) => request('DELETE', `/api/vote?nameId=${nameId}`),
  addName: (name: string, sex: Sex) => request<{ card: Card }>('POST', '/api/names', { name, sex }),
  results: () => request<Results>('GET', '/api/results'),
  nextToRate: (skip: number[]) =>
    request<{ card: (Card & { myScore: number | null; timesRated: number }) | null; poolSize: number }>(
      'GET',
      `/api/rate/next?skip=${skip.join(',')}`,
    ),
  rate: (nameId: number, score: number) => request('POST', '/api/rate', { nameId, score }),
  reset: (scope: 'me' | 'family') => request('POST', '/api/reset', { scope }),
  rankings: () => request<{ rows: RankingRow[] }>('GET', '/api/rankings'),
};
