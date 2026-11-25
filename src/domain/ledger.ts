import {
  type Amounts,
  type Entry,
  type Leg,
  type Market,
  type Movement,
  type Snapshot,
  isGas,
  quantity,
  tokens,
  USD_CASH,
} from "./model";
import {
  accumulate,
  add,
  D,
  execution,
  requireFact,
  validateVector,
  value,
} from "./values";

export interface ObservedPosition extends Snapshot {
  at: string;
  eventId: string;
}

export interface LegState {
  definition: Leg;
  openedAt: string;
  closedAt: string | null;
  position: ObservedPosition | null;
  deposits: number;
  withdrawals: number;
  originalDeposit: Amounts | null;
}

export interface EventResult {
  entry: Entry;
  walletDelta: Amounts;
  received: Amounts;
  earned: Amounts;
  claimedHistorical: string | null;
  networkHistorical: string | null;
  otherHistorical: string | null;
  externalHistorical: string | null;
  swap: ReturnType<typeof execution> | null;
}

export function compareEntries(a: Entry, b: Entry) {
  const time = a.at.localeCompare(b.at);
  if (time) return time;
  const closure =
    Number(a.facts.kind === "CLOSE_STRATEGY") -
    Number(b.facts.kind === "CLOSE_STRATEGY");
  if (closure) return closure;
  if (a.walletOrigin && b.walletOrigin) {
    const left = BigInt(a.walletOrigin.blockNumber);
    const right = BigInt(b.walletOrigin.blockNumber);
    if (left !== right) return left < right ? -1 : 1;
    return (
      a.walletOrigin.txIndex - b.walletOrigin.txIndex ||
      (a.facts.actionIndex ?? 0) - (b.facts.actionIndex ?? 0) ||
      a.sequence - b.sequence
    );
  }
  if (a.walletOrigin || b.walletOrigin) return a.walletOrigin ? 1 : -1;
  return a.sequence - b.sequence;
}

function sorted(entries: Entry[]) {
  return [...entries].sort(compareEntries);
}

