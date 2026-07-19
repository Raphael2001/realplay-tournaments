# realplay-tournaments

Small NestJS (Fastify) module that creates tournaments, ingests bet events, exposes a
live Redis-backed leaderboard, and persists final placements to Postgres via a BullMQ
job scheduled to run at `endsAt`.

## Stack

- NestJS + Fastify
- Postgres via Prisma (raw bets, join table, final placements)
- Redis (`ioredis`) — live leaderboard as a sorted set per tournament
- BullMQ — schedules and runs the finalize/snapshot job

## Setup

Requires Node 20+, yarn, and Docker.

```bash
yarn install
cp .env.example .env
docker compose up -d          # postgres on :5433, redis on :6380 (see below)
yarn prisma migrate deploy    # applies prisma/migrations/*
yarn build
yarn start                    # or: yarn start:dev
```

App listens on `PORT` (default 3000).

Ports in `docker-compose.yml`/`.env.example` are 5433 (postgres) and 6380 (redis)
instead of the defaults — this avoided a collision with other local containers
during development. Change both the compose file and `.env` together if you'd
rather use 5432/6379.

### Tests

```bash
yarn test
```

Unit tests mock Prisma and Redis directly (no DB/Redis needed) and cover:
bet ingestion + scoring, duplicate `externalBetId` idempotency, tournament
window matching, and leaderboard rank/ordering.

## Endpoints

- `POST /tournaments` — `{ name, startsAt, endsAt }` (ISO date strings)
- `POST /bet` — see payload shape in the task; `amount` is integer cents
- `GET /tournaments/:id/leaderboard?limit=20&offset=0` — entries sorted by score DESC

## Data model

- `Bet` — one row per `externalBetId`, globally unique. Re-sending the same event
  upserts onto the same row instead of creating a duplicate.
- `TournamentBet` — join row per `(tournamentId, betId)`, with a unique constraint
  on that pair. This is the actual idempotency boundary: a bet can be accepted by
  several overlapping active tournaments, but only once each.
- `TournamentPlacement` — final `(tournamentId, playerId) -> score, rank`, written
  once by the snapshot job after `endsAt`.

## How ingestion works (`POST /bet`)

1. Upsert `Bet` by `externalBetId` (idempotent at the raw-event level).
2. Find all `ACTIVE` tournaments where `startsAt <= bet.createdAt <= endsAt`. The
   `ACTIVE` filter matters: a bet event can arrive late, after the snapshot job
   already finalized a tournament whose window it falls in — it must not reopen
   scoring for a tournament whose placements are already written to Postgres.
3. For each match, try to insert a `TournamentBet` row. If it violates the unique
   constraint (already counted for that tournament), skip silently. Otherwise,
   `ZINCRBY` the tournament's Redis leaderboard.

The Postgres unique constraint — not an app-level check-then-write — is the source
of truth for "counted once per tournament," so this is correct under concurrent
requests for the same `externalBetId`.

## How finalization works (`POST /tournaments` → BullMQ)

On tournament creation, a delayed job (`delay = endsAt - now`, `jobId = tournamentId`)
is scheduled on the `tournament-snapshot` queue. When it fires, the processor reads
the full Redis sorted set for that tournament, upserts one `TournamentPlacement` row
per player with the computed rank, and marks the tournament `FINALIZED`.

The job is idempotent (upsert on `(tournamentId, playerId)`, and it no-ops if the
tournament is already `FINALIZED`), so retries or duplicate delivery are safe.

## Assumptions & tradeoffs

- **Leaderboard stays Redis-backed after finalization.** `GET /leaderboard` always
  reads from Redis, live or not — the task asks for a "live leaderboard" as one
  endpoint and "final results written to Postgres" as a separate deliverable, not
  a source switch. If you need placements served over the API after finalization,
  add a small branch that reads `TournamentPlacement` once `status === FINALIZED`.
- **`currency` is stored but not used for conversion.** Score is a raw sum of
  `amount` across accepted bets. If a tournament accepts bets in more than one
  currency, they'd be summed as if equivalent. Not specified in the task; would
  need an FX rate source to do this correctly, so it's flagged rather than guessed.
- **`endsAt` must be strictly after `startsAt`** — enforced with a 400 on
  `POST /tournaments`; not stated in the spec but a tournament with an inverted
  or zero-length window can never match a bet.
- **Bet payload trusted on retry.** If the same `externalBetId` is sent twice with
  different `amount`/`playerId`, the first write wins (`update: {}` in the upsert).
  Not specified in the task; assumed events are immutable once emitted.
- **In-process BullMQ worker.** The task mentions a separate workers app exists in
  the real system; here the `SnapshotProcessor` runs in the same Nest process for a
  single runnable deliverable. In production this would move to the workers app —
  the queue/job contract doesn't change, only which process runs the `Processor`.
- **No auth/rate limiting.** Out of scope for the task; would add an API key or
  service-to-service auth in front of `POST /bet` in a real deployment.
- **Job scheduled at tournament-creation time, not by a cron sweep.** Simpler and
  precise, but a crashed/restarted process loses in-flight BullMQ delays only if
  Redis itself is lost (BullMQ persists jobs in Redis, so a Nest process restart
  alone does not lose the schedule).
- **`amount` validated as a positive integer** (`@IsInt() @Min(1)`) since spec
  states amounts are cents and a bet of 0 or negative doesn't make sense to score.
