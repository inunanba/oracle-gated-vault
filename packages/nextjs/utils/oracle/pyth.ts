/**
 * Browser-side helpers for Pyth's pull oracle via Hermes.
 * Hermes serves the latest signed price; the vault verifies it on-chain through Pyth.
 */
export const HERMES_URL = process.env.NEXT_PUBLIC_PYTH_HERMES_URL || "https://hermes.pyth.network";

/** Pyth HBAR/USD feed id (same on every chain). */
export const DEFAULT_FEED_ID =
  process.env.NEXT_PUBLIC_PYTH_PRICE_FEED_ID || "0x3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd";

/** Vault and oracle prices use 8 decimals. */
export const PRICE_DECIMALS = 8;

/**
 * Hedera's EVM sees msg.value in tinybars (8 decimals); wallets and JSON-RPC send weibars (18 decimals).
 * Pyth quotes its update fee in tinybars, so multiply before sending it as `value`.
 */
export const TINYBAR_TO_WEIBAR = 10_000_000_000n;

export type HermesPrice = {
  price: number;
  confidence: number;
  publishTime: number;
};

type HermesResponse = {
  binary: { data: string[] };
  parsed: { id: string; price: { price: string; conf: string; expo: number; publish_time: number } }[];
};

async function fetchLatest(feedId: string): Promise<HermesResponse> {
  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Hermes returned ${res.status}`);
  return res.json();
}

/** Latest off-chain price, for display. */
export async function fetchHermesPrice(feedId: string): Promise<HermesPrice> {
  const { parsed } = await fetchLatest(feedId);
  const p = parsed[0]?.price;
  if (!p) throw new Error("Feed not found on Hermes");
  const scale = 10 ** p.expo;
  return { price: Number(p.price) * scale, confidence: Number(p.conf) * scale, publishTime: p.publish_time };
}

/** Signed update bytes to pass to `depositWithPriceUpdate` / `withdrawWithPriceUpdate`. */
export async function fetchPriceUpdateData(feedId: string): Promise<`0x${string}`[]> {
  const { binary } = await fetchLatest(feedId);
  return binary.data.map(hex => (hex.startsWith("0x") ? hex : `0x${hex}`) as `0x${string}`);
}
