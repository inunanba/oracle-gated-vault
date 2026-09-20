# Testnet verification plan (OWNER — no fabricated proofs)

> **2026-09-21 owner update:** Bounty registration and Portal faucet for account `0.0.10631594` are **SATISFIED**. Do not re-ask registration/faucet. Remaining owner steps are local key-in-`.env` (on owner device only), `hardhat:deploy` on `hederaTestnet`, and pasting a **real** Hashscan URL.

This checklist produces the **real** Hashscan / mirror-node URL required for Scaffold-HBAR Template Bounty submission. Bot/automation must **not** sign, send, or invent links.

## Prerequisites (OWNER machine)

- Node ≥ 20.18.3, this repo cloned, `npm install --legacy-peer-deps`
- Browser access to Hedera Portal and Hashscan
- Secrets stay in local `.env` only (gitignored)

## Steps

### 1. Portal faucet (OWNER) — DONE for 0.0.10631594

1. Open https://portal.hedera.com/ and sign in / create account.
2. Select **Testnet**.
3. Claim testnet HBAR via the faucet UI.
4. Note your account id / EVM address for later.

### 2. Local deployer key (OWNER — never commit)

```bash
# from repo root
cp packages/hardhat/.env.example packages/hardhat/.env
npm run hardhat:account:generate
# or: npm run hardhat:account:import
npm run hardhat:account   # confirm address; fund this address from Portal if needed
```

Confirm `packages/hardhat/.env` is gitignored and never pasted into chat/issues.

### 3. Deploy vault on hederaTestnet (OWNER signs)

```bash
npm run hardhat:compile
npm run hardhat:deploy --network hederaTestnet --tags OracleGatedVault
```

Expected: deploy logs for `MockPriceOracle` then `OracleGatedVault` (depends on `HederaToken`). Copy the **contract address** and **transaction hash** from the console — do not invent them.

Optional interact (still OWNER):

```bash
# after deploy, via Debug Contracts on testnet or a one-off script:
# - MockPriceOracle.setPrice(...)
# - approve + OracleGatedVault.deposit(amount)
```

### 4. Hashscan / mirror URL (OWNER)

1. Open https://hashscan.io/testnet
2. Paste the deploy **tx hash** or contract address.
3. Confirm the page shows your tx / contract on **testnet**.
4. Copy the **exact browser URL** into the bounty submission form.
5. Optionally cross-check via mirror node REST (public read-only) using the same address/tx — still only real values.

**Never** paste placeholder hashes, localhost links, or AI-invented Hashscan URLs into the submission.

### 5. Sanity before submit

- [ ] Public MIT repo URL works for a third party (`npm create scaffold-hbar@latest -- --template <owner>/<repo>`)
- [ ] Real Hashscan/mirror URL opens your deploy
- [x] HubSpot registration completed on https://hedera.com/scaffold-hbar-template-bounty/
- [ ] No `.env` or private keys in the public repo

## What Bot already verified (no keys)

- `hardhat:compile` exit 0
- `hardhat:test` green (19 passing unit)
- `next:build` exit 0 after `@x402/*` peer deps (gen3)
- lint/format clean (gen3)

Bot stops before private-key deploy. Steps 2–4 remain OWNER.
