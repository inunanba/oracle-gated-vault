/**
 * Oracle and vault parameters per network. Prices use 8 decimals ($1.00 = 100_000_000).
 * Override any value with the matching env var (see packages/hardhat/.env.example).
 */

/** Pyth price feeds contract; same address on Hedera testnet (0.0.3042133) and mainnet (0.0.4622850). */
export const PYTH_HEDERA_ADDRESS = "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729";

/** Pyth HBAR/USD feed id. Browse others at https://www.pyth.network/developers/price-feed-ids */
export const PYTH_HBAR_USD_FEED_ID = "0x3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd";

export const PRICE_DECIMALS = 8;

export type VaultParams = {
  minPrice: bigint;
  maxPrice: bigint;
  /** Seconds a stored oracle price stays valid for the gate. */
  maxStaleness: number;
};

/** Hedera networks: real Pyth feed, wide HBAR/USD band, price must be posted in the same minute. */
export const HEDERA_VAULT_DEFAULTS: VaultParams = {
  minPrice: 1_000_000n, // $0.01
  maxPrice: 100_000_000n, // $1.00
  maxStaleness: 60,
};

/** Local chain: MockPriceOracle at $1.00 with a ±20% band. */
export const LOCAL_VAULT_DEFAULTS: VaultParams = {
  minPrice: 80_000_000n,
  maxPrice: 120_000_000n,
  maxStaleness: 3600,
};

/** Reject Pyth prices whose confidence interval exceeds this share of the price (basis points). */
export const DEFAULT_MAX_CONFIDENCE_BPS = 200;

export const HEDERA_CHAIN_IDS = new Set([295, 296]);

export function vaultParamsFromEnv(defaults: VaultParams): VaultParams {
  return {
    minPrice: process.env.VAULT_MIN_PRICE ? BigInt(process.env.VAULT_MIN_PRICE) : defaults.minPrice,
    maxPrice: process.env.VAULT_MAX_PRICE ? BigInt(process.env.VAULT_MAX_PRICE) : defaults.maxPrice,
    maxStaleness: process.env.VAULT_MAX_STALENESS ? Number(process.env.VAULT_MAX_STALENESS) : defaults.maxStaleness,
  };
}
