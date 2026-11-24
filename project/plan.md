# LPStacks — Product & Implementation Plan for Codex

> Working project name: **LPStacks** (renameable). Developer: **Wardana Dev**.
> Product: a liquidity pool journal, transaction-cost tracker, and LP-vs-HODL performance analyzer.
> This file is the product and technical specification. Follow the applicable global AGENTS.md for engineering and Git delivery and the repository AGENTS.md for LPStacks-specific invariants. Do not duplicate or override those delivery rules here.

## 1. Mission and execution instructions

Act as a senior full-stack engineer, DeFi accounting engineer, and product designer. Build a real, working application that answers:

**After earning liquidity provider fees, paying swap execution costs and network fees, and changing my token composition, am I actually better off than if I had simply held my original assets?**

The initial use case is a WETH/cbBTC liquidity position. The owner is comfortable holding either or both assets and wants to accumulate crypto over time, not merely maximize a USD-denominated return. Do not assume that accepting either asset eliminates impermanent loss. Measure the outcome objectively.

Before coding:

1. Inspect the repository, existing README, AGENTS.md, dependencies, current Git branch, history, and working tree.
2. Preserve existing work. If the repository is empty, initialize a sensible project foundation.
3. Write a short implementation plan and track progress in a checklist. Treat this specification as the source of truth unless an existing user requirement overrides it.
4. Implement incrementally, starting with the accounting engine and its tests. Do not stop at a mockup or a plan.
5. Create actual incremental commits and follow the authorized push, pull request, and merge workflow in the global AGENTS.md and Section 14. Merge only completed, validated deliverables.
6. Run the relevant checks throughout development and provide an honest final report.

Do not execute blockchain transactions, request signatures, access private keys, or move user funds. This is a read-only financial journal, not a trading bot, wallet, swap router, or liquidity management execution platform.

## 2. MVP scope and product principles

### Primary capabilities

- Create and manage multiple independent LP strategy cycles.
- Record initial token holdings **before the first entry swap** whenever data is available.
- Record actual token quantities for swaps, deposits into pools, liquidity removals, fee claims, and other operational transactions.
- Automatically fetch historical token prices for transaction-time valuation and current prices for position valuation.
- Allow manual price input when historical pricing is unavailable or inaccurate, with explicit provenance.
- Track gross LP fees, swap execution shortfall, gas, additional expenses, net fee income, total PnL, and performance relative to HODL.
- Show the strategy's value and its HODL benchmark in USD, WETH equivalents, and cbBTC equivalents.
- Support positions that are open, out of range, partially withdrawn, or closed.
- Support entry swaps, exit swaps, rebalances, and compounding without counting income or capital twice.
- Preserve an auditable, chronological journal and provide CSV export.

### Deliberate MVP boundaries

- Begin with manual transaction input and automated price fetching. Blockchain hash and wallet address are optional references, not required to use the app.
- Optimize the first release for WETH/cbBTC, while supporting other two-token pairs through token configuration.
- Base and Uniswap V3/V4 are examples, not assumptions about the user's actual network or protocol. The user must select the real values. Protocol-specific on-chain integrations are not required for MVP.
- A strategy cycle has one opening capital allocation. Internal LP additions, removals, fee claims, and repeated rebalances are supported. New external capital contributions or permanent external withdrawals during an active cycle are out of MVP scope; either open a separate cycle or close and restart the benchmark. Do not silently treat these flows as swaps or profits.
- External gas/operational expenses are supported and accounted for separately from trading capital.
- For the initial version, one cycle may contain multiple sequential LP legs, but only one active leg at a time. Multiple independent cycles can be open in parallel.
- Do not promise tax accounting, tax lots, automatic yield forecasts, or exact on-chain position math for unsupported protocols.
- Do not use fabricated market data in the real dashboard. Explicitly labeled demo data may be provided as an optional seed.

## 3. Technology and architecture

Preserve the existing stack if it is suitable. Otherwise use:

- Next.js App Router, React, strict TypeScript.
- Tailwind CSS, shadcn/ui, Lucide icons, Recharts.
- React Hook Form and Zod for forms and validation.
- PostgreSQL and Prisma ORM (or an existing equivalent relational ORM).
- An established authentication library (such as Auth.js) with private, owner-scoped data.
- A precise decimal arithmetic library, such as decimal.js, and BigInt for raw token units where appropriate.
- Vitest, Playwright, ESLint, Prettier, pnpm, GitHub Actions, Docker Compose.

Use stable mutually compatible dependency versions. Consult current official documentation when integrating external APIs and frameworks. Do not invent endpoints, provider quotas, or unsupported response fields.

Use a modular monolith. Separate journal/ledger logic, pricing adapters, valuation, analytics, persistence, and UI. Financial computations must run in shared domain services, with the server authoritative. Avoid unnecessary microservices, queues, or infrastructure.

Suggested structure (adapt to the existing project):

```text
src/
  app/
  components/{ui,layout,shared}/
  features/{overview,positions,transactions,analytics}/
  domain/{ledger,valuation,performance,pricing}/
  server/{db,auth,services}/
  lib/
prisma/
tests/{unit,integration,e2e}/
```

## 4. UX and navigation

Create a polished, compact, professional DeFi dashboard, inspired by modern portfolio tools, Linear, and Vercel, without copying their branding.

