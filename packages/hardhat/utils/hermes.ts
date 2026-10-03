/**
 * Minimal client for Pyth Hermes (https://hermes.pyth.network), the off-chain service that
 * serves signed price updates for Pyth's pull oracle.
 */
export const HERMES_URL = process.env.PYTH_HERMES_URL || "https://hermes.pyth.network";

type HermesLatestResponse = {
  binary: { encoding: string; data: string[] };
  parsed?: { id: string; price: { price: string; expo: number; publish_time: number } }[];
};

/** Fetches the latest signed update for `feedIds`, ready to pass to `updatePriceFeeds`. */
export async function fetchPriceUpdate(feedIds: string[]): Promise<{ updateData: string[]; publishTime?: number }> {
  const query = feedIds.map(id => `ids[]=${id}`).join("&");
  const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?${query}&encoding=hex`);
  if (!res.ok) {
    throw new Error(`Hermes request failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as HermesLatestResponse;
  return {
    updateData: body.binary.data.map(hex => (hex.startsWith("0x") ? hex : `0x${hex}`)),
    publishTime: body.parsed?.[0]?.price.publish_time,
  };
}

/**
 * Hedera's EVM sees `msg.value` in tinybars (8 decimals) while JSON-RPC transactions carry
 * weibars (18 decimals). Pyth quotes its fee in tinybars, so scale it before sending.
 */
export const TINYBAR_TO_WEIBAR = 10_000_000_000n;
