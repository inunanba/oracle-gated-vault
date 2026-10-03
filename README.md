# Oracle-gated Vault — a Scaffold-HBAR template

An ERC-20 vault on Hedera whose **deposits and withdrawals only open while a live oracle price is fresh and inside a configured band**. On Hedera it reads the **Chainlink HBAR/USD Data Feed** through a small adapter; a **Pyth pull-oracle adapter** (post a signed Hermes update and act on it in the same transaction) ships alongside it behind the same interface. Every gated deposit and withdrawal is also appended to a **Hedera Consensus Service (HCS) topic**, a public, consensus-timestamped audit log that the UI cross-checks against the EVM transactions.

```bash
npm create scaffold-hbar@latest -- --template inunanba/oracle-gated-vault
```

Use it as the starting point for anything that should only move money at a sane price: price-floor treasuries, stablecoin mint/redeem guards, collateral deposits, circuit-breaker vaults, "only rebalance between $X and $Y" strategies.

| | |
|---|---|
| Ecosystem integration | **Chainlink Data Feeds** on Hedera (HBAR/USD, push) by default · **Pyth** (HBAR/USD, pull via Hermes) as an alternative adapter |
| Hedera services | **Smart Contract Service** (Solidity via JSON-RPC relay) · **Consensus Service** (HCS audit topic via `@hashgraph/sdk`) · Mirror Node REST (topic + contract-result reads) · HashScan |
| Stack | Next.js App Router · Hardhat + hardhat-deploy · wagmi/viem · npm workspaces · Node ≥ 20.18.3 |
| Licence | MIT |

![Vault page](docs/screenshots/vault.png)

---

## Contents

