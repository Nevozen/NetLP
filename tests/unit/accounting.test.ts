import { describe, expect, it } from "vitest";
import { replay } from "@/domain/ledger";
import {
  type Entry,
  type EventFacts,
  type Leg,
  type Market,
  type PriceVector,
  type Snapshot,
  USD_CASH,
} from "@/domain/model";
import { evaluate } from "@/domain/performance";
import { D } from "@/domain/values";

const weth = `8453:0x${"1".repeat(40)}`;
const btc = `8453:0x${"2".repeat(40)}`;
const eth = "8453:native";
const market: Market = {
  chainId: "8453",
  network: "Test chain",
  pair: [
    { id: weth, symbol: "WETH", decimals: 18, wrapsNative: true },
    { id: btc, symbol: "cbBTC", decimals: 8 },
  ],
  native: { id: eth, symbol: "ETH", decimals: 18 },
};
const leg: Leg = {
  id: "leg-1",
  protocol: "Test protocol",
  feeAttribution: "TRACKED",
};
const at = (day: number) =>
  `2025-01-${String(day).padStart(2, "0")}T00:00:00.000Z`;
const prices = (day: number, w = "2500", c = "100000", e = w): PriceVector =>
  [
    [weth, w],
    [btc, c],
    [eth, e],
  ].map(([asset, usd]) => ({
    asset,
    usd,
    requestedAt: at(day),
    observedAt: at(day),
    fetchedAt: at(day),
    source: "Fixture",
    quality: "EXACT_OR_NEAR",
    resolution: "fixture",
  }));
const entry = (
  day: number,
  facts: Omit<EventFacts, "gas" | "costs"> | EventFacts,
  quotes = prices(day),
): Entry => ({
  id: `entry-${day}`,
  sequence: day,
  at: at(day),
  prices: quotes,
  facts: { gas: "NONE", costs: [], ...facts } as EventFacts,
});
const open = (wallet: Record<string, string>, quotes = prices(1)) =>
  entry(
    1,
    {
      kind: "OPENING_ALLOCATION",
      baseline: "PRE_ENTRY_VERIFIED",
      wallet,
      gas: "NONE",
      costs: [],
    },
    quotes,
  );
const position = (
  principal: Snapshot["principal"],
  unclaimed: Snapshot["unclaimed"] = ["0", "0"],
): Snapshot => ({
  principal,
  unclaimed,
  source: "Fixture",
  range: "UNKNOWN",
});
const deposit = (
  day: number,
  amounts: [string, string],
  snapshot?: Snapshot,
  newLeg: Leg | null = leg,
) =>
  entry(day, {
    kind: "ADD_LIQUIDITY",
    legId: newLeg?.id ?? leg.id,
    newLeg: newLeg ?? undefined,
    amounts,
    snapshot,
    gas: "NONE",
    costs: [],
  });
const gas = (amount: string, funding: "STRATEGY_WALLET" | "EXTERNAL") =>
  ({ asset: eth, amount, funding, category: "GAS" }) as const;
const result = (
  entries: Entry[],
  day = entries.at(-1)!.sequence,
  quotes = prices(day),
) => evaluate(market, replay(market, entries), at(day), quotes);

