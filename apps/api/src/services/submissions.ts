import type pg from 'pg';
import {
  addDays,
  CARDS_PER_DAY,
  istDate,
  istDayStart,
  POINTS,
  type Reward,
  type SubmitRequest,
  type SubmitResponse,
} from '@daily-loop/shared';
import { lockKey, withTransaction } from '../lib/db-utils';
import { HttpError } from '../lib/http-error';
import { awardBadges } from './badges';
import {
  displayOptions,
  ensureChallenge,
  getCardRow,
  getCardRows,
  progressOf,
  toCard,
} from './challenges';
import { recordCompletion, streakView } from './streaks';
import { loadStreak, saveStreak, totalPoints } from './users';

/** After midnight IST, answers for yesterday's challenge are still accepted for this long. */
export const GRACE_MINUTES = 15;

/** The challenge dates a user may answer at `now`: today, plus yesterday just after midnight. */
export function openChallengeDates(now: Date): string[] {
  const today = istDate(now);
  const graceEnds = istDayStart(today).getTime() + GRACE_MINUTES * 60_000;
  return now.getTime() < graceEnds ? [today, addDays(today, -1)] : [today];
}

/**
 * Records one answer and applies every reward it earns, in a single transaction:
 * points for a correct answer, the daily bonus and streak when all 5 cards are done, and badges.
 *
 * Safe against retries and double taps:
 * - The same idempotency key returns the original result (`replayed: true`), no new rewards.
 * - A second answer to the same card is rejected (409).
 * - Requests from one user are serialised with an advisory lock, so two cards answered at the
 *   same moment can't both think they completed the day.
 * - The database's unique keys on the ledger are the final guard against double rewards.
 */
export async function submitAnswer(
  pool: pg.Pool,
  userId: string,
  body: SubmitRequest,
  now: Date,
): Promise<SubmitResponse> {
  const date = body.challengeDate;
  const today = istDate(now);

  return withTransaction(pool, async (client) => {
    await lockKey(client, `user:${userId}`);

    // 1. A retry of a request that already succeeded: return the current state, no new rewards.
    const previous = await client.query<{
      user_id: string;
      challenge_date: string;
      task_id: string;
    }>('SELECT user_id, challenge_date, task_id FROM submissions WHERE idempotency_key = $1', [
      body.idempotencyKey,
    ]);
    const prev = previous.rows[0];
    if (prev) {
      if (prev.user_id !== userId || prev.task_id !== body.taskId || prev.challenge_date !== date) {
        throw new HttpError(409, 'idempotency_key_reused', 'This request key was already used.');
      }
      return buildResponse(client, userId, date, body.taskId, today, [], [], true);
    }

    // 2. Is this card open for answers?
    if (!openChallengeDates(now).includes(date)) {
      throw new HttpError(400, 'challenge_closed', `The challenge for ${date} is not open.`);
    }
    await ensureChallenge(client, date);
    const row = await getCardRow(client, date, body.taskId, userId);
    if (!row) {
      throw new HttpError(404, 'card_not_found', 'This card is not part of that day’s challenge.');
    }
    if (row.submitted_answer !== null) {
      throw new HttpError(409, 'already_answered', 'You already answered this card.');
    }
    if (!displayOptions(row, date).includes(body.answer)) {
      throw new HttpError(400, 'invalid_answer', 'That answer is not one of the options.');
    }

    // 3. Record the answer.
    const isCorrect = body.answer === row.answer;
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO submissions (user_id, challenge_date, task_id, answer, is_correct, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [userId, date, body.taskId, body.answer, isCorrect, body.idempotencyKey, now],
    );
    const submissionId = inserted.rows[0]!.id;

    // 4. Rewards. ON CONFLICT DO NOTHING + RETURNING: a reward is reported only if it was really added.
    const rewards: Reward[] = [];
    const addPoints = async (delta: number, reason: Reward['reason'], refId: string) => {
      const res = await client.query(
        `INSERT INTO points_ledger (user_id, delta, reason, ref_id, created_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id`,
        [userId, delta, reason, refId, now],
      );
      if (res.rowCount) rewards.push({ delta, reason });
    };

    if (isCorrect) await addPoints(POINTS.correctAnswer, 'correct_answer', submissionId);

    let streak = await loadStreak(client, userId, true);
    const progress = progressOf(await getCardRows(client, date, userId));
    if (progress.answered === CARDS_PER_DAY) {
      const { rows } = await client.query<{ bonus_multiplier: string }>(
        'SELECT bonus_multiplier FROM daily_challenges WHERE date = $1',
        [date],
      );
      const multiplier = Number(rows[0]!.bonus_multiplier);
      await addPoints(Math.round(POINTS.dailyBonus * multiplier), 'daily_bonus', date);
      streak = recordCompletion(streak, date);
      await saveStreak(client, userId, streak, now);
    }

    const newBadges = await awardBadges(client, userId, streakView(streak, today).current, now);
    return buildResponse(client, userId, date, body.taskId, today, rewards, newBadges, false);
  });
}

async function buildResponse(
  client: pg.PoolClient,
  userId: string,
  date: string,
  taskId: string,
  today: string,
  rewards: Reward[],
  newBadges: SubmitResponse['newBadges'],
  replayed: boolean,
): Promise<SubmitResponse> {
  const rows = await getCardRows(client, date, userId);
  const progress = progressOf(rows);
  const row = rows.find((r) => r.task_id === taskId)!;
  return {
    card: toCard(row, date),
    rewards,
    newBadges,
    progress,
    completed: progress.answered === CARDS_PER_DAY,
    streak: streakView(await loadStreak(client, userId), today),
    totalPoints: await totalPoints(client, userId),
    replayed,
  };
}