- [Quick start](#quick-start)
- [What you get](#what-you-get)
- [How it works](#how-it-works)
- [Deploy to Hedera testnet](#deploy-to-hedera-testnet)
- [Deployed on testnet](#deployed-on-testnet)
- [Environment variables](#environment-variables)
- [Scripts](#scripts)
- [Project layout](#project-layout)
- [Contract reference](#contract-reference)
- [Hedera gotchas this template handles](#hedera-gotchas-this-template-handles)
- [Make it yours](#make-it-yours)
- [Testing](#testing)
- [Security model and limitations](#security-model-and-limitations)
- [Troubleshooting](#troubleshooting)
- [Working with AI agents](#working-with-ai-agents)

---

## Quick start

Prerequisites: Node.js ≥ 20.18.3, npm ≥ 9, git. No keys are needed for anything in this section.

```bash
npm create scaffold-hbar@latest -- --template inunanba/oracle-gated-vault
cd <your-project>

npm run hardhat:compile
npm run hardhat:test          # 46 unit tests, in-memory chain, ~3 s
npm run next:dev              # http://localhost:3000/vault
```

The frontend ships with the addresses of the public testnet deployment (see [Deployed on testnet](#deployed-on-testnet)), so `/vault` works against Hedera testnet immediately: connect a wallet on Hedera Testnet, press **Get 100 demo HTK**, **Approve**, **Deposit**.

### Fully local (no testnet at all)

```bash
npm run hardhat:chain                              # terminal 1: Hardhat node on :8545 (forks Hedera testnet state)
npm run hardhat:deploy -- --network localhost      # terminal 2: HederaToken + MockPriceOracle + OracleGatedVault
npm run next:dev                                   # terminal 3, then pick "Hedera Local Fork" in the wallet menu
```

Locally the vault reads `MockPriceOracle`. Open **Debug Contracts**, call `MockPriceOracle.setPrice(50000000)` ($0.50) and watch deposits revert with `PriceOutOfBand`; set it back to `100000000` and they go through.

## What you get

- `/vault` — live Chainlink HBAR/USD price read straight from Hedera, on-chain gate status (oracle price, age, band, OPEN/CLOSED, total deposits), a faucet/approve/deposit/withdraw panel, and the **HCS audit log** (latest topic messages from the mirror node, each marked *verified* after it is matched to the vault event in the referenced EVM transaction). Shows deploy instructions when no vault exists on the selected network.
- `/debug` — Scaffold-HBAR's contract debugger for every deployed contract.
- `/blockexplorer` — local block explorer for the Hardhat chain.
- `packages/hardhat/scripts/e2eTestnet.ts` — runs faucet → approve → gated deposit → gated withdraw on testnet and prints a HashScan link for every transaction (with Pyth it posts a Hermes update in each gated call), then appends both vault events to the HCS audit topic.
- `packages/hardhat/scripts/hcsAuditRelay.ts` — idempotent backfill: reads every `Deposited`/`Withdrawn` event from the mirror node and appends the ones missing from the topic (safe to rerun or schedule).

## How it works

```mermaid
flowchart LR
    U[User / script] -->|deposit / withdraw| V[OracleGatedVault]
    V -->|latestPrice| A{IPriceOracle adapter}
    A -->|latestRoundData| C[Chainlink HBAR/USD feed on Hedera]
    A -.->|getPriceUnsafe| P[Pyth contract on Hedera]
    U -.->|signed update from Hermes| V
    V -->|fresh and in band?| G{Gate}
    G -->|yes| T[move ERC-20, emit Deposited / Withdrawn with price]
    G -->|no| R[revert StalePrice / PriceOutOfBand]
    T -.->|event + tx hash| RL[relay: e2e / hcs:relay]
    RL -->|TopicMessageSubmit| H[(HCS audit topic)]
    H -->|mirror node| UI[/vault audit log: verify vs. contract result/]
```

**Why the oracle is load-bearing.** Every state-changing user path calls `requirePriceInBand()`. With no fresh, in-band price the vault is closed, both ways, and each `Deposited` / `Withdrawn` event records the price it was admitted at. Remove the oracle and the template has no reason to exist.

**Push vs pull, both covered.**

| | Chainlink (default on Hedera) | Pyth (optional) |
|---|---|---|
| Model | Push: Chainlink nodes write rounds on deviation or heartbeat | Pull: anyone posts a signed Hermes update, paying a 1-tinybar fee |
| Vault call | `deposit` / `withdraw` | `depositWithPriceUpdate` / `withdrawWithPriceUpdate` (update + action in one tx, excess fee refunded) |
| Staleness default | 90 000 s (24 h heartbeat + 1 h) | 60 s (price is posted in the same tx) |
| Keys needed | none | `PYTH_API_KEY` (Hermes requires one since the Pyth Core upgrade of 26 Aug 2026) |

**Layers.**

| Layer | File | Responsibility |
|---|---|---|
| Gate + accounting | `contracts/vault/OracleGatedVault.sol` | balances, band/staleness checks, optional in-tx pull update with refund |
| Oracle interfaces | `contracts/oracle/IPriceOracle.sol`, `IUpdatablePriceOracle.sol` | 8-decimal price + timestamp; optional pull-update hooks |
| Chainlink adapter | `contracts/oracle/ChainlinkPriceOracle.sol` | decimals normalisation, rejects answer ≤ 0 and incomplete rounds |
| Pyth adapter | `contracts/oracle/PythPriceOracle.sol` | exponent normalisation, rejects price ≤ 0 and confidence > `maxConfidenceBps`, exact-fee updates |
| Local oracle | `contracts/oracle/MockPriceOracle.sol` | owner-set price for offline development |
| Network config | `packages/hardhat/config/oracle.ts` | feed addresses, provider selection, band defaults |
| HCS audit log | `packages/hardhat/utils/hcsAudit.ts` (pure, tested), `hcsClient.ts` (SDK), `hcsRelay.ts` | message schema, topic creation, idempotent relay |
| UI | `packages/nextjs/app/vault/` | `LiveFeedPrice`, `GateStatus`, `VaultActions`, `AuditLog` |

**HCS audit log.** Hedera has no HCS precompile for contracts, so the log is written off-chain by a relayer, and the design does not require trusting it:

- `deploy/02_create_hcs_audit_topic.ts` creates one topic per vault with the deployer key as **submit key** and **no admin key** (only the relayer can append; nobody can delete or edit).
- Each message is one JSON chunk (`ogv.audit/1`: action, user, amount, gate price, vault, EVM tx hash, log index, block); HCS adds a consensus timestamp and a gap-free sequence number.
- The relayer is idempotent (`txHash:logIndex` keys checked against the mirror node), so reruns never duplicate entries.
- Readers verify instead of trusting: `/vault` fetches each referenced contract result from the mirror node and checks that the log at that index is the same event with the same user, amount and price.

Typical uses: compliance/audit trails for a treasury, a cheap event feed for off-chain services (HCS messages cost a fraction of a cent and need no indexer), or cross-chain attestations.

The vault only knows `IPriceOracle`, so swapping feeds is a new adapter plus `setOracle(adapter)` — no vault changes. See [docs/ORACLE_ADAPTERS.md](docs/ORACLE_ADAPTERS.md).

## Deploy to Hedera testnet

1. **Create a deployer key** (stored encrypted in `packages/hardhat/.env`, never committed):
   ```bash
   npm run hardhat:account:generate      # or hardhat:account:import for an existing ECDSA key
   npm run hardhat:account               # shows the EVM address and balance
   ```
2. **Fund it**: paste the EVM address into the [Hedera faucet](https://portal.hedera.com/faucet). The first transfer auto-creates a Hedera account for that address. A full deploy + e2e run costs about 3–4 testnet HBAR.
3. **Deploy** (HederaToken, ChainlinkPriceOracle on the live HBAR/USD feed, OracleGatedVault, HCS audit topic):
   ```bash
   npm run hardhat:deploy -- --network hederaTestnet
   ```
   The script prints HashScan links and regenerates `packages/nextjs/contracts/deployedContracts.ts`, so the frontend picks the new addresses up automatically.
   For the Pyth adapter instead: `ORACLE_PROVIDER=pyth PYTH_API_KEY=... npm run hardhat:deploy -- --network hederaTestnet`.
4. **Prove it end to end** (faucet, approve, gated deposit and withdraw, HashScan link per step, then both events appended to the HCS topic):
   ```bash
   npm run hardhat:e2e:testnet
   npm run hardhat:hcs:relay        # optional: backfill any vault event not yet on the topic
   ```
5. **Verify source** on Sourcify (HashScan shows the verified badge). No API key, no constructor args: the script reads the deployments and build info.
   ```bash
   npm run hardhat:verify:sourcify -- --network hederaTestnet
   ```

Mainnet works the same with `--network hederaMainnet`; the mainnet Chainlink feed address is already in `config/oracle.ts`.

## Deployed on testnet

<!-- TESTNET_PROOF:START -->
Deployed 2026-10-03 11:20 UTC on Hedera testnet (chain 296). Oracle: Chainlink HBAR/USD `0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a`. All three contracts are **verified on Sourcify (exact match)**, so HashScan shows their source.

| Contract | Address | Deploy |
|---|---|---|
| `HederaToken` | [`0xb199E4193E60Eb98C74cb2048Ec91C67F2B070e2`](https://hashscan.io/testnet/contract/0xb199E4193E60Eb98C74cb2048Ec91C67F2B070e2) | [deploy tx](https://hashscan.io/testnet/transaction/0x97a3f05efb2c8069282aa3982d20f6a1549f111d3424f123ca1cbeaa5bab83ab) |
| `ChainlinkPriceOracle` | [`0x004F052e30bED6a87165b1D4b7f574BfC56bFe7a`](https://hashscan.io/testnet/contract/0x004F052e30bED6a87165b1D4b7f574BfC56bFe7a) | [deploy tx](https://hashscan.io/testnet/transaction/0x656a07756090b5710e56b1425899cdfbcb3586e6ada6a59ea8ffff8ceffec39f) |
| `OracleGatedVault` | [`0x1a6002485B5729088023CAdCd378CA22f28fC287`](https://hashscan.io/testnet/contract/0x1a6002485B5729088023CAdCd378CA22f28fC287) | [deploy tx](https://hashscan.io/testnet/transaction/0x2933e878133572179cc5a73d5537135bd4f345ea6c870c49fdc56cfcacb7fd86) |

Live end-to-end run (`npm run hardhat:e2e:testnet`), oracle price $0.10167308 (2879 s old):

| Step | HashScan |
|---|---|
| approve | [transaction](https://hashscan.io/testnet/transaction/0x49c6294f956d19f07c3c95bebf7c0ccf7d88e4a15c14aec7f1800cf95be76a48) |
| deposit(10.0 HTK) gated by Chainlink HBAR/USD | [transaction](https://hashscan.io/testnet/transaction/0x4bc6c42863e896de44215d9538da59d2211005eb1e4b586fdeda1f5356a288b0) |
| withdraw(5.0 HTK) gated by Chainlink HBAR/USD | [transaction](https://hashscan.io/testnet/transaction/0x177e519d883dd37f8ccc84998ebd257967e219701a861714c55f3934d8c23d92) |
| HCS audit topic 0.0.10841114 | [topic](https://hashscan.io/testnet/topic/0.0.10841114) |

HCS audit topic [`0.0.10841114`](https://hashscan.io/testnet/topic/0.0.10841114) (submit key = deployer, no admin key):

| # | Entry | Mirror node |
|---|---|---|
| 1 | deposit 10.0 HTK @ $0.10167308 | [message](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10841114/messages/1) |
| 2 | withdraw 5.0 HTK @ $0.10167308 | [message](https://testnet.mirrornode.hedera.com/api/v1/topics/0.0.10841114/messages/2) |
<!-- TESTNET_PROOF:END -->

## Environment variables

`packages/hardhat/.env` (copy from `.env.example`; all optional except the deployer key for live networks):

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOYER_PRIVATE_KEY_ENCRYPTED` | — | Written by `account:generate` / `account:import`. Never edit by hand. |
| `HEDERA_RPC_URL` | `https://testnet.hashio.io/api` | Relay used for forking the local chain |
| `ORACLE_PROVIDER` | `chainlink` | `chainlink` (push) or `pyth` (pull) for Hedera deploys |
| `CHAINLINK_FEED_ADDRESS` | HBAR/USD per network | Any Chainlink feed on Hedera |
| `PYTH_API_KEY` | — | Pyth Terminal key; required by Hermes for the Pyth path |
| `PYTH_CONTRACT_ADDRESS` | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` | Pyth contract (testnet and mainnet) |
| `PYTH_PRICE_FEED_ID` | HBAR/USD `0x3728…dfbd` | Any [Pyth feed id](https://www.pyth.network/developers/price-feed-ids) |
| `PYTH_MAX_CONFIDENCE_BPS` | `200` | Reject prices whose confidence interval is wider than 2% |
| `PYTH_HERMES_URL` | `https://pyth.dourolabs.app/hermes` | Hermes endpoint used by scripts |
| `VAULT_MIN_PRICE` / `VAULT_MAX_PRICE` | `1000000` / `100000000` on Hedera ($0.01 / $1.00) | Band, 8 decimals |
| `VAULT_MAX_STALENESS` | `90000` Chainlink, `60` Pyth, `3600` local | Seconds an oracle price stays valid |
| `E2E_AMOUNT` | `10` | HTK amount used by `hardhat:e2e:testnet` |
| `HCS_AUDIT` | `true` | `false` skips creating the HCS audit topic on Hedera deploys |
| `HEDERA_OPERATOR_ID` | resolved from the mirror node | Hedera account id (0.0.x) of the deployer, for SDK (HCS) transactions |

`packages/nextjs/.env` (copy from `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_HEDERA_TESTNET_RPC_URL` / `..._MAINNET_RPC_URL` | hashio | RPC overrides |
| `NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID` | Scaffold default | Get your own at cloud.reown.com for production |

## Scripts

| Command | What it does |
|---|---|
| `npm run hardhat:compile` / `hardhat:test` / `hardhat:test:gas` | Compile, unit tests, tests with gas report |
| `npm run hardhat:chain` | Local Hardhat node forking Hedera testnet (HTS emulation via `@hashgraph/system-contracts-forking`) |
| `npm run hardhat:deploy -- --network <localhost\|hederaTestnet\|hederaMainnet>` | Deploy and regenerate frontend ABIs |
| `npm run hardhat:e2e:testnet` | Live faucet → approve → gated deposit → gated withdraw → HCS audit messages, prints HashScan links |
| `npm run hardhat:hcs:relay` | Append every vault event missing from the HCS audit topic (idempotent) |
| `npm run hardhat:account[:generate\|:import]` | Manage the encrypted deployer key |
| `npm run hardhat:verify:sourcify -- --network hederaTestnet` | Verify every deployed contract on Sourcify (v2 API) |
| `npm run next:dev` / `next:build` / `next:serve` | Frontend |
| `npm run lint` / `npm run format` / `npm run next:check-types` | Quality gates |

## Project layout

```
packages/
  hardhat/
    contracts/
      vault/OracleGatedVault.sol      gate + accounting
      oracle/IPriceOracle.sol         8-decimal price interface
      oracle/IUpdatablePriceOracle.sol pull-oracle extension
      oracle/ChainlinkPriceOracle.sol Chainlink adapter (default on Hedera)
      oracle/PythPriceOracle.sol      Pyth adapter (pull)
      oracle/interfaces/              AggregatorV3Interface
      oracle/MockPriceOracle.sol      local oracle
      mocks/                          MockAggregatorV3, Pyth's MockPyth for tests
      HederaToken.sol                 demo ERC-20 asset with a public faucet()
    config/oracle.ts                  feed addresses, provider, band defaults
    deploy/00_deploy_hedera_token.ts
    deploy/01_deploy_oracle_gated_vault.ts  Chainlink/Pyth on Hedera, mock elsewhere
    deploy/02_create_hcs_audit_topic.ts     HCS topic (Hedera networks only)
    scripts/e2eTestnet.ts             live end-to-end run
    scripts/hcsAuditRelay.ts          idempotent HCS backfill
    scripts/verifySourcify.ts         Sourcify v2 verification
    scripts/runHardhatWithPK.ts       decrypts the deployer key for deploy/run
    utils/hcsAudit.ts                 HCS message schema + relay logic (no network)
    utils/hcsClient.ts, hcsRelay.ts   Hedera SDK + mirror node side
    utils/hermes.ts, utils/hashscan.ts
    test/                             vault, Chainlink, Pyth, HCS audit and token tests
  nextjs/
    app/vault/                        page + LiveFeedPrice, GateStatus, VaultActions, AuditLog
    utils/hcs/audit.ts                topic reader + on-chain cross-check
    contracts/hcsAuditTopics.json     topic id per chain, written by deploy
    utils/oracle/chainlink.ts         feed addresses + ABI
    contracts/deployedContracts.ts    generated by deploy
docs/
  ORACLE_ADAPTERS.md                  Chainlink + Pyth details, adding Supra or your own feed
template.json                         create-scaffold-hbar manifest
AGENTS.md                             instructions for coding agents
```

## Contract reference

`OracleGatedVault`

| Function | Notes |
|---|---|
| `deposit(amount)` / `withdraw(amount)` | Use the price already stored in the oracle |
| `depositWithPriceUpdate(amount, bytes[] update)` payable | Posts the update (pays `getUpdateFee`), refunds excess value, then deposits |
| `withdrawWithPriceUpdate(amount, bytes[] update)` payable | Same for withdrawals |
| `previewGate() → (price, updatedAt, fresh, inBand)` | Non-reverting status for UIs |
| `requirePriceInBand() → price` | Reverting check used by every user action |
| `getUpdateFee(bytes[] update)` | Fee in tinybars |
| `setBand(min, max, maxStaleness)` / `setOracle(addr)` | `onlyOwner` |

Events: `Deposited(user, amount, price)`, `Withdrawn(user, amount, price)`, `PriceRefreshed(caller, fee)`, `BandUpdated`, `OracleUpdated`.
Errors: `PriceOutOfBand(price, min, max)`, `StalePrice(updatedAt, maxStaleness)`, `InsufficientUpdateFee(sent, required)`, `WithdrawExceedsBalance(requested, available)`, `UnexpectedValue`, `ZeroAmount`, `ZeroAddress`, `InvalidBand`.

`ChainlinkPriceOracle(feed, decimals)` — `latestPrice()` returns the latest round scaled to `decimals` with the round's `updatedAt`; reverts `NonPositivePrice` / `IncompleteRound`.

`PythPriceOracle(pyth, priceId, decimals, maxConfidenceBps)` — `latestPrice()` normalises any Pyth exponent to `decimals`, reverts with `NonPositivePrice` or `ConfidenceTooWide`; `updatePrice(update)` requires exactly the Pyth fee (`IncorrectUpdateFee`).

## Hedera gotchas this template handles

- **Tinybars vs weibars.** Inside the EVM, `msg.value` and Pyth's `getUpdateFee` are in tinybars (8 decimals). Wallets and the JSON-RPC relay send weibars (18 decimals). The Pyth path multiplies the fee by `10^10` (`TINYBAR_TO_WEIBAR`); sending the raw fee (1 wei) is below one tinybar, so the contract would see zero and revert with `InsufficientUpdateFee`.
- **Testnet feed cadence.** Chainlink testnet feeds publish on deviation or heartbeat, so `maxStaleness` defaults to 25 h for the push path. `previewGate()` reports stale prices instead of reverting so the UI can explain why the vault is closed.
- **Pyth on Hedera after the Aug 2026 Pyth Core upgrade.** Hermes now needs an API key, and the HBAR/USD slot of the Hedera Pyth contract has not been refreshed since 24 Aug 2026. That is why Chainlink is the default and the Pyth adapter is opt-in.
- **Gas limit is charged.** Hedera charges at least 80% of the gas limit, so deploy, e2e and UI calls set explicit, measured limits instead of padded defaults.
- **Hollow accounts.** Funding a fresh EVM address from the faucet creates a hollow account (no key yet); the first EVM transaction signed by that key (the deploy) completes it. The HCS step runs after the contracts for this reason, and resolves the `0.0.x` account id from the EVM address via the mirror node.
- **One key, two APIs.** The same ECDSA key signs EVM transactions (relay) and native HCS transactions (`@hashgraph/sdk`, `PrivateKey.fromStringECDSA`). HCS messages are capped at 1024 bytes per chunk, so audit entries are compact single-chunk JSON.
- **Sourcify v2.** Sourcify removed its v1 API, which `hardhat verify` (hardhat-verify) still calls (`API v1 is removed`). `scripts/verifySourcify.ts` uses `POST /v2/verify/{chainId}/{address}` with the Hardhat build info and the creation tx hash.
- **Unit tests do not depend on the relay.** The Hardhat network forks Hedera only when `HEDERA_FORKING=true` (`hardhat:chain`), so `hardhat:test` is deterministic and offline. Feeds are exercised with `MockAggregatorV3` and Pyth's own `MockPyth`.

## Make it yours

- **Different asset**: pass your token to the vault constructor in `deploy/01_deploy_oracle_gated_vault.ts`. For an HTS token use its ERC-20 facade address and associate the vault with the token before the first deposit.
- **Different feed or band**: set `CHAINLINK_FEED_ADDRESS` (or `PYTH_PRICE_FEED_ID`) and `VAULT_MIN_PRICE` / `VAULT_MAX_PRICE` (8 decimals) before deploying; update `utils/oracle/chainlink.ts` for the UI card. Retune later with `setBand`.
- **Different oracle**: implement `IPriceOracle` (and `IUpdatablePriceOracle` for pull oracles), deploy, call `setOracle`. A Supra sketch is in [docs/ORACLE_ADAPTERS.md](docs/ORACLE_ADAPTERS.md).
- **Different gate**: the check lives in one function, `requirePriceInBand()`. Gate only deposits, use Pyth's EMA price, or require Chainlink and Pyth to agree within a tolerance.

## Testing

```bash
npm run hardhat:test
```

46 tests cover: in-band/out-of-band/stale deposits and withdrawals, withdrawals blocked while out of band, `previewGate`, owner-only admin and input validation; Chainlink decimals scaling (up and down), non-positive answers, incomplete rounds, missed heartbeat, band re-opening on a new round; Pyth exponent scaling, negative price and wide-confidence rejection, exact update fee, deposit-with-update in one transaction, refund of excess fee, insufficient fee, stale publish time, withdraw-with-update after the stored price went stale; HCS audit message encode/decode and validation, event extraction from real vault receipts (ignoring the token's own logs), idempotent relay ordering; demo token faucet. `npm run hardhat:e2e:testnet` is the live counterpart against the real Chainlink feed.

## Security model and limitations

- **Withdrawals are gated too.** That is the point of the template, but it means users cannot exit while the price is out of band or the feed is stale. For real funds add an owner- or time-locked emergency exit, or gate only deposits.
- **The owner can change the band and the oracle.** Put the vault behind a multisig/timelock in production.
- **Demo asset.** `HederaToken.faucet()` lets anyone mint 100 HTK so visitors can try the public deployment. Remove it for a real asset.
- **Staleness and confidence are per-deployment choices.** Defaults (25 h for Chainlink, 60 s and 2% for Pyth) suit a demo, not every market. A single oracle is a single point of failure; production vaults often require two sources to agree.
- **The HCS log is written by a relayer.** It can be late or incomplete if the relayer stops (rerun `hardhat:hcs:relay` to backfill), but it cannot forge entries undetected: the UI verifies each entry against the contract result. Only the submit key can append.
- Not audited.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `StalePrice` | The feed has not published within `maxStaleness`. Check the feed's last round on `/vault` (or HashScan) and widen with `setBand` if your feed's heartbeat is longer. With Pyth, use `depositWithPriceUpdate` |
| `InsufficientUpdateFee(0, 1)` | Pyth path: the fee was sent in tinybars; multiply by `10^10` (weibars) when sending |
| `Hermes request failed: 401` | Pyth path: set `PYTH_API_KEY` (Pyth Terminal) |
| `PriceOutOfBand` | HBAR/USD is outside the band; check `/vault` and adjust with `setBand` |
| `ConfidenceTooWide` | Pyth path: confidence exceeds `maxConfidenceBps`; wait or redeploy the adapter with a wider limit |
| `npm run hardhat:deploy --network hederaTestnet` deploys to the wrong network | npm swallows flags before `--`; use `npm run hardhat:deploy -- --network hederaTestnet` |
| `hardhat verify` fails with `API v1 is removed` | Use `npm run hardhat:verify:sourcify -- --network hederaTestnet` |
| Deploy fails with `INSUFFICIENT_PAYER_BALANCE` | Fund the deployer address from the faucet; `npm run hardhat:account` shows the balance |
| `/vault` audit log says "No Hedera Consensus Service topic" | Deploy to a Hedera network (creates the topic), or check `HCS_AUDIT` was not `false`; the topic must belong to the current vault address |
| `Mirror node: no Hedera account for 0x…` during deploy | The deployer address was never funded; fund it from the faucet |
| `/vault` says "No vault deployed" | Select the network you deployed to in the wallet menu, or redeploy so `deployedContracts.ts` is regenerated |

## Working with AI agents

[AGENTS.md](AGENTS.md) (loaded by Claude Code via `CLAUDE.md`, and by Cursor/Codex directly) describes the architecture, the invariants to keep, and the commands to validate a change. `.agents/` and `.claude/` include a Solidity security skill and a reviewer agent from Scaffold-HBAR. This template was not built with Hedera Harness.

## License

MIT — see [LICENSE](LICENSE). Built on [Scaffold-HBAR](https://github.com/hedera-dev/scaffold-hbar) (MIT).