- English UI; USD default reporting currency; configurable display timezone (Asia/Jakarta default); UTC persistence.
- Light, dark, and system themes. Responsive layouts and accessible keyboard interactions.
- Clear financial hierarchy, neutral colors, green/red for positive/negative performance with signs and textual labels.
- Consistent decimal formatting: token quantities retain sufficient precision; USD generally displays two decimals; calculations never use rounded display values.
- Provide empty, loading, error, incomplete-data, and stale-price states. Missing data is not zero.
- Use a global denomination switcher: USD / WETH / cbBTC for the initial pair. In multi-pair views, distinguish USD totals from conversions to a selected reference token.
- Show valuation timestamps and price provenance where relevant.
- No placeholder buttons, meaningless charts, or fake balances.

Primary navigation: **Overview**, **Positions**, **Transactions**, **Analytics**. Settings and theme/account controls live in the sidebar footer.

## 5. Accounting model — non-negotiable

### 5.1 Strategy boundary

A strategy cycle begins with an explicitly recorded allocation of tokens before entry preparation and ends after withdrawal from the pool and any optional exit swap. This is distinct from the LP position itself. Idle assets belonging to this cycle remain within its boundary, even if they are not in the pool.

Track three distinct asset buckets:

- Strategy wallet: token quantities allocated to this strategy and currently outside the pool.
- LP principal: token quantities represented by the active liquidity position, excluding unclaimed fees.
- Unclaimed fees: earned token quantities still claimable from the pool, if known.

Claimed fees are in the wallet or have been reinvested into LP principal. They are not a fourth asset bucket. Additional analytics may track historical fee income without adding it again to current wealth.

Gas paid from the tracked wallet reduces its actual balance. Gas paid from outside the tracked wallet is a separate external expense. Never apply both treatments for the same payment. Apply the same rule to any other expense.

### 5.2 Opening baseline

Record:

- Strategy start date and time.
- Actual initial token quantities before any entry swap (e.g. 0.40 WETH and 0 cbBTC).
- Price snapshot for each asset at the opening time.
- Optional dedicated gas asset balance if included in the strategy allocation.
- Baseline quality: `PRE_ENTRY_VERIFIED`, `POST_ENTRY_ONLY`, or `ESTIMATED`.

Initial capital in USD is the sum of opening quantities multiplied by opening reference prices. This is an allocated-capital baseline, not the user's lifetime purchase cost or tax basis.

For existing open LP positions, allow the user to reconstruct the pre-entry holdings and past transactions, or start tracking from a known snapshot. If pre-entry information is missing, label the benchmark as post-entry/partial and explicitly state that earlier execution costs are excluded. Do not infer pre-entry amounts from current pool holdings.

### 5.3 Token accounting and pricing

Represent every asset using network and contract identity, not its ticker alone. Track native ETH separately from WETH and cbBTC separately from BTC, even if using a disclosed proxy price.

Use exact token quantities as decimal strings or integer base units. Store token decimals from verified metadata or user configuration. PostgreSQL numeric precision must accommodate common 18-decimal tokens and the supported value range. Never use JavaScript Number for financial arithmetic. Reject invalid quantities, negative asset balances, and excessive precision rather than silently rounding them.

Use a consistent reference price vector at any evaluation timestamp t:

```text
P_i(t) = USD reference price of token i at time t
Value(Q,t) = sum over tokens of Q_i × P_i(t)
```

Keep historical event valuation and current mark-to-market valuation separate. For a swap, all legs must use the same reference timestamp and compatible pricing sources. Do not use the user's own swap execution price as its fair-value benchmark.

### 5.4 Swap execution cost (entry, exit, rebalance)

A swap event records the actual amount debited and the actual amount credited, excluding gas which is recorded separately. Account for multiple token legs where necessary.

```text
Input fair value  = sum(actual input quantities × event reference prices)
Output fair value = sum(actual output quantities × event reference prices)
Execution shortfall = Input fair value − Output fair value
Shortfall bps = Execution shortfall / Input fair value × 10,000
```

A negative shortfall represents favorable execution relative to the reference; do not clamp it to zero. Price quality and timestamp mismatch may affect the result.

This shortfall is an all-in reference-price estimate of execution cost (including embedded trading fee, price impact, slippage, and other differences). It is not a precise breakdown of each component. Only show a breakdown when separately verified information exists. Any embedded DEX fee already reflected in the actual input/output amounts is informational; **do not subtract it again**.

Example at WETH = $2,500 and cbBTC = $100,000:

```text
Swap input:    0.4 WETH       = $1,000
Swap output:   0.0099 cbBTC   =   $990
Shortfall:                      $10
Gas (separate):                $0.20
Total economic execution cost: $10.20
```

A wallet containing exactly the output has already absorbed the $10 execution shortfall. Subtracting $10 from its marked value would double count it.

### 5.5 Liquidity transfers and principal snapshots

Adding and removing liquidity transfer assets between wallet and pool; they are not income or expenses. Record exact transferred amounts and any associated gas. A protocol may charge an actual separately debited cost; record it explicitly when known.

Pool token composition changes even without journal transactions. Therefore, do not compute live LP principal from original deposit quantities alone. Require periodic position snapshots containing:

- Actual current token0 and token1 principal quantities, excluding fees.
- Unclaimed fee quantities for each token, or explicit unknown status.
- Snapshot timestamp, source, and linked position/leg.
- Optional price range, current pool ratio, in-range status, and liquidity amount.

