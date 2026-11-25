export const baseAddressUrl = (address: string) =>
  `https://basescan.org/address/${encodeURIComponent(address)}`;
export const baseTransactionUrl = (hash: string) =>
  `https://basescan.org/tx/${encodeURIComponent(hash)}`;
