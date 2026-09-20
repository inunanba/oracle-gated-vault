# Oracle-gated Vault (Scaffold-HBAR template)

Production-oriented **Scaffold-HBAR** template: a deposit vault whose `deposit` / `withdraw` paths are **gated by an oracle price band** (Supra/Pyth-style `IPriceOracle` adapter).

One-command consume (after this repo is public):

```bash
npm create scaffold-hbar@latest -- --template inunanba/oracle-gated-vault
```

Built for the [Scaffold-HBAR Template Bounty](https://hedera.com/blog/scaffold-hbar-template-bounty/). Stack: **Next.js App Router + Hardhat**, npm workspaces, Node ≥ 20.18.3. Licence: **MIT**.

## Why this template (ecosystem is load-bearing)

| Without oracle | With oracle adapter |
|----------------|---------------------|
| Vault cannot decide safe bands | `requirePriceInBand()` enforces min/max + staleness |

Removing the oracle **breaks the product**. Local DX uses `MockPriceOracle`; live Supra/Pyth adapters are documented in [`docs/ORACLE_ADAPTERS.md`](./docs/ORACLE_ADAPTERS.md) (read-only / forked-mainnet OK when testnet feeds are thin — per bounty brief).

Hedera surface: Solidity contracts on Hedera JSON-RPC (Hashio), sample HTS helpers from the blank starter, Hashscan-ready deploy tags.

### Rubric map (sponsor-facing)

| Rubric | How this template scores |
|--------|--------------------------|
| Ecosystem (35) | Oracle consumer is the product gate; adapters documented for Supra/Pyth |
| Documentation (30) | README + AGENTS.md + ORACLE_ADAPTERS + TESTNET_VERIFICATION + template.json outro |
| Code quality (20) | Hardhat tests (band / stale / ownable), Next production build, lint clean |
| Hedera depth (15) | Hardhat deploy to `hederaTestnet`, HTS starter contracts retained, Hashio JSON-RPC |

## Prerequisites

- Node.js ≥ 20.18.3
- Git
- (Owner only for live testnet) Hedera Portal faucet: https://portal.hedera.com/

## Quick start (no keys)

```bash
npm install --legacy-peer-deps
npm run hardhat:compile
npm run hardhat:test
npm run next:build
npm run lint
```

Local demo chain:

```bash
# terminal 1
npm run hardhat:chain
# terminal 2
npm run hardhat:deploy --network localhost --tags OracleGatedVault
# terminal 3
npm run next:dev
```

Open http://localhost:3000/vault and use **Debug Contracts** for `deposit` / `withdraw` / `setPrice`.

## Environment

Copy examples only; **never commit `.env`**:

- `packages/hardhat/.env.example` — RPC + encrypted deployer (OWNER generates)
- `packages/nextjs/.env.example` — WalletConnect project id (optional for UI)
- Optional: `NEXT_PUBLIC_ORACLE_MODE=mock|read-only-live`, `NEXT_PUBLIC_PRICE_FEED_ID=...`

If `next:build` complains about missing `@x402/*` modules (transitive from Coinbase CDP / wagmi), this template already declares `@x402/evm`, `@x402/core`, and `@x402/svm` in `packages/nextjs/package.json`.

## Layout

```
packages/hardhat/contracts/oracle/   IPriceOracle, MockPriceOracle
packages/hardhat/contracts/vault/    OracleGatedVault
packages/hardhat/deploy/03_deploy_oracle_gated_vault.ts
packages/hardhat/test/OracleGatedVault.test.ts
packages/nextjs/app/vault/           Concept UI
docs/ORACLE_ADAPTERS.md              Live adapter sketches
docs/TESTNET_VERIFICATION.md         Owner Hashscan checklist
template.json                        Scaffold-HBAR manifest (required)
AGENTS.md                            AI-assisted workflow
LICENCE / LICENSE                    MIT
```

## Owner-only: verifiable testnet tx

Bot/automation must **not** claim faucet, sign, or invent Hashscan links.

Exact steps: [`docs/TESTNET_VERIFICATION.md`](./docs/TESTNET_VERIFICATION.md)

Summary:

1. Register on https://hedera.com/scaffold-hbar-template-bounty/ (HubSpot — free signup class).
2. Portal faucet → fund deployer.
3. `npm run hardhat:account:generate` (or import) locally; keep secrets out of git.
4. `npm run hardhat:deploy --network hederaTestnet --tags OracleGatedVault`
5. Attach **real** Hashscan / mirror-node URL at submission.

Owner boundary notes (local box may also keep `notes/OWNER_BOUNDARY.md`).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run lint` | Next + Hardhat lint |
| `npm run format` | Prettier both workspaces |
| `npm run hardhat:compile` | Compile contracts |
| `npm run hardhat:test` | Unit tests (no keys) |
| `npm run hardhat:deploy --network localhost --tags OracleGatedVault` | Local deploy |
| `npm run hardhat:deploy --network hederaTestnet --tags OracleGatedVault` | Testnet deploy (OWNER) |
| `npm run next:dev` / `next:build` | Frontend |

## Licence

MIT — see [`LICENCE`](./LICENCE) / [`LICENSE`](./LICENSE).
