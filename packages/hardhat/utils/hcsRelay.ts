import {
  type AuditEvent,
  auditEventsFromLogs,
  relayAuditEvents,
  type RelayedEntry,
  requireEvmTransactionHash,
} from "./hcsAudit";
import { HcsTopicSink, MIRROR_NODE, fetchLoggedAuditEvents, operatorClient } from "./hcsClient";

type MirrorLog = {
  address: string;
  data: string;
  topics: string[];
  transaction_hash: string;
  index: number;
  block_number: number;
};

/** All Deposited/Withdrawn events the vault ever emitted, read from the mirror node (no eth_getLogs range limits). */
export async function fetchVaultAuditEvents(chainId: number, vault: string): Promise<AuditEvent[]> {
  const logs: MirrorLog[] = [];
  let next: string | null = `/api/v1/contracts/${vault}/results/logs?order=asc&limit=100`;
  while (next) {
    const res = await fetch(`${MIRROR_NODE[chainId]}${next}`);
    if (!res.ok) throw new Error(`Mirror node log read failed: HTTP ${res.status}`);
    const page = (await res.json()) as { logs: MirrorLog[]; links?: { next?: string | null } };
    logs.push(...page.logs);
    next = page.links?.next ?? null;
  }
  return auditEventsFromLogs(
    logs.map(l => ({
      address: vault, // the mirror node reports the long-zero address; the query is already scoped to the vault
      topics: l.topics,
      data: l.data,
      transactionHash: requireEvmTransactionHash(l.transaction_hash),
      index: l.index,
      blockNumber: l.block_number,
    })),
    vault,
    chainId,
  );
}

/** Appends `events` (or, when omitted, every vault event from the mirror node) that are not yet on the topic. */
export async function relayToTopic(opts: {
  chainId: number;
  topicId: string;
  operatorEvm: string;
  vault: string;
  events?: AuditEvent[];
}): Promise<RelayedEntry[]> {
  const events = opts.events ?? (await fetchVaultAuditEvents(opts.chainId, opts.vault));
  const logged = await fetchLoggedAuditEvents(opts.chainId, opts.topicId);
  const { client } = await operatorClient(opts.chainId, opts.operatorEvm);
  try {
    return await relayAuditEvents(events, new HcsTopicSink(client, opts.topicId), logged);
  } finally {
    client.close();
  }
}
