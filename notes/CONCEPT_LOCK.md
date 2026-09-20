# CONCEPT LOCK — R-20260920-grokbot-hedera-scaffold-preflight-build-01
Locked: 2026-09-20 21:36 JST (Asia/Tokyo)

## Rubric scoring (0–max; zero-capital + owner-only faucet)

| # | Concept | Eco 35 | Docs 30 | Code 20 | Depth 15 | Gate realism | Total /100 | Notes |
|---|---------|--------|---------|---------|----------|--------------|------------|-------|
| 1 | HTS + SaucerSwap LP bootstrap | 30 | 22 | 14 | 10 | Med | **76** | Strong DEX eco; testnet LP fragile; more faucet txs; risk of thin DEX glue |
| 2 | HCS audit log + HashPack paywall | 18 | 28 | 16 | 13 | High | **75** | Docs/DX shine; HashPack/paywall weaker vs listed eco (DEX/oracle/bridge); near x402 adjacency |
| 3 | **Supra/Pyth oracle consumer vault** | **32** | **26** | **17** | **12** | **High** | **87** | Oracle explicitly load-bearing; read-only/mock OK per brief; one deploy tx for Hashscan |
| 4 | HSS scheduled HTS distribution | 20 | 22 | 15 | 14 | Med | **71** | HSS depth good; eco needs bolt-on; payments-scheduler lookalike risk |

## LOCKED
**Oracle-gated Vault (Supra/Pyth consumer)** — repo dir `oracle-gated-vault`

### Rationale (short)
Highest realistic gate-pass + rubric under A0-S: ecosystem points (35) are the largest block and oracles are named load-bearing integrations; vault logic is mockable offline; brief allows read-only/forked-mainnet when testnet oracle is thin; owner only needs Portal faucet + one verifiable deploy/interact for Hashscan. Differentiates from built-ins (blank, hedera-demo, payments-scheduler, bridge, cross-chain-dca, x402, LZ index).

### Product one-liner
Deposit ERC-20/mock asset into a vault that gates deposit/withdraw/strategy actions on an oracle price band (Supra or Pyth feed adapter); mock oracle for local; optional live read-only feed docs for testnet/mainnet.

### Non-goals this preflight
No faucet, no wallet sign/send, no fabricated Hashscan links, no HubSpot registration submit.
