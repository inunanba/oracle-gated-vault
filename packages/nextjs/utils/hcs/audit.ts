import { type AuditEntry, MIRROR_NODE, decodeAuditEntry } from "./verification";
import hcsAuditTopics from "~~/contracts/hcsAuditTopics.json";

export { AUDIT_SCHEMA, MIRROR_NODE, verifyAuditEntry, verifyAuditEvidence } from "./verification";
export type { AuditEntry, AuditVerification, AuditEvidence } from "./verification";

export type AuditTopic = { topicId: string; vault: string; createdAt: string };

export const auditTopicFor = (chainId: number): AuditTopic | undefined =>
  (hcsAuditTopics as Record<string, AuditTopic>)[String(chainId)];

const decodeBase64 = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64), c => c.charCodeAt(0)));
type MirrorTopicMessage = { sequence_number: number; consensus_timestamp: string; message: string };

/** Latest well-formed audit entries; the verifier separately checks chain and vault identity. */
export async function fetchAuditEntries(chainId: number, topicId: string, limit = 10): Promise<AuditEntry[]> {
  if (!MIRROR_NODE[chainId]) throw new Error("Unsupported mirror network");
  const res = await fetch(`${MIRROR_NODE[chainId]}/api/v1/topics/${topicId}/messages?order=desc&limit=${limit}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Mirror node HTTP ${res.status}`);
  const { messages } = (await res.json()) as { messages: MirrorTopicMessage[] };
  if (!Array.isArray(messages)) throw new Error("Invalid mirror topic response");
  const entries: AuditEntry[] = [];
  for (const m of messages) {
    try {
      const entry = decodeAuditEntry(decodeBase64(m.message), m.sequence_number, m.consensus_timestamp);
      if (entry) entries.push(entry);
    } catch {
      // Ignore malformed/non-audit messages; absence is not a completeness proof.
    }
  }
  return entries;
}
