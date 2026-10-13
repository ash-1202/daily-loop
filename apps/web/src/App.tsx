import { useCallback, useEffect, useState } from 'react';
import type { HealthResponse } from '@daily-loop/shared';
import { api } from './api';
import { strings } from './strings';

type Status = { kind: 'checking' } | { kind: 'ok'; health: HealthResponse } | { kind: 'error' };

export function App() {
  const [status, setStatus] = useState<Status>({ kind: 'checking' });

  const load = useCallback(() => {
    api
      .health()
      .then((health) => setStatus({ kind: 'ok', health }))
      .catch(() => setStatus({ kind: 'error' }));
  }, []);

  useEffect(load, [load]);

  const retry = () => {
    setStatus({ kind: 'checking' });
    load();
  };

  return (
    <main className="screen">
      <h1>{strings.appName}</h1>
      <p className="tagline">{strings.tagline}</p>
      <StatusBadge status={status} />
      {status.kind === 'error' && (
        <button type="button" onClick={retry}>
          {strings.retry}
        </button>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status.kind === 'checking') return <p className="badge">{strings.checking}</p>;
  if (status.kind === 'error') return <p className="badge badge--bad">🔌 {strings.offline}</p>;
  return status.health.db === 'up' ? (
    <p className="badge badge--good">✅ {strings.connected}</p>
  ) : (
    <p className="badge badge--bad">⚠️ {strings.dbDown}</p>
  );
}
