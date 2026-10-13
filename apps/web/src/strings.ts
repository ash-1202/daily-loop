// All user-facing text lives here, in short plain English, so it is easy to review and translate later.
// Rules: short sentences, common words, one idea per line, and an icon next to important words.

export const strings = {
  appName: 'Market Daily 5',
  tagline: 'Learn about markets in one minute a day.',

  // Loading and errors
  loading: 'Loading…',
  offline: 'No internet connection.',
  serverError: 'Something went wrong.',
  retry: 'Try again',
  answerNotSent: 'Your answer was not sent. Check your internet.',

  // Top bar
  streakLabel: (n: number) => `${n}-day streak`,
  pointsLabel: (n: number) => `${n} points`,
  atRisk: 'Finish today to keep your 🔥 streak!',

  // Cards
  cardOf: (n: number, total: number) => `Card ${n} of ${total}`,
  termTitle: 'Market word',
  scamTitle: 'Scam or Safe?',
  chartTitle: 'Read the chart',
  scamIntro: 'You got this message:',
  scamQuestion: 'Is it a scam or safe?',
  scamOption: { scam: '🚩 Scam', safe: '✅ Safe' } as Record<string, string>,

  // Result
  correct: 'Correct!',
  wrong: 'Not quite',
  plusPoints: (n: number) => `+${n} points`,
  rightAnswer: 'Right answer:',
  why: 'Why?',
  redFlags: 'Warning signs',
  next: 'Next card',
  seeResult: 'See today’s result',

  // Done
  doneTitle: 'Done for today! 🎉',
  score: (correct: number, total: number) => `You got ${correct} of ${total} right.`,
  pointsToday: 'Points today',
  newBadge: 'New badge!',
  nextChallengeIn: 'Next challenge in',
  comeBack: 'Come back tomorrow for 5 new cards.',
  seeLeaderboard: 'See leaderboard',

  // Tabs
  tabToday: 'Today',
  tabLeaders: 'Leaders',
  tabMe: 'Me',

  // Leaderboard
  leadersTitle: 'This week’s leaders',
  leadersEmpty: 'No points yet this week. Be the first!',
  you: 'You',
  yourRank: (rank: number | null, points: number) =>
    rank ? `You are #${rank} with ${points} points.` : 'Answer today’s cards to join the list.',
  weekNote: 'A new week starts every Monday.',

  // Me
  meTitle: 'Your progress',
  yourName: 'Your name on the leaderboard',
  namePlaceholder: 'e.g. Asha',
  save: 'Save',
  saved: 'Saved ✓',
  nameRules: '2–20 letters or numbers.',
  points: 'Points',
  streak: 'Streak',
  longest: 'Best streak',
  freezes: 'Streak freeze',
  freezeHelp: 'Miss one day a week and your streak is safe. 🧊',
  badgesTitle: 'Badges',
  locked: 'Locked',
} as const;