Manual snapshot input is mandatory for MVP. Do not assume a 50/50 allocation, infer principal from a generic impermanent loss formula, or present stale principal quantities as current on-chain balances.

When recording a liquidity addition/removal or a fee claim, require/update the associated post-event position snapshot, or mark the pool balance incomplete until a valid snapshot is entered. The wallet balance is updated using actual transfers; the pool snapshot is authoritative for pool principal and unclaimed amounts. Never add the old snapshot to newly withdrawn wallet assets.

Partial withdrawals remain internal to the strategy wallet. A full LP removal may leave unclaimed fees. A pool leg is fully settled only when remaining principal and unclaimed fees are known to be zero. Strategy closure is explicit after settlement and any exit swap.

### 5.6 Gross LP fees and compounding

Record fee receipts separately from principal withdrawals. Some protocols combine principal and fees in one transfer. In that case the form must request the principal/fee split and ensure the sum matches the actual receipt. If the split is unknown, permit an unresolved import/draft, but do not guess fee income or certify final fee analytics.

Maintain cumulative claimed fee quantities by token. Maintain the latest known outstanding unclaimed fee quantities by token for each leg. For a fully reconciled journal:

```text
Gross fees earned (token i) = cumulative claimed fee quantity_i
                            + currently outstanding unclaimed fee quantity_i
```

For an imported position, distinguish pre-baseline outstanding fees from fees earned during the tracking period. Pre-baseline fee balances are part of starting wealth when included and must be excluded from newly earned fees.

Fee collection moves claimable fees into the strategy wallet. It changes location, not total wealth. Never sum every historical unclaimed-fee snapshot. Only the most recent valid outstanding quantity is used. Compounding transfers wallet funds back to liquidity; it is not a second fee receipt. If a protocol automatically compounds, do not model compounded income as both extra principal and unclaimed fees; require reliable fee attribution or mark gross fee breakdown incomplete.

Report clearly distinguished fee metrics:

- Claimed fees: native quantities, with USD valuation at the claim timestamp.
- Unclaimed fees: latest known native quantities, marked at the selected evaluation prices.
- Gross fees, marked at evaluation prices: claimed + outstanding quantities valued at the same evaluation prices. This is a fee-income attribution metric, **not** a claim that previously received fees are still held in their original tokens.
- Optional historical earned-fee USD series only when adequate accrual-time data exists. Do not label collection-time valuations as exact accrual-time income.

### 5.7 Gas and other operational costs

A cost record stores:

- Actual token and quantity debited (native ETH on relevant networks, or another fee token).
- Transaction-time reference price and historical USD cost.
- Funding source: `STRATEGY_WALLET` or `EXTERNAL`.
- Category: gas, approval gas, explicit protocol fee, bridge fee, or another operational expense.
- Linked journal event and optional transaction hash.

Record actual total gas, including any applicable execution and L1/data fees for an L2, without summing a total and its components twice. Failed on-chain actions may still incur gas and should be recordable as gas-only events. If exact gas data is unavailable, require manual input or flag it as unknown, not zero.

Record a shared network fee once per blockchain transaction and allow linking multiple logical actions to it. An additional manual fee field cannot duplicate a gas record already imported for the same transaction.

For external costs, store both historical USD and native quantities. Main HODL performance uses the opportunity cost of externally paid expense tokens at the evaluation time (Section 5.8). Display historical USD cost as a separate operational metric. This distinguishes exact economic comparison from cash-basis bookkeeping. External gas is not additional investable capital.

### 5.8 Net wealth, total PnL, and HODL benchmark

For a reconciled single-allocation strategy, define at evaluation time t:

```text
Q_wallet(t)      = actual tracked wallet token quantities
Q_principal(t)   = latest valid LP principal quantities
Q_unclaimed(t)   = latest valid unclaimed-fee quantities
Q_initial        = initial allocated token quantities before entry swaps
Q_external_cost  = cumulative quantities of externally paid expenses

Gross strategy wealth(t) = Value(Q_wallet + Q_principal + Q_unclaimed, t)
External cost mark(t)    = Value(Q_external_cost, t)
Net strategy wealth(t)   = Gross strategy wealth(t) − External cost mark(t)
HODL benchmark(t)        = Value(Q_initial, t)

Total economic PnL(t)    = Net strategy wealth(t) − Initial capital USD
Total return(t)          = Total economic PnL(t) / Initial capital USD × 100
Outperformance vs HODL(t)= Net strategy wealth(t) − HODL benchmark(t)
Relative performance(t)  = Outperformance vs HODL(t) / HODL benchmark(t) × 100
HODL price PnL(t)        = HODL benchmark(t) − Initial capital USD
```

This model treats externally paid fee tokens as a reduction in incremental wealth relative to the no-LP alternative that would have retained them. If the user uses an external USD cash expense, treat it as a documented USD-denominated cost. Do not assume all stablecoins equal USD.

Optional supplementary metric: `Cash-basis net wealth = Gross strategy wealth − historical USD external expenses`. Label it separately; do not mix it with token-aware performance.

**Critical invariants:**

