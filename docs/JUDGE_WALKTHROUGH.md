# Reviewer walkthrough

## What the integration adds

The oracle is an execution prerequisite: a token transfer only happens after freshness and band checks. The same gate works through a Chainlink push adapter or a Pyth pull adapter; the latter lets a user supply an update and act atomically. Local mocks exercise the failure paths without a funded wallet or a live oracle.

Hedera adds a separate consensus-timestamped HCS record stream. An operator relays contract events, and readers use the Mirror Node to compare each entry with the actual emitting vault and receipt. This demonstrates composing Smart Contract Service and Consensus Service without putting a submit key into the frontend. HCS records can be late or incomplete; sequence numbers and matching entries do not prove that all events have been relayed.

A reusable use case is an operator-controlled treasury transfer window: allow deposits and withdrawals only while HBAR/USD is inside an explicit band. For a stablecoin depeg guard, replace the feed with that asset's price source. The demo token's value is not derived from HBAR/USD.

## Try the read-only path

```bash
npm create scaffold-hbar@latest -- --template inunanba/oracle-gated-vault
cd <your-project>
npm run next:dev
```

Open `/vault` on Hedera Testnet. No signing is needed to inspect the live price, gate, vault address and HCS entries. Testnet writes require a wallet funded with testnet HBAR. The included burner wallet starts unfunded.

## Prove the gate locally

Run `npm run hardhat:test` for deterministic local checks. For an interactive local demonstration, start `npm run hardhat:chain`, deploy with `npm run hardhat:deploy -- --network localhost`, select Hedera Local Fork, then use Debug Contracts:

1. Mint demo HTK and approve the vault.
2. Set MockPriceOracle to `100000000` ($1.00); deposit succeeds within the local band.
3. Set it to `50000000` ($0.50); deposit and withdrawal fail with `PriceOutOfBand`.
4. Restore an in-band observation; withdrawal succeeds.
5. Tests also advance time beyond maxStaleness: the same in-band price no longer authorizes a transfer until refreshed.

The interactive fork needs public network access. Unit tests do not need a funded account; first-time dependency/compiler installation may need internet access.

## Check a recorded event

Use the links in README's testnet proof table. A successful vault receipt contains both token logs and vault logs. The HCS entry names the EVM hash and vault log index. The browser verifier checks selected chain, configured vault, independently resolved contract identity, successful receipt, emitting address, event kind, user, amount and admission price.

Run `npm run test:hcs-ui` to exercise a valid alias emitter, numeric emitter, another vault emitting identical values, changed chain/vault/value/kind, malformed messages and unavailable mirror data. The latter is UNKNOWN, not verified or a claimed forged event.

UI actions do not submit HCS messages automatically. The operator runs `npm run hardhat:hcs:relay` to backfill. Use one relayer and allow mirror reflection before retrying; strict exactly-once delivery is not claimed.

## Final eligibility checks

```bash
npm run hardhat:test
npm run test:hcs-ui
npm run lint
npm run next:check-types
npm run hardhat:check-types
npm run next:build
npm run next:serve
```

Confirm `/`, `/vault`, `/debug` and `/blockexplorer` boot. Before submitting, rerun from a fresh scaffold of the final public commit and check MIT, template.json, README, AGENTS, tracked secrets and real testnet links. Record the commit and actual outputs; do not substitute this checklist for observed evidence.

## Limits a reviewer should know

This is an unaudited starter, not a production custody service. Withdrawals close when the oracle is unavailable, stale or out of band; the owner controls feed and band. The default 25-hour Chainlink age is a testnet demonstration choice. The Pyth adapter has mock coverage but its live path requires separate credentials and verification. Fee-on-transfer/rebasing assets are not supported, replacement feeds must use 8 decimals, and future oracle timestamps require additional validation before production. No HTS, yield, complete audit coverage or mainnet operational proof is claimed.
