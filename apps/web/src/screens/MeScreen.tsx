import { useState, type FormEvent } from 'react';
import { ApiError, type MeResponse } from '@daily-loop/shared';
import { strings } from '../strings';

interface Props {
  me: MeResponse;
  onSaveName: (name: string) => Promise<void>;
}

export function MeScreen({ me, onSaveName }: Props) {
  const [name, setName] = useState(me.user.displayName ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'invalid' | 'failed'>('idle');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setStatus('saving');
    try {
      await onSaveName(name);
      setStatus('saved');
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 400 ? 'invalid' : 'failed');
    }
  };

  return (
    <div className="screen-body">
      <h2>👤 {strings.meTitle}</h2>

      <div className="done__stats">
        <div className="bigstat">
          <span className="bigstat__value">⭐ {me.points}</span>
          <span className="bigstat__label">{strings.points}</span>
        </div>
        <div className="bigstat">
          <span className="bigstat__value">🔥 {me.streak.current}</span>
          <span className="bigstat__label">{strings.streak}</span>
        </div>
        <div className="bigstat">
          <span className="bigstat__value">🏅 {me.streak.longest}</span>
          <span className="bigstat__label">{strings.longest}</span>
        </div>
        <div className="bigstat">
          <span className="bigstat__value">🧊 {me.streak.freezesLeft}</span>
          <span className="bigstat__label">{strings.freezes}</span>
        </div>
      </div>
      <p className="muted small">{strings.freezeHelp}</p>

      <form className="name-form" onSubmit={save}>
        <label htmlFor="display-name">{strings.yourName}</label>
        <div className="name-form__row">
          <input
            id="display-name"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            placeholder={strings.namePlaceholder}
            onChange={(e) => {
              setName(e.target.value);
              setStatus('idle');
            }}
          />
          <button type="submit" className="primary" disabled={status === 'saving'}>
            {status === 'saved' ? strings.saved : strings.save}
          </button>
        </div>
        <p className={`small ${status === 'invalid' ? 'error-text' : 'muted'}`} aria-live="polite">
          {status === 'failed' ? strings.offline : strings.nameRules}
        </p>
      </form>

      <h3>{strings.badgesTitle}</h3>
      <ul className="badges">
        {me.badges.map((b) => (
          <li key={b.id} className={`badge${b.awardedAt ? '' : ' badge--locked'}`}>
            <span className="badge__icon" aria-hidden="true">
              {b.awardedAt ? b.icon : '🔒'}
            </span>
            <strong>{b.name}</strong>
            <small>{b.awardedAt ? b.description : `${strings.locked}: ${b.description}`}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
