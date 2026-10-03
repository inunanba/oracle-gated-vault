import { decodeEventLog, parseAbi } from "viem";
import hcsAuditTopics from "~~/contracts/hcsAuditTopics.json";

/** Browser side of the HCS audit log (schema mirrors packages/hardhat/utils/hcsAudit.ts). */
export const AUDIT_SCHEMA = "ogv.audit/1";

export type AuditEntry = {
  sequenceNumber: number;
  consensusTimestamp: string;
  kind: "deposit" | "withdraw";
  vault: string;
  user: string;
  amount: bigint;
  price: bigint;
  txHash: `0x${string}`;
  logIndex: number;
};

export type AuditTopic = { topicId: string; vault: string; createdAt: string };

export const MIRROR_NODE: Record<number, string> = {
  295: "https://mainnet.mirrornode.hedera.com",
  296: "https://testnet.mirrornode.hedera.com",
};

export const auditTopicFor = (chainId: number): AuditTopic | undefined =>
  (hcsAuditTopics as Record<string, AuditTopic>)[String(chainId)];

const VAULT_EVENTS = parseAbi([
  "event Deposited(address indexed user, uint256 amount, uint256 price)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 price)",
]);

const decodeBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));

type MirrorTopicMessage = { sequence_number: number; consensus_timestamp: string; message: string };

/** Latest audit entries on the topic (newest first); non-audit messages are skipped. */
export async function fetchAuditEntries(chainId: number, topicId: string, limit = 10): Promise<AuditEntry[]> {
  const res = await fetch(`${MIRROR_NODE[chainId]}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`);
  if (!res.ok) throw new Error(`Mirror node HTTP ${res.status}`);
  const { messages } = (await res.json()) as { messages: MirrorTopicMessage[] };
  const entries: AuditEntry[] = [];
  for (const m of messages) {
    try {
      const w = JSON.parse(decodeBase64(m.message));
      if (w.s !== AUDIT_SCHEMA || (w.k !== "deposit" && w.k !== "withdraw")) continue;
      entries.push({
        sequenceNumber: m.sequence_number,
        consensusTimestamp: m.consensus_timestamp,
        kind: w.k,
        vault: w.v,
        user: w.u,
        amount: BigInt(w.a),
        price: BigInt(w.p),
        txHash: w.tx,
        logIndex: w.li,
      });
    } catch {
      // not an audit message
    }
  }
  return entries;
}

type MirrorContractResult = { result: string; logs: { index: number; topics: `0x${string}`[]; data: `0x${string}` }[] };

/**
 * Cross-checks one HCS entry against the EVM side: the referenced transaction succeeded and its log
 * at `logIndex` is the same vault event with the same user, amount and price.
 */
export async function verifyAuditEntry(chainId: number, entry: AuditEntry): Promise<boolean> {
  const res = await fetch(`${MIRROR_NODE[chainId]}/api/v1/contracts/results/${entry.txHash}`);
  if (!res.ok) return false;
  const result = (await res.json()) as MirrorContractResult;
  if (result.result !== "SUCCESS") return false;
  const log = result.logs.find(l => l.index === entry.logIndex);
  if (!log || log.topics.length === 0) return false;
  try {
    const decoded = decodeEventLog({
      abi: VAULT_EVENTS,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      data: log.data,
    });
    const args = decoded.args as { user: string; amount: bigint; price: bigint };
    return (
      decoded.eventName === (entry.kind === "deposit" ? "Deposited" : "Withdrawn") &&
      args.user.toLowerCase() === entry.user.toLowerCase() &&
      args.amount === entry.amount &&
      args.price === entry.price
    );
  } catch {
    return false;
  }
}
