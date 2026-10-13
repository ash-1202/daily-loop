import { useEffect, useState } from 'react';
import type { LeaderboardResponse } from '@daily-loop/shared';
import { api } from '../api';
import { strings } from '../strings';

export function LeadersScreen() {
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    api
      .leaderboard()
      .then((b) => active && setBoard(b))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, []);

  if (failed) return <p className="screen-body">{strings.offline}</p>;
  if (!board) return <p className="screen-body">{strings.loading}</p>;

  return (
    <div className="screen-body">
      <h2>🏆 {strings.leadersTitle}</h2>
      <p className="muted">{strings.yourRank(board.me.rank, board.me.points)}</p>
      {board.entries.length === 0 ? (
        <p>{strings.leadersEmpty}</p>
      ) : (
        <ol className="board">
          {board.entries.map((e) => (
            <li
              key={`${e.rank}-${e.displayName}`}
              className={`board__row${e.isMe ? ' board__row--me' : ''}`}
            >
              <span className="board__rank">
                {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : `#${e.rank}`}
              </span>
              <span className="board__name">
                {e.displayName}
                {e.isMe && <span className="chip">{strings.you}</span>}
              </span>
              <span className="board__points">⭐ {e.points}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="muted small">{strings.weekNote}</p>
    </div>
  );
}
