# Oracle adapters (Supra / Pyth) — load-bearing integration

## Why this is load-bearing (ecosystem rubric)

`OracleGatedVault.requirePriceInBand()` **always** reads `IPriceOracle.latestPrice()`. If the oracle is removed or returns garbage outside the band / past `maxStaleness`, `deposit` and `withdraw` revert. The template’s product story is “price-band gated vault,” so the oracle adapter is not optional glue — it is the gate.

| Mode | Contract | Keys / faucet | When to use |
|------|----------|---------------|-------------|
| Local / CI | `MockPriceOracle` | None | Default DX, unit tests, `npm run hardhat:test` |
| Testnet read-only | Adapter implementing `IPriceOracle` | RPC only | When a Hedera testnet feed exists |
| Forked mainnet | Adapter + Hardhat fork | Optional mainnet RPC | When only mainnet feeds exist (allowed by bounty brief) |

## Interface

```solidity
interface IPriceOracle {
    function latestPrice() external view returns (uint256 price, uint256 updatedAt);
    function decimals() external view returns (uint8);
}
```

Canonical scale in this template: **8 decimals** (Pyth-style). Vault band defaults: min `80e6`, max `120e6`, staleness `3600` seconds (see `deploy/03_deploy_oracle_gated_vault.ts`).

## Local (default)

1. Deploy script tags `OracleGatedVault` deploy `MockPriceOracle` then the vault.
2. Owner calls `MockPriceOracle.setPrice(uint256)` to move the band for demos.
3. Frontend `/vault` shows `NEXT_PUBLIC_ORACLE_MODE` (default `mock`).

No API keys, no Portal faucet, no wallet required for compile/test/build.

## Wiring a live Supra adapter (sketch)

1. Confirm Supra pull / on-chain consumer address for Hedera (testnet or mainnet).
2. Implement `contracts/oracle/SupraPriceOracle.sol` that:
   - Calls Supra’s verified price API / precompile surface for the chosen feed id
   - Maps raw price + timestamp into `latestPrice()` with 8 decimals
3. Deploy adapter; call `vault.setOracle(adapter)`.
4. Set `NEXT_PUBLIC_ORACLE_MODE=read-only-live` and `NEXT_PUBLIC_PRICE_FEED_ID=<id>`.
5. Keep `MockPriceOracle` path for CI — never delete the mock.

Official Supra docs: https://docs.supra.com/ (verify Hedera deployment status before coding).

## Wiring a live Pyth adapter (sketch)

1. Confirm Pyth price-feed contract / Hermes endpoint usable from Hedera JSON-RPC.
2. Implement `contracts/oracle/PythPriceOracle.sol` wrapping `getPriceUnsafe` / `getPriceNoOlderThan` for a feed id.
3. Same `setOracle` + env vars as above.
4. If only Ethereum mainnet feeds exist: document Hardhat `fork` of that chain in README; CI stays on mock.

Official Pyth docs: https://docs.pyth.network/

## Staleness and band policy

- `maxStaleness`: reject if `block.timestamp - updatedAt > maxStaleness` (see `StalePrice`).
- Band: reject if `price < minPrice || price > maxPrice` (see `PriceOutOfBand`).
- Owner can retune via `setBand(min, max, maxStaleness)` without redeploying the vault.

## OWNER eligibility tx

See [`TESTNET_VERIFICATION.md`](./TESTNET_VERIFICATION.md). Portal faucet → `hardhat:deploy --network hederaTestnet --tags OracleGatedVault` → real Hashscan URL. Never invent links.

## Non-goals

- This template does not ship a production risk engine, liquidation bot, or yield strategy.
- Live adapter bytecode is intentionally thin stubs + docs so consumers can swap feeds without forking vault logic.
