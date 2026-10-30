import { useState } from 'react';
import { api, type Me } from './api';

export function Family({ me, onChange, onSignOut }: { me: Me; onChange: (me: Me) => void; onSignOut: () => void }) {
  const [lastName, setLastName] = useState(me.lastName);
  const [saved, setSaved] = useState(false);
  const link = `${location.origin}/?code=${me.inviteCode}`;

  async function share() {
    const text = `Join me on Baby Names: ${link}`;
    if (navigator.share) await navigator.share({ title: 'Baby Names', text, url: link }).catch(() => {});
    else await navigator.clipboard?.writeText(link);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    onChange(await api.setLastName(lastName));
    setSaved(true);
  }

  return (
    <div className="family">
      <h1>Family</h1>
      <section className="panel">
        <p className="muted">Signed in as</p>
        <p className="big">{me.displayName}</p>
        <p className="muted">
          {me.partners.length ? `Paired with ${me.partners.join(', ')}` : 'Waiting for your partner to join'}
        </p>
      </section>

      <section className="panel">
        <p className="muted">Family code</p>
        <p className="code big">{me.inviteCode}</p>
        <button className="primary" onClick={share}>
          Share invite link
        </button>
      </section>

      <form className="panel form" onSubmit={save}>
        <label>
          Baby's last name
          <input
            value={lastName}
            onChange={(e) => {
              setLastName(e.target.value);
              setSaved(false);
            }}
            maxLength={40}
          />
        </label>
        <button className="ghost">{saved ? 'Saved' : 'Save'}</button>
      </form>

      <p className="muted small-text">
        Names come from US Social Security records through {me.dataYear}. Ranks are for that year.
      </p>
      <button
        className="link"
        onClick={() => {
          if (confirm('Sign out on this phone? You will need the family code to rejoin as a new person.')) onSignOut();
        }}
      >
        Sign out
      </button>
    </div>
  );
}