describe("Section 11 acceptance examples", () => {
  it("A: execution shortfall and external gas are each counted once", () => {
    const evaluation = result([
      open({ [weth]: "0.4" }),
      entry(2, {
        kind: "SWAP",
        purpose: "ENTRY",
        inputs: [{ asset: weth, amount: "0.4" }],
        outputs: [{ asset: btc, amount: "0.0099" }],
        gas: "RECORDED",
        costs: [gas("0.00008", "EXTERNAL")],
      }),
    ]);
    expect(evaluation).toMatchObject({
      walletUsd: "990",
      executionShortfall: "10",
      netWealth: "989.8",
      hodl: "1000",
      totalPnl: "-10.2",
      outperformance: "-10.2",
      netClaimedIncome: "-10.2",
      networkHistorical: "0.2",
    });
    expect(evaluation.equivalents[weth].outperformance).toBe("-0.00408");
  });

  it("B: changing prices distinguish wealth, attribution, cash cost and HODL, including withdrawal", () => {
    const day3 = prices(3, "3000", "50000");
    const entries = [
      open({ [weth]: "1", [btc]: "0.05" }),
      entry(2, {
        kind: "ADD_LIQUIDITY",
        newLeg: leg,
        legId: leg.id,
        amounts: ["1", "0.05"],
        snapshot: position(["1", "0.05"]),
        gas: "RECORDED",
        costs: [gas("0.01", "EXTERNAL")],
      }),
      entry(
        3,
        {
          kind: "COLLECT_FEES",
          legId: leg.id,
          fees: ["0.04", "0"],
          snapshot: position(["0.9", "0.055"]),
          gas: "NONE",
          costs: [],
        },
        day3,
      ),
    ];
    const evaluation = result(entries, 3, day3);
    expect(evaluation).toMatchObject({
      openingCapital: "7500",
      hodl: "5500",
      principalUsd: "5450",
      grossWealth: "5570",
      netWealth: "5540",
      totalPnl: "-1960",
      outperformance: "40",
      divergence: "-50",
      grossMarked: "120",
      networkHistorical: "25",
      externalMark: "30",
      netClaimedIncome: "95",
      cashBasisNet: "5545",
    });
    expect(evaluation.relativePerformance).toMatch(/^0\.7272727/);
    const exit = entry(4, {
      kind: "REMOVE_LIQUIDITY",
      legId: leg.id,
      principal: ["0.9", "0.055"],
      receipt: ["0.9", "0.055"],
      fees: ["0", "0"],
      snapshot: position(["0", "0"]),
      gas: "NONE",
      costs: [],
    });
    const close = entry(
      5,
      { kind: "CLOSE_STRATEGY", gas: "NONE", costs: [] },
      prices(5, "3000", "50000"),
    );
    expect(result([...entries, exit, close], 5, close.prices)).toMatchObject({
      walletUsd: "5570",
      principalUsd: "0",
      netWealth: "5540",
      outperformance: "40",
      divergence: null,
    });
    expect(() => result([...entries, exit, close], 6)).toThrow(
      /closure timestamp/,
    );
  });

  it("C: fee collection and compounding only change the asset location", () => {
    const entries = [
      open({ [weth]: "0.4" }),
      deposit(2, ["0.4", "0"], position(["0.4", "0"], ["0.008", "0"])),
    ];
    const claim = entry(3, {
      kind: "COLLECT_FEES",
      legId: leg.id,
      fees: ["0.008", "0"],
      snapshot: position(["0.4", "0"]),
      gas: "NONE",
      costs: [],
    });
    const compound = deposit(4, ["0.008", "0"], position(["0.408", "0"]), null);
    expect(result(entries)).toMatchObject({
      netWealth: "1020",
      grossMarked: "20",
      unclaimedUsd: "20",
      claimedHistorical: "0",
    });
    expect(result([...entries, claim])).toMatchObject({
      netWealth: "1020",
      grossMarked: "20",
      unclaimedUsd: "0",
      walletUsd: "20",
    });
    expect(result([...entries, claim, compound])).toMatchObject({
      netWealth: "1020",
      grossMarked: "20",
      principalUsd: "1020",
      walletUsd: "0",
      divergence: null,
    });
  });

  it("D: internal gas reduces only the tracked native token balance", () => {
    const evaluation = result([
      open({ [weth]: "1", [eth]: "0.01" }),
      entry(2, {
        kind: "GAS_ONLY",
        gas: "RECORDED",
        costs: [gas("0.001", "STRATEGY_WALLET")],
      }),
    ]);
    expect(evaluation).toMatchObject({
      openingCapital: "2525",
      netWealth: "2522.5",
      hodl: "2525",
      outperformance: "-2.5",
      externalMark: "0",
    });
    expect(evaluation.quantities.wallet).toEqual({
      [weth]: "1",
      [eth]: "0.009",
    });
  });

  it("E: an exit swap can spend every previously claimed fee", () => {
    const entries = [
      open({ [weth]: "0.4" }),
      deposit(2, ["0.4", "0"], position(["0.4", "0"], ["0.006", "0"])),
      entry(3, {
        kind: "REMOVE_LIQUIDITY",
        legId: leg.id,
        principal: ["0.4", "0"],
        fees: ["0.006", "0"],
        receipt: ["0.406", "0"],
        snapshot: position(["0", "0"]),
        gas: "NONE",
        costs: [],
      }),
      entry(4, {
        kind: "SWAP",
        purpose: "EXIT",
        inputs: [{ asset: weth, amount: "0.406" }],
        outputs: [{ asset: btc, amount: "0.00995" }],
        gas: "NONE",
        costs: [],
      }),
    ];
    expect(result(entries)).toMatchObject({
      netWealth: "995",
      executionShortfall: "20",
      grossMarked: "15",
      netClaimedIncome: "-5",
      outperformance: "-5",
    });
  });

  it("F: positive USD PnL and fee income can coincide with HODL underperformance", () => {
    const entries = [
      open({ [weth]: "1" }),
      deposit(2, ["1", "0"], position(["0.8", "0"], ["0.05", "0"])),
    ];
    expect(result(entries, 2, prices(2, "4000"))).toMatchObject({
      totalPnl: "900",
      outperformance: "-600",
      netIncomeWithPending: "200",
    });
    expect(
      result(
        [open({ [weth]: "1", [btc]: "0.01" })],
        2,
        prices(2, "4000", "120000"),
      ),
    ).toMatchObject({ outperformance: "0", netWealth: "5200", hodl: "5200" });
  });

  it("F: retains favorable shortfall, 18/8 decimal units and precise exchange ratios", () => {
    const opening = open({
      [weth]: "1.000000000000000001",
      [btc]: "0.00000001",
    });
    const quotes = prices(
      2,
      "2500.123456789012345678",
      "99999.987654321098765432",
    );
    const evaluation = result(
      [
        opening,
        entry(
          2,
          {
            kind: "SWAP",
            purpose: "REBALANCE",
            inputs: [{ asset: weth, amount: "0.000000000000000001" }],
            outputs: [{ asset: btc, amount: "0.00000001" }],
            gas: "NONE",
            costs: [],
          },
          quotes,
        ),
      ],
      2,
      quotes,
    );
    expect(evaluation.quantities.wallet).toEqual({
      [weth]: "1",
      [btc]: "0.00000002",
    });
    expect(evaluation.executionShortfall).toBe(
      "-0.000999999876540710864197530987654322",
    );
    expect(
      new D(evaluation.crossRates.token1PerToken0!)
        .times(evaluation.crossRates.token0PerToken1!)
        .toSignificantDigits(110)
        .eq(1),
    ).toBe(true);
    expect(() => result([open({ [btc]: "0.000000001" })])).toThrow(
      /8 fractional digits/,
    );
  });

  it("F: missing historical quotes, unknown fees and invalidated principal are not zero", () => {
    const partial = [
      open({ [weth]: "1" }, []),
      deposit(2, ["1", "0"], position(["1", "0"], [null, "0"])),
    ];
    expect(result(partial)).toMatchObject({
      openingCapital: null,
      netWealth: null,
      principalUsd: "2500",
      grossMarked: null,
      hodl: "2500",
    });
    const removal = entry(3, {
      kind: "REMOVE_LIQUIDITY",
      legId: leg.id,
      principal: ["0.5", "0"],
      fees: ["0", "0"],
      receipt: ["0.5", "0"],
      gas: "NONE",
      costs: [],
    });
    expect(result([...partial, removal])).toMatchObject({
      netWealth: null,
      principalUsd: null,
      walletUsd: "1250",
    });
    expect(() =>
      result([...partial, removal, entry(4, { kind: "CLOSE_STRATEGY" })]),
    ).toThrow(/Settle all LP principal/);
  });

  it("F: reconciles a partial baseline and excludes inherited fees from earned income", () => {
    const opening = entry(1, {
      kind: "OPENING_ALLOCATION",
      baseline: "POST_ENTRY_ONLY",
      wallet: { [weth]: "0.1" },
      imported: { leg, snapshot: position(["0.4", "0"], ["0.008", "0"]) },
      gas: "NONE",
      costs: [],
    });
    expect(result([opening])).toMatchObject({
      openingCapital: "1270",
      grossMarked: "0",
      unclaimedUsd: "20",
      baseline: "POST_ENTRY_ONLY",
    });
    const removed = entry(2, {
      kind: "REMOVE_LIQUIDITY",
      legId: leg.id,
      principal: ["0.2", "0"],
      fees: ["0.012", "0"],
      receipt: ["0.212", "0"],
      snapshot: position(["0.2", "0"]),
      gas: "NONE",
      costs: [],
    });
    const evaluation = result([opening, removed]);
    expect(evaluation).toMatchObject({
      netWealth: "1280",
      grossMarked: "10",
      claimedHistorical: "10",
      outperformance: "10",
    });
    expect(evaluation.quantities.claimed[weth]).toBe("0.012");
    expect(evaluation.notices).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "BASELINE" })]),
    );
  });

  it("F: handles full removal, same-hash actions and a new range without opening new capital", () => {
    const txHash = `0x${"a".repeat(64)}`;
    const remove = entry(3, {
      kind: "REMOVE_LIQUIDITY",
      legId: leg.id,
      principal: ["0.4", "0"],
      fees: ["0.004", "0"],
      receipt: ["0.404", "0"],
      snapshot: position(["0", "0"]),
      gas: "RECORDED",
      txHash,
      actionIndex: 0,
      costs: [gas("0.0004", "EXTERNAL")],
    });
    const next = {
      ...deposit(4, ["0.404", "0"], position(["0.404", "0"]), {
        ...leg,
        id: "leg-2",
        lower: "0.01",
        upper: "0.05",
      }),
      at: at(3),
      prices: prices(3),
    };
    next.facts = { ...next.facts, gas: "SHARED", txHash, actionIndex: 1 };
    const entries = [
      open({ [weth]: "0.4" }),
      deposit(2, ["0.4", "0"], position(["0.4", "0"])),
      remove,
      next,
    ];
    expect(result(entries, 3)).toMatchObject({
      openingCapital: "1000",
      grossMarked: "10",
      networkHistorical: "1",
      netWealth: "1009",
    });
    expect(() =>
      replay(market, [
        ...entries.slice(0, -1),
        {
          ...next,
          facts: { ...next.facts, gas: "RECORDED", costs: remove.facts.costs },
        },
      ]),
    ).toThrow(/one network fee/);
    expect(() =>
      replay(market, [
        ...entries.slice(0, -1),
        { ...next, facts: { ...next.facts, actionIndex: 0 } },
      ]),
    ).toThrow(/action is already posted/);
    expect(() =>
      replay(market, [
        entries[0],
        { ...next, facts: { ...next.facts, gas: "NONE" } },
      ]),
    ).toThrow(/Insufficient WETH/);
  });

  it("F: warns on proxies and refuses incompatible swap observations", () => {
    const quotes = prices(2);
    quotes[1] = {
      ...quotes[1],
      quality: "PROXY",
      observedAt: "2025-01-01T21:00:00.000Z",
      note: "Disclosed test proxy",
    };
    const swap = entry(
      2,
      {
        kind: "SWAP",
        purpose: "ENTRY",
        inputs: [{ asset: weth, amount: "0.4" }],
        outputs: [{ asset: btc, amount: "0.01" }],
        gas: "NONE",
        costs: [],
      },
      quotes,
    );
    const evaluation = result([open({ [weth]: "0.4" }), swap], 2, quotes);
    expect(evaluation).toMatchObject({
      executionShortfall: null,
      netClaimedIncome: null,
      netWealth: "1000",
    });
    expect(evaluation.notices.map((n) => n.message).join(" ")).toMatch(
      /compatible.*proxy/i,
    );
    expect(() =>
      result([open({ [weth]: "0.4" }), { ...swap, prices: prices(3) }]),
    ).toThrow(/timestamp/);
  });
});

it("marks stale principal and unknown network costs honestly and supports documented fiat expenses", () => {
  const cash = entry(4, {
    kind: "OTHER_EXPENSE",
    gas: "NONE",
    costs: [
      {
        asset: USD_CASH,
        amount: "1.22",
        funding: "EXTERNAL",
        category: "OTHER",
      },
    ],
  });
  const entries = [
    open({ [weth]: "1" }),
    deposit(2, ["1", "0"], position(["1", "0"])),
    cash,
  ];
  expect(result(entries)).toMatchObject({
    netWealth: "2498.78",
    otherHistorical: "1.22",
    externalMark: "1.22",
  });
  expect(result(entries).notices).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "STALE" })]),
  );
  expect(
    result([
      ...entries,
      entry(5, { kind: "GAS_ONLY", gas: "UNKNOWN", costs: [] }),
    ]),
  ).toMatchObject({
    netWealth: null,
    networkHistorical: null,
    externalMark: null,
  });
});