- Do not subtract swap execution shortfall from net wealth again: actual wallet and principal quantities already incorporate it.
- Do not subtract internal gas or internal protocol fees again: those debits already reduced wallet balances.
- Subtract externally paid costs exactly once (they are absent from wallet balances).
- Do not add claimed fees again: they are already reflected in wallet/principal holdings or subsequent swaps.
- Add outstanding unclaimed fees only if excluded from the principal snapshot.
- Evaluate strategy and HODL at the same timestamp with the same price vector.
- Never include unrelated wallet assets or count the same opening capital in two strategies.
- Do not clamp negative profits, returns, shortfalls, or relative performance.
- Return N/A for undefined ratios or missing inputs; never Infinity/NaN or fabricated zero.

For closed cycles, freeze the realized evaluation snapshot at closure using the exit/closing reference prices. Optionally provide a separately labeled hypothetical current mark of closing assets, but never change closed historical PnL as market prices move.

### 5.9 Net fee income versus actual LP profitability

Provide an operational fee efficiency metric separate from wealth PnL:

```text
Historical execution shortfall = sum of swap shortfalls at event prices
Historical explicit costs      = sum of actual gas and other independent expenses at event prices
Historical operational cost     = historical execution shortfall + historical explicit costs
Net claimed fee income (USD)   = claimed fees at claim-time USD − historical operational cost
Net fee income incl. pending   = net claimed fee income + current USD value of outstanding fees
```

The last line is a mixed timing operational estimate; explicitly label it as such. It is not a strict reconciliation of mark-to-market wealth PnL. Do not include embedded swap fees in explicit costs.

Also provide a token-aware marked diagnostic if useful, but do not sum historic USD cost attribution with terminal-price wealth deltas as if they reconcile exactly. A residual includes token price changes, execution timing, composition changes, and reinvestment effects.

**Net fee income can be positive while performance versus HODL is negative.** Show both metrics prominently.

### 5.10 Divergence loss / impermanent loss

Use the user's pre-entry HODL baseline as the main economic benchmark. Do not label its entire underperformance as impermanent loss: it includes entry/exit execution costs, gas, fee income, and changes in composition.

Optionally support a narrower per-leg divergence metric only for a clean single-deposit leg with no interim principal changes, using the actual post-entry deposited quantities as the leg-specific HODL comparator:

```text
Leg HODL value(t) = value of original deposited quantities at t
Leg divergence(t) = LP principal value(t), excluding fees − Leg HODL value(t)
```

Show N/A if the leg has multiple deposits/withdrawals or unsupported compounding, unless a validated flow-adjusted method is implemented. Do not apply a full-range constant-product IL formula to concentrated liquidity, changing ranges, or unsupported protocols.

For a known price range, indicate `IN_RANGE`, `OUT_OF_RANGE`, or `UNKNOWN` based on the appropriate token-ratio direction and protocol semantics. Out of range can result in one-sided holdings and no active fee earning for conventional concentrated-liquidity positions. Do not promise a fee rate from the status alone.

### 5.11 Denomination and asset accumulation

Provide both actual token quantities and value equivalents. For a value at a given timestamp:

```text
WETH equivalent = value_USD / P_WETH(t)
cbBTC equivalent = value_USD / P_cbBTC(t)
WETH price in cbBTC = P_WETH(t) / P_cbBTC(t)
cbBTC price in WETH = P_cbBTC(t) / P_WETH(t)
```

Label ratios explicitly (e.g. cbBTC per 1 WETH). Provide inversion without ambiguity.

For accumulation/benchmark comparisons, convert the same-time outperformance amount using the same evaluation price. To measure change in token-equivalent wealth over time, convert each endpoint at its own timestamp, then subtract the equivalents. These are different metrics:

```text
Excess WETH equivalent vs HODL(t) = Outperformance_USD(t) / P_WETH(t)
Change in WETH equivalent wealth  = Net strategy wealth(t)/P_WETH(t)
                                 − Initial capital USD/P_WETH(start)
```

Apply the same approach for cbBTC. Do not present equivalents as actual token balances or executable swap quotes.

## 6. Pricing service

Build an interchangeable price provider interface:

- Historical USD quote by asset identity and UTC timestamp.
- Latest USD quote by asset identity.
- Optional historical batch quotes.
- Manual override with reason and source.

Use CoinGecko or another suitable documented provider. Verify actual API availability, contract mappings, granularity, authentication, and historical lookback limitations at implementation time. Keep provider credentials on the server. Do not promise unlimited free historical minute-level data.

For each stored price snapshot include:

- Token ID, chain and contract identity.
- USD price as a precise decimal.
- Requested timestamp and actual source timestamp.
- Provider, provider asset identifier, resolution/granularity.
- Quality status: `EXACT_OR_NEAR`, `APPROXIMATE`, `MANUAL`, `PROXY`, `MISSING`.
- Fetch time and optional notes.

Define and document acceptable timestamp tolerance. Warn when data is stale or coarse. Never silently substitute today's price for a historical transaction. If exact historical data is not available, support a clearly labeled approximate quote or a manual reference price. Save historical quotes immutably once a transaction is posted; corrections must be auditable.

Resolve wrapped assets by actual token identity when supported. If using ETH as a WETH proxy or BTC as a cbBTC proxy, make that substitution explicit and user-visible. Wrapped assets may deviate from their underlying reference price; a proxy is not an exact quote.

