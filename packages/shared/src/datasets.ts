import { z } from 'zod/mini';

// Schemas for the hand-written dataset files in datasets/. The seed script validates every file
// against these before anything is written to the database.

const text = (max: number) => z.string().check(z.minLength(1), z.maxLength(max));
const stableId = (prefix: string) => z.string().check(z.regex(new RegExp(`^${prefix}_\\d{4}$`)));
const difficulty = z.int().check(z.gte(1), z.lte(3));
const positiveInt = z.int().check(z.gte(1));

/** A "Market word" card: pick the right meaning. */
export const termItemSchema = z.object({
  id: stableId('term'),
  question: text(120),
  answer: text(90),
  distractors: z.array(text(90)).check(z.minLength(2), z.maxLength(3)),
  explanation: text(240),
  icon: text(8),
  difficulty,
});

/** A "Scam or Safe?" card: read a message, decide if it is a scam. */
export const scamItemSchema = z.object({
  id: stableId('scam'),
  message: text(240),
  is_scam: z.boolean(),
  red_flags: z.array(text(80)).check(z.maxLength(4)),
  explanation: text(240),
  difficulty,
});

export const badgeRuleSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('challenges_completed'), count: positiveInt }),
  z.object({
    type: z.literal('correct_count'),
    task_type: z.enum(['term', 'scam', 'chart']),
    count: positiveInt,
  }),
  z.object({ type: z.literal('streak'), days: positiveInt }),
]);

export const badgeItemSchema = z.object({
  id: z.string().check(z.regex(/^[a-z][a-z0-9_]*$/)),
  name: text(30),
  description: text(120),
  icon: text(8),
  rule: badgeRuleSchema,
  sort_order: z.int(),
});

const fileHeader = {
  name: text(60),
  version: positiveInt,
};

export const termsFileSchema = z.object({
  dataset: z.literal('terms'),
  ...fileHeader,
  items: z.array(termItemSchema).check(z.minLength(1)),
});

export const scamsFileSchema = z.object({
  dataset: z.literal('scams'),
  ...fileHeader,
  items: z.array(scamItemSchema).check(z.minLength(1)),
});

export const badgesFileSchema = z.object({
  dataset: z.literal('badges'),
  ...fileHeader,
  items: z.array(badgeItemSchema).check(z.minLength(1)),
});

export type TermItem = z.infer<typeof termItemSchema>;
export type ScamItem = z.infer<typeof scamItemSchema>;
export type BadgeItem = z.infer<typeof badgeItemSchema>;
export type BadgeRule = z.infer<typeof badgeRuleSchema>;
export type TermsFile = z.infer<typeof termsFileSchema>;
export type ScamsFile = z.infer<typeof scamsFileSchema>;
export type BadgesFile = z.infer<typeof badgesFileSchema>;

const normalise = (s: string) => s.trim().toLowerCase();

/**
 * Rules a schema cannot express on its own (they compare items with each other or fields within
 * an item). Returns human-readable problems; an empty array means the file is fine.
 */
export function findDatasetProblems(file: TermsFile | ScamsFile | BadgesFile): string[] {
  const problems: string[] = [];

  const seen = new Set<string>();
  for (const item of file.items) {
    if (seen.has(item.id)) problems.push(`${item.id}: duplicate id`);
    seen.add(item.id);
  }

  if (file.dataset === 'terms') {
    const questions = new Set<string>();
    for (const item of file.items) {
      const options = [item.answer, ...item.distractors].map(normalise);
      if (new Set(options).size !== options.length) {
        problems.push(`${item.id}: answer and distractors must all be different`);
      }
      const q = normalise(item.question);
      if (questions.has(q)) problems.push(`${item.id}: duplicate question`);
      questions.add(q);
    }
  }

  if (file.dataset === 'scams') {
    for (const item of file.items) {
      if (item.is_scam && item.red_flags.length === 0) {
        problems.push(`${item.id}: a scam needs at least one red flag`);
      }
      if (!item.is_scam && item.red_flags.length > 0) {
        problems.push(`${item.id}: a safe message should have no red flags`);
      }
    }
  }

  return problems;
}
