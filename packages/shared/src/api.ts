import { z } from 'zod/mini';

// Request and response contracts for the daily-loop API. The API validates requests with these;
// the API client validates responses with them. One definition, so the two can't drift apart.

const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/));
const taskType = z.enum(['term', 'scam', 'chart']);

// ---------- Errors ----------

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

// ---------- Session ----------

export const sessionRequestSchema = z.object({
  /** Random token the app creates once and keeps on the device. */
  deviceToken: z.string().check(z.regex(/^[A-Za-z0-9_-]{32,128}$/)),
});
export type SessionRequest = z.infer<typeof sessionRequestSchema>;

export const userSchema = z.object({
  id: z.string(),
  displayName: z.nullable(z.string()),
});
export type User = z.infer<typeof userSchema>;

export const sessionResponseSchema = z.object({
  user: userSchema,
  isNew: z.boolean(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// ---------- Cards ----------

/** Shown only after the card is answered. */
export const cardResultSchema = z.object({
  answer: z.string(),
  isCorrect: z.boolean(),
  correctAnswer: z.string(),
  explanation: z.string(),
  redFlags: z.array(z.string()),
});
export type CardResult = z.infer<typeof cardResultSchema>;

export const cardSchema = z.object({
  position: z.number(),
  taskId: z.string(),
  type: taskType,
  prompt: z.string(),
  options: z.array(z.string()),
  icon: z.nullable(z.string()),
  /** null until answered. The correct answer is never sent before that. */
  result: z.nullable(cardResultSchema),
});
export type Card = z.infer<typeof cardSchema>;

export const progressSchema = z.object({
  answered: z.number(),
  correct: z.number(),
  total: z.number(),
});
export type Progress = z.infer<typeof progressSchema>;

export const todayResponseSchema = z.object({
  date: isoDate,
  cards: z.array(cardSchema),
  progress: progressSchema,
  completed: z.boolean(),
});
export type TodayResponse = z.infer<typeof todayResponseSchema>;

// ---------- Streaks and badges ----------

export const streakSchema = z.object({
  current: z.number(),
  longest: z.number(),
  freezesLeft: z.number(),
  completedToday: z.boolean(),
  /** True if today is the last chance to keep the streak (a freeze would be used). */
  atRisk: z.boolean(),
});
export type Streak = z.infer<typeof streakSchema>;

export const badgeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  awardedAt: z.nullable(z.string()),
});
export type Badge = z.infer<typeof badgeSchema>;

// ---------- Submissions ----------

export const submitRequestSchema = z.object({
  challengeDate: isoDate,
  taskId: z.string().check(z.minLength(1), z.maxLength(64)),
  answer: z.string().check(z.minLength(1), z.maxLength(200)),
  /** Created by the client once per answer; a retry with the same key is a no-op. */
  idempotencyKey: z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/)),
});
export type SubmitRequest = z.infer<typeof submitRequestSchema>;

export const rewardSchema = z.object({
  delta: z.number(),
  reason: z.enum(['correct_answer', 'daily_bonus', 'badge', 'adjustment']),
});
export type Reward = z.infer<typeof rewardSchema>;

export const submitResponseSchema = z.object({
  card: cardSchema,
  rewards: z.array(rewardSchema),
  newBadges: z.array(badgeSchema),
  progress: progressSchema,
  completed: z.boolean(),
  streak: streakSchema,
  totalPoints: z.number(),
  /** True if this was a retry of a request that had already succeeded. */
  replayed: z.boolean(),
});
export type SubmitResponse = z.infer<typeof submitResponseSchema>;

// ---------- Me ----------

export const meResponseSchema = z.object({
  user: userSchema,
  points: z.number(),
  streak: streakSchema,
  badges: z.array(badgeSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const updateMeRequestSchema = z.object({
  displayName: z
    .string()
    .check(z.trim(), z.minLength(2), z.maxLength(20), z.regex(/^[\p{L}\p{N} _.-]+$/u)),
});
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

// ---------- Leaderboard ----------

export const leaderboardEntrySchema = z.object({
  rank: z.number(),
  displayName: z.string(),
  points: z.number(),
  isMe: z.boolean(),
});
export type LeaderboardEntry = z.infer<typeof leaderboardEntrySchema>;

export const leaderboardResponseSchema = z.object({
  weekStart: isoDate,
  entries: z.array(leaderboardEntrySchema),
  me: z.object({ rank: z.nullable(z.number()), points: z.number() }),
});
export type LeaderboardResponse = z.infer<typeof leaderboardResponseSchema>;
