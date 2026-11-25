# Changelog

## Unreleased

- Read-only Base wallet activity with optional Alchemy sync, BaseScan CSV/hash import, ERC-20/NFT filters and private CSV export.
- Review and atomically post verified PancakeSwap v3 WETH/cbBTC activity to one strategy, with exact token quantities, one gas charge per receipt, and auditable block provenance.
- Private, owner-scoped strategy journal for verified pre-entry and labeled imported allocations.
- Exact token accounting for swaps, liquidity transfers, fee collection, expenses and sequential LP legs, with immutable corrections and frozen closed-cycle results.
- Historical and latest CoinGecko reference prices with disclosed provenance, proxy and missing states; independent manual pricing remains available.
- Fee income, historical costs, net wealth, HODL comparison and token-equivalent reporting, with dated analytics and CSV export.
- Automated unit, PostgreSQL and browser lifecycle tests, plus local and optional self-hosted setup.
