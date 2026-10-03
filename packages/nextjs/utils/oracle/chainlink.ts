/** Chainlink HBAR/USD Data Feeds on Hedera (8 decimals). Must match the feed the vault's oracle adapter wraps. */
export const CHAINLINK_HBAR_USD: Record<number, `0x${string}`> = {
  296: "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a",
  295: "0xAF685FB45C12b92b5054ccb9313e135525F9b5d5",
};

/** Vault and oracle prices use 8 decimals. */
export const PRICE_DECIMALS = 8;

export const aggregatorV3Abi = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint8" }] },
] as const;
