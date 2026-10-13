import { useState, type FormEvent } from 'react';
import { ApiError, type MeResponse } from '@daily-loop/shared';
import { strings } from '../strings';

interface Props {
  me: MeResponse;
  onRequestCode: (email: string) => Promise<void>;
  /** Resolves true if the device switched to an existing account. */
  onVerifyCode: (email: string, code: string) => Promise<boolean>;
  onLogout: () => Promise<void>;
}

/** The server's messages are written in plain English for users; anything else is "no connection". */
const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : strings.offline);

/**
 * Email login in two steps: email → 6-digit code. Hidden entirely when the server has email
 * login switched off; shows the saved email and a log-out button once verified.
 */
export function SaveProgress({ me, onRequestCode, onVerifyCode, onLogout }: Props) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switched, setSwitched] = useState(false);

  if (!me.features.emailLogin) return null;

  if (me.user.email) {
    return (
      <section className="panel">
        {switched && (
          <p className="banner banner--good" role="status">
            {strings.welcomeBack}
          </p>
        )}
        <p>
          <strong>{strings.savedAs(me.user.email)}</strong>
        </p>
        <button type="button" className="secondary" onClick={() => void onLogout()}>
          {strings.logout}
        </button>
        <p className="muted small">{strings.logoutHelp}</p>
      </section>
    );
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    void run(async () => {
      await onRequestCode(email.trim());
      setCode('');
      setStep('code');
    });
  };

  const check = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setSwitched(await onVerifyCode(email.trim(), code.trim()));
    });
  };

  return (
    <section className="panel">
      <h3>{strings.saveTitle}</h3>

      {step === 'email' ? (
        <form className="name-form" onSubmit={send}>
          <p className="muted small">{strings.saveHelp}</p>
          <label htmlFor="save-email">{strings.emailLabel}</label>
          <div className="name-form__row">
            <input
              id="save-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              placeholder={strings.emailPlaceholder}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || !email.trim()}>
              {strings.sendCode}
            </button>
          </div>
        </form>
      ) : (
        <form className="name-form" onSubmit={check}>
          <p className="small">{strings.codeSentTo(email.trim())}</p>
          <label htmlFor="save-code">{strings.codeLabel}</label>
          <div className="name-form__row">
            <input
              id="save-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              placeholder="123456"
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
            <button type="submit" className="primary" disabled={busy || code.length !== 6}>
              {strings.verify}
            </button>
          </div>
          <p className="muted small">{strings.neverShare}</p>
          <div className="link-row">
            <button type="button" className="link" disabled={busy} onClick={() => send()}>
              {strings.newCode}
            </button>
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => {
                setStep('email');
                setError(null);
              }}
            >
              {strings.otherEmail}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p className="small error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
