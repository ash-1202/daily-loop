import { useState } from 'react';
import {
  POINTS,
  type Badge,
  type MeResponse,
  type Reward,
  type TodayResponse,
} from '@daily-loop/shared';
import { CardView } from '../components/CardView';
import { ProgressDots } from '../components/ProgressDots';
import { strings } from '../strings';
import { useCountdownToNextDay } from '../useCountdown';

interface Props {
  today: TodayResponse;
  me: MeResponse;
  rewardsByTask: Record<string, Reward[]>;
  newBadges: Badge[];
  submitting: boolean;
  submitFailed: boolean;
  onAnswer: (taskId: string, option: string) => void;
  onRetry: () => void;
  onShowLeaders: () => void;
}

export function TodayScreen(props: Props) {
  const { today, me, rewardsByTask, submitting, submitFailed } = props;
  // The card being viewed. After answering, it stays on screen (showing the result) until "Next".
  const [viewing, setViewing] = useState<string | null>(null);

  const firstUnanswered = today.cards.find((c) => !c.result);
  const card = today.cards.find((c) => c.taskId === viewing) ?? firstUnanswered;

  if (!card) return <DoneScreen {...props} />;

  const remaining = today.cards.filter((c) => !c.result && c.taskId !== card.taskId).length;

  return (
    <div className="screen-body">
      {me.streak.atRisk && <p className="banner banner--warn">{strings.atRisk}</p>}
      <ProgressDots cards={today.cards} currentTaskId={card.taskId} />
      <CardView
        key={card.taskId}
        card={card}
        total={today.cards.length}
        rewards={rewardsByTask[card.taskId]}
        submitting={submitting}
        isLast={remaining === 0}
        onAnswer={(option) => {
          setViewing(card.taskId);
          props.onAnswer(card.taskId, option);
        }}
        onNext={() => setViewing(null)}
      />
      {submitFailed && (
        <div className="banner banner--error" role="alert">
          <p>📶 {strings.answerNotSent}</p>
          <button type="button" className="primary" onClick={props.onRetry}>
            {strings.retry}
          </button>
        </div>
      )}
    </div>
  );
}

function DoneScreen({ today, me, newBadges, onShowLeaders }: Props) {
  const countdown = useCountdownToNextDay();
  const pointsToday = today.progress.correct * POINTS.correctAnswer + POINTS.dailyBonus;

  return (
    <div className="screen-body done">
      <ProgressDots cards={today.cards} />
      <h2 className="done__title">{strings.doneTitle}</h2>
      <p className="done__score">{strings.score(today.progress.correct, today.progress.total)}</p>

      <div className="done__stats">
        <div className="bigstat">
          <span className="bigstat__value">⭐ {pointsToday}</span>
          <span className="bigstat__label">{strings.pointsToday}</span>
        </div>
        <div className="bigstat">
          <span className="bigstat__value">🔥 {me.streak.current}</span>
          <span className="bigstat__label">{strings.streakLabel(me.streak.current)}</span>
        </div>
      </div>

      {newBadges.map((b) => (
        <div key={b.id} className="badge-won" role="status">
          <span className="badge-won__icon" aria-hidden="true">
            {b.icon}
          </span>
          <span>
            <strong>{strings.newBadge}</strong> {b.name}
            <br />
            <small>{b.description}</small>
          </span>
        </div>
      ))}

      <p className="done__next">
        ⏰ {strings.nextChallengeIn} <strong>{countdown}</strong>
        <br />
        {strings.comeBack}
      </p>
      <button type="button" className="secondary" onClick={onShowLeaders}>
        🏆 {strings.seeLeaderboard}
      </button>
    </div>
  );
}
