# AGENTS.md

Briefing for coding agents (Cursor, Claude Code via `CLAUDE.md`, Codex) working in this repo.

## What this is

**Oracle-gated Vault**, a Scaffold-HBAR template: an ERC-20 vault on Hedera that only accepts deposits and withdrawals while an oracle price is fresh and inside an owner-set band. On Hedera the default oracle is the Chainlink HBAR/USD Data Feed (push) via `ChainlinkPriceOracle`; `PythPriceOracle` is an opt-in pull adapter whose updates travel inside the user's transaction (`*WithPriceUpdate`). Every gated `Deposited`/`Withdrawn` event is also appended to a Hedera Consensus Service (HCS) topic (audit log) by an off-chain relayer using `@hashgraph/sdk`; the UI verifies each topic entry against the selected chain, configured vault, independently resolved log emitter, and EVM event values. Verification does not prove completeness.

Stack: NPM workspaces · `packages/hardhat` (Hardhat + hardhat-deploy, Solidity 0.8.28) · `packages/nextjs` (Next.js App Router, wagmi/viem, RainbowKit, DaisyUI). There is no Foundry package.

## Invariants — do not break

1. Every state-changing user path in `OracleGatedVault` goes through `_checkedPolicy()` (the same check exposed by `requirePriceInBand()`). Do not add a deposit/withdraw path that skips it unless the user explicitly asks for an emergency exit.
2. The vault depends only on `IPriceOracle` / `IUpdatablePriceOracle`. Oracle-specific code belongs in an adapter under `contracts/oracle/`, never in the vault.
3. Prices are 8-decimal fixed point everywhere (`PRICE_DECIMALS`). Adapters normalise.
4. On Hedera, `msg.value` and Pyth fees are **tinybars**; wallets send **weibars**. Off-chain code multiplies by `TINYBAR_TO_WEIBAR` (10^10). Never send a raw fee as `value`.
5. Keep `MockPriceOracle`, `MockAggregatorV3` and `MockPyth` paths working: unit tests and the local chain must not need the network.
6. HCS audit messages follow the `ogv.audit/1` schema in `packages/hardhat/utils/hcsAudit.ts`, mirrored in `packages/nextjs/utils/hcs/audit.ts`; change both together and bump the schema string. Keep messages single-chunk (≤ 1024 bytes) and keep the relay idempotent (`txHash:logIndex`). Keep `hcsAudit.ts` free of network/SDK imports so it stays unit-testable.
7. Never commit `.env`, private keys, or invented transaction hashes/HashScan links. Only paste links produced by a real run.

## Commands

Flags for Hardhat go after `--` (npm swallows them otherwise).

```bash
npm run hardhat:compile
npm run hardhat:test                                  # offline, ~3 s
npm run lint && npm run next:check-types              # must be clean
npm run next:build
npm run test:ui-boot                                  # production routes, after build
node --test packages/nextjs/tests/hcs-verification.test.mjs

npm run hardhat:chain                                 # local node (forks Hedera testnet)
npm run hardhat:deploy -- --network localhost         # MockPriceOracle path
npm run next:dev                                      # http://localhost:3000/vault

npm run hardhat:account:generate                      # encrypted deployer key in packages/hardhat/.env
npm run hardhat:deploy -- --network hederaTestnet     # ChainlinkPriceOracle on the live HBAR/USD feed
ORACLE_PROVIDER=pyth PYTH_API_KEY=... npm run hardhat:deploy -- --network hederaTestnet   # Pyth instead
npm run hardhat:e2e:testnet                           # live faucet/approve/deposit/withdraw + HCS audit, prints HashScan links
npm run hardhat:hcs:relay                             # backfill vault events missing from the HCS topic (idempotent)
npm run hardhat:verify:sourcify -- --network hederaTestnet   # Sourcify v2 (hardhat verify still uses the removed v1 API)
```

Validate any contract change with `hardhat:test`; any frontend change with `next:check-types`, `next:lint` and `next:build`.

## Where things live

