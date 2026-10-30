import { useState, type FormEvent } from 'react';
import { api } from './api';

export function Welcome({ onSignedIn }: { onSignedIn: (token: string) => void }) {
  const [mode, setMode] = useState<'create' | 'join'>(() =>
    new URLSearchParams(location.search).get('code') ? 'join' : 'create',
  );
  const [displayName, setDisplayName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { token } =
        mode === 'create' ? await api.createFamily(displayName, lastName) : await api.join(code, displayName);
      history.replaceState(null, '', '/');
      onSignedIn(token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="welcome">
      <h1>Baby Names</h1>
      <p className="muted">Swipe through names on your own phones, then see the ones you both love.</p>

      <div className="segmented">
        <button className={mode === 'create' ? 'on' : ''} onClick={() => setMode('create')}>
          Start a family
        </button>
        <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>
          Join with a code
        </button>
      </div>

      <form onSubmit={submit} className="form">
        <label>
          Your first name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required maxLength={40} />
        </label>
        {mode === 'create' ? (
          <label>
            Baby's last name <span className="muted">(optional)</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={40} />
          </label>
        ) : (
          <label>
            Family code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              maxLength={6}
              autoCapitalize="characters"
              className="code"
            />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {mode === 'create' ? 'Start swiping' : 'Join family'}
        </button>
      </form>
    </div>
  );
}