export function replay(market: Market, entries: Entry[]) {
  const ordered = sorted(entries);
  const opening = ordered[0];
  requireFact(
    opening?.facts.kind === "OPENING_ALLOCATION",
    "Record an opening allocation before posting other events.",
  );
  const openingFacts = opening.facts;
  const assetMap = new Map(tokens(market).map((token) => [token.id, token]));
  const wallet: Amounts = {};
  const initial: Amounts = {};
  const external: Amounts = {};
  const claimed: Amounts = {};
  const earnedClaimed: Amounts = {};
  const carry: Amounts = {};
  const legs: LegState[] = [];
  const active = () => legs.find((leg) => !leg.closedAt);
  const results: EventResult[] = [];
  let gasUnknown = false;
  let closedAt: string | null = null;

  function amount(asset: string, text: string) {
    const maxDecimals = asset === USD_CASH ? 2 : assetMap.get(asset)?.decimals;
    requireFact(
      maxDecimals !== undefined,
      `Asset ${asset} is not configured on this strategy.`,
    );
    requireFact(
      quantity.safeParse(text).success &&
        (text.split(".")[1]?.length ?? 0) <= maxDecimals,
      `Invalid quantity for ${assetMap.get(asset)?.symbol ?? "USD cash"}: use up to ${maxDecimals} fractional digits.`,
    );
    return new D(text);
  }

  function movement(move: Movement) {
    requireFact(
      move.asset !== USD_CASH,
      "USD cash is for externally funded cash expenses only.",
    );
    const units = amount(move.asset, move.amount);
    requireFact(units.gt(0), "Actual movements and expenses must be positive.");
    return units;
  }

  function pair(units: [string, string]) {
    return market.pair.map((asset, index) => ({
      asset: asset.id,
      units: amount(asset.id, units[index]),
    }));
  }

  function applySnapshot(
    leg: LegState,
    snapshot: Snapshot | undefined,
    entry: Entry,
  ) {
    leg.position = null;
    if (!snapshot) return;
    for (const [index, token] of market.pair.entries()) {
      for (const text of [
        snapshot.principal[index],
        snapshot.unclaimed[index],
      ]) {
        if (text !== null) amount(token.id, text);
      }
    }
    if (snapshot.ratio)
      requireFact(
        new D(snapshot.ratio).gt(0),
        "The observed pool ratio must be positive.",
      );
    leg.position = { ...snapshot, at: entry.at, eventId: entry.id };
    if (
      [...snapshot.principal, ...snapshot.unclaimed].every(
        (n) => n !== null && new D(n).isZero(),
      )
    ) {
      requireFact(
        Object.values(carry).every((n) => new D(n).isZero()),
        "Record the collection of the imported opening fees before marking the leg settled.",
      );
      leg.closedAt = entry.at;
    }
  }

  function openLeg(definition: Leg, at: string): LegState {
    requireFact(!active(), "Settle the active leg before opening a new one.");
    requireFact(
      !legs.some((leg) => leg.definition.id === definition.id),
      "That LP leg already exists.",
    );
    const { lower, upper } = definition;
    requireFact(
      (!lower && !upper) ||
        (lower && upper && new D(lower).gt(0) && new D(lower).lt(upper)),
      "Enter both range bounds, with a positive lower bound strictly below the upper bound.",
    );
    const leg = {
      definition,
      openedAt: at,
      closedAt: null,
      position: null,
      deposits: 0,
      withdrawals: 0,
      originalDeposit: null,
    };
    legs.push(leg);
    return leg;
  }

  const hashes = new Set<string>();
  for (const entry of ordered) {
    if (entry.facts.txHash && entry.facts.gas === "RECORDED") {
      requireFact(
        !hashes.has(entry.facts.txHash),
        "Only one network fee may be recorded for a transaction hash.",
      );
      hashes.add(entry.facts.txHash);
    }
  }

  const actions = new Set<string>();
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const entry of ordered) {
    const { facts, prices } = entry;
    requireFact(!closedAt, "A closed cycle cannot accept further events.");
    requireFact(
      !ids.has(entry.id) && !sequences.has(entry.sequence),
      "Duplicate journal event or sequence.",
    );
    ids.add(entry.id);
    sequences.add(entry.sequence);
    validateVector(market, entry.at, prices);
    requireFact(
      (facts.txHash === undefined) === (facts.actionIndex === undefined),
      "A transaction hash requires an action index, and vice versa.",
    );
    if (facts.txHash) {
      const action = `${facts.txHash}:${facts.actionIndex}`;
      requireFact(
        !actions.has(action),
        "That transaction action is already posted.",
      );
      actions.add(action);
    }
    const networkCosts = facts.costs.filter(isGas);
    requireFact(
      networkCosts.length === (facts.gas === "RECORDED" ? 1 : 0),
      "Record exactly one total network fee, or explicitly mark its coverage.",
    );
    if (facts.gas === "SHARED") {
      requireFact(
        facts.txHash && hashes.has(facts.txHash),
        "A shared network fee requires a posted action with the same hash and recorded fee in this cycle.",
      );
    }
    if (facts.gas === "UNKNOWN") gasUnknown = true;
    if (facts.kind === "APPROVAL" || facts.kind === "GAS_ONLY") {
      requireFact(
        facts.gas !== "NONE",
        "Specify the network fee or mark it unknown for this event.",
      );
    }
    if (facts.kind === "OTHER_EXPENSE") {
      requireFact(
        facts.costs.some((c) => !isGas(c)),
        "Record an independent expense.",
      );
    }
    if (
      facts.kind === "OPENING_ALLOCATION" ||
      facts.kind === "POSITION_SNAPSHOT" ||
      facts.kind === "CLOSE_STRATEGY"
    ) {
      requireFact(
        facts.gas === "NONE" && facts.costs.length === 0 && !facts.txHash,
        "Record transfers and expenses as separate transaction events.",
      );
    }
    const line: EventResult = {
      entry,
      walletDelta: {},
      received: {},
      earned: {},
      claimedHistorical: "0",
      networkHistorical: "0",
      otherHistorical: "0",
      externalHistorical: "0",
      swap: null,
    };

    const moveWallet = (asset: string, delta: InstanceType<typeof D>) => {
      requireFact(
        accumulate(wallet, asset, delta).gte(0),
        `Insufficient ${assetMap.get(asset)?.symbol ?? "asset"} in the strategy wallet at ${entry.at}.`,
      );
      accumulate(line.walletDelta, asset, delta);
    };
    const collect = (fees: [string, string]) => {
      for (const { asset, units } of pair(fees)) {
        if (units.isZero()) continue;
        const fromBaseline = D.min(carry[asset] ?? "0", units);
        accumulate(carry, asset, fromBaseline.neg());
        const newFees = units.minus(fromBaseline);
        moveWallet(asset, units);
        accumulate(claimed, asset, units);
        accumulate(earnedClaimed, asset, newFees);
        accumulate(line.received, asset, units);
        accumulate(line.earned, asset, newFees);
      }
      line.claimedHistorical = value(line.earned, prices);
    };

    if (facts.kind === "OPENING_ALLOCATION") {
      requireFact(
        entry === opening,
        "There can only be one opening allocation.",
      );
      requireFact(
        facts.baseline !== "POST_ENTRY_ONLY" || facts.imported,
        "A post-entry baseline needs an imported opening snapshot.",
      );
      requireFact(
        facts.baseline !== "PRE_ENTRY_VERIFIED" || !facts.imported,
        "To reconstruct a pre-entry baseline, journal its actual entry events.",
      );
      for (const [asset, text] of Object.entries(facts.wallet)) {
        requireFact(asset !== USD_CASH, "USD cash is not a wallet asset.");
        const units = amount(asset, text);
        moveWallet(asset, units);
        accumulate(initial, asset, units);
      }
      if (facts.imported) {
        const { leg: definition, snapshot } = facts.imported;
        const leg = openLeg(definition, entry.at);
        for (const [index, token] of market.pair.entries()) {
          const principal = snapshot.principal[index];
          const pending = snapshot.unclaimed[index];
          requireFact(
            principal !== null && pending !== null,
            "To reconcile starting wealth, imported opening principal and fees must be known for both assets.",
          );
          accumulate(
            initial,
            token.id,
            amount(token.id, principal).plus(amount(token.id, pending)),
          );
          carry[token.id] = pending;
        }
        applySnapshot(leg, snapshot, entry);
      }
      requireFact(
        Object.values(initial).some((n) => new D(n).gt(0)),
        "Allocate at least one nonzero opening balance.",
      );
    } else if (facts.kind === "SWAP") {
      for (const move of facts.inputs)
        moveWallet(move.asset, movement(move).neg());
      for (const move of facts.outputs) moveWallet(move.asset, movement(move));
      line.swap = execution(facts.inputs, facts.outputs, prices);
    } else if (facts.kind === "WRAP_UNWRAP") {
      const { input, output } = facts;
      const spendsNative = input.asset === market.native.id;
      const wrapped = assetMap.get(spendsNative ? output.asset : input.asset);
      requireFact(
        (spendsNative || output.asset === market.native.id) &&
          wrapped?.wrapsNative,
        "Wrap/unwrap must use this network's configured native and wrapped-native assets.",
      );
      const actualInput = movement(input);
      const actualOutput = movement(output);
      requireFact(
        actualInput.eq(actualOutput),
        "Wrap/unwrap quantities must match. Record gas or explicit fees separately.",
      );
      moveWallet(input.asset, actualInput.neg());
      moveWallet(output.asset, actualOutput);
    } else if ("legId" in facts) {
      let leg = active();
      if (facts.kind === "ADD_LIQUIDITY" && facts.newLeg) {
        requireFact(
          facts.newLeg.id === facts.legId,
          "The LP leg identity must match the deposit.",
        );
        leg = openLeg(facts.newLeg, entry.at);
      }
      requireFact(
        leg?.definition.id === facts.legId,
        "Choose the active LP leg for this event.",
      );
      if (facts.kind === "ADD_LIQUIDITY") {
        const deposits = pair(facts.amounts);
        requireFact(
          deposits.some(({ units }) => units.gt(0)),
          "Record at least one liquidity deposit.",
        );
        for (const { asset, units } of deposits) moveWallet(asset, units.neg());
        leg.deposits++;
        if (
          leg.deposits === 1 &&
          openingFacts.imported?.leg.id !== leg.definition.id
        ) {
          leg.originalDeposit = Object.fromEntries(
            deposits.map(({ asset, units }) => [asset, units.toFixed()]),
          );
        }
      } else if (facts.kind === "REMOVE_LIQUIDITY") {
        const principal = pair(facts.principal);
        const fees = pair(facts.fees);
        requireFact(
          principal.some(({ units }) => units.gt(0)),
          "Use fee collection when no principal was withdrawn.",
        );
        for (const [index, { asset, units }] of principal.entries()) {
          requireFact(
            amount(asset, facts.receipt[index]).eq(
              units.plus(fees[index].units),
            ),
            "Each receipt must match its principal and fee split.",
          );
          moveWallet(asset, units);
        }
        leg.withdrawals++;
        collect(facts.fees);
      } else if (facts.kind === "COLLECT_FEES") {
        requireFact(
          pair(facts.fees).some(({ units }) => units.gt(0)),
          "Record at least one collected fee quantity.",
        );
        collect(facts.fees);
      }
      applySnapshot(leg, facts.snapshot, entry);
      if (facts.kind === "ADD_LIQUIDITY")
        requireFact(
          !leg.closedAt,
          "A deposit cannot leave a known empty and settled LP leg.",
        );
    } else if (facts.kind === "CLOSE_STRATEGY") {
      requireFact(
        !active(),
        "Settle all LP principal and unclaimed fees before closing.",
      );
      requireFact(
        !gasUnknown,
        "Resolve unknown network expenses before closing.",
      );
      closedAt = entry.at;
    }

    if (facts.gas === "UNKNOWN") line.networkHistorical = null;
    for (const cost of facts.costs) {
      const cash = cost.asset === USD_CASH;
      requireFact(
        !cash || (cost.funding === "EXTERNAL" && !isGas(cost)),
        "USD cash may only fund an external non-network expense.",
      );
      const units = cash ? amount(cost.asset, cost.amount) : movement(cost);
      requireFact(units.gt(0), "Expenses must have a positive quantity.");
      const historical = value({ [cost.asset]: cost.amount }, prices);
      if (cost.funding === "EXTERNAL") {
        accumulate(external, cost.asset, units);
        line.externalHistorical = add(line.externalHistorical, historical);
      } else {
        moveWallet(cost.asset, units.neg());
      }
      if (isGas(cost))
        line.networkHistorical = add(line.networkHistorical, historical);
      else line.otherHistorical = add(line.otherHistorical, historical);
    }
    results.push(line);
  }

  return {
    opening,
    openingFacts,
    initial,
    wallet,
    external,
    claimed,
    earnedClaimed,
    carry,
    legs,
    activeLeg: active() ?? null,
    results,
    gasUnknown,
    closedAt,
  };
}

export type Ledger = ReturnType<typeof replay>;
