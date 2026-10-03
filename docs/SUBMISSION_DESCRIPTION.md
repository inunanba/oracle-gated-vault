# Project description (three sentences)

Oracle-gated Vault is a Scaffold-HBAR template for treasury transfer windows whose ERC-20 deposits and withdrawals require a fresh oracle price inside a configured band, with transaction-time admission evidence showing why each transfer was allowed.
It uses Chainlink HBAR/USD by default, includes an optional Pyth pull adapter, and composes Hedera Smart Contract Service with an operator-run HCS audit stream and a Mirror Node-based UI that independently checks the vault emitter, action and recorded policy.
Builders get deterministic mocks and tamper tests, reproducible CI, a wallet-free read-only preview and integration guides, with explicit limits on custody, oracle availability and audit completeness.

Use the admission-evidence description only after publishing and verifying a fresh deployment of this version. Old proof links and the v1.0.0 video do not demonstrate it. Work does not submit the form.
