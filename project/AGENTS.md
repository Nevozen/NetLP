# LPStacks — Project Agent Instructions

## Scope and instruction hierarchy

LPStacks by Wardana Dev is a private liquidity-pool journal and performance analyzer. Its initial use case is WETH/cbBTC, comparing actual LP strategy wealth after costs against holding the initial assets. Read `plan.md` in full for product scope, formulas, workflows, acceptance examples, and milestones. Follow applicable global AGENTS.md for engineering and Git delivery; this file adds project-specific rules and does not override remote permissions, branch protection, or CI gates. Honor explicit task constraints. Preserve existing code and documentation.

## Architecture and implementation

- Preserve a suitable existing stack. Otherwise use Next.js App Router, React, strict TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma, mature authentication, Zod, precise decimal arithmetic, Vitest and Playwright, as specified in `plan.md`.
- Keep a modular monolith. Separate ledger, pricing, valuation, performance, persistence, authentication, and presentation; the server is authoritative for financial results.
- Build manual journal input and historical/current reference pricing first. Read-only on-chain imports are post-MVP. Do not assume the actual chain, protocol, fee tier, or price range.
- Implement accounting tests before relying on dashboards. No fake statistics or non-functional controls. Use English UI, USD default, WETH/cbBTC equivalent views, configurable timezone (Asia/Jakarta default), UTC persistence, and accessible responsive layouts.

## Accounting invariants

- A strategy cycle starts before its first entry swap when evidence is available. Preserve initial token quantities and reference prices. Imported post-entry or estimated baselines must be labeled; do not reconstruct missing historical holdings by guessing.
- Identify tokens by chain and contract/native identity, not ticker alone. Distinguish native ETH from WETH and cbBTC from BTC. Use precise decimals or integer base units; never use JS Number for money or token arithmetic.
- Track strategy wallet, LP principal excluding fees, and outstanding unclaimed fees as distinct buckets. Claimed fees already reside in the wallet or have been spent/reinvested; do not add them again to wealth.
- Swaps record actual input/output quantities and gas separately. Execution shortfall = fair value of input minus fair value of output at one consistent independent reference timestamp. Allow negative shortfall. Embedded swap fees are already included in actual quantities; do not deduct them again.
- Liquidity additions, withdrawals, fee claims and compounding are internal movements, not new capital or duplicate income. Record accurate post-event pool snapshots; principal composition cannot be inferred from opening amounts alone. Unknown principal/fees must stay incomplete, not zero.
- Internal gas/expenses reduce tracked wallet balances once. External expenses are separately recorded and deducted once using evaluation-time opportunity cost for the economic comparison. Display historical expense value separately. Record a shared network fee only once, including applicable L2 components.
- Net wealth = marked wallet + marked principal + marked unclaimed fees − marked external expenses. HODL benchmark = initial allocation marked at the same evaluation timestamp/prices. Total PnL = net wealth − opening capital; LP outperformance = net wealth − HODL. Never deduct execution shortfall or internal costs again from net wealth.
- Gross fee income, net fee income, total PnL, and outperformance are different metrics. Follow the exact valuation bases and formulas in `plan.md`. Do not report unsupported divergence/impermanent loss estimates as exact.
- Actual token holdings are not token-equivalent valuations. Label cross-rates and equivalent units clearly. Ratios with zero denominators or missing inputs are N/A; do not clamp negative results.
- Use immutable posted historical price snapshots with source, requested/observed timestamp, quality and proxy disclosure; corrections must be auditable. Stale, approximate and missing quotes must be visible. Manual pricing must work if the provider is unavailable.
- MVP: one initial capital allocation and one active LP leg per cycle; sequential rebalances allowed. New external investment or permanent withdrawal requires a separate cycle or close/restart. Preserve closed evaluation input references and results, without later repricing them silently.

## Integrity and security

Use owner-scoped authenticated access and server validation for every private operation. Post/correct events and close cycles transactionally, with idempotency, concurrency protection, and auditable corrections. Enforce nonnegative unsigned amounts and no negative wallet balances. Distinguish missing values from zero. Keep immutable financial inputs and calculation versions reproducible.

This is a journal, not a wallet or execution engine. Never request private keys, seed phrases, signing permissions, or execute swaps, approvals, transfers, liquidity operations, or any other blockchain transaction. Protect wallet identifiers, transaction hashes, provider credentials, and exports. Validate external URLs, prevent SSRF and CSV formula injection, and isolate test databases. No production database resets or destructive migrations without authorization.

## Verification and delivery

- Implement all acceptance examples in `plan.md` Section 11 as automated tests. Cover fee-claim/compound invariance, external versus internal gas, execution cost double-counting, exact decimals, changing prices, imports, stale snapshots, corrections, duplicate transactions, frozen closure, and ownership isolation.
- Run actual repository formatting, lint, typecheck, unit/integration/E2E and build checks as applicable. Disclose failures, skipped checks, and API limitations. Do not claim production readiness when mandatory checks remain unverified.
- Use global AGENTS.md for actual atomic commits, authorized feature-branch pushes, PRs and gated merges. This project does not authorize direct stable-branch pushes, protection bypass, or deployment. If the global file is unavailable, keep work local until remote delivery rules are established.
- Follow `plan.md` milestones, update README and changelog accurately, and report real commit hashes, PR/merge state, test outcomes, setup steps, and unresolved limitations.
