import {
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  type Abi,
  type ContractFunctionArgs,
  type ContractFunctionName,
  type ContractFunctionReturnType,
} from "viem";
import { priceText, quantity, type Snapshot } from "@/domain/model";
import { D } from "@/domain/values";
import { ProviderError, ZERO, type BaseReader } from "./base-rpc";
import {
  BASE_PAIR,
  CBBTC,
  FACTORY,
  MANAGER,
  WETH,
  factoryAbi,
  managerAbi,
  poolAbi,
} from "./pancake-contracts";

type Pair = [bigint, bigint];
type BlockReader = ReturnType<typeof atBlock>;
const Q96 = 1n << 96n;
const Q128 = 1n << 128n;
const UINT256 = 1n << 256n;
const MAX128 = Q128 - 1n;
const MIN_TICK = -887272;
const MAX_TICK = 887272;

// Q128.128 constants for sqrt(1.0001)^(-2^i), from the v3 TickMath specification.
const POWERS = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

export function tickSqrt(tick: number) {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK)
    throw new ProviderError("INVALID");
  const magnitude = Math.abs(tick);
  let ratio = Q128;
  for (let bit = 0; bit < POWERS.length; bit++) {
    if (magnitude & (1 << bit)) ratio = (ratio * POWERS[bit]) >> 128n;
  }
  if (tick > 0) ratio = (UINT256 - 1n) / ratio;
  return (ratio + (1n << 32n) - 1n) >> 32n;
}

export function atBlock(rpc: BaseReader, block: bigint) {
  return async <
    const A extends Abi,
    N extends ContractFunctionName<A, "pure" | "view">,
  >(
    to: string,
    abi: A,
    functionName: N,
    ...args: ContractFunctionArgs<A, "pure" | "view", N> & readonly unknown[]
  ) => {
    try {
      const data = await rpc.call(
        to,
        encodeFunctionData<Abi, string>({ abi, functionName, args }),
        block,
      );
      return decodeFunctionResult<Abi, string>({
        abi,
        functionName,
        data,
        args,
      }) as ContractFunctionReturnType<A, "pure" | "view", N>;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError("INVALID");
    }
  };
}

export async function optionalRead<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (!(error instanceof ProviderError) || error.kind === "RATE_LIMIT")
      throw error;
    return null;
  }
}

export function pairOrder(token0: string, token1: string) {
  if (token0 === WETH && token1 === CBBTC) return true;
  if (token0 === CBBTC && token1 === WETH) return false;
  return null;
}

export function baseOrder<T>(pair: [T, T], ordered: boolean): [T, T] {
  return ordered ? pair : [pair[1], pair[0]];
}

export function baseAmounts(pair: Pair, ordered: boolean): [string, string] {
  const [a, b] = baseOrder(pair, ordered);
  return [
    formatUnits(a, BASE_PAIR[0].decimals),
    formatUnits(b, BASE_PAIR[1].decimals),
  ];
}

export async function factoryPool(
  read: BlockReader,
  token0: `0x${string}`,
  token1: `0x${string}`,
  fee: number,
) {
  return (
    await read(FACTORY, factoryAbi, "getPool", token0, token1, fee)
  ).toLowerCase();
}

export async function poolIdentity(read: BlockReader, pool: string) {
  const [a, b, fee] = await Promise.all([
    read(pool, poolAbi, "token0"),
    read(pool, poolAbi, "token1"),
    read(pool, poolAbi, "fee"),
  ]);
  const ordered = pairOrder(a.toLowerCase(), b.toLowerCase());
  if (ordered === null || (await factoryPool(read, a, b, fee)) !== pool)
    return null;
  return { ordered, fee, token0: a.toLowerCase(), token1: b.toLowerCase() };
}

export async function readPosition(read: BlockReader, tokenId: bigint) {
  const [
    ,
    ,
    token0,
    token1,
    fee,
    lower,
    upper,
    liquidity,
    growth0,
    growth1,
    owed0,
    owed1,
  ] = await read(MANAGER, managerAbi, "positions", tokenId);
  const ordered = pairOrder(token0.toLowerCase(), token1.toLowerCase());
  if (
    ordered === null ||
    lower >= upper ||
    lower < MIN_TICK ||
    upper > MAX_TICK
  )
    return null;
  const pool = await factoryPool(read, token0, token1, fee);
  if (pool === ZERO) return null;
  return {
    pool,
    ordered,
    fee,
    lower,
    upper,
    liquidity,
    growth: [growth0, growth1] as Pair,
    owed: [owed0, owed1] as Pair,
  };
}

export type Position = NonNullable<Awaited<ReturnType<typeof readPosition>>>;