Provide server-side caching, batch fetching where supported, request timeouts, sensible retry/backoff, and an explicit refresh control. Avoid repeated requests on every render. When provider access is unavailable, all manual journaling and valuation with manually supplied prices must continue to work.

## 7. Positions module

The Positions page is the main workspace for strategy cycles and LP legs.

### 7.1 List and filters

- Tabs: Open, Closed, All.
- Search by pair, label, protocol, network, and optional on-chain ID.
- Filters for network, protocol, status, and opening date.
- Cards or compact rows with pair, strategy name, LP status, current principal value, idle wallet value, gross fees, costs, net fee income, net outperformance, elapsed time, and data freshness.
- Clearly distinguish strategy status from pool range status.

### 7.2 Create strategy wizard

1. Select network, protocol, pair, and strategy name.
2. Enter initial holdings and opening timestamp; allow starting with only one token.
3. Optionally record gas reserve as part of initial allocated holdings.
4. Fetch historical opening prices or provide manual values.
5. Choose new strategy or import existing position. Existing position flow supports reconstructing history or starting at a post-entry baseline.
6. Save opening snapshot, notes, optional wallet address, and optional on-chain position ID.
7. Prompt to record entry swap and initial liquidity deposit, or proceed to the imported snapshot.

For imported positions, the opening asset allocation must reconcile to the opening wallet + principal + pre-existing unclaimed fees if these are included. No fabricated opening swaps or fees.

### 7.3 LP leg details

- Protocol and version (custom allowed), chain, pool identifier/address, optional NFT/position ID.
- token0/token1 identity and ordering.
- Fee tier, optional dynamic fee indicator.
- Optional lower and upper price range, explicitly denominated in token1 per token0 (or user-selected display inversion).
- Opening and closing timestamp, range status, notes.
- Latest actual principal and unclaimed-fee snapshot.
- History of range changes via separate sequential legs, rather than overwriting historical range values.

### 7.4 Strategy details

Provide tabs or sections for Overview, Ledger, Position Snapshots, Fees & Costs, and Notes.

Display:

- Opening allocation vs current holdings by token.
- Actual wallet, principal, outstanding fees, and external cost quantities.
- Initial capital, net wealth, HODL benchmark, total PnL, relative performance.
- Claimed fees, unclaimed fees, execution costs, gas, other costs, net fee income.
- Position history, transaction timeline, reference price history, and freshness.
- Optional divergence metric with eligibility explanation.

Actions: Record Transaction, Update Snapshot, Open/Rebalance LP Leg, Close Strategy, Edit Metadata, Export.

Do not let users mark a strategy closed while liquidity or unclaimed fees are known to remain. If closure details are missing, keep it open/incomplete and indicate the missing steps. Closing must freeze a reproducible evaluation record.

## 8. Transactions module

Create a chronological, searchable transaction journal. Every event belongs to a strategy cycle and optionally an LP leg. Support:

| Event type | Purpose |
|---|---|
| OPENING_ALLOCATION | Record initial capital/baseline once |
| SWAP | Actual input/output quantities, entry/exit/rebalance purpose |
| ADD_LIQUIDITY | Move wallet tokens into a pool leg |
| REMOVE_LIQUIDITY | Move principal from pool to wallet; partial or full |
| COLLECT_FEES | Move earned token fees into the wallet |
| APPROVAL | Record approval-related gas, no fake asset transfer |
| GAS_ONLY | Network expense, including failed transactions |
| OTHER_EXPENSE | Explicit independently paid cost |
| WRAP_UNWRAP | Actual native/wrapped asset transfer, plus gas if applicable |
| POSITION_SNAPSHOT | Record observed principal and unclaimed quantities |
| CLOSE_STRATEGY | Freeze final evaluation after all legs settle |

Rebalance and compound are grouped workflows using underlying events, not extra money-moving events. A bridge can be recorded in a later version with network-specific accounting; do not add an unsupported bridge implementation merely to populate a menu.

### Transaction form

- Strategy and optional leg selector, type, timestamp, optional hash and chain, notes.
- Token identity, actual amount sent/received, principal/fee split as appropriate.
- Price snapshot preview showing source, timestamp, and quality.
- Actual gas quantity, gas token, funding source, explicit additional expenses.
- Live preview of fair values, execution shortfall, costs, and resulting strategy wallet balances.
- For liquidity/fee events, prompt for updated post-event principal and fee snapshot.
- Allow drafts with unresolved fields; posted events require complete accounting inputs (or explicitly known quantities with missing valuations that block affected metrics).
- Show warning for negative balance, duplicated hash/action, missing historical pricing, or chronological inconsistency.

### Ledger integrity

- Keep a deterministic chronological ordering (timestamp plus sequence for equal timestamps).
- Use actual transaction hash + network + action/log index or a stable manual event ID to avoid duplicates. One hash may contain multiple legitimate actions.
- Do not count the same cost or fee receipt twice when using grouped workflows.
- Posted transactions must be immutable or corrected via audited version/reversal-and-replacement logic. Editing metadata can be allowed without modifying accounting facts.
- Backdated entries and corrections must trigger deterministic ledger replay and validation from the affected point. Reject resulting negative balances or invalid state transitions.
- A failed transaction must not change state partially. Persist event, token movements, costs, and required snapshots atomically when supplied together.
- Price provider failure must not create fake valuations; retain unresolved records and flag affected analytics.

## 9. Overview and analytics

