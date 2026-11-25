# Architecture and Operations

## Application

- **Domain:** exact quantity validation and arithmetic, deterministic chronological replay, reference mark valuation, and explicit unknown coverage.
- **Persistence:** Prisma and PostgreSQL. Strategies, owner accounts, event identities, revisions, price sets, drafts and final evaluations have foreign keys. Versioned JSON payloads preserve decimal strings and snapshot evidence without coercion by PostgreSQL or JavaScript. The mutable event index points to chronological facts; revisions and posted quotes are append-only in application writes. A revision, its price set and the new projection commit together. Strategy row locks serialize mutations; command IDs, transaction/action uniqueness, and a partial network-fee index catch duplicate payments. `FinalEvaluation` stores the exact revision IDs and closing reference set alongside the result.
- **Security:** Better Auth password sessions, no public enrollment, same-origin server actions, database-backed request throttling, and owner checks in all reads/writes/exports. Raw addresses and hashes are optional private references. CSV cells that could be interpreted as formulas are escaped. Outbound price requests only target CoinGecko's fixed endpoints; user-supplied URLs are never fetched.
- **Presentation:** Next App Router with the private Overview, Positions, Transactions and Analytics workspace; no populated financial charts until there are actual observations. UTC timestamps are entered and displayed in the selected IANA timezone (Asia/Jakarta by default). Ambiguous and nonexistent DST local times require a different time or display zone.

## Self-hosting

Run only against an approved environment. Set the real HTTPS origin in `BETTER_AUTH_URL`, a random `BETTER_AUTH_SECRET`, an independent URL-safe `POSTGRES_PASSWORD`, and optionally `COINGECKO_DEMO_KEY`. The production Compose configuration publishes only the web service on loopback, not PostgreSQL.

```sh
docker compose up -d db
docker compose build web tools
docker compose run --rm tools pnpm db:migrate
docker compose run --rm -e LPSTACKS_OWNER_NAME -e LPSTACKS_OWNER_EMAIL -e LPSTACKS_OWNER_PASSWORD tools pnpm owner:create
docker compose up -d web
```

Once the first owner exists, do not keep provisioning credentials in the deployment environment. Configure the HTTPS reverse proxy to preserve the public `Host`, set `X-Forwarded-Proto: https`, and overwrite `X-Forwarded-For` with a trusted client IP instead of forwarding a caller-provided value. Keep the app's port inaccessible to the public, and do not cache authenticated pages, downloads or auth API responses. Use HTTPS and enable HSTS at the edge after verifying the hostname.

For a managed database, reserve a direct connection for migrations (`DIRECT_URL` when needed), use a private network with certificate validation, and consider separate migration and application roles. The app needs normal row access and transactions, not schema ownership. Keep the database and the auth secret backed up separately; rotating the secret invalidates existing sessions.

## Migration and Recovery

Before upgrades, back up to a protected location with `pg_dump -Fc`; encrypt backups, set a retention policy and periodically validate a restore into a **new** database. Review migration SQL, take a backup, and run `pnpm db:migrate` before rolling out the new app revision. Do not use `prisma migrate reset` on a database with real journal data. To recover, restore with `pg_restore --exit-on-error` into a new database, confirm ownership and audit history, then explicitly switch the application connection. Backups and CSVs can contain sensitive wallet references. Do not make them public or commit them.

## Scope Limits

- Manual, EVM-token journal only: there is no RPC import, signing, execution, external capital flow mid-cycle, or tax reporting.
- One initial allocation and one active LP leg per cycle. Manually overlapping allocations are not detectable; the owner must reconcile the strategy boundary. Closed accounting is immutable in the application; metadata can still be updated.
- A position snapshot is evidence, not a protocol simulation. Auto-compounded fee attribution can be marked unavailable. Historical charts use at most the latest 80 candidate observation timestamps per selected cycle; sparse data is intentionally shown as discrete points. A saved market-price mark does not populate past quantities.
- Keyless provider pricing is best effort. Use manual pricing if the plan, asset mapping, time coverage, or quote quality is unsuitable. Exact arithmetic protects recorded quantities but does not make price estimates exact.
