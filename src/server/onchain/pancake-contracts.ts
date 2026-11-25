import { parseAbi } from "viem";
import { presets } from "@/domain/catalog";

// Base deployments in the official PancakeSwap v3 and Universal Router address tables.
export const MANAGER = "0x46a15b0b27311cedf172ab29e4f4766fbe7f4364";
export const FACTORY = "0x0bfbcf9fa4f9c56b0f40a671ad40e0805a091865";
export const ROUTERS = new Set([
  "0x1b81d678ffb9c0263b24a97847620c99d213eb14",
  "0xfe6508f0015c778bdcc1fb5465ba5ebe224c9912",
]);
export const BASE_PAIR = presets.base.pair;
export const [WETH, CBBTC] = BASE_PAIR.map(
  (token) => token.id.split(":")[1],
) as [`0x${string}`, `0x${string}`];
export const factoryAbi = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
]);
export const managerAbi = parseAbi([
  "function positions(uint256) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)",
  "function ownerOf(uint256) view returns (address)",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "event DecreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "event Collect(uint256 indexed tokenId, address recipient, uint256 amount0, uint256 amount1)",
]);
export const poolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function slot0() view returns (uint160, int24, uint16, uint16, uint16, uint32, bool)",
  "function ticks(int24) view returns (uint128, int128, uint256, uint256, int56, uint160, uint32, bool)",
  "function positions(bytes32) view returns (uint128, uint256, uint256, uint128, uint128)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint128 protocolFeesToken0, uint128 protocolFeesToken1)",
  "event Mint(address sender, address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Burn(address indexed owner, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount, uint256 amount0, uint256 amount1)",
  "event Collect(address indexed owner, address recipient, int24 indexed tickLower, int24 indexed tickUpper, uint128 amount0, uint128 amount1)",
]);
export const approveAbi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