| Concern                                                     | Path                                                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Vault                                                       | `packages/hardhat/contracts/vault/OracleGatedVault.sol`                                          |
| Oracle interfaces / adapters                                | `packages/hardhat/contracts/oracle/`                                                             |
| Network addresses, feed id, band defaults                   | `packages/hardhat/config/oracle.ts`                                                              |
| Deploy (Chainlink or Pyth on chain 295/296, mock elsewhere) | `packages/hardhat/deploy/01_deploy_oracle_gated_vault.ts`                                        |
| HCS topic creation (Hedera only)                            | `packages/hardhat/deploy/02_create_hcs_audit_topic.ts`                                           |
| HCS schema + relay (pure) / SDK + mirror node               | `packages/hardhat/utils/hcsAudit.ts` / `hcsClient.ts`, `hcsRelay.ts`                             |
| HCS topic ids (browser)                                     | `packages/nextjs/contracts/hcsAuditTopics.json` (written by deploy)                              |
| Live e2e / HCS backfill                                     | `packages/hardhat/scripts/e2eTestnet.ts`, `scripts/hcsAuditRelay.ts`                             |
| Hermes / HashScan helpers (scripts)                         | `packages/hardhat/utils/hermes.ts`, `utils/hashscan.ts`                                          |
| Tests                                                       | `packages/hardhat/test/`                                                                         |
| Receipt replay lab                                          | `packages/nextjs/app/proof-lab/` (labelled local evidence)                                       |
| Vault UI                                                    | `packages/nextjs/app/vault/` (`LiveFeedPrice`, `GateStatus`, `VaultActions`, `AuditLog`)         |
| Feed addresses + ABI (browser)                              | `packages/nextjs/utils/oracle/chainlink.ts`                                                      |
| Generated ABIs + addresses                                  | `packages/nextjs/contracts/deployedContracts.ts` (regenerated by every deploy; do not hand-edit) |

## Common tasks

**Add an oracle adapter (Supra, custom).** Create `contracts/oracle/<Name>PriceOracle.sol` implementing `IPriceOracle` (plus `IUpdatablePriceOracle` if it is pull-based). Return 8 decimals and the source's own timestamp. Add a test file using a mock of the source. Deploy it and call `vault.setOracle(adapter)`. See `docs/ORACLE_ADAPTERS.md`.

**Change the feed.** Set `CHAINLINK_FEED_ADDRESS` (or `PYTH_PRICE_FEED_ID` with `ORACLE_PROVIDER=pyth`) before deploying, update `utils/oracle/chainlink.ts` for the UI card, and choose a band that brackets the current price.

**Read/write contracts in the UI.** Use the Scaffold hooks from `~~/hooks/scaffold-hbar`: `useScaffoldReadContract`, `useScaffoldWriteContract` (supports `value` and `gas`), `useDeployedContractInfo`. Contract names must exist in `deployedContracts.ts`, so deploy locally first when adding a contract.

```tsx
const { data: gate } = useScaffoldReadContract({
  contractName: "OracleGatedVault",
  functionName: "previewGate",
});
const { writeContractAsync } = useScaffoldWriteContract({
  contractName: "OracleGatedVault",
});
await writeContractAsync({
  functionName: "deposit",
  args: [amount],
  gas: 300_000n,
});
// Pyth path: functionName "depositWithPriceUpdate", args [amount, updateData], value: feeTinybars * 10n ** 10n
```

**Log another event to HCS.** Add it to the ABI and `auditEventsFromLogs` in `utils/hcsAudit.ts` (new `k` value), mirror the decoder and verifier in `packages/nextjs/utils/hcs/audit.ts`, add a test in `test/HcsAudit.test.ts`.

## Style

- Solidity: custom errors (no revert strings), NatSpec on public surface, checks-effects-interactions, `nonReentrant` on user actions.
- TypeScript: `type` over `interface`, `~~` import alias, `"use client"` for pages with hooks, DaisyUI classes for UI.
- Hardhat deploy files are numbered `NN_deploy_<name>.ts` and tagged.
- Comments explain why, not what. No dead code.
