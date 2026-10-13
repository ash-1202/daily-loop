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
  chartAria: (days: number) => `Candlestick chart of a stock's price over ${days} days`,
  chartDay: (n: number) => `Day ${n}`,
  chartCaption: 'Hollow candle = closed higher. Filled = closed lower. Prices start at 100.',

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

  // Save progress (email login)
  saveTitle: '🔒 Save your progress',
  saveHelp: 'Add your email to keep your points and streak, even on a new phone.',
  emailLabel: 'Your email',
  emailPlaceholder: 'name@example.com',
  sendCode: 'Send code',
  codeSentTo: (email: string) => `We sent a 6-digit code to ${email}.`,
  codeLabel: 'Code from the email',
  verify: 'Verify',
  newCode: 'Send a new code',
  otherEmail: 'Use a different email',
  savedAs: (email: string) => `✅ Progress saved to ${email}`,
  welcomeBack: 'Welcome back! You are signed in to your saved account.',
  neverShare: 'We will never ask you for this code. Do not share it.',
  logout: 'Log out',
  logoutHelp:
    'On this phone you will start again as a new guest. Sign in with your email any time.',
  saveNudge: 'Save your streak: add your email in Me.',
  saveNudgeButton: 'Save progress',
} as const;
