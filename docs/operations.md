# Architecture and Operations

## Application

- **Domain:** exact quantity validation and arithmetic, deterministic chronological replay, reference mark valuation, and explicit unknown coverage.
- **Persistence:** Prisma and PostgreSQL. Strategies, owner accounts, event identities, revisions, price sets, drafts and final evaluations have foreign keys. Versioned JSON payloads preserve decimal strings and snapshot evidence without coercion by PostgreSQL or JavaScript. The mutable event index points to chronological facts; revisions and posted quotes are append-only in application writes. A revision, its price set and the new projection commit together. Strategy row locks serialize mutations; command IDs, transaction/action uniqueness, and a partial network-fee index catch duplicate payments. `FinalEvaluation` stores the exact revision IDs and closing reference set alongside the result.
- **Security:** Better Auth password sessions, no public enrollment, same-origin server actions, database-backed request throttling, and owner checks in all reads/writes/exports. Raw addresses and hashes are optional private references. CSV cells that could be interpreted as formulas are escaped. Outbound price requests only target CoinGecko's fixed endpoints; user-supplied URLs are never fetched.
- **Presentation:** Next App Router with the private Overview, Positions, Transactions and Analytics workspace; no populated financial charts until there are actual observations. UTC timestamps are entered and displayed in the selected IANA timezone (Asia/Jakarta by default). Ambiguous and nonexistent DST local times require a different time or display zone.
- **Wallet imports:** `WalletWatch` holds a per-owner Base wallet, paginated checkpoints and a short sync lease. `WalletActivity` deduplicates by owner, chain, address and hash. Indexer and file imports enqueue candidates; only canonical RPC evidence fills transaction/transfer details. `WalletImportReview` holds the frozen preview briefly. Posting revalidates chain finality and evidence revisions, locks the owner/strategy/watch, and writes all actions, price sets, revisions and provenance in one transaction.

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

## Base Wallet Providers

`ALCHEMY_API_KEY` enables server-side Base transfers discovery using Alchemy's fixed Base endpoint. `BASE_RPC_URL` can override verification or enable hash/CSV verification alone. Use a trusted HTTPS Base mainnet endpoint that serves `finalized`, receipts, historical `eth_call`, and block-hash log queries. Plain HTTP is allowed only for loopback development. Do not share keys in support logs, browser config, screenshots, or CSVs. A configured provider receives public addresses and/or hashes. Those identifiers are still private within LPStacks. The BaseScan website is used for explorer links and user-downloaded exports, not scraped. The official Etherscan Base history API requires a paid tier; LPStacks does not depend on it.

The workspace polls only while visible, without a scheduler or webhook. A PostgreSQL lease coalesces browser tabs. Discovery paginates both directions over fixed windows, overlaps recent blocks, and pauses when verification falls behind. Provider failures back off from two minutes up to 20 minutes. Alchemy calls are paced within each server process. The [published free-tier limits](https://www.alchemy.com/docs/reference/pricing-plans) are 30 million compute units per month per account and a base throughput of 300 CU/second per app; check the current plan and monitor aggregate use across replicas. Both RPC and indexer access are best effort; Base's public RPC is rate limited and not recommended for production. A rate limit, malformed response, or missing receipt is not proof of an empty wallet. A CSV or hash can fill missed activity. Unknown snapshot quantities and incomplete gas inputs are disclosed; the app does not infer token movements or reconstruct historical opening capital from wallet history.

Imported results use Base's canonical `finalized` tag, not a fixed confirmation count. For position changes, LPStacks only attaches an immediate post-transaction snapshot if the block logs rule out later changes to that pool or NFT in the same block. It uses the NFT manager's historical liquidity and fee growth to reconcile combined decrease/collect events. If amounts are affected by rounding, an earlier unreconciled withdrawal, or unavailable archive data, review the actual payout and supply independent evidence or use the manual journal. A standalone NFT transfer/burn never creates a withdrawal or fee line. Replacing a watched address starts a new scan generation and retains the other address's records without mixing them into the new view.

## Migration and Recovery

Before upgrades, back up to a protected location with `pg_dump -Fc`; encrypt backups, set a retention policy and periodically validate a restore into a **new** database. Review migration SQL, take a backup, and run `pnpm db:migrate` before rolling out the new app revision. Do not use `prisma migrate reset` on a database with real journal data. To recover, restore with `pg_restore --exit-on-error` into a new database, confirm ownership and audit history, then explicitly switch the application connection. Backups and CSVs can contain sensitive wallet references. Do not make them public or commit them.

## Scope Limits

- Read-only discovery and review are scoped to Base; financial proposals support direct WETH/cbBTC PancakeSwap v3 swaps and supported NFT liquidity/collection flows. Infinity, staked positions, smart-wallet/paymaster settlement and mixed routes may appear as activity without ledger-ready facts. A decrease without payment does not credit the wallet. Native ETH is never treated as WETH, and unresolved principal/fee splits require independent confirmation. The app never signs or executes transactions.
- External capital flows mid-cycle and tax reporting remain out of scope.
- One initial allocation and one active LP leg per cycle. Manually overlapping allocations are not detectable; the owner must reconcile the strategy boundary. Closed accounting is immutable in the application; metadata can still be updated.
- A position snapshot is evidence, not a protocol simulation. Auto-compounded fee attribution can be marked unavailable. Historical charts use at most the latest 80 candidate observation timestamps per selected cycle; sparse data is intentionally shown as discrete points. A saved market-price mark does not populate past quantities.
- Keyless provider pricing is best effort. Use manual pricing if the plan, asset mapping, time coverage, or quote quality is unsuitable. Exact arithmetic protects recorded quantities but does not make price estimates exact.
