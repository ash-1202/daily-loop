import { useEffect, useRef } from 'react';
import { POINTS, type Card, type Reward } from '@daily-loop/shared';
import { strings } from '../strings';
import { ChartView } from './ChartView';

interface Props {
  card: Card;
  total: number;
  rewards: Reward[] | undefined;
  submitting: boolean;
  isLast: boolean;
  onAnswer: (option: string) => void;
  onNext: () => void;
}

const TITLES = { term: strings.termTitle, scam: strings.scamTitle, chart: strings.chartTitle };

const optionLabel = (card: Card, option: string) =>
  card.type === 'scam' ? (strings.scamOption[option] ?? option) : option;

export function CardView({ card, total, rewards, submitting, isLast, onAnswer, onNext }: Props) {
  const result = card.result;

  return (
    <article className={`card card--${card.type}`}>
      <p className="card__meta">
        {strings.cardOf(card.position, total)} · {TITLES[card.type]}
      </p>

      {card.type === 'scam' ? (
        <>
          <p className="card__intro">📩 {strings.scamIntro}</p>
          <blockquote className="bubble">{card.prompt}</blockquote>
          <h2 className="card__question">{strings.scamQuestion}</h2>
        </>
      ) : card.chart ? (
        <>
          <ChartView chart={card.chart} />
          <h2 className="card__question">{card.prompt}</h2>
        </>
      ) : (
        <h2 className="card__question">
          {card.icon && (
            <span className="card__icon" aria-hidden="true">
              {card.icon}
            </span>
          )}
          {card.prompt}
        </h2>
      )}

      <div className={`options options--${card.type}`}>
        {card.options.map((option) => {
          let state = '';
          if (result) {
            if (option === result.correctAnswer) state = ' option--right';
            else if (option === result.answer) state = ' option--wrong';
            else state = ' option--dim';
          }
          return (
            <button
              key={option}
              type="button"
              className={`option${state}`}
              disabled={!!result || submitting}
              onClick={() => onAnswer(option)}
            >
              {optionLabel(card, option)}
              {result && option === result.correctAnswer && <span aria-hidden="true"> ✓</span>}
              {result && option === result.answer && !result.isCorrect && (
                <span aria-hidden="true"> ✗</span>
              )}
            </button>
          );
        })}
      </div>

      {result && <ResultPanel card={card} rewards={rewards} isLast={isLast} onNext={onNext} />}
    </article>
  );
}

function ResultPanel({
  card,
  rewards,
  isLast,
  onNext,
}: {
  card: Card;
  rewards: Reward[] | undefined;
  isLast: boolean;
  onNext: () => void;
}) {
  const result = card.result!;
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the result so screen readers announce it and keyboard users can continue.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const points =
    rewards?.find((r) => r.reason === 'correct_answer')?.delta ??
    (result.isCorrect ? POINTS.correctAnswer : 0);

  return (
    <section className={`result ${result.isCorrect ? 'result--right' : 'result--wrong'}`}>
      <h3 ref={headingRef} tabIndex={-1} className="result__title">
        {result.isCorrect ? `✅ ${strings.correct}` : `❌ ${strings.wrong}`}
        {points > 0 && <span className="chip chip--points">{strings.plusPoints(points)}</span>}
      </h3>

      {!result.isCorrect && (
        <p>
          {strings.rightAnswer} <strong>{optionLabel(card, result.correctAnswer)}</strong>
        </p>
      )}

      <h4 className="result__why">💡 {strings.why}</h4>
      <p>{result.explanation}</p>

      {result.redFlags.length > 0 && (
        <>
          <h4 className="result__why">{strings.redFlags}</h4>
          <ul className="flags">
            {result.redFlags.map((flag) => (
              <li key={flag} className="chip chip--flag">
                🚩 {flag}
              </li>
            ))}
          </ul>
        </>
      )}

      <button type="button" className="primary" onClick={onNext}>
        {isLast ? strings.seeResult : strings.next} →
      </button>
    </section>
  );
}
