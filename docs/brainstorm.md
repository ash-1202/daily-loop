# Brainstorm

A living record of ideas and decisions for **daily-loop**. Update it as decisions are made.
The final explainer can be written from this file.

---

## 1. The brief (Kenpath Labs build task)

Build a small, responsive web app that people would want to open every day.
They do a short task and are rewarded for it.

- Task type and reward mechanics are our choice. A small idea done well beats a big one half done.
- Effort: 4 to 6 hours. Deadline: ~17 Oct 2026.
- Deliverables: live link (free tier), repository with a clone-to-run README,
  explainer (written or a 2 to 3 minute video). Say where AI tools were used.
- Judged equally on: the app, the explainer, the repository.

### Who the users are, and what that means for us

| Fact about users | Design consequence |
|---|---|
| Modest Android phones, mobile data | Small JS bundle (< ~150 KB), few/light assets, fast first load on 3G, PWA + offline queue |
| English is often a second language | Short, plain words; icons alongside text; all strings in one file for future translation |
| Earnings are worth real money | Server-side scoring only, append-only points ledger, idempotent submissions, nothing lost to bugs |

---

## 1a. The daily challenge: Market Daily 5

**Decision (2026-10-13):** a financial-literacy challenge themed on trading in India.
Every day the user answers **5 short cards** (~1 minute in total).

| Cards | Type | What the user does |
|---|---|---|
| 2 | **Market word** (`term`) | Multiple choice on a term such as SIP, T+1, circuit limit, stop-loss, F&O lot size |
| 2 | **Scam or Safe?** (`scam`) | Reads a realistic message (e.g. "Guaranteed 5% daily! Join my Telegram VIP") and taps 🚩 Scam or ✅ Safe |
| 1 | **Read the chart** (`chart`) | Sees a past candlestick snippet with the stock name hidden and names the pattern or trend |

After every answer a short **"Why?"** explanation is shown, so wrong answers still teach something.
If time runs short, `chart` cards are dropped first; `term` + `scam` alone are a complete app.

### Guardrail: reward learning, never market predictions

Rewards are worth real money to these users, so points come only from answering knowledge
questions correctly, never from guessing where prices will go.

- Paying for price predictions makes the app look like betting (India's 2025 online gaming
  law bans real-money games).
- No stock tips or recommendations (SEBI restricts unregistered investment advice).
  Chart cards use **past** data with the stock name hidden.
- This is a design guardrail, not legal advice.

### Ideas considered and not chosen

| Idea | Why not (for now) |
|---|---|
| Money maths (SIP returns, brokerage, tax) | Fee and tax rules change and need upkeep |
| Paper trade of the day | Needs a market feed, too big for 4 to 6 hours, drifts towards prediction |
| "Did Nifty close up or down?" | Needs live data; rewards guessing rather than learning |

### Rewards

| Mechanic | Rule (first draft) |
|---|---|
| Points | +10 per correct answer, +5 bonus for finishing all 5 |
| Streak | 🔥 counter for consecutive days; 1 free streak freeze per week |
| Badges | 🛡️ *Scam Spotter* (10 scams caught), 📈 *Chart Reader* (10 charts right), 📚 *7-Day Learner* (7-day streak) |
| Leaderboard | Weekly, ranked by points |

### Why it fits the users

- **Second-language English:** one sentence per card, icons, one tap to answer.
- **Modest phones and mobile data:** cards are text plus small SVG charts drawn from OHLC numbers;
  no chart library, no images to download.
- **Real money at stake:** scam cards teach people to protect their money; rewards are scored on the server.
- **Later:** Hindi copy. All strings live in one file, so adding it is cheap.

### Datasets

```
datasets/
├── terms.json           # id, question, options[], answer, explanation, icon
├── scams.json           # id, message, is_scam, red_flags[], explanation
├── chart_universe.json  # symbols the chart generator may use (e.g. NIFTY 50 tickers)
└── charts_fallback.json # a few hand-made chart cards, used only if market data is unavailable
```

`term` and `scam` cards are hand-written. `chart` cards are **generated every day by a backend
service** from Yahoo Finance data (see 2b). No data from any other personal project is used.

---

## 2. Architecture

**Rule: the frontend shows things, the backend decides things.**

| Concern | Frontend (`apps/web`) | Backend (`apps/api`) |
|---|---|---|
| Showing the task | Renders the task | Serves today's task **without answers** |
| Submitting | Sends answer + idempotency key | Validates, scores, records exactly once |
| Points and streaks | Displays them | Calculates them; append-only ledger |
| Badges and levels | Celebration UI | Rules engine awards them |
| Leaderboard | Displays it | Aggregates it (cached) |
| Offline | Queues submissions, retries | Idempotent, so retries never double-pay |

