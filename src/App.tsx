import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, getToken, setToken, type Me } from './api';
import { Welcome } from './Welcome';
import { Swipe } from './Swipe';
import { Results } from './Results';
import { Family } from './Family';

type Tab = 'swipe' | 'results' | 'family';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(Boolean(getToken()));
  const [tab, setTab] = useState<Tab>('swipe');

  const loadMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      setMe(await api.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on every tab switch so a partner who just joined shows up by name.
  useEffect(() => {
    loadMe();
  }, [loadMe, tab]);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!me)
    return (
      <Welcome
        onSignedIn={(token) => {
          setToken(token);
          setLoading(true);
          loadMe();
        }}
      />
    );

  const partner = me.partners[0] ?? 'Partner';

  return (
    <div className="app">
      <main className="screen">
        {tab === 'swipe' && <Swipe me={me} />}
        {tab === 'results' && <Results partner={partner} hasPartner={me.partners.length > 0} me={me} />}
        {tab === 'family' && (
          <Family
            me={me}
            onChange={setMe}
            onSignOut={() => {
              setToken(null);
              setMe(null);
            }}
          />
        )}
      </main>
      <nav className="tabs">
        <TabButton active={tab === 'swipe'} onClick={() => setTab('swipe')} icon="🃏" label="Swipe" />
        <TabButton active={tab === 'results'} onClick={() => setTab('results')} icon="💞" label="Results" />
        <TabButton active={tab === 'family'} onClick={() => setTab('family')} icon="👪" label="Family" />
      </nav>
    </div>
  );
}

function TabButton(props: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button className={`tab ${props.active ? 'active' : ''}`} onClick={props.onClick}>
      <span aria-hidden>{props.icon}</span>
      {props.label}
    </button>
  );
}
