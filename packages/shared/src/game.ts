// Game rules shared by the API (which enforces them) and the web app (which explains them).

export const CARDS_PER_DAY = 5;

/** Which card types make up a day, in order. Chart falls back to a term until chart cards exist. */
export const DAILY_MIX = ['term', 'scam', 'term', 'scam', 'chart'] as const;

export const POINTS = {
  correctAnswer: 10,
  dailyBonus: 5, // for answering all 5 cards, multiplied by the day's bonus_multiplier
} as const;

export const STREAK_FREEZES_PER_WEEK = 1;