### Overview dashboard

Headline metrics:

- Total allocated capital (with open vs closed scope clearly labeled).
- Current net strategy wealth of open cycles.
- Gross fees (claimed/pending split).
- Total swap execution shortfall.
- Total network fees and other operational costs.
- Net fee income (with clear valuation basis).
- Net outperformance vs HODL.
- Total economic PnL.
- Number of active and closed strategies.

Show a recent activity list and open-position summary. Clearly flag stale/incomplete data and do not include incomplete cycles in certified aggregate results without an explicit partial-total warning.

### Analytics

- LP net wealth vs HODL benchmark over time, using actual dated position snapshots and contemporaneous price quotes.
- Outperformance over time (USD and selected token equivalent).
- Fee collection and operating expense timeline (historical event basis).
- Fee vs costs, gas-cost burden, and execution shortfall per transaction.
- Entry swap vs exit swap cost by strategy.
- Actual asset composition vs opening HODL composition.
- Strategy and network/protocol breakdowns.
- Optional simple annualized return only with sufficient elapsed time, labeled as backward-looking and not a forecast. Do not call fee yield APY without a valid compounding methodology.

Filters: strategy, pair, network, protocol, open/closed, and date range (7D, 30D, 90D, all time, custom).

For historical charts, never use today's pool quantities for past dates. If snapshots are sparse, show actual observation points and gaps; do not fabricate daily history or smooth through missing data. If a latest snapshot is revalued with a new market quote, label it as estimated using stale composition, not a fresh on-chain value.

For portfolio aggregation, sum USD metrics from independent, non-overlapping allocations. Do not sum raw WETH and cbBTC quantities into a single number. Closed-cycle performance uses each cycle's closing mark; open cycles use their current evaluation mark. Label combined closed/open PnL as a sum of distinct cycle outcomes, not a time-weighted portfolio return. Compute percentages using appropriate weighted denominators, never an unweighted average of percentages. Filter event-based costs by event dates and closed-cycle results by closure date; do not reset an opening HODL baseline when changing the reporting filter.

## 10. Data model and persistence

Design a relational schema that supports exact arithmetic and auditability. Suggested entities:

| Entity | Key data |
|---|---|
| User | Authentication identity, settings, timestamps |
| Network | Chain ID, name, native token identity |
| Token | Network, contract/native identifier, symbol, decimals, price mapping |
| Strategy | Owner, pair, status, start/end times, baseline quality, notes, optional wallet reference |
| OpeningAllocation | Strategy, token, quantity, opening price snapshot |
| LpLeg | Strategy, protocol/version, pool/position identifier, range, fee tier, opened/closed times |
| JournalEvent | Strategy, optional leg, type, timestamp, ordering, status, hash, action index, group, notes |
| TokenMovement | Event, token, signed quantity or from/to bucket, principal/fee classification |
| CostRecord | Event/transaction identity, token, amount, funding source, cost category, price snapshot |
| PriceSnapshot | Token, USD price, requested/observed timestamps, source, quality, metadata |
| PositionSnapshot | Leg, timestamp/sequence, token principal quantities, unclaimed quantities, completeness, source |
| EvaluationSnapshot | Strategy, evaluation time, relevant prices/snapshots, metrics, calculation version, final flag |
| AuditRevision | Record reference, reason, revision/version, actor, timestamps |

Keep authentication-provider Account models separate from any financial asset records. Avoid conflicting model names.

Enforce foreign keys, ownership, unique baseline per cycle, event idempotency, nonnegative unsigned quantities, consistent token identities, and valid status transitions. Use database transactions and concurrency controls for posting/correcting events and closing strategies. Do not rely solely on client-side checks. Index owner/strategy, timestamp, status, chain/hash/action identity, and snapshot lookup fields.

Record the calculation version and input references used to produce final evaluations. Derive balances and metrics from source events and snapshots; cached summaries are not the source of truth. Keep price snapshots and financial facts reproducible. Implement migrations, optional clearly labeled seed data, and a safe reset procedure only for local test databases.

## 11. Acceptance examples — implement as automated tests

All prices and quantities below are synthetic, not live market values. Use exact decimal arithmetic and compare expected results.

### A. Entry swap, external gas, no LP income

Opening allocation: 0.4 WETH. Event and evaluation prices: WETH $2,500, cbBTC $100,000, native ETH $2,500.

- Swap 0.4 WETH for 0.0099 cbBTC.
- Gas paid externally: 0.00008 ETH ($0.20).
- Expected wallet value: $990.
- Expected execution shortfall: $10.
- Expected net strategy wealth: $989.80.
- Expected HODL benchmark: $1,000.
- Expected economic PnL and outperformance: -$10.20.
- Expected net claimed fee income: -$10.20.
- Expected outperformance in WETH equivalent: -0.00408 WETH.
- Must not subtract the $10 twice.

### B. Complete LP cycle with changing prices

Opening: 1 WETH + 0.05 cbBTC. Opening prices: WETH $2,500, cbBTC $100,000. Initial capital $7,500. Deposit all without a swap; gas is external.

At evaluation: WETH $3,000, cbBTC $50,000, native ETH $3,000. Actual LP principal: 0.9 WETH + 0.055 cbBTC ($5,450). Claimed fees retained in wallet: 0.04 WETH ($120). Unclaimed fees zero. External gas: 0.01 ETH total, paid when ETH was $2,500 ($25 historical, $30 at evaluation).

