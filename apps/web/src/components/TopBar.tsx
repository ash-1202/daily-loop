import type { MeResponse } from '@daily-loop/shared';
import { strings } from '../strings';

export function TopBar({ me }: { me: MeResponse | null }) {
  return (
    <header className="topbar">
      <span className="topbar__title">{strings.appName}</span>
      {me && (
        <span className="topbar__stats">
          <span className="stat" aria-label={strings.streakLabel(me.streak.current)}>
            🔥 {me.streak.current}
          </span>
          <span className="stat" aria-label={strings.pointsLabel(me.points)}>
            ⭐ {me.points}
          </span>
        </span>
      )}
    </header>
  );
}