export function liquidityAmounts(
  spot: bigint,
  lower: bigint,
  upper: bigint,
  liquidity: bigint,
): Pair {
  if (lower <= 0n || upper <= lower || spot <= 0n || liquidity < 0n)
    throw new ProviderError("INVALID");
  const mid = spot < lower ? lower : spot > upper ? upper : spot;
  return [
    ((liquidity << 96n) * (upper - mid)) / (upper * mid),
    (liquidity * (mid - lower)) / Q96,
  ];
}

export function unrealizedFee(
  global: bigint,
  lowerOutside: bigint,
  upperOutside: bigint,
  last: bigint,
  liquidity: bigint,
  tick: number,
  lower: number,
  upper: number,
) {
  const wrap = (n: bigint) => BigInt.asUintN(256, n);
  const below = tick >= lower ? lowerOutside : wrap(global - lowerOutside);
  const above = tick < upper ? upperOutside : wrap(global - upperOutside);
  return (wrap(global - below - above - last) * liquidity) >> 128n;
}

function priceRatio(sqrt: bigint, ordered: boolean) {
  const scale = new D(10).pow(BASE_PAIR[0].decimals - BASE_PAIR[1].decimals);
  const raw = new D(sqrt.toString()).div(Q96.toString()).pow(2);
  const ratio = scale
    .times(ordered ? raw : new D(1).div(raw))
    .toDecimalPlaces(36);
  return ratio.gt(0) && priceText.safeParse(ratio.toFixed()).success
    ? ratio.toFixed()
    : undefined;
}

export function priceBounds(position: Position) {
  const lower = priceRatio(tickSqrt(position.lower), position.ordered);
  const upper = priceRatio(tickSqrt(position.upper), position.ordered);
  return lower && upper
    ? position.ordered
      ? { lower, upper }
      : { lower: upper, upper: lower }
    : {};
}

export async function positionSnapshot(
  read: BlockReader,
  position: Position,
  block: bigint,
  noOwedPrincipal: [boolean, boolean],
): Promise<Snapshot> {
  const source = `Base v3 state at block ${block}`;
  const { pool, ordered, liquidity, lower, upper, owed, growth } = position;
  const liquidityText = quantity.safeParse(liquidity.toString()).data;
  if (!liquidity) {
    const pending = baseAmounts(owed, ordered);
    return {
      source,
      range: "OUT_OF_RANGE",
      principal: ["0", "0"],
      unclaimed: baseOrder(
        [
          noOwedPrincipal[0] || owed[0] === 0n,
          noOwedPrincipal[1] || owed[1] === 0n,
        ],
        ordered,
      ).map((known, i) => (known ? pending[i] : null)) as Snapshot["unclaimed"],
      liquidity: liquidityText,
    };
  }
  const [sqrt, tick] = await read(pool, poolAbi, "slot0");
  if (
    tick < MIN_TICK ||
    tick > MAX_TICK ||
    sqrt < tickSqrt(MIN_TICK) ||
    sqrt > tickSqrt(MAX_TICK)
  )
    throw new ProviderError("INVALID");
  const principal = baseAmounts(
    liquidityAmounts(sqrt, tickSqrt(lower), tickSqrt(upper), liquidity),
    ordered,
  );
  const pending: Snapshot["unclaimed"] = [null, null];
  if (noOwedPrincipal[0] || noOwedPrincipal[1]) {
    const [a, b, global0, global1] = await Promise.all([
      read(pool, poolAbi, "ticks", lower),
      read(pool, poolAbi, "ticks", upper),
      read(pool, poolAbi, "feeGrowthGlobal0X128"),
      read(pool, poolAbi, "feeGrowthGlobal1X128"),
    ]);
    if (!a[7] || !b[7]) throw new ProviderError("INVALID");
    const rawFees: Pair = [
      owed[0] +
        unrealizedFee(
          global0,
          a[2],
          b[2],
          growth[0],
          liquidity,
          tick,
          lower,
          upper,
        ),
      owed[1] +
        unrealizedFee(
          global1,
          a[3],
          b[3],
          growth[1],
          liquidity,
          tick,
          lower,
          upper,
        ),
    ];
    const fees = baseAmounts(rawFees, ordered);
    const known = baseOrder(
      [
        noOwedPrincipal[0] && rawFees[0] <= MAX128,
        noOwedPrincipal[1] && rawFees[1] <= MAX128,
      ],
      ordered,
    );
    for (const i of [0, 1] as const)
      if (known[i] && quantity.safeParse(fees[i]).success) pending[i] = fees[i];
  }
  return {
    source,
    range: tick >= lower && tick < upper ? "IN_RANGE" : "OUT_OF_RANGE",
    principal,
    unclaimed: pending,
    ratio: priceRatio(sqrt, ordered),
    liquidity: liquidityText,
  };
}
