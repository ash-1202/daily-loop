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
├── terms.json    # id, question, options[], answer, explanation, icon
├── scams.json    # id, message, is_scam, red_flags[], explanation
└── charts.json   # id, ohlc[], pattern, options[], answer, explanation   (stock name hidden)
```

Chart data can come from historical candle snapshots (e.g. from earlier trading projects),
with stock names removed.

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

### Stack (proposed)

- **Frontend:** Preact or React + Vite, PWA (service worker), TypeScript.
- **Backend:** Node + Fastify or Hono, TypeScript (types shared via `packages/shared`).
  FastAPI is the alternative if we prefer Python.
- **Database:** Postgres on a free tier (Neon or Supabase).
- **Hosting:** web on Cloudflare Pages or Vercel; API on Render or Fly.io.

### Repository layout

```
daily-loop/
├── apps/
│   ├── web/          # frontend (PWA)
│   └── api/          # backend (REST API)
├── packages/
│   └── shared/       # shared types + validation schemas
├── datasets/         # versioned content (JSON/CSV)
├── db/
│   ├── migrations/   # SQL migrations
│   └── seed/         # validate + load datasets into the DB
└── docs/
    └── brainstorm.md
```

---

## 3. Database design (first draft)

```
users            id, display_name, device_token, timezone, created_at
datasets         id, name, version, source, content_hash, loaded_at
tasks            id, dataset_id, type('term'|'scam'|'chart'), prompt, options(jsonb),
                 answer(hidden), explanation, payload(jsonb), difficulty, language, active
daily_challenges date, task_ids[5], bonus_multiplier         -- one row per day: 2 term, 2 scam, 1 chart
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
- **Streaks use the user's local timezone**, so late-night activity counts for the right day.
- **Streak freezes** keep the app forgiving for people with patchy connectivity.
- **Leaderboard:** weekly query + cache to start; materialized view only if needed.

---

## 4. Datasets → DB pipeline

- Content lives in `datasets/` as JSON/CSV with **stable IDs** (e.g. `q_0001`); git versions it.
- A seed script in `db/seed/` **validates** each file against the shared schemas,
  **upserts** by ID, and records `content_hash` in `datasets`, so re-running is safe.
- Adding content = edit a dataset file + re-seed. No code changes.

---

## 5. API sketch (draft)

```
POST /api/session            -> create/restore anonymous user (device token)
GET  /api/today              -> today's challenge (no answers)
POST /api/submissions        -> { taskId, answer, idempotencyKey } -> result + rewards
GET  /api/me                 -> points balance, streak, badges
GET  /api/leaderboard?week=  -> top N + my rank
```

---

## 6. Open questions

1. ~~What is the daily task?~~ Decided: Market Daily 5 (see 1a).
2. **Login:** anonymous device token only, or optional name/phone?
3. ~~Which motivators?~~ Decided: points, streak + freeze, 3 badges, weekly leaderboard; no levels.
4. **Backend language:** TypeScript (shared types) or Python (FastAPI)?
5. **Chart data source:** historical candle snapshots from earlier projects, or a small hand-made set?
6. **How are the daily 5 picked?** Pre-generated `daily_challenges` rows, or chosen on the fly with a date-based seed?

---

## 7. Decision log

| Date | Decision | Why |
|---|---|---|
| 2026-10-13 | Monorepo: `apps/web`, `apps/api`, `packages/shared`, `datasets`, `db` | One clone-to-run README; shared types between web and API |
| 2026-10-13 | Server-authoritative rewards with an append-only ledger | Rewards are worth real money to users |
| 2026-10-13 | Daily challenge = Market Daily 5 (2 term, 2 scam, 1 chart) | Useful financial literacy for first-time investors; dataset-driven; small scope |
| 2026-10-13 | Reward correct knowledge answers only, never price predictions | Avoids betting/gaming-law and stock-tip concerns |
| 2026-10-13 | Motivators: points, streak + weekly freeze, 3 badges, weekly leaderboard; no levels | Enough to bring people back without bloating scope |

---

## 8. Where AI tools were used

Keep this updated for the explainer.

- 2026-10-13: Claude helped draft this brainstorm document and the initial repository layout.
- 2026-10-13: Claude helped brainstorm trading-themed challenge ideas and the Market Daily 5 design.
