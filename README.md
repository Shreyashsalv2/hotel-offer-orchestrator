# Hotel Offer Orchestrator

Aggregates overlapping hotel offers from two (mock) suppliers, deduplicates hotels by name, selects the best-priced offer per hotel and supports price-range filtering — orchestrated with **Temporal** and stored/filtered in **Redis**.

**Stack:** Node.js 22 · TypeScript · Express 5 · Temporal · Redis · Docker Compose

---

## Contents

- [Architecture](#architecture)
- [Quick start (Docker)](#quick-start-docker)
- [Deploying to a server](#deploying-to-a-server)
- [Running locally without Docker](#running-locally-without-docker)
- [API reference](#api-reference)
- [How it works](#how-it-works)
- [Simulating a supplier outage](#simulating-a-supplier-outage)
- [Postman collection](#postman-collection)
- [Tests](#tests)
- [Configuration](#configuration)
- [Project structure](#project-structure)
- [Design decisions](#design-decisions)

---

## Architecture

```
 Client / Postman / Demo UI
            │
            ▼
 ┌─────────────────────────────────────┐      ZRANGE … BYSCORE      ┌──────────────────┐
 │ API (Express :3000)                 │ ─────────────────────────► │ Redis            │
 │  GET /api/hotels   GET /health      │      (price filtering)     │ sorted set       │
 │  GET /supplierA/hotels  (mock)      │                            │ hotels:<city>    │
 │  GET /supplierB/hotels  (mock)      │                            └──────────────────┘
 └─────────────────────────────────────┘                                     ▲
            │ start workflow + await result         ▲                        │ ZADD
            ▼                                       │ HTTP                   │
 ┌─────────────────────────────────────┐            │              ┌──────────────────┐
 │ Temporal server :7233  (UI :8080)   │ ◄───────── │ ──────────── │ Worker           │
 │ task queue "hotel-offers"           │  polls     │              │ hotelOffers-     │
 └─────────────────────────────────────┘            └───────────── │ Workflow         │
                                                                    └──────────────────┘

 Workflow: fetch Supplier A ║ fetch Supplier B (parallel, retried)
           → dedupe by name, keep cheapest → save to Redis → return list
```

| Container  | Purpose                                                        | Port(s)          |
|------------|----------------------------------------------------------------|------------------|
| `api`      | REST API, mock supplier endpoints, `/health`, demo UI          | 3000             |
| `worker`   | Temporal worker running the workflow and activities            | –                |
| `temporal` | Temporal server (dev server, SQLite persisted to a volume) + Web UI | 7233, 8080  |
| `redis`    | Stores the deduplicated list per city                          | 6379             |

The API and worker are built from the **same Docker image** and differ only in their start command.

---

## Quick start (Docker)

**Prerequisites:** Docker with Docker Compose v2.

```bash
git clone https://github.com/Shreyashsalv2/hotel-offer-orchestrator.git
cd hotel-offer-orchestrator
docker compose up --build -d
```

Wait until all services are healthy (`docker compose ps`), then:

```bash
curl "http://localhost:3000/api/hotels?city=delhi"
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=5000&maxPrice=6000"
curl "http://localhost:3000/health"
```

| URL                                   | What                                  |
|---------------------------------------|---------------------------------------|
| http://localhost:3000/api/hotels?city=delhi | Main API                        |
| http://localhost:3000/health          | Health of suppliers & dependencies    |
| http://localhost:3000/                | Optional demo UI                      |
| http://localhost:8080                 | Temporal Web UI (workflow history)    |

> **Port already in use?** Host ports are configurable: `API_PORT=3001 REDIS_PORT=6380 docker compose up --build -d`.

Logs and teardown:

```bash
docker compose logs -f api worker
docker compose down          # stop
docker compose down -v       # stop and delete Temporal data volume
```

---

## Deploying to a server

The same Compose stack runs on any Linux server or cloud VM with Docker installed, for example AWS EC2, GCP Compute Engine, Azure VM or DigitalOcean.

```bash
# on the server
git clone https://github.com/Shreyashsalv2/hotel-offer-orchestrator.git
cd hotel-offer-orchestrator
docker compose up --build -d
docker compose ps                     # wait until api, redis and temporal are healthy
curl http://localhost:3000/health
```

- Open port **3000** (API) in the firewall or security group. Keep **7233** (Temporal), **6379** (Redis) and **8080** (Temporal UI) private, or reach them over an SSH tunnel: `ssh -L 8080:localhost:8080 user@server`.
- All services use `restart: unless-stopped`, so the stack comes back after a crash or a server reboot. Use `/health` to monitor it (it also checks that the worker is running).
- Override settings with environment variables or a `.env` file next to `docker-compose.yml` (see [Configuration](#configuration)).
- Update to a new version: `git pull && docker compose up --build -d`.

**Production notes:** run Temporal as a cluster backed by PostgreSQL, or use Temporal Cloud. Use a managed Redis service. Put the API behind a reverse proxy with TLS. Scale workers with `docker compose up -d --scale worker=3`.

---

## Running locally without Docker

**Prerequisites:** Node.js ≥ 20, a Redis server, and the [Temporal CLI](https://docs.temporal.io/cli).

```bash
npm install
cp .env.example .env              # optional; defaults work for localhost

temporal server start-dev         # terminal 1 – Temporal on :7233, UI on :8233
redis-server                      # terminal 2 – (or: docker run -p 6379:6379 redis:7-alpine)
npm run dev:api                   # terminal 3 – API on :3000
npm run dev:worker                # terminal 4 – Temporal worker
```

Production build: `npm run build && npm run start:api` / `npm run start:worker`.

---

## API reference

### `GET /api/hotels`

| Query param | Required | Description                                       |
|-------------|----------|---------------------------------------------------|
| `city`      | yes      | City name (case-insensitive), e.g. `delhi`        |
| `minPrice`  | no       | Inclusive lower bound (number ≥ 0)                |
| `maxPrice`  | no       | Inclusive upper bound (number ≥ 0, ≥ `minPrice`)  |

**200 OK** — deduplicated list sorted by price:

```json
[
  { "name": "Holtin",  "price": 5340, "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison", "price": 5900, "supplier": "Supplier A", "commissionPct": 13 }
]
```

| Status | When                                                                           |
|--------|--------------------------------------------------------------------------------|
| 200    | Success. A city with no hotels returns `[]`. If one supplier failed, the response header `X-Failed-Suppliers` names it. |
| 400    | Invalid query (missing city, non-numeric/negative price, `minPrice > maxPrice`) |
| 502    | Both suppliers unavailable                                                     |
| 503    | Temporal or Redis unreachable                                                  |
| 504    | Workflow timed out (e.g. no worker running)                                    |

Error body: `{ "error": "message", "details": [...] }`.

### `GET /supplierA/hotels`, `GET /supplierB/hotels`

Mock supplier APIs returning static data. Optional `?city=` filter (without it, all hotels are returned).

```json
[{ "hotelId": "a1", "name": "Holtin", "price": 6000, "city": "delhi", "commissionPct": 10 }]
```

Data exists for `delhi` (6 hotels each, 4 overlapping names) and `mumbai` (3 each, 2 overlapping). Any other city returns `[]`.

### `POST /supplierA/toggle`, `POST /supplierB/toggle`

Body `{ "down": true | false }` — simulates an outage (the supplier responds with **503**). `GET /supplierX/status` shows the current state.

### `GET /health`

```json
{
  "status": "ok",
  "timestamp": "2026-11-21T00:27:52.373Z",
  "suppliers": {
    "supplierA": { "status": "up", "latencyMs": 23 },
    "supplierB": { "status": "up", "latencyMs": 14 }
  },
  "dependencies": {
    "redis":          { "status": "up", "latencyMs": 4 },
    "temporal":       { "status": "up", "latencyMs": 5 },
    "temporalWorker": { "status": "up", "latencyMs": 8 }
  }
}
```

| `status`   | Meaning                                                    | HTTP |
|------------|------------------------------------------------------------|------|
| `ok`       | Everything up                                              | 200  |
| `degraded` | Infrastructure up, but only one supplier available         | 503  |
| `down`     | No supplier available or Redis/Temporal/worker down        | 503  |

Each supplier is probed over HTTP (the same way the worker calls it); `temporalWorker` checks that at least one worker is polling the task queue.

---

## How it works

### Workflow — `hotelOffersWorkflow(city)` ([src/temporal/workflows.ts](src/temporal/workflows.ts))

1. **Parallel supplier calls** — `fetchSupplierHotels('supplierA')` and `fetchSupplierHotels('supplierB')` run concurrently (`Promise.allSettled`).
   - Each activity: 5 s start-to-close timeout, up to **3 attempts** with exponential backoff (300 ms → 2 s).
   - 5xx / network errors / timeouts are **retryable**; 4xx and malformed payloads are **non-retryable**.
2. **Partial failure tolerance** — if one supplier still fails after retries, the workflow logs a warning and continues with the other. If **both** fail it throws a non-retryable `AllSuppliersUnavailable` failure (→ HTTP 502).
3. **Deduplication** — [`selectBestOffers`](src/services/dedupe.ts) groups by normalised name (trimmed, case-insensitive), keeps the **lowest price**, breaks ties with the **higher commission**, and sorts by price. It is a pure function, so it runs deterministically inside the workflow.
4. **Persistence** — `saveHotelsToRedis` activity stores the result (with its own retry policy).
5. Returns `{ city, hotels, failedSuppliers }` to the API.

Every request starts a new workflow execution (`hotels-<city>-<uuid>`), visible in the Temporal UI with full activity history, retries and failures.

### Redis storage & price filtering ([src/services/hotelCache.ts](src/services/hotelCache.ts))

The deduplicated list is stored as a **sorted set** per city:

```
key:    hotels:<city>
score:  price
member: {"name":"Holtin","price":5340,"supplier":"Supplier B","commissionPct":20}
```

- Writes are atomic (`MULTI` → `DEL`, `ZADD`, `EXPIRE` with a 10-minute TTL).
- **Filtering is executed inside Redis** with `ZRANGE hotels:<city> <min> <max> BYSCORE` (missing bounds become `-inf` / `+inf`), which is O(log N + M).

Inspect it yourself:

```bash
docker compose exec redis redis-cli ZRANGE hotels:delhi 5000 6000 BYSCORE WITHSCORES
```

### Logging & error handling

- Structured JSON logs with **pino** in the API (per-request logs via `pino-http`).
- Workflows use Temporal's replay-safe `log`; activities use `Context.current().log` (includes workflow/activity IDs and attempt numbers).
- A central Express error handler maps validation errors → 400, workflow failures → 502/504, unreachable dependencies → 503, everything else → 500.
- The worker retries its Temporal connection on startup; both processes shut down gracefully on `SIGTERM`/`SIGINT`.

---

## Simulating a supplier outage

```bash
# take Supplier A down
curl -X POST localhost:3000/supplierA/toggle -H 'Content-Type: application/json' -d '{"down":true}'

curl -i "localhost:3000/api/hotels?city=delhi"   # 200, only Supplier B, header X-Failed-Suppliers: Supplier A
curl    "localhost:3000/health"                  # status "degraded"

# bring it back
curl -X POST localhost:3000/supplierA/toggle -H 'Content-Type: application/json' -d '{"down":false}'
```

Alternatively start with a supplier down: `SUPPLIER_A_DOWN=true docker compose up -d`. The demo UI also has *take down / bring up* buttons.

---

## Postman collection

File: [`postman/hotel-orchestrator.postman_collection.json`](postman/hotel-orchestrator.postman_collection.json)

Import it into Postman (*Import → File*). The `baseUrl` collection variable defaults to `http://localhost:3000`. Every request has test assertions.

| Folder                         | Covers                                                                 |
|--------------------------------|------------------------------------------------------------------------|
| 1. Health                      | All dependencies up                                                    |
| 2. Mock suppliers              | Supplier payloads; overlapping names between A and B                   |
| 3. Hotels                      | Valid city with overlaps (`delhi`), price-range / min-only / max-only filters, `mumbai`, **city with no results** (`paris`) |
| 4. Validation errors           | Missing city, `minPrice > maxPrice`, non-numeric price                 |
| 5. Supplier outage simulation  | **One supplier down** (graceful degradation + degraded health), both down (502), recovery |

Run from the CLI:

```bash
npx newman run postman/hotel-orchestrator.postman_collection.json
# different port:
npx newman run postman/hotel-orchestrator.postman_collection.json --env-var baseUrl=http://localhost:3001
```

---

## Tests

```bash
npm test
```

- `tests/dedupe.test.ts` — best-offer selection, case-insensitive matching, tie-breaking, sorting.
- `tests/workflow.test.ts` — runs the real workflow on Temporal's local test server (`@temporalio/testing`) with stubbed activities: happy path, one supplier down (verifies 3 retry attempts), both down, empty city.
- `tests/api.test.ts` — HTTP layer with `supertest`: response shape, filtering, validation, error mapping, supplier toggle, health statuses.

> The first run downloads the Temporal test server binary.

---

## Configuration

All settings are environment variables (see [`.env.example`](.env.example)):

| Variable              | Default                  | Description                                        |
|-----------------------|--------------------------|----------------------------------------------------|
| `PORT`                | `3000`                   | API port inside the container                      |
| `REDIS_URL`           | `redis://localhost:6379` | Redis connection string                            |
| `TEMPORAL_ADDRESS`    | `localhost:7233`         | Temporal frontend                                  |
| `TEMPORAL_NAMESPACE`  | `default`                | Temporal namespace                                 |
| `TASK_QUEUE`          | `hotel-offers`           | Task queue shared by API and worker                |
| `SUPPLIER_BASE_URL`   | `http://localhost:3000`  | Where the worker reaches the supplier endpoints    |
| `SUPPLIER_TIMEOUT_MS` | `3000`                   | HTTP timeout per supplier call                     |
| `CACHE_TTL_SECONDS`   | `600`                    | TTL of `hotels:<city>` in Redis                    |
| `SUPPLIER_A_DOWN` / `SUPPLIER_B_DOWN` | `false`  | Start a supplier in outage mode                    |
| `LOG_LEVEL`           | `info`                   | pino log level                                     |
| `API_PORT` / `REDIS_PORT` | `3000` / `6379`      | Host port mappings (docker compose only)           |

---

## Project structure

```
src/
├── server.ts                 # API entrypoint – wires real dependencies
├── worker.ts                 # Temporal worker entrypoint
├── app.ts                    # Express app factory (dependency-injected for tests)
├── config.ts, logger.ts, types.ts
├── routes/
│   ├── hotels.routes.ts      # GET /api/hotels + query validation (zod)
│   ├── suppliers.routes.ts   # mock supplier APIs + outage toggle
│   └── health.routes.ts      # GET /health
├── temporal/
│   ├── workflows.ts          # hotelOffersWorkflow
│   ├── activities.ts         # fetchSupplierHotels, saveHotelsToRedis
│   └── client.ts             # Temporal client singleton
├── services/
│   ├── dedupe.ts             # best-offer selection (pure)
│   ├── hotelCache.ts         # Redis sorted-set write / range query
│   └── redis.ts              # Redis connection
├── mocks/supplierData.ts     # static supplier inventories
└── middleware/errorHandler.ts
public/index.html             # optional demo UI
postman/                      # Postman collection
tests/                        # Jest tests
Dockerfile, docker-compose.yml
```

---

## Design decisions

- **Separate API and worker processes** — the standard Temporal deployment model; workers can be scaled independently. Both use one image.
- **Suppliers called over HTTP from activities** — the worker calls the mock endpoints exactly as it would call real third-party APIs, so timeouts, retries and outage handling are exercised for real.
- **`Promise.allSettled` + per-activity retries** — a single flaky supplier never fails the whole request; the client still gets the best available prices and is told which supplier failed via `X-Failed-Suppliers` (the response body keeps the exact format required).
- **Deduplication in the workflow** — it is pure and deterministic, so no extra activity round-trip is needed.
- **Fresh data per request, filtering in Redis** — every `/api/hotels` call runs the workflow (keeping Redis current) and, when a price range is given, the filter is answered by a Redis `ZRANGE … BYSCORE` query on the stored sorted set, as required.
- **Temporal dev server in Compose** — `temporalio/temporal server start-dev` is a single container with the Web UI and SQLite persistence; simple to run for this assignment. For production, use a Temporal cluster (or Temporal Cloud) backed by PostgreSQL/Cassandra.

### Possible improvements

- Serve recent results straight from Redis (stale-while-revalidate) instead of running the workflow on every request.
- Rate limiting and authentication on the public API.
- Metrics (Prometheus) and tracing (OpenTelemetry interceptors for Temporal).
