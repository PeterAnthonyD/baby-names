import { useState, type FormEvent } from 'react';
import { api } from './api';

type Member = { id: string; displayName: string };

export function Welcome({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>(() =>
    new URLSearchParams(location.search).get('code') ? 'join' : 'create',
  );
  const [displayName, setDisplayName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  // Join mode: after the code checks out, pick yourself or join as someone new.
  const [members, setMembers] = useState<Member[] | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ token: string } | void>) {
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (result) {
        history.replaceState(null, '', '/');
        onSignedIn(result.token);
      } else {
        setBusy(false);
      }
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'create') return run(() => api.createFamily(displayName, lastName));
    if (!members)
      return run(async () => {
        const list = (await api.familyMembers(code)).members;
        setMembers(list);
        setIsNew(list.length === 0);
      });
    return run(() => api.join(code, displayName));
  }

  function switchMode(next: 'create' | 'join') {
    setMode(next);
    setMembers(null);
    setIsNew(false);
    setError('');
  }

  return (
    <div className="welcome">
      <h1>Baby Names</h1>
      <p className="muted">Swipe through names on your own phones, then see the ones you both love.</p>

      <div className="segmented">
        <button className={mode === 'create' ? 'on' : ''} onClick={() => switchMode('create')}>
          Start a family
        </button>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => switchMode('join')}>
          Join or sign back in
        </button>
      </div>

      <form onSubmit={submit} className="form">
        {mode === 'create' && (
          <>
            <label>
              Your first name
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} />
            </label>
            <label>
              Baby's last name <span className="muted">(optional)</span>
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={40} />
            </label>
          </>
        )}

        {mode === 'join' && (
          <label>
            Family code
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
                setMembers(null);
                setIsNew(false);
              }}
              required
              maxLength={6}
              autoCapitalize="characters"
              className="code"
            />
          </label>
        )}

        {mode === 'join' && members && members.length > 0 && !isNew && (
          <div className="who">
            <p className="who-title">Who are you?</p>
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                className="ghost who-button"
                disabled={busy}
                onClick={() => run(() => api.signBackIn(code, m.id))}
              >
                I'm {m.displayName}
              </button>
            ))}
            <button type="button" className="link" onClick={() => setIsNew(true)}>
              I'm someone new
            </button>
          </div>
        )}

        {mode === 'join' && isNew && (
          <label>
            Your first name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={40}
              autoFocus
            />
          </label>
        )}

        {error && <p className="error">{error}</p>}
        {!(mode === 'join' && members && !isNew) && (
          <button className="primary" disabled={busy}>
            {mode === 'create' ? 'Start swiping' : members ? 'Join family' : 'Continue'}
          </button>
        )}
      </form>
    </div>
  );
}
