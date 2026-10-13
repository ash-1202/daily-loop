import type pg from 'pg';
import { CARDS_PER_DAY, DAILY_MIX, type Card, type Progress } from '@daily-loop/shared';
import { lockKey, type Db } from '../lib/db-utils';
import { seededShuffle } from '../lib/shuffle';

type TaskType = 'term' | 'scam' | 'chart';

/** Types to try for each slot, in order. Chart falls back to a term until chart cards exist. */
const SLOT_CANDIDATES: Record<TaskType, TaskType[]> = {
  term: ['term'],
  scam: ['scam'],
  chart: ['chart', 'term'],
};

/** The least recently used active card of a type, excluding cards already chosen for the day. */
async function pickLeastRecentlyUsed(
  client: pg.PoolClient,
  type: TaskType,
  exclude: string[],
): Promise<string | undefined> {
  const { rows } = await client.query<{ id: string }>(
    `SELECT t.id
     FROM tasks t
     LEFT JOIN LATERAL (
       SELECT max(d.challenge_date) AS last_used
       FROM daily_challenge_tasks d WHERE d.task_id = t.id
     ) u ON true
     WHERE t.type = $1 AND t.active AND NOT (t.id = ANY($2::text[]))
     ORDER BY u.last_used NULLS FIRST, random()
     LIMIT 1`,
    [type, exclude],
  );
  return rows[0]?.id;
}

/**
 * Makes sure the challenge for `date` exists, creating it if needed. Must run inside a transaction.
 *
 * Cards are picked per slot in DAILY_MIX order, least recently used first (never-used cards first,
 * ties broken randomly), so content rotates evenly and doesn't repeat until the pool runs out.
 * An advisory lock on the date means two simultaneous requests can't both build the same day.
 */
export async function ensureChallenge(client: pg.PoolClient, date: string): Promise<void> {
  const exists = async () =>
    (await client.query('SELECT 1 FROM daily_challenges WHERE date = $1', [date])).rowCount! > 0;

  if (await exists()) return;
  await lockKey(client, `challenge:${date}`);
  if (await exists()) return; // another request built it while we waited

  const chosen: string[] = [];
  for (const slotType of DAILY_MIX) {
    let taskId: string | undefined;
    for (const type of SLOT_CANDIDATES[slotType]) {
      taskId = await pickLeastRecentlyUsed(client, type, chosen);
      if (taskId) break;
    }
    if (!taskId) throw new Error(`Not enough active cards to build the challenge for ${date}`);
    chosen.push(taskId);
  }

  await client.query('INSERT INTO daily_challenges (date) VALUES ($1)', [date]);
  for (const [i, taskId] of chosen.entries()) {
    await client.query(
      'INSERT INTO daily_challenge_tasks (challenge_date, position, task_id) VALUES ($1, $2, $3)',
      [date, i + 1, taskId],
    );
  }
}

export interface CardRow {
  position: number;
  task_id: string;
  type: TaskType;
  prompt: string;
  options: string[];
  answer: string;
  explanation: string;
  payload: { icon?: string; red_flags?: string[] };
  submitted_answer: string | null;
  is_correct: boolean | null;
}

const cardColumns = `
  d.position, t.id AS task_id, t.type, t.prompt, t.options, t.answer, t.explanation, t.payload,
  s.answer AS submitted_answer, s.is_correct`;

/** The day's cards for one user, with that user's answers (if any). */
export async function getCardRows(db: Db, date: string, userId: string): Promise<CardRow[]> {
  const { rows } = await db.query<CardRow>(
    `SELECT ${cardColumns}
     FROM daily_challenge_tasks d
     JOIN tasks t ON t.id = d.task_id
     LEFT JOIN submissions s
       ON s.user_id = $2 AND s.challenge_date = d.challenge_date AND s.task_id = d.task_id
     WHERE d.challenge_date = $1
     ORDER BY d.position`,
    [date, userId],
  );
  return rows;
}

export async function getCardRow(
  db: Db,
  date: string,
  taskId: string,
  userId: string,
): Promise<CardRow | undefined> {
  const { rows } = await db.query<CardRow>(
    `SELECT ${cardColumns}
     FROM daily_challenge_tasks d
     JOIN tasks t ON t.id = d.task_id
     LEFT JOIN submissions s
       ON s.user_id = $3 AND s.challenge_date = d.challenge_date AND s.task_id = d.task_id
     WHERE d.challenge_date = $1 AND d.task_id = $2`,
    [date, taskId, userId],
  );
  return rows[0];
}

/** Options as shown to users: shuffled per day and card (Scam/Safe keeps a fixed order). */
export function displayOptions(row: Pick<CardRow, 'type' | 'options' | 'task_id'>, date: string) {
  return row.type === 'scam' ? row.options : seededShuffle(row.options, `${date}:${row.task_id}`);
}

/**
 * Converts a database row to what the client may see. The correct answer, explanation and red
 * flags are included only once the user has answered the card.
 */
export function toCard(row: CardRow, date: string): Card {
  const answered = row.submitted_answer !== null;
  return {
    position: row.position,
    taskId: row.task_id,
    type: row.type,
    prompt: row.prompt,
    options: displayOptions(row, date),
    icon: row.payload.icon ?? null,
    result: answered
      ? {
          answer: row.submitted_answer!,
          isCorrect: row.is_correct!,
          correctAnswer: row.answer,
          explanation: row.explanation,
          redFlags: row.payload.red_flags ?? [],
        }
      : null,
  };
}

export function progressOf(rows: CardRow[]): Progress {
  return {
    answered: rows.filter((r) => r.submitted_answer !== null).length,
    correct: rows.filter((r) => r.is_correct).length,
    total: CARDS_PER_DAY,
  };
}