Expected:

- HODL benchmark: $5,500.
- Gross strategy wealth: $5,570.
- Net strategy wealth: $5,540.
- Total economic PnL: -$1,960 (market decline can coexist with LP outperformance).
- Net outperformance vs HODL: +$40.
- Relative performance: approximately +0.7272727%.
- Leg divergence excluding fees: -$50.
- Gross marked fee income: $120.
- Historical gas cost: $25; external gas opportunity cost: $30.
- If the 0.04 WETH was claimed at $3,000, historical net claimed fee income: $95.
- Cash-basis net wealth (optional): $5,545.

When all principal is withdrawn, it moves into the wallet, and principal becomes zero. At identical prices, with no new costs, wealth must remain unchanged. Once explicitly closed, later prices must not alter the final evaluation.

### C. Fee claim and compound invariance

At constant prices, begin with LP principal worth $1,000 and unclaimed fees worth $20. Wallet zero. Claim the $20 without gas, then reinvest it with no execution loss or new fees. Total wealth must remain $1,020 throughout. Gross fees must remain $20, not $40 or $60. Unclaimed decreases to zero after claim, and reinvestment increases principal by $20 while reducing wallet by $20.

### D. Internal gas versus external gas

At fixed prices, initial allocation includes 1 WETH and a dedicated 0.01 native ETH reserve. Both priced $2,500, opening capital $2,525. Spend 0.001 native ETH from the tracked reserve. Net wealth $2,522.50, HODL $2,525, outperformance -$2.50. External cost mark must remain zero. Do not subtract internal gas twice.

### E. Exit swap consumes fees

At constant prices, opening wealth $1,000, principal returned to wallet $1,000, claimed fees $15, unclaimed zero, no external expenses. Exit swap consumes the entire $1,015 fair-value input and produces $995 fair-value output. Execution shortfall $20. Final net wealth $995, net fee income -$5 (assuming claim and swap use the same prices), outperformance -$5. Do not subtract $20 again or add $15 again.

### F. Other required scenarios

- Positive total USD PnL but negative HODL outperformance; positive fees but negative outperformance.
- No swaps, no fees, no expenses, unchanged token composition: strategy equals HODL at any prices.
- Favorable execution produces a negative shortfall, not an error.
- cbBTC 8-decimal and WETH 18-decimal quantities, tiny fees, high-precision ratios.
- Missing prices and unknown unclaimed fees produce N/A/incomplete, not zero.
- Imported position without historical pre-entry data does not claim full-lifecycle performance.
- Combined principal/fee receipts, partial removals, fee claims, rebalances, same-hash multi-action events.
- Duplicate costs, duplicated events, negative wallet balances, backdated corrections, and transaction rollback.
- Price proxy and historical timestamp mismatch warnings; frozen historical prices and final results.
- User ownership isolation, concurrent posting, and unauthorized mutation attempts.

## 12. Security, data export, and deployment

- Private authentication; owner-scoped reads, writes, analytics, and exports. No unauthenticated financial endpoints.
- Validate all requests server-side and protect sessions. Use secure cookies, appropriate CSRF controls, rate limiting for sensitive operations, and safe redirects.
- Never request seed phrases, private keys, exchange login credentials, wallet signatures, or transaction permissions.
- Wallet addresses and transaction hashes are optional, potentially identifying information; do not expose them publicly or leak them into logs.
- Store provider credentials and database/auth secrets in environment variables; provide `.env.example` with placeholders.
- Validate chain identifiers, token addresses, and URLs. Use approved provider endpoints; do not fetch arbitrary user-controlled URLs on the server.
- Support CSV exports for journal events, token movements, expenses, fee receipts, snapshots, and performance reports with timestamps, units, pricing basis and completeness flags. Protect against CSV formula injection.
- Provide Dockerfile and Docker Compose for optional VPS/self-hosted deployment. Document local development, migrations, HTTPS/reverse proxy, private database networking, backup/restore and price provider setup. Follow the standing authorized Git delivery workflow in AGENTS.md for routine pushes and PR merges. Independent production deployment, releases, and high-impact deployment side effects require explicit or applicable standing authorization.
- Keep test data isolated from production. Never reset a user database or automatically seed production.
- Include a clear product note: estimates depend on recorded quantities and reference price quality; this is a journal, not investment or tax advice.

## 13. Tests, implementation order, and definition of done

### Milestones

1. **Foundation:** repository inspection, stack, configuration, project-level AGENTS.md, CI baseline. Preserve the global instructions; do not edit them from this repository.
2. **Accounting core:** exact decimal utilities, token ledger, swap/fee/cost math, HODL/wealth functions, acceptance tests.
3. **Data layer and auth:** schema, migrations, private data access, atomic posting/corrections.
4. **Pricing:** historical/latest adapters, manual overrides, cache, provenance, error states.
5. **Application shell:** responsive navigation, design system, themes.
6. **Positions:** creation/import, initial allocation, legs, snapshots, closure.
7. **Transactions:** complete forms, live previews, reconciliation and event history.
8. **Overview/analytics:** meaningful live database metrics, benchmark charts and token denomination views.
9. **Quality and delivery:** integration/e2e tests, exports, deployment docs, README, changelog.

