# LPStacks

LPStacks by **Wardana Dev** is a private liquidity-pool journal. It compares the actual recorded value of an LP strategy after costs with what holding its opening allocation would have been worth. It never connects to a signing wallet or moves funds.

## Local Setup

Requirements: Node.js 24, pnpm 11.18, and PostgreSQL 17 or compatible. Docker Compose is optional.

1. Copy `.env.example` to `.env`. Generate two independent secrets with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Set `POSTGRES_PASSWORD` and substitute the same password in the local `DATABASE_URL`. Set `BETTER_AUTH_SECRET` to the second value. Docker Compose constructs its own internal database URL from `POSTGRES_PASSWORD`; use a URL-safe value such as hex.
2. Start a local database, or use an existing **development** database. To expose only the Compose PostgreSQL port on loopback:

   ```sh
   docker compose -f compose.yaml -f compose.dev.yaml up -d db
   pnpm install --frozen-lockfile
   pnpm db:migrate
   ```

3. Provision a private owner using environment variables `LPSTACKS_OWNER_NAME`, `LPSTACKS_OWNER_EMAIL`, and `LPSTACKS_OWNER_PASSWORD` (12–128 characters). Set the password using a masked prompt or your local secret manager; do not paste it into command history or store it in source. For Bash:

   ```sh
   export LPSTACKS_OWNER_NAME="Journal Owner" LPSTACKS_OWNER_EMAIL="owner@example.com"
   read -rsp "Owner password: " LPSTACKS_OWNER_PASSWORD; echo
   export LPSTACKS_OWNER_PASSWORD
   pnpm owner:create
   unset LPSTACKS_OWNER_PASSWORD
   ```

4. Run `pnpm dev` and open `http://localhost:3000`. For a production-mode local check, run `pnpm build` then `pnpm start`. Sign-in uses the exact origin configured by `BETTER_AUTH_URL`. There is no public sign-up or email recovery endpoint.

## Use the Journal

- Create a cycle using holdings **before** the first entry swap. For an already open position, use a known opening snapshot and disclose a post-entry or estimated benchmark. Enter actual principal **excluding** outstanding fees. Choose the real chain, protocol, and token identities. The Base and Ethereum WETH/cbBTC templates are optional; custom EVM pairs can use manually sourced prices.
- Record actual swap inputs and outputs. Use one network fee per transaction hash; other logical actions of the same transaction use different action indices and can link to that fee. Record total L2 fees only once. A separate fee is for an actual independent debit, not the swap fee already reflected in the amount received.
- Deposit, claim, withdraw, or compound using ordinary journal entries. A post-event snapshot replaces the previous composition. Unknown positions or fees remain incomplete. To rebalance, settle the old leg and record the new deposit; the cycle retains its original benchmark.
- Use **Refresh valuation** for current market prices or a dated manual mark. This revalues the recorded positions; it does not pull their current quantities from a chain. Close explicitly after settlement and the optional exit swap. A closed cycle retains its valuation, input revision IDs, and calculation version; corrections must be posted before closure.
- Select USD, WETH or cbBTC in the reporting toolbar. Equivalents are not actual token balances. Each strategy's detail view also shows both configured pair denominations, original holdings, and reciprocal rates.

## Import Base Wallet Activity

1. For automatic discovery, set `ALCHEMY_API_KEY` on the server for an [Alchemy Base app](https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers). Its free tier works within quota; there is no BaseScan subscription. To verify CSVs or hashes without Alchemy, set `BASE_RPC_URL` to a trusted Base mainnet endpoint. If both are set, Alchemy discovers candidates and the configured RPC verifies receipts, finality, and historical state.
2. In **Settings**, save one public Base address. Choose the latest 10,000 blocks or start from the first successful sync. With LPStacks open and visible, **Transactions → Wallet activity** checks about every 30 seconds, with **Sync now** and pause/resume controls. The **Transactions**, **Token Transfers**, and **NFT Transfers** filters show available activity and BaseScan links. These records never change your strategy balances by themselves.
3. For history the indexer misses, export a CSV in BaseScan (when offered) and upload it, or paste a transaction hash. LPStacks reads only the hash column and verifies each receipt against the saved address. Use up to 500 distinct hashes or 512 KB per file. Verification is incremental; leave the app visible or use **Sync now** to process the queue. Activity CSV export includes up to 500 matching transactions; per-strategy CSV contains posted journal entries and their provenance.
4. Select up to 10 eligible PancakeSwap v3 WETH/cbBTC transactions. Choose an open strategy with the right baseline, confirm funding and swap purpose, and fill in any missing evidence or independent prices. Preview and click **Post selected** to record the whole batch, with gas charged once per receipt. For a pre-existing LP position, the active leg needs its PancakeSwap v3 pool address and numeric NFT ID. Review does not create a baseline or close a strategy.

Discovery is transfer-based, not a full replica of BaseScan. Failed calls or approvals without indexed transfers can be missing. Use CSV/hash to supplement them. Unsupported contracts, unrelated assets and NFT transfers are activity, not earnings. Unknown snapshots stay incomplete. The importer never connects to the wallet, requests a signature, or submits a transaction.

## Accounting and Prices

The server replays token quantities with exact decimals. Wallet + LP principal + unclaimed fees gives gross wealth. Net wealth subtracts **only** external expenses, marked at the same evaluation time as the strategy and HODL. Swap shortfall and internal expense debits already reduce holdings. A fee claim changes location, not wealth; an imported fee reserve is consumed before attributing new claimed fees.

Net claimed fee income is claim-time earned LP fees minus historical execution shortfall and independent historical expenses. Net fee income including pending mixes that historical result with a current outstanding-fee mark. Neither is economic PnL or HODL outperformance. An eligible simple leg's divergence compares its observed principal with holding the original deposit, not with the pre-entry strategy.

CoinGecko uses fixed, verified asset mappings, a batched latest endpoint and historical ranges without substituting current prices for older events. The optional `COINGECKO_DEMO_KEY` stays server-side. Demo history is limited to 365 days and can be coarse or unavailable. Historical requests select the nearest sample within three hours; observations over 15 minutes away are approximate, and swap observations over two hours apart cannot produce a shortfall. Explicit manual input uses its own source and reason. Base native ETH is marked using a disclosed Ethereum ETH proxy. Saved open evaluation marks older than one hour and observed composition older than 24 hours are flagged. Analytics only plot dated, reconcilable observations; they do not invent daily history.

## Verification

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod --audit-level high
pnpm build
```

Use **two isolated databases** named `lpstacks_test` and `lpstacks_e2e` (suffixes such as `_local` are supported), not the application database. Set `LPSTACKS_TEST_DATABASE_URL` and `LPSTACKS_E2E_DATABASE_URL` in the shell. In Bash, run:

```sh
DIRECT_URL="" DATABASE_URL="$LPSTACKS_TEST_DATABASE_URL" pnpm db:migrate
DIRECT_URL="" DATABASE_URL="$LPSTACKS_E2E_DATABASE_URL" pnpm db:migrate
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser suite runs the standalone build on loopback port `3167`. Tests create isolated fixture records and do not reset databases. Never assign production credentials to the test variables. See [architecture and operations](docs/operations.md) for deployment, migration, backups, and limitations.
