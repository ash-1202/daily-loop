import type { Card } from '@daily-loop/shared';

/** One dot per card: green if right, red if wrong, outlined if current, grey if still to do. */
export function ProgressDots({ cards, currentTaskId }: { cards: Card[]; currentTaskId?: string }) {
  return (
    <ol className="dots" aria-hidden="true">
      {cards.map((c) => {
        const state = c.result ? (c.result.isCorrect ? 'right' : 'wrong') : 'todo';
        const current = c.taskId === currentTaskId ? ' dot--current' : '';
        return <li key={c.taskId} className={`dot dot--${state}${current}`} />;
      })}
    </ol>
  );
}
