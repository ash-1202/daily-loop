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

**Date:** 2026-10-13 · **Branch:** `feature/challenge-api`

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
