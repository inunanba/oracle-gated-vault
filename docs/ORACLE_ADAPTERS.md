# Oracle adapters

The vault depends on two small interfaces. Everything oracle-specific lives in an adapter.

```solidity
interface IPriceOracle {
    function latestPrice() external view returns (uint256 price, uint256 updatedAt); // 8 decimals
    function decimals() external view returns (uint8);
}

interface IUpdatablePriceOracle is IPriceOracle {
    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256 fee); // tinybars on Hedera
    function updatePrice(bytes[] calldata updateData) external payable;
}
```

`OracleGatedVault` enforces freshness (`maxStaleness`) and the band; adapters normalise units and reject data that is invalid at the source (negative price, wide confidence).

## Pyth (shipped)

| | Hedera testnet | Hedera mainnet |
|---|---|---|
| Pyth contract | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` ([0.0.3042133](https://hashscan.io/testnet/contract/0.0.3042133)) | same address ([0.0.4622850](https://hashscan.io/mainnet/contract/0.0.4622850)) |
| Hermes | `https://hermes.pyth.network` (stable) | same |
| Update fee | 1 tinybar per update | per Pyth governance |

Source: [Pyth EVM contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/evm), [Hedera docs: Pyth](https://docs.hedera.com/evm/integrations/oracles/pyth).

`PythPriceOracle(pyth, priceId, decimals, maxConfidenceBps)`:

- `latestPrice()` reads `getPriceUnsafe(priceId)` and returns `(price scaled to decimals, publishTime)`. Staleness is deliberately left to the vault so one adapter can serve consumers with different tolerances.
- Reverts `NonPositivePrice` for `price <= 0`, `ConfidenceTooWide` when `conf / price > maxConfidenceBps / 10_000`, `ExponentOutOfRange` for exponents outside `[-18, 0]`.
- `updatePrice(update)` forwards exactly `pyth.getUpdateFee(update)` to `pyth.updatePriceFeeds`; any other `msg.value` reverts `IncorrectUpdateFee`. The vault computes the fee, forwards it, and refunds the caller's excess.

### Off-chain flow

```ts
// browser: packages/nextjs/utils/oracle/pyth.ts — scripts: packages/hardhat/utils/hermes.ts
const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`);
const updateData = (await res.json()).binary.data.map(h => `0x${h}`);
const fee = await vault.getUpdateFee(updateData);                 // tinybars
await vault.depositWithPriceUpdate(amount, updateData, { value: fee * 10n ** 10n }); // weibars
```

### Why not just `getPriceNoOlderThan`?

On Hedera testnet the stored HBAR/USD price is usually days or weeks old because nobody pays to update it. A consumer that only reads would be closed permanently. Carrying the update inside the user's transaction keeps the price seconds old without a keeper.

## Adding Supra

Supra's pull oracle follows the same shape: fetch a signed proof off-chain, verify it on-chain, then read. Check the [Supra docs](https://docs.supra.com/) for the current Hedera pull-oracle verifier address before coding.

1. `contracts/oracle/SupraPriceOracle.sol` implementing `IUpdatablePriceOracle`: `updatePrice` calls the Supra verifier with the proof bytes, `latestPrice` reads the verified pair and scales to 8 decimals using the pair's decimals, returning Supra's timestamp (convert ms to s if needed).
2. A test with a mock verifier, mirroring `test/PythPriceOracle.test.ts`.
3. Deploy, then `vault.setOracle(supraAdapter)`. The frontend needs a Supra proof client in place of `fetchPriceUpdateData`.

## Adding Chainlink (push oracle)

Chainlink Data Feeds on Hedera are push-based, so implement only `IPriceOracle`:

```solidity
(, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
if (answer <= 0) revert NonPositivePrice(answer);
return (_scale(uint256(answer), feed.decimals()), updatedAt);
```

Call the plain `deposit` / `withdraw`; the `*WithPriceUpdate` variants are only for pull oracles. Set `maxStaleness` above the feed's heartbeat.

## When a protocol has no Hedera testnet deployment

The bounty brief allows read-only or forked-mainnet integrations. `npm run hardhat:fork` starts a Hardhat node forking Hedera (`HEDERA_RPC_URL` can point at mainnet), so an adapter can be exercised against mainnet state locally.
