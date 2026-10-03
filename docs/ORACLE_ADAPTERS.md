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

## Chainlink (default on Hedera)

| | Hedera testnet | Hedera mainnet |
|---|---|---|
| HBAR/USD feed | `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a` | `0xAF685FB45C12b92b5054ccb9313e135525F9b5d5` |
| Decimals | 8 | 8 |

Source: [Chainlink Data Feeds on Hedera](https://docs.chain.link/data-feeds/price-feeds/addresses?network=hedera). Feeds are push-based: Chainlink nodes write a round when the price deviates past a threshold or the heartbeat expires, so reading costs only gas and needs no keys.

`ChainlinkPriceOracle(feed, decimals)` reads `latestRoundData()`, scales the answer from the feed's decimals to `decimals`, and returns the round's `updatedAt`. It reverts `NonPositivePrice` for `answer <= 0` and `IncompleteRound` when `updatedAt == 0`. Set the vault's `maxStaleness` above the feed heartbeat (default 90 000 s = 24 h + 1 h). Use plain `deposit` / `withdraw`; the `*WithPriceUpdate` variants revert for push feeds because they have no update fee.

## Pyth (opt-in pull adapter)

> Since the Pyth Core upgrade of 26 Aug 2026, Hermes requires an API key from Pyth Terminal (`Authorization: Bearer $PYTH_API_KEY`, base URL `https://pyth.dourolabs.app/hermes`). Hedera is listed among the chains not in the upgrade, and the HBAR/USD slot of the Hedera Pyth contract was last refreshed on 24 Aug 2026. Verify that a fresh Hermes update is accepted on Hedera before relying on this path; the adapter itself is covered by unit tests with Pyth's `MockPyth`.

| | Hedera testnet | Hedera mainnet |
|---|---|---|
| Pyth contract | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` ([0.0.3042133](https://hashscan.io/testnet/contract/0.0.3042133)) | same address ([0.0.4622850](https://hashscan.io/mainnet/contract/0.0.4622850)) |
| Hermes | `https://pyth.dourolabs.app/hermes` (API key) | same |
| Update fee | 1 tinybar per update | per Pyth governance |

Source: [Pyth EVM contract addresses](https://docs.pyth.network/price-feeds/core/contract-addresses/evm), [Hedera docs: Pyth](https://docs.hedera.com/evm/integrations/oracles/pyth).

`PythPriceOracle(pyth, priceId, decimals, maxConfidenceBps)`:

- `latestPrice()` reads `getPriceUnsafe(priceId)` and returns `(price scaled to decimals, publishTime)`. Staleness is deliberately left to the vault so one adapter can serve consumers with different tolerances.
- Reverts `NonPositivePrice` for `price <= 0`, `ConfidenceTooWide` when `conf / price > maxConfidenceBps / 10_000`, `ExponentOutOfRange` for exponents outside `[-18, 0]`.
- `updatePrice(update)` forwards exactly `pyth.getUpdateFee(update)` to `pyth.updatePriceFeeds`; any other `msg.value` reverts `IncorrectUpdateFee`. The vault computes the fee, forwards it, and refunds the caller's excess.

### Off-chain flow

```ts
// packages/hardhat/utils/hermes.ts (keep the API key server-side; don't ship it to the browser)
const res = await fetch(`${HERMES_URL}/v2/updates/price/latest?ids[]=${feedId}&encoding=hex`, {
  headers: { Authorization: `Bearer ${process.env.PYTH_API_KEY}` },
});
const updateData = (await res.json()).binary.data.map(h => `0x${h}`);
const fee = await vault.getUpdateFee(updateData);                 // tinybars
await vault.depositWithPriceUpdate(amount, updateData, { value: fee * 10n ** 10n }); // weibars
```

### Why not just `getPriceNoOlderThan`?

A pull feed is only as fresh as the last update someone paid for. A consumer that only reads would be closed whenever nobody else has updated recently. Carrying the update inside the user's transaction keeps the price seconds old without a keeper.

## Adding Supra

Supra's pull oracle follows the same shape: fetch a signed proof off-chain, verify it on-chain, then read. Check the [Supra docs](https://docs.supra.com/) for the current Hedera pull-oracle verifier address before coding.

1. `contracts/oracle/SupraPriceOracle.sol` implementing `IUpdatablePriceOracle`: `updatePrice` calls the Supra verifier with the proof bytes, `latestPrice` reads the verified pair and scales to 8 decimals using the pair's decimals, returning Supra's timestamp (convert ms to s if needed).
2. A test with a mock verifier, mirroring `test/PythPriceOracle.test.ts`.
3. Deploy, then `vault.setOracle(supraAdapter)`. Off-chain code fetches the Supra proof and calls `depositWithPriceUpdate`, exactly like the Pyth path in `scripts/e2eTestnet.ts`.

## When a protocol has no Hedera testnet deployment

The bounty brief allows read-only or forked-mainnet integrations. `npm run hardhat:fork` starts a Hardhat node forking Hedera (`HEDERA_RPC_URL` can point at mainnet), so an adapter can be exercised against mainnet state locally.