Commit meaningful completed work throughout, not just at the end. Implement vertical slices where helpful. If the environment lacks API credentials, make the manual mode work and use mocks only in tests; clearly report unverified provider integration. Do not block the core app on optional automation.

### Verification

- Unit tests for all financial invariants and numerical examples in Section 11.
- Integration tests against an isolated database for event posting, duplicate prevention, corrections, snapshot lifecycle, closure, and authorization.
- End-to-end test: create pre-entry baseline → record swap → add liquidity → record snapshot → claim fees → rebalance or remove liquidity → exit swap → close → verify all financial metrics and history.
- Additional end-to-end coverage for imported position, missing pricing, manual pricing, dark/mobile layout and CSV export.
- Run formatting, lint, strict type checking, tests, and production build. Suggested scripts: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`. Use actual repository commands.

MVP is done when manual journaling works end to end with real persistence; prices can be fetched or entered manually; accounting examples pass; no fee double-counting occurs; open and closed performance is reproducible; incomplete data is disclosed; and the app is secure, usable, and documented. Do not claim production readiness if mandatory tests or security requirements remain unverified.

## 14. Repository delivery — follow AGENTS.md

Use the global AGENTS.md for repository discovery, branch isolation, incremental Conventional Commits, push, PR creation, CI/review gates, and automatic merge on authorized repositories. The repository AGENTS.md adds LPStacks-specific engineering and accounting rules only. Do not install conflicting local Git rules or rewrite the global file. No remote URL, default branch, or permanent feature branch is assumed.

Treat each coherent milestone or independently complete feature as a possible PR; commit and push smaller validated units on its task branch. Do not merge every individual commit into the stable branch. For repositories authorized for automatic delivery, merge complete PRs only after all applicable local and remote gates pass. If CI is blocked, continue safe local work and leave affected PRs unmerged; report the blocker. Respect existing protections and repository merge strategies. Never deploy, create a release, or bypass protections merely to finish this plan.

Use scopes such as `ledger`, `pricing`, `valuation`, `positions`, `transactions`, `fees`, `analytics`, `overview`, `database`, `auth`, `security`, `ui`, `export`, and `config` when appropriate.

Example progression (illustrative, not a required count):

```text
chore(core): Initialize LPStacks project
chore(config): Configure development tooling
feat(ledger): Add exact token balance accounting
feat(valuation): Calculate transaction execution shortfall
feat(valuation): Add token-aware HODL benchmark
test(ledger): Cover fee claim and compound invariants
feat(database): Add strategy and journal models
feat(auth): Protect private strategy records
feat(pricing): Add historical price provider adapter
feat(pricing): Support manual price snapshots
feat(ui): Implement responsive dashboard shell
feat(positions): Add strategy allocation workflow
feat(positions): Support imported LP snapshots
feat(transactions): Record swaps and operational costs
feat(transactions): Add liquidity and fee event workflows
feat(positions): Freeze closed strategy evaluations
feat(overview): Display net wealth and HODL performance
feat(analytics): Add asset denomination comparisons
feat(export): Add transaction and performance CSV exports
test(core): Cover complete liquidity strategy lifecycle
build(docker): Add self-hosted deployment configuration
ci: Configure automated quality checks
docs: Document accounting rules and setup
```

Maintain README.md, CONTRIBUTING.md, CHANGELOG.md, .gitignore, .env.example, and CI configuration where appropriate. Use repository-compatible commit validation tooling. Never commit secrets, private transaction exports, user data, database dumps, or generated artifacts. If the global instructions are unavailable, report that fact and keep remote delivery conservative; do not infer permission to push or merge.

## 15. Post-MVP roadmap (not mandatory for first release)

Only after manual accounting is correct:

- Read-only wallet import via verified chain RPC/indexers and protocol-specific adapters.
- Decode actual swap transfers, position-manager events, combined principal/fee collections, and gas, including L2 fee components; require review before posting uncertain imports.
- Automatic principal/unclaimed fee snapshots for supported protocols, with block/timestamp provenance.
- More chains, pairs, parallel legs, and explicit external contributions/withdrawals with a validated cash-flow-adjusted HODL benchmark and time-weighted or money-weighted returns.
- Audit-grade fee attribution for automated vaults and more advanced divergence analysis.
- Read-only notifications for range status, data freshness, or fee/cost thresholds.

Do not make these prerequisites for the MVP and do not implement wallet signing or automated fund movement.

## 16. Final delivery report and execution directive

Before finishing, report:

- Implemented features, architecture, important accounting decisions, and any deviations from this plan.
- Actual checks run and their pass/fail/skipped results, including external API verification limitations.
- Current branch, actual commit hashes and subjects, push destination/status, PR URL/state, remote CI/review outcomes, resulting base revision if merged, and final `git status --short`. Distinguish local completion, remote integration, and deployment.
- Local setup commands, required configuration, migrations, test commands, and deployment guide.
- Remaining limitations, incomplete requirements, known bugs, and next logical improvements.

Verify Git history with `git log --oneline --graph --decorate`. Do not claim any action succeeded unless it actually ran successfully.

**Start now.** Build LPStacks as a real financial journaling application, not a dashboard mockup. Prioritize correct economic accounting over visual complexity. The primary outcome is trustworthy LP-vs-HODL performance from actual token movements, reference prices, and observed position snapshots, without double-counting fees or execution costs.
