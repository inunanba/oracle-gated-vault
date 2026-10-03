# Schedule Service assessment — final review

Decision: **do not add or claim Schedule Service integration in this submission version**.

A useful future composition is a scheduled treasury withdrawal whose price and age are checked when the scheduled call executes. Hedera's native SDK supports scheduling contract calls and waiting until expiry; see the official [HIP-423 walkthrough](https://hedera.com/blog/introducing-hip-423-long-term-scheduled-transactions/). Scheduling creates an execution time, not a guarantee of an in-band price. The scheduled payer/caller must own the vault balance; the schedule creation result cannot be shown as a successful withdrawal. A Pyth payload supplied at creation may be stale when the call executes.

The current audit schema and UI expect 32-byte EVM transaction hashes. The review found hash truncation in the relay; this patch removes it and rejects unsupported native hashes instead of manufacturing a 32-byte proof. Native scheduled contract execution needs a separately verified transaction identity/receipt path, including scheduled transaction ID resolution, caller semantics, failures, expiry, replay and the resulting HCS record. A serialization-only SDK test or an EVM mock cannot prove those network properties. The current Work environment cannot sign/fund a live scheduled call, and there is no validated schedule evidence to reuse.

Adding a nominal third service without resolving and demonstrating that workflow would weaken correctness and the demo. The audited differentiator for this version is therefore Smart Contract Service + load-bearing oracle admission + HCS/Mirror verification. No HSS, automated retry, automatic HCS submission or scheduled payout is claimed.

Future acceptance: deterministic builder tests; actual testnet schedule create/execute/fail evidence; confirmed effective caller; fresh execution-time observation; non-truncated supported mirror identity; verified HCS entry; safe duplicate and expiry handling; clear user-visible statuses. Implement an audit schema extension only with both encoders/decoders updated and compatibility tests.
