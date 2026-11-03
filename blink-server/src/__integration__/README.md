# Integration tests

Tests in this folder (`*.int.test.ts`) run the real server stack against a
real Postgres. They exist because the unit suite (`src/__tests__/`) mocks the
database, so it can't catch wrong SQL, foreign-key violations or races.

## Running

```bash
# from the repo root: start Postgres 16
docker compose up -d postgres

# from blink-server/
TEST_DATABASE_URL=postgresql://blink:blink_dev_password@localhost:5432/blink_test npm run test:integration
```

The database name must contain `test`: global setup **drops and recreates the
`public` schema** and then runs `runMigrations()`. A missing database is created
for you. CI runs the same command against a `postgres:16` service.

## What is real and what is stubbed

| Real | Stubbed |
|---|---|
| `createApp()` (all middleware, rate limits, routes, error handler) | Expo Push HTTP calls (`exp.host`) |
| `authenticate` middleware, incl. the `revoked_tokens` check | Twilio SMS HTTP calls (`api.twilio.com`) |
| Postgres + every migration | |
| Socket.io server on a random port, `socket.io-client` | |

Stubs live in `support/httpStubs.ts` and intercept `fetch`; recorded calls are
in `pushRequests` / `smsRequests`. Any other non-local fetch throws.

## Writing a test

```ts
import { useTestServer } from './support/server';
import { bearer, createGroup, createUser } from './support/factories';

const server = useTestServer(); // one server per file, fresh app (rate limits) per test

it('...', async () => {
  const alice = await createUser();                  // SQL factory, returns a token
  const group = await createGroup({ createdBy: alice });
  const res = await server.api().get(`/api/groups/${group.id}`).set(bearer(alice));
  expect(res.status).toBe(200);
});
```

- Arrange state with the SQL factories in `support/factories.ts`; act through
  the HTTP API (`server.api()`) or a socket (`server.connectSocket(token)`).
- Every table is truncated before each test; after each test the harness waits
  for fire-and-forget DB work to settle.
- Files run serially (`--runInBand`) because they share one database.

## Known bugs

A known bug enters as an `it.failing(...)` test with a `KNOWN BUG` comment that
names the recovery-plan phase that fixes it. `it.failing` passes while the
assertion fails; when the fix lands Jest reports it, and the fix PR flips it to
a plain `it(...)`.
