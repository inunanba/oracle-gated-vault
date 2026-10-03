import { Interface, type Log, type TransactionReceipt } from "ethers";

/**
 * HCS audit log for the vault: every gated Deposited/Withdrawn event becomes one Hedera Consensus
 * Service message. HCS gives the log a consensus timestamp and a gap-free sequence number that anyone
 * can read from the mirror node without running an indexer, and each message carries the EVM tx hash
 * so a reader can cross-check it against the contract result.
 *
 * This file is pure (no network, no SDK) so it is unit tested offline; `hcsClient.ts` is the live
 * Hedera SDK side.
 */
export const AUDIT_SCHEMA = "ogv.audit/1";
/** HCS rejects messages above 1024 bytes per chunk; audit messages are kept to a single chunk. */
export const HCS_MAX_MESSAGE_BYTES = 1024;

export type AuditKind = "deposit" | "withdraw";

export type AuditEvent = {
  kind: AuditKind;
  chainId: number;
  vault: string;
  user: string;
  /** Asset amount in base units (18 decimals for the demo token), as a decimal string. */
  amount: string;
  /** Oracle price the gate used, 8 decimals, as a decimal string. */
  price: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
};

type AuditWire = {
  s: string;
  k: AuditKind;
  c: number;
  v: string;
  u: string;
  a: string;
  p: string;
  tx: string;
  li: number;
  b: number;
};

const VAULT_EVENTS = new Interface([
  "event Deposited(address indexed user, uint256 amount, uint256 price)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 price)",
]);

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const UINT_RE = /^[0-9]+$/;

/** Unique key of an on-chain event; used to make the relay idempotent. */
export const auditKey = (e: Pick<AuditEvent, "txHash" | "logIndex">) => `${e.txHash.toLowerCase()}:${e.logIndex}`;

/** ogv.audit/1 supports EVM hashes only; never fabricate one by truncating a native hash. */
export function requireEvmTransactionHash(hash: string): string {
  if (!HASH_RE.test(hash)) throw new Error("Unsupported mirror transaction hash: expected a 32-byte EVM hash");
  return hash;
}

export function encodeAuditMessage(e: AuditEvent): string {
  requireEvmTransactionHash(e.txHash);
  const wire: AuditWire = {
    s: AUDIT_SCHEMA,
    k: e.kind,
    c: e.chainId,
    v: e.vault.toLowerCase(),
    u: e.user.toLowerCase(),
    a: e.amount,
    p: e.price,
    tx: e.txHash.toLowerCase(),
    li: e.logIndex,
    b: e.blockNumber,
  };
  const json = JSON.stringify(wire);
  if (Buffer.byteLength(json, "utf8") > HCS_MAX_MESSAGE_BYTES) {
    throw new Error(`Audit message exceeds ${HCS_MAX_MESSAGE_BYTES} bytes`);
  }
  return json;
}

/** Parses and validates a topic message; returns null for anything that is not a well-formed audit entry. */
export function decodeAuditMessage(message: string): AuditEvent | null {
  let w: Partial<AuditWire>;
  try {
    w = JSON.parse(message);
  } catch {
    return null;
  }
  if (
    !w ||
    w.s !== AUDIT_SCHEMA ||
    (w.k !== "deposit" && w.k !== "withdraw") ||
    !Number.isInteger(w.c) ||
    !ADDRESS_RE.test(w.v ?? "") ||
    !ADDRESS_RE.test(w.u ?? "") ||
    !UINT_RE.test(w.a ?? "") ||
    !UINT_RE.test(w.p ?? "") ||
    !HASH_RE.test(w.tx ?? "") ||
    !Number.isInteger(w.li) ||
    !Number.isInteger(w.b)
  ) {
    return null;
  }
  return {
    kind: w.k,
    chainId: w.c as number,
    vault: w.v as string,
    user: w.u as string,
    amount: w.a as string,
    price: w.p as string,
    txHash: w.tx as string,
    logIndex: w.li as number,
    blockNumber: w.b as number,
  };
}

/** Extracts the vault's Deposited/Withdrawn events from logs (receipt logs or eth_getLogs results). */
export function auditEventsFromLogs(
  logs: readonly Pick<Log, "address" | "topics" | "data" | "transactionHash" | "index" | "blockNumber">[],
  vault: string,
  chainId: number,
): AuditEvent[] {
  const events: AuditEvent[] = [];
  for (const log of logs) {
    if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
    const parsed = VAULT_EVENTS.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) continue;
    events.push({
      kind: parsed.name === "Deposited" ? "deposit" : "withdraw",
      chainId,
      vault: vault.toLowerCase(),
      user: (parsed.args.user as string).toLowerCase(),
      amount: (parsed.args.amount as bigint).toString(),
      price: (parsed.args.price as bigint).toString(),
      txHash: log.transactionHash.toLowerCase(),
      logIndex: log.index,
      blockNumber: log.blockNumber,
    });
  }
  return events;
}

export const auditEventsFromReceipt = (receipt: TransactionReceipt, vault: string, chainId: number) =>
  auditEventsFromLogs(receipt.logs, vault, chainId);

/** Where audit messages go: the live HCS topic (`HcsTopicSink`) or an in-memory sink in tests. */
export interface AuditSink {
  submit(message: string): Promise<{ sequenceNumber: number }>;
}

export class MemoryAuditSink implements AuditSink {
  readonly messages: string[] = [];
  async submit(message: string) {
    this.messages.push(message);
    return { sequenceNumber: this.messages.length };
  }
}

export type RelayedEntry = { event: AuditEvent; sequenceNumber: number };

/**
 * Submits every event whose (txHash, logIndex) is not already on the topic. Pass the decoded
 * messages already on the topic as `alreadyLogged` (from the mirror node) to make reruns safe.
 */
export async function relayAuditEvents(
  events: readonly AuditEvent[],
  sink: AuditSink,
  alreadyLogged: Iterable<Pick<AuditEvent, "txHash" | "logIndex">> = [],
): Promise<RelayedEntry[]> {
  const seen = new Set([...alreadyLogged].map(auditKey));
  const relayed: RelayedEntry[] = [];
  for (const event of events) {
    const key = auditKey(event);
    if (seen.has(key)) continue;
    seen.add(key);
    const { sequenceNumber } = await sink.submit(encodeAuditMessage(event));
    relayed.push({ event, sequenceNumber });
  }
  return relayed;
}
