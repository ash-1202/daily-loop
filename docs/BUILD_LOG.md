# Build log

A step-by-step learning journal of **how the code was written**: what was built in each step, the
commands that were run, how the key files work, the concepts behind them, what went wrong and how
it was fixed, and how each step was verified.

| File | Answers |
|---|---|
| [README.md](../README.md) | What is this, and how do I run it? |
| [docs/brainstorm.md](brainstorm.md) | What did we decide, and why? |
| **docs/BUILD_LOG.md** (this file) | How was it built, step by step, and what can be learned from it? |

**How to use this file:** one entry per step (usually one branch / pull request), newest at the bottom.
Each entry follows the same template (see the end of this file).

---

## Contents

- [Step 0: Design and architecture](#step-0-design-and-architecture)
- [Step 1: Monorepo setup](#step-1-monorepo-setup)
- [Step 2: Database schema and datasets](#step-2-database-schema-and-datasets)
- [Step 3: Challenge API](#step-3-challenge-api)
- [Step 4: Game screens (web UI)](#step-4-game-screens-web-ui)
- [Step 5: Docker, CI/CD and deployment](#step-5-docker-cicd-and-deployment)
- [Step 6: Chart cards](#step-6-chart-cards)

---

## Step 0: Design and architecture

**Date:** 2026-10-13 · **Branch:** `feature/brainstorming_architecture` · **PR:** [#1](https://github.com/ash-1202/daily-loop/pull/1)

No code, only documents. Before writing code we agreed on:

- **The product:** Market Daily 5, a one-minute daily financial-literacy challenge (2 market words, 2 scam-or-safe, 1 chart).
- **The architecture:** React web app → Node.js/Fastify API → Postgres; shared TypeScript code in between.
- **The rules that shape all later code:** the server decides rewards; points live in an append-only ledger;
  submissions are idempotent; one day boundary (IST); reward learning, never market predictions.

**Lesson:** writing the design down first (README + brainstorm) made every later step faster. Each
coding step below implements a part of that design rather than inventing it on the fly.

---

## Step 1: Monorepo setup

**Date:** 2026-10-13 · **Branch:** `feature/monorepo-setup` · **PR:** [#2](https://github.com/ash-1202/daily-loop/pull/2)

### Goal

Create the skeleton that every later feature builds on: one repository holding the API, the web app
and shared code, where **one install and one command** run everything. Prove the wiring end to end:
browser → web app → API → database.

### What was built

```
daily-loop/
├── package.json          # npm workspaces + root scripts
├── package-lock.json     # exact dependency versions (commit it)
├── tsconfig.base.json    # TypeScript settings shared by every workspace
├── eslint.config.js      # linting rules
├── .prettierrc.json      # formatting rules
├── .editorconfig         # editor basics (indent, line endings)
├── .nvmrc                # Node version (22)
├── .env.example          # settings template, copied to .env (which git ignores)
├── docker-compose.yml    # local Postgres
├── apps/
│   ├── api/
│   │   ├── package.json  # @daily-loop/api
│   │   ├── tsup.config.ts# production build
│   │   └── src/
│   │       ├── config.ts       # reads + validates environment variables
│   │       ├── db.ts           # Postgres connection pool
│   │       ├── app.ts          # builds the Fastify app, registers routes
│   │       ├── server.ts       # starts it, handles shutdown
│   │       └── routes/health.ts# GET /api/health
│   └── web/
│       ├── package.json  # @daily-loop/web
│       ├── vite.config.ts# dev server + /api proxy
│       ├── index.html
│       └── src/
│           ├── main.tsx  # React entry point
│           ├── App.tsx   # the page
│           ├── api.ts    # creates the shared API client
│           ├── strings.ts# all user-facing text
│           └── styles.css
└── packages/
    └── shared/
        ├── package.json  # @daily-loop/shared
        └── src/
            ├── health.ts     # health response schema + type
            ├── api-client.ts # typed fetch client
            └── index.ts      # public exports
```

### Commands that were run

```bash
git checkout -b feature/monorepo-setup

# Dependencies are installed into a specific workspace with -w
npm install zod -w @daily-loop/shared
npm install fastify pg dotenv zod @daily-loop/shared -w @daily-loop/api
npm install -D tsx tsup @types/pg @types/node -w @daily-loop/api
npm install react react-dom @daily-loop/shared -w @daily-loop/web
npm install -D vite @vitejs/plugin-react @types/react @types/react-dom -w @daily-loop/web

# Root-level dev tools (no -w): shared by all workspaces
npm install -D typescript concurrently eslint @eslint/js typescript-eslint \
  eslint-plugin-react-hooks globals prettier

cp .env.example .env
npm run db:up      # docker compose up -d --wait
npm run dev        # API on :3000, web on :5173
```

### Key files explained

**`package.json` (root): workspaces**

```json
"workspaces": ["packages/*", "apps/*"]
```

This one line makes it a monorepo. npm treats each folder as a package and **symlinks** them into
`node_modules/@daily-loop/…`, so `import { createApiClient } from '@daily-loop/shared'` works in the
API and the web app without publishing anything. The root `dev` script uses `concurrently` to run
both servers in one terminal with coloured `[api]` / `[web]` prefixes.

**`packages/shared/package.json`: shipping TypeScript source**

```json
"exports": { ".": "./src/index.ts" }
```

The shared package has **no build step**: it points straight at its `.ts` source. That works because
every consumer already understands TypeScript: Vite (web), `tsx` (API in dev) and `tsup` (API build,
which bundles shared in via `noExternal`). Fewer build steps = fewer things to go stale.

**`apps/api/src/config.ts`: validate settings at startup**

Environment variables are untyped strings. The config file parses them with a Zod schema once, at
startup. If `DATABASE_URL` is missing or not a `postgres://` URL, the API **refuses to start** with a
clear message, instead of failing later on the first request. The rest of the code imports a typed
`config` object and never touches `process.env` directly.

**`apps/api/src/app.ts` vs `server.ts`: build vs start**

`buildApp()` only creates the Fastify instance and registers routes; `server.ts` calls `listen()`.
Keeping them apart means tests (in later steps) can build the app and send fake requests to it with
`app.inject()` without opening a real port.

**`apps/api/src/db.ts`: one connection pool**

Opening a Postgres connection is slow, so the API keeps a **pool** of up to 10 and reuses them.
`isDbUp()` runs `SELECT 1`, the cheapest possible query, for the health check.

**`apps/api/src/routes/health.ts`: an honest health check**

Returns `200 { ok: true, db: "up" }`, or `503 { ok: false, db: "down" }` when the API runs but the
database is unreachable. Hosting platforms use this to decide if the service is healthy.

**`apps/web/vite.config.ts`: the dev proxy**

```ts
proxy: { '/api': 'http://localhost:3000' }
```

The browser only ever talks to `localhost:5173`; Vite forwards `/api/*` to the API. So there is no
CORS setup, and later, login cookies will behave exactly as they will in production on one domain.

**`packages/shared/src/api-client.ts`: one client for web and mobile**

A small wrapper around `fetch` that calls an endpoint and **validates the response** with the shared
schema. Because it uses only `fetch`, the same file will work in a future React Native app.

**`apps/web/src/strings.ts`: all text in one place**

Every sentence the user sees lives here, so the copy can be reviewed for plain English, and
translated (e.g. to Hindi) later without touching components.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Monorepo / npm workspaces | Several packages in one repo, linked locally, installed with one `npm install` |
| Lockfile (`package-lock.json`) | Pins exact versions so every machine installs the same thing; always commit it |
| `dependencies` vs `devDependencies` | Needed at runtime vs only needed to build, test or lint |
| `tsx` / `tsup` / Vite | Run TS directly in dev / bundle the API for production / dev server + bundler for the web |
| Fail fast on config | Validate environment variables at startup, not on first use |
| Connection pooling | Reuse a few DB connections instead of opening one per request |
| Dev proxy | Make the browser see one origin in development, like production |
| Docker Compose | A one-command, throwaway local database with the same version for everyone |

### Problems hit and how they were fixed

**1. ESLint 9 was flagged as unsupported.**
`npm install` warned that `eslint@9` is end-of-life. Upgraded to `eslint@10` after checking that
`typescript-eslint` and `eslint-plugin-react-hooks` list ESLint 10 in their `peerDependencies`
(`npm view <pkg> peerDependencies`). *Lesson: read install warnings; check peer compatibility before upgrading.*

**2. Lint error: "Calling setState synchronously within an effect".**
The first `App.tsx` called `setStatus({ kind: 'checking' })` at the start of a function used as a
`useEffect`. React's lint rule flags this because it causes an extra render. Fix: the initial state is
already `'checking'`, so the effect only starts the request; the "set to checking" happens only in the
**Try again** click handler. *Lesson: initial state should come from `useState(...)`, not from an effect.*

**3. Docker was not running.**
`docker compose` failed with *"failed to connect to the docker API … colima"*. This Mac runs Docker
through **Colima**, which had to be started (`colima start`).

**4. The API started on the web app's port.**
The dev-preview tool sets `PORT=5173` for the web server; the API also read `PORT`, so it took 5173 and
Vite silently moved to 5174. Fixes:
- The API reads its own **`API_PORT`** first and falls back to `PORT` (which hosts like Render set in production).
- Vite has **`strictPort: true`**, so it errors instead of silently moving to another port.

*Lesson: generic environment variable names collide; give each service its own.*

**5. Port 5432 was already taken.**
A Postgres was already installed on this Mac, so Docker's Postgres is exposed on **5433** instead.

**6. The web app said "Cannot reach the server" when only the database was down.**
The API correctly returned `503` with a JSON body, but the client threw on any non-2xx status.
Fix: the client's `get()` accepts a list of statuses whose body is still valid (`[503]` for health).
*Lesson: a non-200 response can still carry meaningful data.*

**7. The whole API crashed when the database restarted (the important one).**
Stopping Postgres made the API process die with *"Unhandled 'error' event … terminating connection due
to administrator command"*. The `pg` pool emits an `error` event when an **idle** connection is closed
by the server, and in Node an `error` event with no listener crashes the process.
Fix in `db.ts`:

```ts
pool.on('error', (err) => {
  console.warn(`Postgres idle client error (client discarded): ${err.message}`);
});
```

The pool throws away the broken connection and opens a fresh one on the next query. This would have
happened in production too: hosted databases such as Neon close idle connections routinely.
*Lesson: test failure paths (stop the DB on purpose), not only the happy path.*

**8. The web bundle was larger than needed.**
The first build was **92 KB gzipped**: React (~60 KB) plus the full Zod library. Switching shared
schemas to **`zod/mini`** (same validation, tree-shakable) brought it to **74 KB**. The API's own
server-only code can keep full Zod, since bundle size does not matter on the server.
*Lesson: measure the bundle early (`npm run build` prints sizes); our users are on cheap phones and mobile data.*

### How it was verified

| Check | Result |
|---|---|
| `npm run typecheck` / `npm run lint` / `npm run format:check` | All pass |
| Open http://localhost:5173 at phone size (375 × 812) | Shows **✅ Connected** |
| Stop the database, reload | Shows **⚠️ Server is up, database is down** |
| `curl /api/health` while cycling the DB: up → stopped → back | `200 → 503 → 503 → 200 → 200`; API never crashed |
| `npm run build`, then run `node apps/api/dist/server.js` | Built API answers `/api/health` with 200 |

### What's next

Step 2, `feature/db-and-datasets`: SQL migrations for every table, the seed script, and the first
market-word and scam-or-safe datasets.

---

## Step 2: Database schema and datasets

**Date:** 2026-10-13 · **Branch:** `feature/db-and-datasets` · **PR:** [#3](https://github.com/ash-1202/daily-loop/pull/3)

### Goal

Turn the data model from the design into real Postgres tables, load the first content into them, and
**prove with tests** that the rules protecting users' rewards are enforced by the database itself.

### What was built

```
db/migrations/
├── 0001_users_and_auth.sql        # users, identities, otp_codes, sessions
├── 0002_content.sql               # datasets, tasks, daily_challenges, daily_challenge_tasks
├── 0003_gameplay.sql              # submissions, points_ledger (+ append-only trigger), streaks, badges
└── 0004_market_data_and_jobs.sql  # market_candles, job_runs
datasets/
├── terms.json                     # 30 "Market word" cards
├── scams.json                     # 30 "Scam or Safe?" cards (20 scam, 10 safe)
└── badges.json                    # 4 badges
packages/shared/src/datasets.ts    # dataset schemas (zod/mini) + cross-item rule checks
apps/api/
├── src/
│   ├── paths.ts                   # repoPath(): find files relative to the repo root
│   ├── migrate.ts                 # the migration runner
│   ├── seed/seed.ts               # validate + load datasets
│   └── scripts/                   # CLI entry points
│       ├── migrate.ts             #   npm run db:migrate
│       ├── seed.ts                #   npm run db:seed
│       ├── reset.ts               #   npm run db:reset (local only)
│       └── check-datasets.ts      #   npm run datasets:check
├── test/
│   ├── global-setup.ts            # creates + migrates + seeds daily_loop_test once
│   ├── test-db.ts                 # helpers: withRollback, expectPgError
│   ├── datasets.test.ts           # dataset files and rule checks
│   └── db-constraints.test.ts     # database rules
├── vitest.config.ts
└── tsup.config.ts                 # now also builds dist/migrate.js and dist/seed.js
```

### Commands that were run

```bash
git checkout main && git pull && git checkout -b feature/db-and-datasets

# Vitest (see problem 1 for why npm 11 was used)
npx -y npm@11 install                  # after adding "vitest" to apps/api devDependencies

npm run datasets:check                 # validate the JSON files, no database needed
npm run db:migrate                     # apply 0001..0004
npm run db:migrate                     # again: "Nothing to do"
npm run db:seed                        # 30 terms, 30 scams, 4 badges inserted
npm run db:seed                        # again: "unchanged" for every file
npm test                               # 18 tests
npm run db:reset                       # wipe local DB, migrate, seed
```

### Key files explained

**Migrations: numbered, plain SQL, never edited**

Each file is one step in the schema's history. The runner (`apps/api/src/migrate.ts`, ~80 lines):

1. Takes a Postgres **advisory lock**, so two processes starting at once (e.g. two deploys) don't both migrate.
2. Creates `schema_migrations (name, checksum, applied_at)` if needed.
3. For each `NNNN_name.sql` file in order: skips it if already applied, otherwise runs it **in its own
   transaction** and records its **sha256 checksum**.
4. If an applied file was **edited later**, it stops with an error. A schema change is always a new file,
   so every database (yours, the test DB, production) goes through exactly the same steps.

Why not an ORM or a migration library? Plain SQL is the most readable description of a schema, and
the runner is small enough to read in a minute. That's a good trade for a project this size.

**Rules enforced by the database (`0003_gameplay.sql`)**

```sql
CREATE TRIGGER points_ledger_append_only
  BEFORE UPDATE OR DELETE ON points_ledger
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
```

| Rule | How Postgres enforces it |
|---|---|
| Points history can't be edited | Trigger raises an error on `UPDATE` / `DELETE` |
| Nothing is rewarded twice | `UNIQUE (user_id, reason, ref_id)` on `points_ledger` |
| One answer per card per day | `UNIQUE (user_id, challenge_date, task_id)` on `submissions` |
| A retry can't create a second answer | `idempotency_key UNIQUE` |
| You can only answer today's cards | Composite FK `(challenge_date, task_id) → daily_challenge_tasks` |
| A card always has its answer among its options | `CHECK (options ? answer)` (the jsonb `?` operator: "does this array contain this string?") |
| At most 5 cards a day, none repeated | `CHECK (position BETWEEN 1 AND 5)`, `UNIQUE (challenge_date, task_id)` |

Application code will still check these things to give friendly error messages, but if that code ever
has a bug, the database refuses the bad write. For data that's worth real money, that is the safety net.

**Why a join table instead of `task_ids[]`**

The design said `daily_challenges.task_ids[5]`. Postgres **can't put a foreign key on array elements**,
so an array could hold an ID that doesn't exist, or the same ID twice. `daily_challenge_tasks` has one
row per card with real foreign keys, and it's what lets `submissions` reference "a card in that day's challenge".

**Dataset format: `answer` + `distractors`**

```json
{ "id": "term_0001", "question": "What is a SIP?",
  "answer": "Investing a fixed amount regularly, like every month",
  "distractors": ["A one-time big investment", "A type of bank loan", "A government tax"], ... }
```

Writing `answer` separately from `distractors` means the file can't accidentally always put the right
answer first; the options get shuffled when a day's challenge is built.

**The seed: validate everything, then write**

`seed.ts` loads **all** files first and validates each in two layers:

1. **Schema** (`packages/shared/src/datasets.ts`): types, lengths, ID format such as `term_0001`.
2. **Rules** (`findDatasetProblems`): duplicate IDs or questions, a distractor equal to the answer
   (ignoring case and spaces), a scam with no red flags, a safe message with red flags.

Only if every file passes does it write, one transaction per changed file:

- The file's **sha256** is compared with `datasets.content_hash`; unchanged files are skipped.
- Rows are **upserted** (`INSERT … ON CONFLICT (id) DO UPDATE`). `RETURNING (xmax = 0) AS inserted`
  is a Postgres trick to tell whether each row was inserted (true) or updated (false), for the report.
- Items no longer in the file are set `active = false`. They're never deleted, because past submissions point to them.

**`db:reset` refuses anything that isn't local**

It drops the whole schema, so it checks the host in `DATABASE_URL` and refuses unless it's
`localhost`/`127.0.0.1`/`::1` and `NODE_ENV` isn't `production`.

**Tests use their own database**

`test/global-setup.ts` runs once: it creates `daily_loop_test` (next to `daily_loop`) if missing,
wipes it, migrates and seeds. Each test then runs inside a transaction that's **always rolled back**
(`withRollback`), so tests don't affect each other and dev data is never touched. To check that a
statement fails, `expectPgError` wraps it in a **savepoint**, because after an error Postgres refuses
every further query in that transaction until you roll back.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Schema migrations | The database schema's version history, applied in order, never rewritten |
| Advisory lock | An app-defined lock in Postgres, here "only one migrator at a time" |
| Constraints as a safety net | `UNIQUE`, `CHECK`, `FOREIGN KEY` and triggers stop bad data even if the code has a bug |
| Composite foreign key | A foreign key over several columns, e.g. "this (date, task) pair must exist in that table" |
| Append-only table | History you can add to but never change: the basis of an auditable points ledger |
| Upsert | `INSERT … ON CONFLICT DO UPDATE`: insert new rows, update existing ones, in one statement |
| Idempotent scripts | Running twice has the same effect as running once (`migrate`, `seed`) |
| Soft delete | Mark as inactive instead of deleting, so references stay valid |
| Content hash | A fingerprint of a file, used to detect changes cheaply |
| Savepoint | A point inside a transaction you can roll back to without losing the whole transaction |
| Postgres error codes | `23505` unique, `23503` foreign key, `23514` check, `P0001` raised by a trigger |

### Problems hit and how they were fixed

**1. `npm install` crashed with "Cannot read properties of null (reading 'edgesOut')".**
Adding Vitest made npm 10's dependency resolver crash. Vitest declares Vite as a *peer dependency*,
and Vite lives in a different workspace (`apps/web`); npm 10 has a bug resolving that across workspaces.
Installing at the root, or a clean reinstall, hit the same crash, and the clean reinstall left
`node_modules` empty. Fix: run the install once with **npm 11** without changing the global npm:
`npx -y npm@11 install`. Then confirmed that **npm 10 installs fine from the resulting lockfile**,
so anyone cloning the repo with Node 22 / npm 10 is unaffected; only *adding* the package triggered the bug.
*Lesson: read the stack trace (`buildIdealTree` → `loadPeerSet` pointed to peer resolution), and check
the fix works with the tool version your users actually have.*

npm 11 also printed that it **blocked esbuild's install script**: a new npm 11 safety default. The
build still worked, because esbuild ships its binary as a platform package; the script only verifies it.

**2. Lint: `preserve-caught-error`.**
Two places caught an error and threw a new, friendlier one. ESLint 10 flags this because the original
stack trace is lost. Fix: `new Error('friendly message', { cause: err })`.
*Lesson: when wrapping an error, keep the original as `cause`.*

**3. All 18 tests passed on the first run, which needed checking.**
A test that can't fail proves nothing. One expected error code was deliberately changed
(`P0001` → `23505`): the append-only test failed as it should, then passed again once restored.
*Lesson: break a test on purpose at least once to see it go red.*

**4. Prettier reformatted the dataset JSON, so the seed "updated" all 60 cards.**
Not a bug: the file bytes changed, so the hash changed, so the seed re-applied the files. That showed the
change detection and upsert path work. Content IDs and text were unchanged.

**5. The web bundle grew by 3 KB with code it never uses.**
Exporting the dataset schemas from `@daily-loop/shared` made the web bundle grow from 73.8 to 76.6 KB
gzipped, even though the web app never imports them. A bundler can only drop unused code if it knows
that loading a file has no **side effects**; `z.object(...)` at the top of a file *looks* like it might.
Fix: `"sideEffects": false` in `packages/shared/package.json`, a promise that every file in the
package is safe to drop when unused. Back to 73.8 KB, and the dataset code is gone from the bundle.
*Lesson: check bundle size after adding shared code, and mark side-effect-free packages.*

### How it was verified

| Check | Result |
|---|---|
| `npm run datasets:check` | terms 30, scams 30, badges 4: all ok |
| `npm run db:migrate` twice | 4 applied, then "Nothing to do" |
| `npm run db:seed` twice | 30 + 30 inserted, 4 badges; then "unchanged" for all |
| `npm test` | **18 passed**: datasets (7) and database rules (11) |
| Break one test on purpose | It failed; restored, it passed |
| Remove `term_0030` from the file, seed; restore, seed | `1 deactivated` → `active = f`; then `active = t` again |
| `npm run db:reset` | Wiped, 4 migrations, seeded |
| `db:reset` with a remote `DATABASE_URL` | **Refused** |
| Built scripts `node apps/api/dist/migrate.js` / `seed.js` | Work (needed for production deploys) |
| API `/api/health` after the reset | Still 200: the pool recovered by itself |
| Web bundle after adding shared dataset code | 73.8 KB gzipped (unchanged), no dataset code inside |
| `npm run lint` / `typecheck` / `format:check` | All pass |

### What's next

Step 3, `feature/challenge-api`: guest sessions, building a day's challenge, `GET /api/today`,
`POST /api/submissions`, and awarding points, streaks and badges through the ledger.

---

## Step 3: Challenge API

**Date:** 2026-10-13 · **Branch:** `feature/challenge-api` · **PR:** [#4](https://github.com/ash-1202/daily-loop/pull/4)

### Goal

Make the game playable through the API: a guest can start a session, get today's 5 cards, answer them,
and receive points, a daily bonus, a streak and badges, with every rule enforced on the server and
safe against retries, double taps and simultaneous requests.

### What was built

```
packages/shared/src/
├── api.ts          # request/response schemas for every endpoint (one source of truth)
├── api-client.ts   # typed client: createSession, today, submit, me, updateMe, leaderboard; ApiError
├── game.ts         # rules both sides need: 5 cards, daily mix, +10 / +5 points, 1 freeze a week
└── time.ts         # IST dates: istDate, istDayStart, addDays, daysBetween, weekStart
apps/api/src/
├── app.ts          # buildApp({ pool, clock }), cookie plugin, auth hook, one error format
├── server.ts       # passes the real pool and clock
├── lib/
│   ├── db-utils.ts # withTransaction, lockKey (advisory lock), DATE parser, isDbUp
│   ├── crypto.ts   # randomToken, sha256
│   ├── shuffle.ts  # seededShuffle
│   └── http-error.ts # HttpError, parseBody (validate with shared schemas)
├── services/
│   ├── sessions.ts    # guest users via device token; session cookies
│   ├── challenges.ts  # build a day (least recently used cards), cards without answers
│   ├── submissions.ts # score an answer and apply every reward, in one transaction
│   ├── streaks.ts     # pure streak rules (freeze, reset, what to display)
│   ├── badges.ts      # evaluate badge rules, award new ones
│   └── users.ts       # points total, streak load/save, display names
└── routes/            # session, today, submissions, me, leaderboard, health
apps/api/test/
├── rules.test.ts      # pure rules: IST dates, answer window, streaks, shuffle, badge rules
├── api.test.ts        # the API end to end through app.inject, with a fake clock
└── api-helpers.ts     # createTestApp, signIn, playDay, resetGameData
```

### Commands that were run

```bash
git checkout main && git pull && git checkout -b feature/challenge-api
npm install @fastify/cookie -w @daily-loop/api

# Manual smoke test against the dev server, keeping cookies in a jar like a browser
curl -c jar.txt -b jar.txt -X POST localhost:3000/api/session \
  -H 'content-type: application/json' -d '{"deviceToken":"…32+ chars…"}'
curl -b jar.txt localhost:3000/api/today
bash smoke-day.sh jar.txt        # answers all 5 cards, then a retry and a double answer

npm test                          # 59 tests
```

### Key files explained

**Routes are thin; services hold the logic**

A route only checks who you are (`requireUser`), validates the body with a shared schema
(`parseBody`), and calls a service. For example `routes/submissions.ts` is 10 lines; all scoring lives
in `services/submissions.ts`. Services take a database handle and a time, so they're easy to test.

**`buildApp({ pool, clock })`: dependency injection without a framework**

The app no longer imports the database or calls `new Date()` itself. `server.ts` passes the real pool
and `() => new Date()`; tests pass the test database and a clock they can move:

```ts
const app = createTestApp(pool);          // starts Wednesday 14 Oct, 12:00 IST
app.setNow(new Date('2026-10-14T18:40:00Z'));  // 00:10 IST on the 15th
```

That's how the tests cover midnight, missed days, a new week and the 15-minute grace period in milliseconds.
Every timestamp the app writes (ledger, submissions) also comes from this clock, so "this week" means
the same thing everywhere.

**Guest sessions (`services/sessions.ts`)**

1. The app creates a random **device token** once and keeps it on the device.
2. `POST /api/session` hashes it and looks for a `device` identity. Found → that user; not found → a new user.
3. The response sets a cookie holding a different random **session token**; only its SHA-256 is stored.
   The cookie is `httpOnly` (JavaScript can't read it), `SameSite=Lax`, and `Secure` in production.
4. If the device token is unknown but the request already has a valid session (the app's storage was
   cleared), the new token is **linked to the existing user**, so progress isn't lost.

An advisory lock on the device hash stops two simultaneous first launches from creating two users.

**Building a day (`ensureChallenge`)**

For each slot in `['term', 'scam', 'term', 'scam', 'chart']`, pick the active card of that type that was
used **least recently** (never-used first, ties random). The chart slot falls back to a term until chart
cards exist. A lock on the date means simultaneous first requests build the day once. It runs on the first
`GET /api/today` of the day; the scheduled job in step 4 will build days in advance.

**Never leak the answer (`toCard`)**

The database row has the answer, explanation and red flags. `toCard` copies them into the response
**only if this user has answered the card**. A test checks the raw JSON of unanswered cards contains none
of them. Options are shuffled with `seededShuffle(options, date + card id)`: the same order for everyone
and on reload, but the right answer isn't always first. Scam/Safe keeps a fixed order so the buttons
don't swap places.

**Scoring an answer (`submitAnswer`)**, in one transaction:

```
lock this user  →  same idempotency key seen?  → return original result, replayed: true
                →  date open? card in that day? not answered yet? answer is an option?
                →  insert submission
                →  correct: +10 (ledger)
                →  5th card: +5 bonus (ledger), update streak
                →  award badges whose rule is now met
```

The ledger inserts use `ON CONFLICT DO NOTHING RETURNING id`, so a reward is reported to the user only
if it was really written, and the database's unique keys remain the final guard.

**Streak rules (`services/streaks.ts`): pure functions**

`recordCompletion(state, date)` returns the new state; `streakView(state, today)` returns what to show.
No database, no clock, so the 7 streak tests run in milliseconds:

| Situation | Result |
|---|---|
| Completed yesterday too | +1 |
| Missed exactly one day, freeze available | +1, freeze used |
| Missed one day, freeze already used this week | back to 1 |
| Missed two days or more | back to 1 |
| New Monday | freeze refills |
| Today, last streak day was 2 days ago and a freeze is left | shown with `atRisk: true` |
| Streak can no longer be saved | shown as 0 (longest is kept) |

**IST dates without a date library (`shared/src/time.ts`)**

`Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'` gives the IST calendar date of any instant.
After that, dates are plain `'YYYY-MM-DD'` strings: they sort correctly, compare with `===`, and
`addDays` / `weekStart` work in UTC so no local timezone can shift them.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Dependency injection | Pass in what code needs (database, clock) instead of importing it, so tests can swap it |
| Fake clock | Control "now" in tests to cover midnight, next week, grace periods instantly |
| Session cookie | A random token in an httpOnly cookie; the server stores only its hash |
| Idempotency key | A client-chosen ID per action, so a retry returns the first result instead of acting twice |
| Advisory lock | Serialise work per key (user, date, device) inside Postgres, without locking tables |
| Race condition | Two requests reading the same state before either writes; fixed here with a lock |
| Pure functions | Rules with no I/O (streaks, shuffle, badge rules) are the easiest code to test |
| Thin routes, fat services | HTTP details in routes; business rules in services |
| Information hiding | Answers stay on the server until the user commits to an answer |
| Seeded randomness | Looks random, but the same input always gives the same output |
| Testing through HTTP | `app.inject()` sends real requests to the app without opening a port |

### Problems hit and how they were fixed

**1. TypeScript: "'rows' implicitly has type 'any'… referenced in its own initializer".**
The first `ensureChallenge` used a `while` loop where the type being searched changed inside the loop
(chart → term). TypeScript couldn't infer it. Rewritten as a helper `pickLeastRecentlyUsed()` and a
list of candidate types per slot (`chart: ['chart', 'term']`), which also reads more clearly.

**2. The smoke-test loop answered nothing.**
In zsh, `for T in $IDS` doesn't split a string into words (bash does), so the loop ran once with all
five IDs as one value. The test script was rewritten for bash (`#!/usr/bin/env bash`, `read -a`).
*Lesson: when a script misbehaves, check which shell runs it.*

**3. Five old database tests failed after the new API tests were added.**
The API tests leave rows behind, and the database-rule tests then tried to create the same challenge
date. Fix: every API test starts with `resetGameData()` (a `TRUNCATE … CASCADE`, which doesn't fire the
ledger's row trigger), the API test file empties the database when it finishes, and the database-rule
file empties it before starting. Test files now run one at a time (`fileParallelism: false`) because they
share one database. *Lesson: tests sharing state must clean up, before and after.*

**4. The streak test was wrong, not the code.**
The test expected the streak to be 0 on "day 5", but day 5 after Wednesday 14 Oct is **Monday 19 Oct**,
a new week, so the freeze had refilled and the streak was correctly still alive. The test now checks
Monday (alive, at risk, freeze available) and Tuesday (gone). *Lesson: when a test fails, check the
test's assumptions before changing the code.*

**5. Proving the concurrency tests work.**
All tests passed, so the per-user lock was removed on purpose and the concurrency tests were rerun:

| Without the lock | What happened |
|---|---|
| 5 cards answered at the same moment | **No daily bonus at all**: each transaction counted fewer than 5 answers, because the others hadn't committed yet |
| Same answer double-tapped | **One request got a 500**: both passed the "seen this key?" check, then one hit the unique constraint |

Both tests failed every time; with the lock restored, all 59 pass (three runs in a row).
*Lesson: database constraints stopped double payment, but only a lock gives correct behaviour; test
races by actually racing requests (`Promise.all`).*

**6. Dates from Postgres could shift by a day.**
Not a bug yet, but a known trap: the `pg` driver turns `DATE` columns into JS `Date` objects at midnight
in the **server's** timezone. On a server in UTC, IST dates would be compared wrongly. Fixed up front by
registering a type parser that returns `'YYYY-MM-DD'` strings (`lib/db-utils.ts`).

### How it was verified

| Check | Result |
|---|---|
| `npm test` | **59 passed** (3 runs in a row): 18 pure rules, 23 API, 11 database rules, 7 datasets |
| Remove the per-user lock, run concurrency tests | Both fail (no bonus; 500 on double tap); restored → pass |
| `curl` without a session | `401 not_signed_in` |
| `curl` session → today | Cookie is HttpOnly; 5 cards; response contains no answers or explanations |
| Answer a full day (1 wrong) | 4 × 10 + 5 bonus = **45 points**, streak 1, First Step badge, 5 ledger rows |
| Retry the last answer (same key) | `replayed: true`, no rewards, total still 45 |
| Answer a card twice | `409 already_answered` |
| `GET /api/leaderboard` | Week starts Monday 12 Oct; rank 1 with 45 points; fallback name "Player 0014" |
| `npm run lint` / `typecheck` / `format:check` / `build` | All pass; web bundle 75.9 KB gzipped (API client now validates every response) |

### What's next

Step 4, `feature/challenge-generator`: the Yahoo Finance provider, rule-based chart cards, the
`/internal/jobs/generate-challenges` endpoint and the GitHub Actions schedule.

*(Changed: the game screens were built first, as step 4, so the app is playable on a phone sooner.
The chart generator moves to step 5.)*

---

## Step 4: Game screens (web UI)

**Date:** 2026-10-13 · **Branch:** `feature/web-ui` · **PR:** [#5](https://github.com/ash-1202/daily-loop/pull/5)

### Goal

Turn the API into an app someone can play on a cheap Android phone: start as a guest, answer today's
5 cards one at a time, learn why each answer is right, see points, streak and badges grow, and check
the leaderboard. Keep it small, readable for people with limited English, and honest on bad networks.

### What was built

```
apps/web/
├── index.html                 # + link to the web manifest
├── public/manifest.webmanifest# "Add to home screen": name, colours, icon
└── src/
    ├── App.tsx                # loading / error / tabs
    ├── useGame.ts             # all game state and actions in one hook
    ├── useCountdown.ts        # "Next challenge in 2h 1m" (to midnight IST)
    ├── device.ts              # device token (localStorage + fallback), randomId()
    ├── strings.ts             # every sentence the user sees
    ├── styles.css             # mobile-first styles, light + dark
    ├── components/
    │   ├── TopBar.tsx         # 🔥 streak  ⭐ points
    │   ├── TabBar.tsx         # 📝 Today  🏆 Leaders  👤 Me
    │   ├── ProgressDots.tsx   # ● ● ◉ ○ ○
    │   └── CardView.tsx       # a card, its options, and the result panel
    └── screens/
        ├── TodayScreen.tsx    # one card at a time; Done screen when all 5 are answered
        ├── LeadersScreen.tsx  # weekly leaderboard
        └── MeScreen.tsx       # stats, display name, badges
```

No new dependencies: React, the shared typed API client, and plain CSS.

### Key files explained

**`useGame.ts`: one hook owns the game**

Screens don't call the API themselves (except the leaderboard, which is read-only). The hook:

1. On start: `createSession({ deviceToken })` → then `today()` and `me()` in parallel.
2. `answer(card, option)`: builds the request with a **new idempotency key** and sends it.
3. On success: replaces that card with the server's version (now with its result), and updates
   progress, points, streak and badges **from the response**. The app never adds points itself.
4. On a network or server error: keeps the request as `pending` and shows **Try again**, which resends
   the **same request with the same key**. If the first attempt actually reached the server, the retry is
   answered as a replay and nothing is counted twice.
5. On a "your view is out of date" error (`already_answered`, `challenge_closed`, …): reloads from the server.
6. When the app comes back to the foreground on a new IST day, it reloads today's challenge.

A `stateRef` gives event handlers the latest state without re-creating them on every render.

**`TodayScreen.tsx`: which card to show**

```ts
const card = today.cards.find((c) => c.taskId === viewing) ?? firstUnanswered;
```

`viewing` is set when the user answers, so the answered card stays on screen with its result until they
tap **Next** (which clears `viewing` and moves to the next unanswered card). No unanswered card left →
the Done screen. Because the cards come from the server, reloading the page resumes at the right card.

**`CardView.tsx`: showing the result**

After answering, the right option turns green with ✓ and a wrong choice red with ✗: colour **and** a
symbol, so it works for colour-blind users. The result panel shows ✅/❌, **+10 points** (from the
server's reward list), the right answer if needed, **💡 Why?**, and for scams the 🚩 warning signs.
Focus moves to the result heading, so screen readers announce it and the page scrolls to it.

**Plain language (`strings.ts`)**

Every sentence is in one file, written for readers whose first language isn't English: short sentences,
common words ("Warning signs", not "Indicators"), icons next to key words (🔥 streak, ⭐ points,
🚩 Scam, ✅ Safe). A future Hindi version means translating one file.

**Sizes for small screens (`styles.css`)**

18px base text, answer buttons at least 56px tall, full-width on a 375px screen, a fixed bottom tab bar
that respects the phone's safe area, and light/dark colours from the same CSS variables.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Server as the source of truth | The UI shows what the server says (points, streak, results) and never calculates rewards |
| Custom hook | Put state + side effects in `useGame()`; screens become simple functions of state |
| Optimistic vs confirmed UI | Here the UI waits for the server's answer (fast enough), so it never shows a reward it must take back |
| Idempotent retry | Resend the same request with the same key after a network failure |
| Accessible feedback | Colour + symbol, focus management, `role="alert"`/`role="status"` for messages |
| Mobile-first CSS | Design for 375px first; larger screens just get a centred column |
| Content in one place | All copy in `strings.ts`: easy to review, simplify and translate |
| Web app manifest | Lets Android "Add to home screen" open the app full-screen with its own icon |

### Problems hit and how they were fixed

**1. Every API call from the browser returned 404, but `curl` to the API worked.**
The page showed "Something went wrong", with `POST /api/session → 404`. Calling the API directly on port
3000 worked. Through Vite (port 5173), `GET /api/today` without a session returned **200**, yet the API
would say 401. So Vite wasn't proxying at all: it was serving `index.html` for every path. The Vite process
had been started at 20:11, **before** `node_modules` was deleted and reinstalled in step 2, so its
proxy code was loading from files that no longer existed. Restarting the dev server fixed it.
*Lesson: after reinstalling `node_modules`, restart long-running dev servers. And when a proxied call
fails, call the backend directly to tell which side is broken.*

**2. Switching branches restarted the API with old code for a moment.**
`git checkout main` (before `git pull`) briefly removed the step 3 files; `tsx watch` noticed and
restarted on the old code, then again after the pull. Harmless, but it explains odd logs during branch switches.

**3. The error text was hard to read in dark mode.**
It reused `--bad-text`, which in dark mode is a pale pink meant for text on a red background. Added a
separate `--error-text` colour for error text on the normal background.

**4. Earned and locked badges looked too similar.**
Only opacity told them apart. Earned badges now have a green outline, and locked ones show 🔒 plus "Locked:".

**5. A choice made for testing on real phones.**
`crypto.randomUUID()` only exists on HTTPS or localhost. Opening the dev server from a phone over Wi-Fi
(`http://192.168.x.x:5173`) would break it, so IDs use `crypto.getRandomValues()`, which works everywhere.

### How it was verified

Played in the browser at phone size (375 × 812), in dark and light mode:

| Check | Result |
|---|---|
| First visit | Guest created automatically; card 1 of 5 shown; 🔥 0 ⭐ 0 |
| Wrong answer | Chosen option red ✗, right option green ✓, "❌ Not quite", right answer, "💡 Why?"; red dot |
| Scam card | Message shown as a chat bubble, two big buttons 🚩 Scam / ✅ Safe |
| Correct answer | "✅ Correct! +10 points"; ⭐ updates in the top bar; green dot |
| Scam with warning signs | 🚩 chips: "Asks for OTP", "Pretends to be SEBI", "Creates panic" |
| **Network failure** (first `fetch` to `/api/submissions` made to fail in the page) | "Your answer was not sent… Try again" → retry succeeds; **both attempts used the same idempotency key**; ⭐ 20 (counted once) |
| Fifth card | "See today's result" → Done: 4 of 5 right, ⭐ 45, 🔥 1, **New badge: First Step**, countdown to midnight IST |
| Leaders | Two players tied at 45 both shown 🥇; my row highlighted with "You" |
| Me | Invalid name `<b>` rejected; "Asha" saved; stats, freeze 🧊 1, First Step earned, others 🔒 |
| Reload the page | Same guest (cookie), Done screen restored from the server |
| `npm run lint` / `typecheck` / `test` / `build` | All pass; **80.1 KB JS + 2.0 KB CSS** gzipped |

Not tested in the browser: opening the app on a new IST day (the reload-on-visibility code). The
day boundary itself is covered by the API tests.

### What's next

Step 5, `feature/challenge-generator`: Yahoo Finance chart cards, the pre-generation job and its schedule.

*(Changed: deployment came next instead, so a live link existed early and hosting problems surfaced
while there was time to fix them.)*

---

## Step 5: Docker, CI/CD and deployment

**Date:** 2026-10-13 / 14 · **Branches:** `feature/deploy` ([PR #6](https://github.com/ash-1202/daily-loop/pull/6)), `fix/deploy-db-name` ([PR #7](https://github.com/ash-1202/daily-loop/pull/7))
· **Live:** https://daily5.tradertrix.com

### Goal

Put the app on a real URL that a reviewer can open on a phone, and make shipping automatic: every merge to
`main` is tested, packaged as a Docker image and deployed, with an automatic rollback if the new version
is unhealthy. The server is shared with another product (ChaiHouse), which must never be affected.

### Choosing where to host

| Option | Finding | Verdict |
|---|---|---|
| Render free | Sleeps after 15 min idle; **30–60 s** to wake | ❌ a reviewer would wait on a blank screen |
| Vercel + Neon | Fast, free, one domain | ✅ viable fallback |
| Another existing droplet | 1 GB RAM, no Docker, sensitive workload | ❌ keep it isolated |
| **ChaiHouse droplet** | Bangalore, 2 GB RAM (1.3 GB free), Docker + Caddy + GHCR already, nightly backups | ✅ chosen |

The server was inspected **read-only first** (memory, disk, containers, ports, firewall, Caddy config,
how ChaiHouse deploys) before proposing anything. That inspection is what revealed the name-collision
risk on ChaiHouse's network.

### What was built

```
Dockerfile                    # 4 stages: deps → build → production deps → runtime (node:22-alpine, non-root)
.dockerignore                 # no node_modules, .git, .env, docs in the build context
apps/api/src/routes/web.ts    # API serves the built web app (one domain) + JSON 404s
apps/api/src/config.ts        # + STATIC_DIR, TRUST_PROXY, APP_VERSION
apps/api/test/web.test.ts     # caching headers, SPA fallback, 404s, version
.github/workflows/ci.yml      # PRs: format, lint, typecheck, datasets, tests (Postgres service), build, docker build
.github/workflows/deploy.yml  # main: checks → image to GHCR → SSH deploy (retries) → verify public URL
deploy/
├── docker-compose.prod.yml   # app + db, memory caps, oom priority, loopback port, shared "edge" network
├── deploy-daily-loop.sh      # pull → migrate → seed → restart → health → record tag; rollback on failure
├── daily-loop-ssh-gate.sh    # forced command: only "deploy <40-hex sha>"
├── backup-daily-loop.sh      # nightly pg_dump, 14 days
├── Caddyfile.daily5          # HTTPS site block (security headers, compression)
└── README.md                 # runbook: one-time setup, operations, rollback, restore
docker-compose.yml            # dev stack renamed to project "daily-loop-dev"
```

### Key files explained

**One image, one domain.** In production the API also serves `apps/web/dist`. Files in `/assets/` have a
content hash in their name, so they're cached for a year (`immutable`); `index.html` is `no-cache`, so
phones always pick up a new release. Unknown GET paths return `index.html` (single-page app); unknown
`/api/*` paths stay JSON 404s. The session lookup now runs only for `/api/*`, so static files never cost
a database query.

**The Dockerfile's four stages.** Dependencies are installed in a layer that only changes when a
`package.json` or the lockfile changes (fast rebuilds). The final stage copies only the API bundle, the
web build, migrations, datasets and **production** dependencies (32.8 MB), and runs as the unprivileged
`node` user with a `HEALTHCHECK`. `APP_VERSION` (the commit sha) is set last, so a new commit doesn't
invalidate earlier layers; `/api/health` reports it.

**The deploy script** (`deploy-daily-loop <sha>`), run on the server:

```
validate sha → lock (one deploy at a time) → pull image → db up → migrate → seed
→ replace app container → wait for Docker health → check /api/health shows <sha> and db up
→ record current_tag / previous_tag → keep the 3 newest images
any failure after the app was replaced → start previous_tag again → exit 1 (the workflow fails)
```

Migrations run *before* the app is replaced and are additive only, so the old version keeps working
during the deploy and after a rollback.

**Least privilege for CI.** GitHub holds an SSH key for user `deploy`. On the server:

```
restrict,command="/usr/local/bin/daily-loop-ssh-gate" ssh-ed25519 AAAA… github-actions-daily-loop
```

`restrict` disables port forwarding, agent forwarding and terminals; `command=` replaces whatever the
client asks to run with the gate. The gate accepts only `deploy <exactly 40 chars of 0-9a-f>` and runs the
root-owned deploy script through one sudo rule. `deploy` has a locked password and isn't in the
`docker` group (which would be root-equivalent).

**Sharing a server.** Memory caps (app 256 MB, db 200 MB), `oom_score_adj: 800` (ChaiHouse 500), log
rotation, no public ports, and a separate compose project. Caddy (ChaiHouse's) reaches the app over
ChaiHouse's Docker network.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Multi-stage Docker build | Build with all the tools, ship only what runs |
| Layer caching | Copy dependency manifests before source, so code changes don't reinstall packages |
| Immutable tags | Tag images with the commit sha; `latest` is a convenience, never what you deploy |
| Build once, deploy anywhere | CI builds; servers only pull. Small servers never compile |
| Health checks + rollback | A deploy is done when the new version proves it's healthy, not when it starts |
| Forced SSH commands | An SSH key can be limited to one exact action |
| OOM score | Tell the kernel which containers to sacrifice first under memory pressure |
| Docker DNS | Containers find each other by service name, across *every* network they're on |
| Cache-Control | Hashed assets: cache forever; HTML: always revalidate |
| Reusable workflows | `deploy.yml` calls `ci.yml`, so production runs exactly the PR checks |

### Problems hit and how they were fixed

**1. The free-hosting assumption was wrong.** The design said free hosts start Node "in about a second".
Checking current docs showed Render's free tier sleeps after 15 minutes and takes 30–60 s to wake.
*Lesson: verify platform limits when you decide, not from memory; they change.*

**2. A shared network needs unique names: twice.**
- *Caught before deploying:* ChaiHouse's Caddy routes to the DNS name `app`. A daily-loop service called
  `app` on the same network would have split ChaiHouse's traffic. Named it `daily-loop-app`.
- *Caught by the first deploy:* the deploy failed with **"password authentication failed for user
  daily_loop"**. The password was fine. The app container is on two networks, and ChaiHouse's Postgres is
  also called `db`, so `db` resolved to **ChaiHouse's database**, which rejected the login (no harm:
  nothing was read or written, and Postgres doesn't lock accounts). Renamed to `daily-loop-db`.

  The local simulation had missed it because its stand-in network was empty. A regression test now puts
  a decoy Postgres aliased `db` on the shared network. It also showed *why* the bug is nasty: from a
  container on both networks, `db` resolved to whichever network was attached in a particular order, so
  the old setup worked locally but not on the server. *Lesson: a container on several networks sees
  every name on all of them; prefix every service name on a shared network.*

**3. The simulation clobbered the local dev database.** The production compose project is called
`daily-loop`, and so (by folder name) was the dev stack; both had a service `db`, so Compose treated them
as one and replaced the dev container. Data survived (different volume names). The dev stack is now
`name: daily-loop-dev`, keeping its old volume via an explicit `name:`. *Lesson: name compose projects
explicitly.*

**4. The SSH gate had a newline bypass.** The first gate checked the sha with `grep -E '^[0-9a-f]{40}$'`.
`grep` matches line by line, so `"<valid sha><newline>anything"` passed. The deploy script's own check
(bash `=~`, whole string) would still have rejected it, but a gate must not rely on the next layer.
Replaced with pure shell checks: no character outside `0-9a-f`, and length exactly 40. Then tested 12
hostile inputs. *Lesson: validate whole strings, not lines.*

**5. The server randomly dropped SSH connections.** `kex_exchange_identification: Connection reset`.
24 connections were open, almost all internet bots, and sshd's default `MaxStartups 10:30:100` drops a
growing share of new connections once more than 10 are unauthenticated. The workflow retries SSH on exit
code 255 (connection errors). That's safe because redeploying the same sha changes nothing and the lock
prevents overlap. *Lesson: retries need idempotent operations.*

**6. Smaller ones.**
- `@fastify/static` v10 passes a Fastify reply to `setHeaders` (`.header()`, not `.setHeader()`).
- Fastify scopes the not-found handler to the plugin that sets it, so it's set on the root instance.
- `/private/tmp` and `/Volumes` aren't shared into Colima's VM, so bind mounts there appeared empty; the
  simulation moved to the home folder and actionlint read files via stdin.
- Shellcheck: `A && B || C` isn't if/else; rewritten as `if`.
- zsh doesn't word-split `$VAR`; test scripts with arrays run under bash.
- The image is 277 MB, but ~177 MB of that is the official `node:22-alpine` base; the app adds ~35 MB.

### How it was verified

| Check | Result |
|---|---|
| Local Docker build | Non-root `node` user; no source, `.env` or dev tools; all runtime deps present |
| Simulated droplet: first deploy / upgrade / broken release | Migrated + seeded / no-op migrations / **unhealthy → rolled back automatically**, exit 1 |
| Simulated droplet with a decoy `db` (ChaiHouse) | Old compose: `db` resolves to the decoy; new compose: own database, decoy untouched |
| SSH gate, 12 hostile inputs (`;`, `$(…)`, newline, length, uppercase…) | All rejected; only `deploy <40-hex>` allowed |
| The real deploy key | Shell refused; other commands refused; port forwarding "administratively prohibited"; `deploy <sha>` reaches the script |
| actionlint, shellcheck, prettier, lint, typecheck, 66 tests | All pass; **CI passed on GitHub** for PR #6 |
| First automatic deploy | Checks ✅ image ✅ **deploy ❌**: the `db` name collision (problem 2) |
| After the fix, on the server | Migrations + seed into its own DB; both containers healthy |
| https://daily5.tradertrix.com | `/api/health` → `db: up`, version = commit; Let's Encrypt cert; HTTP → HTTPS; HSTS, nosniff, DENY |
| Cookie in production | `HttpOnly; Secure; SameSite=Lax` |
| Caching | JS bundle 83 KB gzipped, `max-age=31536000, immutable`; `index.html` `no-cache` |
| Phone-sized browser on the live site | Card shown; answer → "Correct! +10 points" |
| ChaiHouse during and after | All containers healthy; site 200 throughout |
| Memory | daily-loop ~51 MB in total; 1.28 GB still available |

### What's next

Merge `fix/deploy-db-name`. That merge is the first **fully automatic** deploy (checks → image → SSH →
health → public URL check). Then: chart cards (Yahoo Finance) and email login.

**Result ([PR #7](https://github.com/ash-1202/daily-loop/pull/7)):** the first fully automatic deploy
succeeded in about 2 minutes from merge (checks 42 s, Docker build 17 s, push 20 s, deploy + public
check 33 s). Only the app container was replaced; the database kept running, data survived, and the
previous version was recorded for rollback.

---

## Step 6: Chart cards

**Date:** 2026-10-14 · **Branch:** `feature/chart-cards`

### Goal

Fill the fifth daily slot with **"Read the chart"** cards built from real, recent NSE prices, every
day, automatically, while keeping the guardrail: the card teaches how to *read* a chart and never
rewards guessing what happens next.

### What was built

```
datasets/chart_universe.json        # 24 NSE large caps (Yahoo symbols); read by the job, not seeded
packages/shared/src/api.ts          # Card.chart = { candles: [o,h,l,c][], highlightLast }
apps/api/src/market/
├── provider.ts                     # MarketDataProvider interface + Candle type
├── yahoo.ts                        # YahooProvider: fetch + Zod-validated parse
├── chart-rules.ts                  # pure: rescale, classifyTrend, classifyCandle, buildChartQuestion
└── generator.ts                    # the daily job: chart cards + 7 days of challenges, logged in job_runs
apps/api/src/scripts/generate.ts    # npm run challenges:generate / dist/generate.js
apps/api/src/services/challenges.ts # the day's own chart_<date> first; toCard sends candles only
apps/web/src/components/ChartView.tsx  # SVG candlestick chart
deploy/generate-daily-loop.sh       # server cron, 18:30 IST
deploy/deploy-daily-loop.sh         # + runs the job on every deploy (non-fatal)
apps/api/test/chart-rules.test.ts, generator.test.ts, market-fixtures.ts
```

### Commands that were run

```bash
# Can we get the data, from here and from the droplet?
curl 'https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?range=3mo&interval=1d'
# → 200 from the Mac and from the droplet (0.07 s); today's candle has nulls (market still open)

node -e '…'                       # checked all 24 symbols: 200, ~125 daily candles each
npm run challenges:generate       # real run against the dev DB: 7 charts + 7 challenges in 1.1 s
npm test                          # 81 tests
```

### Key files explained

**`chart-rules.ts`: pure rules with one clear answer**

```
rescale:        divide by the first close × 100, round to 2 decimals   (hides the real price level)
trend:          up > +5%, down < −5%, sideways within ±2%, else null    (2–5% is ambiguous)
last candle:    doji if body ≤ 10% of range, green/red if body ≥ 50%, else null
```

`null` means "not a good question": the generator tries other 20-day windows (in random order) until
one gives a clear-cut answer. The rules run on the **rescaled, rounded numbers the user sees**, so the
answer can always be checked against the chart. The explanation quotes those same numbers.

**`yahoo.ts`: trust nothing from outside.** The JSON is validated with Zod. Rows with a `null`, rows
that can't be a real candle (high below close, etc.), and **today's candle** (it changes until the
market closes) are dropped. Timestamps are converted to IST trading dates.

**`generator.ts`: the job.** For each of the next 7 days without a challenge: pick a random symbol
(at most 5 tries), fetch ~6 months once per symbol per run, store the candles, find a window, insert
task `chart_<date>`. Then build the 7 days. Each run is a row in `job_runs` (running → succeeded/failed,
with a JSON report). Errors for one day are recorded and skipped, never fatal.

**Where it runs.** The first plan was a GitHub Actions cron calling a secret-protected endpoint, because
free hosts sleep. On an always-on server that's needless exposure, so instead: a **server cron** at
18:30 IST runs `node dist/generate.js` inside the live app container, and **every deploy** runs it too.

**Nothing private reaches the phone.** The task's `payload` holds `ohlc`, `kind` and `meta` (symbol and
dates, for auditing). `toCard` copies **only** the candles and a highlight flag; a test checks the JSON
contains no `.NS`, no "meta", no dates and no explanation before answering.

**`ChartView.tsx`: a chart in plain SVG.** No chart library (it adds 1.3 KB gzipped). Rising candles are
hollow and falling ones filled, the traditional convention, so colour isn't the only signal. A dashed
line marks the starting level (100); the last candle gets a highlight band for candle questions.

### Concepts to learn from this step

| Concept | In one line |
|---|---|
| Provider interface | Code against `MarketDataProvider`, not Yahoo, so the source can be swapped |
| Validate external data | Parse third-party JSON with a schema; drop rows that can't be true |
| Ambiguity bands | When an answer would be borderline, skip the example rather than teach something debatable |
| Rescaling | Same shape, different numbers: hides which stock it is without changing the lesson |
| Synthetic fixtures | Tests use generated candles; no third-party data committed, fully repeatable |
| Seeded randomness in tests | Inject `random` so "random" choices are the same on every run |
| Job audit log | Every background run leaves a row: when, outcome, what it did, what failed |
| Graceful degradation | Charts are a bonus slot; their failure falls back instead of breaking the day |

### Problems hit and how they were fixed

**1. My own schema rejected my own file.** The first real run failed: `chart_universe.json`'s `name`
was longer than the 60 characters the shared schema allows. The schema did its job; the name was shortened.

**2. Days weren't getting their own chart.** The builder picked *any* unused chart at random, so the
"alternate question types by day" plan didn't hold (today got a trend card made for another day). The
picker now prefers `chart_<date>`, then least recently used. Removing that line on purpose makes the
generator test fail.

**3. Yahoo's last candle is incomplete during market hours** (seen in the first `curl`: last close
`null`). The parser drops today's candle even when it has numbers, since they're still changing. A test
covers it, and removing the rule makes it fail.

**4. Not committing Yahoo data.** It would have been easy to save a real API response as a test fixture,
but the repo is public and Yahoo's terms limit redistribution. The fixtures generate candles instead.

### How it was verified

| Check | Result |
|---|---|
| Yahoo from Mac and droplet | 200; droplet fetch 0.07 s; all 24 symbols ~125 candles |
| Real job run (dev DB) | 7 chart cards + 7 challenges in 1.1 s; kinds alternate; answers vary (Down, Red, Sideways, Doji…) |
| Spot-check answers vs data | Trend card: 100 → 91.93 (−8.07%) = "Down"; doji: body 1% of range |
| Browser, phone size | Chart readable; "Sideways" → "Correct! +10", explanation quotes 100.0 → 101.2 (1.2%) |
| `npm test` | **81 passed** (+15): rules, parser (nulls, today, impossible rows, URL encoding), job (7 days, idempotent, Yahoo down → terms), no data leak |
| Deliberately broken code | Removing the "today" filter or the date preference fails the right tests |
| Docker image | Contains `dist/generate.js` and `chart_universe.json` |
| Web bundle | 81.5 KB JS gzipped (+1.3 KB for the chart) |

### What's next

After merging: install the updated deploy script and the 18:30 IST cron on the server (infrastructure
files are applied by hand, see `deploy/README.md`), then email OTP login and the explainer.

---

## Entry template

Copy this for each new step.

```markdown
## Step N: <title>

**Date:** YYYY-MM-DD · **Branch:** `feature/...` · **PR:** #

### Goal
### What was built
### Commands that were run
### Key files explained
### Concepts to learn from this step
### Problems hit and how they were fixed
### How it was verified
### What's next
```
