import { useEffect, useState } from 'react';
import { addDays, istDate, istDayStart } from '@daily-loop/shared';

/** Time left until the next challenge (midnight IST), formatted like "5h 12m", updated every 30 s. */
export function useCountdownToNextDay(): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const next = istDayStart(addDays(istDate(new Date(now)), 1)).getTime();
  const minutes = Math.max(0, Math.ceil((next - now) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
