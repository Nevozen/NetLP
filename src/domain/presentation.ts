import type { EventKind } from "./model";

export const eventNames: Record<EventKind, string> = {
  OPENING_ALLOCATION: "Opening allocation",
  SWAP: "Swap",
  ADD_LIQUIDITY: "Add liquidity",
  REMOVE_LIQUIDITY: "Remove liquidity",
  COLLECT_FEES: "Collect fees",
  APPROVAL: "Approval",
  GAS_ONLY: "Network expense",
  OTHER_EXPENSE: "Other expense",
  WRAP_UNWRAP: "Wrap / unwrap",
  POSITION_SNAPSHOT: "Position snapshot",
  CLOSE_STRATEGY: "Close strategy",
};

export const positionsStates = {
  IN_RANGE: "In range",
  OUT_OF_RANGE: "Out of range",
  UNKNOWN: "Range unknown",
};