### Stack (decided 2026-10-13)

- **Frontend:** React + Vite, PWA (service worker), TypeScript.
- **Backend:** Node.js + Fastify, TypeScript (types shared via `packages/shared`).
- **Database:** Postgres on a free tier (Neon or Supabase).
- **Hosting:** web on Cloudflare Pages or Vercel; API on Render or Fly.io.

### Why Node.js (and not Java) for the backend

Java (Spring Boot) was considered with future scale in mind. At this app's likely scale, the
language is not the limit; the architecture is. The workload is I/O-bound (small JSON reads and
writes against Postgres), which Node handles very well.

| | Node.js + TypeScript | Java (Spring Boot) |
|---|---|---|
| Fits the 4 to 6 hour budget | ✅ Little boilerplate | ⚠️ More setup and ceremony |
| Shared types with the frontend | ✅ One `packages/shared` | ❌ Duplicated or generated |
| Free tier (512 MB, sleeps when idle) | ✅ ~50 to 100 MB, ~1 s cold start | ⚠️ ~300 to 500 MB, 5 to 15 s cold start |
| First load when opened on a phone | ✅ Fast, even after sleeping | ❌ Risk of a blank screen |
| Heavy CPU work at very large scale | OK | ✅ Stronger |

### How it scales later

1. **Stateless API:** run more instances behind a load balancer.
2. **Postgres:** connection pooling, then read replicas.
3. **Leaderboard:** move to Redis sorted sets when queries get heavy.
4. **Background work** (badge checks, generating each day's challenge): move to a job queue.
5. **CPU-heavy services** (e.g. analytics): split out just that service, in Java or Go if needed.

### Why React (and the path to a React Native app)

React was chosen over Preact so that a future **React Native** mobile app can share as much as possible.

- React Native **cannot reuse web screens** (`<div>` vs `<View>`), so UI would be rewritten.
- What **can** be shared is everything that is not UI: types, validation schemas, the API client,
  hooks, and reward/streak display logic.
- So from day one, non-UI code lives in `packages/shared`, and `apps/web` contains only screens.
  A future `apps/mobile` (Expo / React Native) then only needs its own screens.
- Cost: React adds ~45 KB gzipped vs ~4 KB for Preact. This still fits the ~150 KB budget.
- Not chosen: sharing screens via react-native-web, because it makes the web bundle heavier on low-end phones.

### Repository layout

```
daily-loop/
├── apps/
│   ├── web/          # frontend (PWA)
│   └── api/          # backend (REST API)
├── packages/
│   └── shared/       # types, schemas, API client, hooks (no UI; reusable by React Native)
├── datasets/         # versioned content (JSON/CSV)
├── db/
│   ├── migrations/   # SQL migrations
│   └── seed/         # validate + load datasets into the DB
└── docs/
    └── brainstorm.md
```

---

## 2a. Login and authentication

**Decision (2026-10-13):** play as a guest first; verify by **email OTP** to save progress and claim rewards.
Phone login (SMS / WhatsApp OTP) can be added later without schema changes.

### Flow

```
Open app → play as guest (device token) → "Save your streak 🔥" → enter email → 6-digit OTP → same account, now verified
```

### Why guest first

- **Reviewers open the link on a phone first.** An email form plus OTP wait (or OTP in spam) before the
  first card is a bad first impression. As a guest they answer card 1 within seconds.
- **Users with limited English** experience the app before facing a form.
- **Rewards are worth real money**, so a verified email is required **before points can be claimed or
  redeemed**, and progress survives a phone change.

### Why email OTP now, phone later

- Email OTP is effectively free (e.g. Resend free tier: 3,000 emails/month) and every Android user has a Gmail account.
- Phone OTP in India needs **DLT registration** for SMS or WhatsApp Business approval, which takes days.
- No passwords to store, reset or leak.

### Built to add phone login later

- The person (`users`) is separate from how they log in (`identities`). Phone login is a new
  `type = 'phone'` row; one user can have device, email and phone identities.
- OTP delivery sits behind one interface, `OtpSender.send(to, code)`:
  `EmailOtpSender` (Resend) now; `SmsOtpSender` (e.g. MSG91) or `WhatsAppOtpSender` later.
- Merging: if a guest verifies an email that already belongs to another account, the guest's device
  is linked to that account (rule to be finalised while building).

### OTP safety rules

- 6 digits, valid for **10 minutes**, **single use**, at most **5 attempts**.
- Store only a **hash** of the code, never the code itself.
- **Rate-limit** sends per email and per IP (e.g. 3 per 15 minutes) so nobody can spam an inbox.
- Session token in an **httpOnly, Secure, SameSite cookie**; only its hash is stored in `sessions`.
- Local development prints the OTP to the console, so the README setup needs no email account.

---

## 2b. Daily challenge generation

**Decision (2026-10-13):** daily challenges are **pre-generated** by a backend service.
`chart` cards are built from **Yahoo Finance** daily candles; `term` and `scam` cards come from the hand-written datasets.

### How the job works

```
Scheduler (daily) → POST /internal/jobs/generate-challenges (secret header)
  1. Fetch recent daily candles for a few symbols from chart_universe.json  (MarketDataProvider)
  2. Save raw candles to market_candles                                     (our own copy)
  3. Build 1 chart task: pick a past window, hide the name, compute the answer by rules
  4. Pick 2 term + 2 scam tasks not shown in the last N days
  5. Insert daily_challenges rows for the next 7 days that don't exist yet  (idempotent)
```

- **Generate 7 days ahead.** If one run fails (Yahoo down, server asleep), users still get a challenge.
- **Idempotent.** `daily_challenges.date` is unique; re-running the job never creates duplicates or changes a day already served.
- **Last-resort fallback.** If `GET /api/today` finds no row, it builds one from `charts_fallback.json` + the term/scam pools, so the app never shows an empty day.

### How a chart card is built (no predictions)

- Take a window of ~20 **past** daily candles for one symbol.
- **Hide the stock:** no name or ticker, and prices rescaled so the first close = 100.
  The card cannot be read as a tip on a real, identifiable stock.
- **The answer is computed by rules from the data shown**, never about what happens next. Examples:
  - *Trend:* "Over these 20 days the price went…" Up (> +5%) / Down (< −5%) / Sideways.
  - *Last candle:* "The last candle is a…" Doji / Hammer / Bullish engulfing / Normal, using standard definitions.
  - *Biggest move:* "On which day did the price move the most?"
- The explanation is filled from a template using the same numbers ("It started at 100 and ended at 108, up 8%").
- Windows that don't produce a clear answer (e.g. a trend right on the ±5% line) are skipped.

### Yahoo Finance: risks and mitigations

| Risk | Mitigation |
|---|---|
| No official public API; the unofficial endpoints (used via `yahoo-finance2`) can change or rate-limit | Fetch only once a day for a few symbols; 7-day buffer; fallback chart set |
| Yahoo's terms limit redistribution and commercial use | Fine for a demo/learning app; we store our own normalised copy and never show raw prices or names. A licensed source is needed for production |
| Vendor lock-in | All fetching goes through a `MarketDataProvider` interface. `YahooProvider` now; a licensed feed (e.g. NSE data vendor or broker API) later is a new class, not a rewrite |

### Scheduling on free hosting

Free-tier servers sleep when idle, so an in-process cron (e.g. `node-cron`) cannot be relied on.

- **GitHub Actions scheduled workflow** (free) calls `POST /internal/jobs/generate-challenges` once a day,
  e.g. **18:30 IST**, after the market closes at 15:30. The request wakes the server.
- The endpoint is protected by a secret header (`X-Job-Secret`) stored as a GitHub Actions secret.
- At scale this moves to a proper job queue/worker (see "How it scales later").

---

## 3. Database design (first draft)

```
users            id, display_name, timezone, created_at
identities       id, user_id, type('device'|'email'|'phone'), value, verified_at
                 UNIQUE(type, value)
otp_codes        id, identity_type, value, code_hash, expires_at, attempts, used_at
sessions         id, user_id, token_hash, expires_at, revoked_at
datasets         id, name, version, source, content_hash, loaded_at
tasks            id, dataset_id, type('term'|'scam'|'chart'), prompt, options(jsonb),
                 answer(hidden), explanation, payload(jsonb), difficulty, language, active,
                 source('dataset'|'generated'), created_at
daily_challenges date UNIQUE, task_ids[5], bonus_multiplier, generated_at
                 -- one row per day: 2 term, 2 scam, 1 chart; pre-generated 7 days ahead
market_candles   symbol, date, open, high, low, close, volume, provider, fetched_at
                 PRIMARY KEY(symbol, date)                         -- internal only, never sent to clients
job_runs         id, job, started_at, finished_at, status, details(jsonb)   -- audit of each generation run
submissions      id, user_id, task_id, challenge_date, answer, is_correct,
                 idempotency_key UNIQUE, created_at
points_ledger    id, user_id, delta, reason, ref_id, created_at   -- append-only
streaks          user_id, current, longest, last_active_date, freezes_left
badges           id, code, name, rule(jsonb), icon
user_badges      user_id, badge_id, awarded_at
```

### Principles

- **Ledger is the source of truth.** Balance = `SUM(delta)`. Rows are never updated or deleted.
- **Idempotency keys** on submissions, so network retries never double-reward.
- **One day boundary: midnight to midnight IST (Asia/Kolkata)** for challenges, streaks and the weekly
  leaderboard. A streak counts consecutive IST challenge dates, so "today's challenge" and "today's streak"
  can never disagree. `users.timezone` is kept for display and future reminders only.
- **Streak freezes** keep the app forgiving for people with patchy connectivity.
- **Leaderboard:** weekly query + cache to start; materialized view only if needed.

### Changes made while implementing (2026-10-13)

The draft above was implemented in `db/migrations/0001…0004`. What changed, and why:

| Draft | Implemented | Why |
|---|---|---|
| `daily_challenges.task_ids[5]` array | Join table `daily_challenge_tasks (challenge_date, position 1-5, task_id)` | Postgres cannot enforce foreign keys inside an array. The join table guarantees every task exists, no task repeats in a day, and at most 5 positions |
| `submissions` references `task_id` | Composite FK `(challenge_date, task_id) → daily_challenge_tasks` + `UNIQUE(user_id, challenge_date, task_id)` | A user can only answer cards from that day's challenge, and only once each |
| Ledger "append-only" by convention | `BEFORE UPDATE OR DELETE` trigger that raises an error + `UNIQUE(user_id, reason, ref_id)` + `CHECK (delta <> 0)` | Rules that protect real money belong in the database, not only in code that might have a bug |
| `tasks.answer` hidden | Also `CHECK (options ? answer)` | A typo in a dataset can never create an unanswerable card |
| `badges.code` | `badges.id` is the code (e.g. `scam_spotter`) + `description`, `sort_order` | One stable identifier instead of two |
| `streaks.freezes_left` | + `freeze_week` | Knows which IST week the free freeze belongs to, so it refills each Monday |
| `datasets` | + `item_count` | Quick check of what was loaded |

---

## 4. Datasets → DB pipeline

- Content lives in `datasets/` as JSON with **stable IDs** (e.g. `term_0001`, `scam_0001`); git versions it.
- The seed (`apps/api/src/seed/seed.ts`) **validates every file first** against the schemas in
  `packages/shared` plus cross-item rules (unique IDs and questions, distractors different from the
  answer, red flags only on scams). If any file is invalid, **nothing is written**.
- It **upserts** by ID and records the file's sha256 in `datasets`, so an unchanged file is skipped and re-running is safe.
- Items removed from a file are **deactivated, never deleted**: past submissions still reference them.
- Term items store `answer` + `distractors` (not a positional `options` list), so the file has no
  "correct answer is always first" bias; options are shuffled when a day's challenge is built.
- Adding content = edit a dataset file, `npm run datasets:check`, `npm run db:seed`. No code changes.
- First content (v1): 30 market words, 30 scam-or-safe messages (20 scams / 10 safe, so "always tap
  Scam" is not a winning strategy), 4 badges (First Step, 7-Day Learner, Scam Spotter, Chart Reader).
- `chart_universe.json` and `charts_fallback.json` are deferred to the chart generator step, where
  the rules that compute chart answers are written.

---

## 5. API sketch (draft)

```
POST /api/session            -> create/restore guest user (device token) -> session cookie
POST /api/auth/otp/request   -> { email } -> sends a 6-digit OTP (rate-limited)
POST /api/auth/otp/verify    -> { email, code } -> links email to the current user, verified
POST /api/auth/logout        -> revokes the session
GET  /api/today              -> today's challenge (no answers)
POST /api/submissions        -> { taskId, answer, idempotencyKey } -> result + rewards
GET  /api/me                 -> points balance, streak, badges
GET  /api/leaderboard?week=  -> top N + my rank

POST /internal/jobs/generate-challenges  -> (X-Job-Secret header) pre-generates the next 7 days
```

---

## 6. Open questions

1. ~~What is the daily task?~~ Decided: Market Daily 5 (see 1a).
2. ~~Login?~~ Decided: guest first, email OTP to save progress and claim rewards; phone later (see 2a).
3. ~~Which motivators?~~ Decided: points, streak + freeze, 3 badges, weekly leaderboard; no levels.
4. ~~Backend language?~~ Decided: Node.js + TypeScript (Fastify). Frontend: React.
5. ~~Chart data source?~~ Decided: Yahoo Finance via a backend service; no data from other personal projects (see 2b).
6. ~~How are the daily 5 picked?~~ Decided: pre-generated `daily_challenges` rows, 7 days ahead (see 2b).
7. ~~Challenge day boundary?~~ Decided: one global day, midnight to midnight IST, for challenges,
   streaks and the weekly leaderboard (weeks run Monday to Sunday IST).

---

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-13 | Monorepo: `apps/web`, `apps/api`, `packages/shared`, `datasets`, `db` | One clone-to-run README; shared types between web and API |
| 2026-10-13 | Server-authoritative rewards with an append-only ledger | Rewards are worth real money to users |
| 2026-10-13 | Daily challenge = Market Daily 5 (2 term, 2 scam, 1 chart) | Useful financial literacy for first-time investors; dataset-driven; small scope |
| 2026-10-13 | Reward correct knowledge answers only, never price predictions | Avoids betting/gaming-law and stock-tip concerns |
| 2026-10-13 | Motivators: points, streak + weekly freeze, 3 badges, weekly leaderboard; no levels | Enough to bring people back without bloating scope |
| 2026-10-13 | Backend: Node.js + TypeScript + Fastify (Java considered) | I/O-bound workload, shared types, fast cold starts on free tiers; scales via architecture |
| 2026-10-13 | Frontend: React (Preact considered) | Keeps a path to a React Native app; non-UI code in `packages/shared` |
| 2026-10-13 | Login: guest first, email OTP to verify; `users` separate from `identities` | Zero-friction first use; free OTP delivery; phone login later without schema changes |
| 2026-10-13 | Pre-generate daily challenges 7 days ahead via a scheduled backend job | Never an empty day; idempotent; survives a failed run |
| 2026-10-13 | Chart cards generated from Yahoo Finance behind a `MarketDataProvider` interface; no data from other personal projects | Fresh content daily; swappable for a licensed source later |
| 2026-10-13 | Trigger the job from GitHub Actions cron, not an in-process cron | Free-tier servers sleep; the HTTP call wakes them |
| 2026-10-13 | Day boundary: midnight IST for challenges, streaks and leaderboard weeks (Mon to Sun) | India-first audience; one clock means challenge and streak never disagree; simpler code and tests |
| 2026-10-13 | Monorepo with npm workspaces (no Turborepo/Nx); `packages/shared` ships TS source, bundled into the API by tsup | Zero extra tooling; one install and one `npm run dev` |
| 2026-10-13 | Shared schemas use `zod/mini` | Cut the web bundle from 92 KB to 74 KB gzipped, which matters on low-end phones |
| 2026-10-13 | API reads `API_PORT` first, then `PORT`; local Postgres on host port 5433 | Avoids clashing with other dev servers and an existing local Postgres; hosts like Render still set `PORT` |
| 2026-10-13 | Postgres pool has an `error` listener | Without it, a dropped idle connection (DB restart, Neon idle timeout) crashes the API; found while testing |
| 2026-10-13 | Own ~80-line migration runner over plain SQL files (no ORM, no migration library) | Plain SQL is easy to review; runner adds checksums, one transaction per file and an advisory lock |
| 2026-10-13 | Money-related rules enforced in Postgres (triggers, unique keys, composite FKs, checks) | A bug in application code cannot double-pay or edit history |
| 2026-10-13 | Join table `daily_challenge_tasks` instead of a `task_ids[]` array | Arrays cannot have foreign keys |
| 2026-10-13 | Tests run against a separate `daily_loop_test` database; each test rolls back | Dev data is never touched; tests stay independent |
| 2026-10-13 | Badge "First Step" added (4 badges instead of 3) | A reward on day one makes the first session feel complete |

---

## 8. Where AI tools were used

Keep this updated for the explainer.

- 2026-10-13: Claude helped draft this brainstorm document and the initial repository layout.
- 2026-10-13: Claude helped brainstorm trading-themed challenge ideas and the Market Daily 5 design.
- 2026-10-13: Claude helped compare Node.js vs Java and React vs Preact for the stack decision.
- 2026-10-13: Claude helped design the guest-first email OTP login and identities schema.
- 2026-10-13: Claude helped design the daily challenge generation job and rule-based chart cards.
- 2026-10-13: Claude set up the monorepo (workspaces, TypeScript, ESLint, Prettier, Docker Postgres,
  Fastify health endpoint, React page) and tested it, including a database restart.
- 2026-10-13: Claude wrote the SQL migrations, migration runner, seed script and tests, and drafted
  the first 30 market-word and 30 scam-or-safe cards (content to be reviewed by a human for accuracy and tone).
