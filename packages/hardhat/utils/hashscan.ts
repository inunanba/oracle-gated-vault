/** HashScan link builders for Hedera chain ids 295 (mainnet) and 296 (testnet). */
function network(chainId: number): string {
  if (chainId === 295) return "mainnet";
  if (chainId === 296) return "testnet";
  throw new Error(`Chain ${chainId} is not a Hedera network`);
}

export const hashscanContractUrl = (chainId: number, address: string) =>
  `https://hashscan.io/${network(chainId)}/contract/${address}`;

export const hashscanTxUrl = (chainId: number, hash: string) =>
  `https://hashscan.io/${network(chainId)}/transaction/${hash}`;
