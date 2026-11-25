import { decodeEventLog, decodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import { address, knownPair, priceText, snapshotSchema } from "@/domain/model";
import type { Prisma } from "@/generated/prisma/client";
import {
  decodeTransfers,
  type VerifiedActivity,
  type WalletTransfer,
} from "./activity";
import {
  ProviderError,
  ZERO,
  type BaseReader,
  type ChainLog,
} from "./base-rpc";
import {
  approveAbi,
  CBBTC,
  MANAGER,
  managerAbi,
  poolAbi,
  ROUTERS,
  WETH,
} from "./pancake-contracts";
import {
  atBlock,
  baseAmounts,
  optionalRead,
  poolIdentity,
  positionSnapshot,
  priceBounds,
  readPosition,
} from "./position";
import type { Classify } from "./wallet-sync";

const movementPair = knownPair;
const action = { index: z.number().int().nonnegative() };
const lpFields = {
  ...action,
  tokenId: z.string().regex(/^\d{1,78}$/),
  pool: address,
  fee: z.number().int().nonnegative(),
  lower: priceText.optional(),
  upper: priceText.optional(),
  snapshot: snapshotSchema.optional(),
};
const draftAction = z.discriminatedUnion("kind", [
  z.object({
    ...action,
    kind: z.literal("SWAP"),
    paid: movementPair,
    received: movementPair,
    pool: address,
  }),
  z.object({
    ...lpFields,
    kind: z.literal("ADD"),
    amounts: movementPair,
    mint: z.boolean(),
  }),
  z.object({
    ...lpFields,
    kind: z.literal("COLLECTION"),
    receipt: movementPair,
    principal: movementPair.nullable(),
    minimumPrincipal: movementPair,
  }),
  z.object({ ...action, kind: z.enum(["APPROVAL", "GAS_ONLY"]) }),
]);
export const pancakeDraftSchema = z.object({
  version: z.literal(1),
  actions: z.array(draftAction).max(12),
  warning: z.string().max(250).optional(),
});
export type PancakeAction = z.infer<typeof draftAction>;
export type PancakeDraft = z.infer<typeof pancakeDraftSchema>;
type RawPair = [bigint, bigint];
const ZEROS: RawPair = [0n, 0n];
const equal = (a: RawPair, b: RawPair) => a[0] === b[0] && a[1] === b[1];
const some = (a: RawPair) => a[0] > 0n || a[1] > 0n;
const at = (log: ChainLog) => ({
  topics: log.topics as [Hex, ...Hex[]],
  data: log.data,
});
const forPair = (t: WalletTransfer) =>
  t.standard === "ERC-20" && (t.contract === WETH || t.contract === CBBTC);
const involves = (t: WalletTransfer, wallet: string) =>
  t.from === wallet || t.to === wallet;
const flows = (
  ts: WalletTransfer[],
  from: string,
  to: string,
  tokens: [string, string],
): RawPair =>
  tokens.map((token) =>
    ts.reduce(
      (total, t) =>
        t.contract === token && t.from === from && t.to === to
          ? total + BigInt(t.units)
          : total,
      0n,
    ),
  ) as RawPair;
const between = (ts: WalletTransfer[], lower: number, upper: number) =>
  ts.filter((t) => t.logIndex > lower && t.logIndex < upper);

function managerEvents(logs: ChainLog[]) {
  return logs.flatMap((log) => {
    if (log.address !== MANAGER || log.topics.length !== 2) return [];
    try {
      const decoded = decodeEventLog({ abi: managerAbi, ...at(log) });
      return [{ ...decoded, index: log.logIndex }];
    } catch {
      return [];
    }
  });
}

function poolEvents(logs: ChainLog[]) {
  return logs.flatMap((log) => {
    try {
      const decoded = decodeEventLog({ abi: poolAbi, ...at(log) });
      return [{ ...decoded, index: log.logIndex, address: log.address }];
    } catch {
      return [];
    }
  });
}

const warning = (message: string) =>
  ({ version: 1, actions: [], warning: message }) satisfies PancakeDraft;

async function swaps(
  rpc: BaseReader,
  tx: VerifiedActivity,
  transfers: WalletTransfer[],
) {
  const logs = poolEvents(tx.receipt.logs).filter(
    (event) => event.eventName === "Swap",
  );
  if (
    !logs.length ||
    logs.length > 12 ||
    transfers.some((t) => !forPair(t) && involves(t, tx.wallet))
  )
    return warning(
      "The router path is not a supported direct PancakeSwap v3 WETH/cbBTC swap.",
    );
  const poolReads = new Map<
    string,
    Promise<Awaited<ReturnType<typeof poolIdentity>> | null>
  >();
  const pairTransfers = transfers.filter(forPair);
  const actions: PancakeAction[] = [];
  for (const [i, event] of logs.entries()) {
    const router = tx.tx.to!;
    const read = atBlock(rpc, tx.block.number);
    const lookup =
      poolReads.get(event.address) ??
      optionalRead(() => poolIdentity(read, event.address));
    poolReads.set(event.address, lookup);
    const identity = await lookup;
    const recipient = event.args.recipient.toLowerCase();
    if (
      !identity ||
      event.args.sender.toLowerCase() !== router ||
      (recipient !== tx.wallet && recipient !== router)
    )
      return warning(
        "The pool, route, or swap recipient could not be verified.",
      );
    const amounts: RawPair = [event.args.amount0, event.args.amount1];
    if (!(
      (amounts[0] > 0n && amounts[1] < 0n) ||
      (amounts[0] < 0n && amounts[1] > 0n)
    ))
      return warning(
        "The swap does not settle as two opposite token movements.",
      );
    const paid = amounts.map((v) => (v > 0n ? v : 0n)) as RawPair;
    const received = amounts.map((v) => (v < 0n ? -v : 0n)) as RawPair;
    const input = paid[0] ? identity.token0 : identity.token1;
    const output = received[0] ? identity.token0 : identity.token1;
    const tokens: [string, string] = [identity.token0, identity.token1];
    const segment = between(
      pairTransfers,
      logs[i - 1]?.index ?? -1,
      i + 1 === logs.length ? Infinity : event.index,
    );
    const directIn = equal(
      flows(segment, tx.wallet, event.address, tokens),
      paid,
    );
    const stagedIn =
      !directIn &&
      equal(flows(segment, tx.wallet, router, tokens), paid) &&
      equal(flows(segment, router, event.address, tokens), paid);
    const rawOut = equal(
      flows(segment, event.address, recipient, tokens),
      received,
    );
    const settledOut =
      recipient === tx.wallet ||
      equal(flows(segment, router, tx.wallet, tokens), received);
    const expected = (t: WalletTransfer) =>
      (t.contract === input &&
        ((directIn && t.from === tx.wallet && t.to === event.address) ||
          (stagedIn &&
            ((t.from === tx.wallet && t.to === router) ||
              (t.from === router && t.to === event.address))))) ||
      (t.contract === output &&
        ((t.from === event.address && t.to === recipient) ||
          (recipient === router && t.from === router && t.to === tx.wallet)));
    if (
      (!directIn && !stagedIn) ||
      !rawOut ||
      !settledOut ||
      segment.some((t) => !expected(t))
    )
      return warning(
        "The swap amounts do not reconcile to actual wallet transfers.",
      );
    actions.push({
      index: event.index,
      kind: "SWAP",
      pool: event.address,
      paid: baseAmounts(paid, identity.ordered),
      received: baseAmounts(received, identity.ordered),
    });
  }
  return { version: 1, actions } satisfies PancakeDraft;
}

function logTouchesPosition(log: ChainLog, tokenId: bigint) {
  if (log.address !== MANAGER) return false;
  const [event] = managerEvents([log]);
  return (
    event?.args.tokenId === tokenId ||
    decodeTransfers([log]).some(
      (t) => t.standard === "ERC-721" && t.tokenId === tokenId.toString(),
    )
  );
}

async function liquidity(
  rpc: BaseReader,
  tx: VerifiedActivity,
  transfers: WalletTransfer[],
) {
  const events = managerEvents(tx.receipt.logs);
  const nft = transfers.filter(
    (t) => t.contract === MANAGER && t.standard === "ERC-721",
  );
  const ids = [...new Set(events.map((e) => e.args.tokenId))];
  if (!ids.length)
    return warning(
      "This position-manager call has no supported deposited or collected amounts.",
    );
  if (
    ids.length > 4 ||
    events.length > 8 ||
    transfers.some(
      (t) =>
        involves(t, tx.wallet) &&
        !forPair(t) &&
        !(t.contract === MANAGER && t.standard === "ERC-721"),
    )
  )
    return warning("This position-manager batch is too complex to reconcile.");
  const poolLogs = poolEvents(tx.receipt.logs);
  const read = atBlock(rpc, tx.block.number);
  const previous = atBlock(rpc, tx.block.number - 1n);
  const readOwner = async (reader: typeof read, id: bigint) =>
    (await reader(MANAGER, managerAbi, "ownerOf", id)).toLowerCase();
  const pairTransfers = transfers.filter(
    (t) => forPair(t) && involves(t, tx.wallet),
  );
  const accounted = new Set<number>();
  const actions: PancakeAction[] = [];
  for (const id of ids) {
    const relevant = events.filter((e) => e.args.tokenId === id);
    const mint = nft.some(
      (t) =>
        t.tokenId === id.toString() && t.from === ZERO && t.to === tx.wallet,
    );
    const burn = nft.some(
      (t) =>
        t.tokenId === id.toString() && t.from === tx.wallet && t.to === ZERO,
    );
    if (
      (mint && burn) ||
      nft.some(
        (t) => t.tokenId === id.toString() && t.from !== ZERO && t.to !== ZERO,
      )
    )
      return warning("NFT ownership changed during the transaction.");
    const add = relevant.find((e) => e.eventName === "IncreaseLiquidity");
    const decrease = relevant.find((e) => e.eventName === "DecreaseLiquidity");
    const collect = relevant.find((e) => e.eventName === "Collect");
    if (decrease && !collect)
      return warning(
        "Liquidity decreased, but no tokens reached the wallet in this transaction.",
      );
    if (
      (add && relevant.length !== 1) ||
      (!add && (!collect || relevant.length !== (decrease ? 2 : 1))) ||
      (decrease && collect && collect.index < decrease.index)
    )
      return warning(
        "Multiple operations on the same position could not be separated.",
      );
    const position = await optionalRead(() =>
      readPosition(burn ? previous : read, id),
    );
    const owner = await optionalRead(() =>
      readOwner(burn ? previous : read, id),
    );
    if (!position || owner !== tx.wallet)
      return warning(
        "The Base PancakeSwap v3 NFT and wallet ownership could not be verified at the transaction block.",
      );
    const { pool, ordered } = position;
    const tokens: [string, string] = ordered ? [WETH, CBBTC] : [CBBTC, WETH];
    const blockLogs = await optionalRead(() =>
      rpc.blockLogs(tx.block.hash, [pool, MANAGER]),
    );
    const validLogs =
      blockLogs &&
      blockLogs.every(
        (log) => log.blockHash === tx.block.hash && !log.removed,
      ) &&
      blockLogs.some(
        (log) =>
          log.transactionHash === tx.tx.hash &&
          log.logIndex === relevant.at(-1)!.index,
      )
        ? blockLogs
        : null;
    const earlier = validLogs?.some(
      (log) =>
        log.transactionIndex < tx.receipt.transactionIndex &&
        logTouchesPosition(log, id),
    );
    const later = validLogs?.some(
      (log) =>
        log.transactionIndex > tx.receipt.transactionIndex &&
        (log.address === pool || logTouchesPosition(log, id)),
    );
    if (burn && (!validLogs || earlier))
      return warning("Ownership before the NFT burn could not be verified.");
    if (
      !mint &&
      later &&
      validLogs?.some(
        (log) =>
          log.transactionIndex > tx.receipt.transactionIndex &&
          logTouchesPosition(log, id),
      )
    )
      return warning("The position changed again later in the same block.");
    const prior =
      !mint && validLogs && !earlier
        ? burn
          ? position
          : await optionalRead(() => readPosition(previous, id))
        : null;
    const noPriorPrincipal: [boolean, boolean] = [
      mint || prior?.owed[0] === 0n,
      mint || prior?.owed[1] === 0n,
    ];
    const anchor = (add ?? collect!).index;
    const start = events.filter((e) => e.index < anchor).at(-1)?.index ?? -1;
    const ownTransfers = between(pairTransfers, start, anchor);
    const common = {
      index: anchor,
      tokenId: id.toString(),
      pool,
      fee: position.fee,
      ...priceBounds(position),
    };
    const lastInPool = !poolLogs.some(
      (log) => log.address === pool && log.index > anchor,
    );
    let noPrincipal = noPriorPrincipal;
    let draft: PancakeAction;
    if (add) {
      const amounts: RawPair = [add.args.amount0, add.args.amount1];
      const core = poolLogs.filter(
        (e) =>
          e.eventName === "Mint" &&
          e.address === pool &&
          e.index > start &&
          e.index < anchor &&
          e.args.owner.toLowerCase() === MANAGER &&
          e.args.tickLower === position.lower &&
          e.args.tickUpper === position.upper,
      );
      // Match the actual pair debits and the position manager's mint to the verified pool.
      if (
        core.length !== 1 ||
        core[0].eventName !== "Mint" ||
        core[0].args.amount !== add.args.liquidity ||
        !equal([core[0].args.amount0, core[0].args.amount1], amounts) ||
        !some(amounts) ||
        !equal(flows(ownTransfers, tx.wallet, pool, tokens), amounts) ||
        ownTransfers.some((t) => t.from !== tx.wallet || t.to !== pool)
      )
        return warning(
          "The liquidity deposit does not reconcile to actual pair debits.",
        );
      draft = {
        ...common,
        kind: "ADD",
        mint,
        amounts: baseAmounts(amounts, ordered),
      };
    } else {
      const e = collect!;
      const actual = flows(ownTransfers, pool, tx.wallet, tokens);
      const principal: RawPair = decrease
        ? [decrease.args.amount0, decrease.args.amount1]
        : ZEROS;
      const core = poolLogs.filter(
        (log) =>
          log.eventName === "Collect" &&
          log.address === pool &&
          log.index > start &&
          log.index < anchor &&
          log.args.owner.toLowerCase() === MANAGER &&
          log.args.recipient.toLowerCase() === tx.wallet &&
          log.args.tickLower === position.lower &&
          log.args.tickUpper === position.upper,
      );
      if (
        e.args.recipient.toLowerCase() !== tx.wallet ||
        core.length !== 1 ||
        core[0].eventName !== "Collect" ||
        !equal(actual, [core[0].args.amount0, core[0].args.amount1]) ||
        !some(actual) ||
        ownTransfers.some((t) => t.from !== pool || t.to !== tx.wallet)
      )
        return warning(
          "The collection did not reconcile to transfers from the verified pool to this wallet.",
        );
      if (actual[0] < principal[0] || actual[1] < principal[1])
        return warning(
          "The wallet did not receive enough tokens to settle this transaction's withdrawn principal.",
        );
      const splitKnown =
        noPriorPrincipal.every(Boolean) &&
        (!some(principal) ||
          (equal(actual, [e.args.amount0, e.args.amount1]) &&
            (burn ||
              !!(validLogs && !later && lastInPool && !some(position.owed)))));
      noPrincipal = some(principal)
        ? [splitKnown, splitKnown]
        : noPriorPrincipal;
      draft = {
        ...common,
        kind: "COLLECTION",
        receipt: baseAmounts(actual, ordered),
        principal: splitKnown ? baseAmounts(principal, ordered) : null,
        minimumPrincipal: baseAmounts(principal, ordered),
      };
    }
    for (const t of ownTransfers) accounted.add(t.logIndex);
    if (burn) {
      draft.snapshot = {
        source: `Verified PancakeSwap v3 NFT burn in block ${tx.block.number}`,
        principal: ["0", "0"],
        unclaimed: ["0", "0"],
        range: "OUT_OF_RANGE",
        liquidity: "0",
      };
    } else if (validLogs && !later && lastInPool) {
      const state = await optionalRead(() =>
        positionSnapshot(read, position, tx.block.number, [
          noPrincipal[0] || position.owed[0] === 0n,
          noPrincipal[1] || position.owed[1] === 0n,
        ]),
      );
      if (state) draft.snapshot = state;
    }
    actions.push(draft);
  }
  if (
    nft.some((t) => !ids.some((id) => id.toString() === t.tokenId)) ||
    pairTransfers.some((t) => !accounted.has(t.logIndex))
  )
    return warning(
      "Additional wallet movements in this receipt could not be attributed to the positions.",
    );
  return {
    version: 1,
    actions: actions.sort((a, b) => a.index - b.index),
  } satisfies PancakeDraft;
}

function isApproval(tx: VerifiedActivity) {
  if ((tx.tx.to !== WETH && tx.tx.to !== CBBTC) || tx.tx.value !== 0n)
    return false;
  try {
    const {
      args: [spender],
    } = decodeFunctionData({ abi: approveAbi, data: tx.tx.input });
    return (
      spender.toLowerCase() === MANAGER || ROUTERS.has(spender.toLowerCase())
    );
  } catch {
    return false;
  }
}

export const classifyPancake: Classify = async (rpc, tx) => {
  const lp = tx.tx.to === MANAGER;
  const router = !!tx.tx.to && ROUTERS.has(tx.tx.to);
  const approval = isApproval(tx);
  if (
    (!lp && !router && !approval) ||
    tx.tx.from !== tx.wallet ||
    tx.tx.type > 4n
  )
    return { status: "ACTIVITY_ONLY" };
  let candidate: PancakeDraft;
  if (tx.evidence.result === "reverted" || approval) {
    candidate = {
      version: 1,
      actions: [
        {
          index: 0,
          kind: tx.evidence.result === "reverted" ? "GAS_ONLY" : "APPROVAL",
        },
      ],
    };
  } else if (tx.tx.value !== 0n || tx.evidence.omittedTransfers) {
    candidate = warning(
      "Native ETH settlement or an oversized receipt needs manual reconciliation.",
    );
  } else {
    const transfers = decodeTransfers(tx.receipt.logs);
    candidate = lp
      ? await liquidity(rpc, tx, transfers)
      : await swaps(rpc, tx, transfers);
    if ((await rpc.block(tx.block.number)).hash !== tx.block.hash)
      throw new ProviderError("INVALID");
  }
  const draft = pancakeDraftSchema.safeParse(candidate);
  if (!draft.success)
    candidate = warning(
      "The decoded amounts are outside the supported journal limits.",
    );
  const missing =
    !tx.evidence.fees.total ||
    tx.evidence.fees.total === "0" ||
    candidate.actions.some(
      (op) =>
        (op.kind === "COLLECTION" && !op.principal) ||
        ("snapshot" in op &&
          (!op.snapshot ||
            [...op.snapshot.principal, ...op.snapshot.unclaimed].includes(
              null,
            ))) ||
        ((op.kind === "ADD" || op.kind === "COLLECTION") && !op.snapshot),
    );
  return {
    status: candidate.actions.length && !missing ? "READY" : "NEEDS_REVIEW",
    draft: JSON.parse(JSON.stringify(candidate)) as Prisma.InputJsonObject,
  };
};
