import {
  AccountId,
  Client,
  PrivateKey,
  TopicCreateTransaction,
  TopicId,
  TopicMessageSubmitTransaction,
} from "@hashgraph/sdk";
import fs from "fs";
import path from "path";

import { type AuditSink, decodeAuditMessage, type AuditEvent } from "./hcsAudit";

/** Live Hedera SDK side of the HCS audit log (topic creation, message submit, mirror-node reads). */

export const MIRROR_NODE: Record<number, string> = {
  295: process.env.HEDERA_MIRROR_MAINNET_URL || "https://mainnet.mirrornode.hedera.com",
  296: process.env.HEDERA_MIRROR_TESTNET_URL || "https://testnet.mirrornode.hedera.com",
};

export const hashscanTopicUrl = (chainId: number, topicId: string) =>
  `https://hashscan.io/${chainId === 295 ? "mainnet" : "testnet"}/topic/${topicId}`;

/** Resolves the Hedera account id (0.0.x) behind an EVM address via the mirror node. */
export async function accountIdForEvmAddress(chainId: number, evmAddress: string): Promise<string> {
  const res = await fetch(`${MIRROR_NODE[chainId]}/api/v1/accounts/${evmAddress}`);
  if (!res.ok) throw new Error(`Mirror node: no Hedera account for ${evmAddress} (HTTP ${res.status}). Fund it first.`);
  const { account } = (await res.json()) as { account?: string };
  if (!account) throw new Error(`Mirror node: no Hedera account for ${evmAddress}`);
  return account;
}

/**
 * Builds an SDK client whose operator is the same ECDSA key Hardhat deploys with
 * (__RUNTIME_DEPLOYER_PRIVATE_KEY, set by `runHardhatWithPK.ts`). HEDERA_OPERATOR_ID overrides the
 * mirror-node lookup of the account id.
 */
export async function operatorClient(chainId: number, evmAddress: string) {
  const raw = process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY;
  if (!raw) throw new Error("No deployer key loaded (run through `npm run hardhat:deploy` / `hardhat:e2e:testnet`).");
  const key = PrivateKey.fromStringECDSA(raw.replace(/^0x/, ""));
  const accountId = AccountId.fromString(
    process.env.HEDERA_OPERATOR_ID || (await accountIdForEvmAddress(chainId, evmAddress)),
  );
  const client = chainId === 295 ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(accountId, key);
  return { client, key, accountId };
}

/** Creates the audit topic. Only the operator key can submit; no admin key, so the log cannot be deleted. */
export async function createAuditTopic(client: Client, key: PrivateKey, memo: string): Promise<string> {
  const tx = await new TopicCreateTransaction()
    .setTopicMemo(memo.slice(0, 100))
    .setSubmitKey(key.publicKey)
    .execute(client);
  const receipt = await tx.getReceipt(client);
  if (!receipt.topicId) throw new Error("TopicCreateTransaction returned no topic id");
  return receipt.topicId.toString();
}

export class HcsTopicSink implements AuditSink {
  constructor(
    private readonly client: Client,
    private readonly topicId: string,
  ) {}

  async submit(message: string) {
    const tx = await new TopicMessageSubmitTransaction()
      .setTopicId(TopicId.fromString(this.topicId))
      .setMessage(message)
      .execute(this.client);
    const receipt = await tx.getReceipt(this.client);
    return { sequenceNumber: Number(receipt.topicSequenceNumber) };
  }
}

/** Reads and decodes every audit message already on the topic (mirror node, paginated). */
export async function fetchLoggedAuditEvents(chainId: number, topicId: string): Promise<AuditEvent[]> {
  const base = MIRROR_NODE[chainId];
  const out: AuditEvent[] = [];
  let next: string | null = `/api/v1/topics/${topicId}/messages?limit=100&order=asc`;
  while (next) {
    const res = await fetch(`${base}${next}`);
    if (res.status === 404) break; // brand-new topic not yet ingested by the mirror node
    if (!res.ok) throw new Error(`Mirror node topic read failed: HTTP ${res.status}`);
    const page = (await res.json()) as { messages: { message: string }[]; links?: { next?: string | null } };
    for (const m of page.messages) {
      const event = decodeAuditMessage(Buffer.from(m.message, "base64").toString("utf8"));
      if (event) out.push(event);
    }
    next = page.links?.next ?? null;
  }
  return out;
}

/**
 * Topic ids per chain id live in packages/nextjs/contracts/hcsAuditTopics.json (committed, read by the
 * /vault page). Not under deployments/: hardhat-deploy would treat the file as a contract deployment.
 */
export type AuditTopicRecord = { topicId: string; vault: string; createdAt: string };

const TOPICS_FILE = path.join(__dirname, "..", "..", "nextjs", "contracts", "hcsAuditTopics.json");

const readTopics = (): Record<string, AuditTopicRecord> =>
  fs.existsSync(TOPICS_FILE) ? JSON.parse(fs.readFileSync(TOPICS_FILE, "utf8")) : {};

export const readAuditTopic = (chainId: number): AuditTopicRecord | null => readTopics()[String(chainId)] ?? null;

export function saveAuditTopic(chainId: number, record: AuditTopicRecord) {
  const topics = readTopics();
  topics[String(chainId)] = record;
  fs.writeFileSync(TOPICS_FILE, JSON.stringify(topics, null, 2) + "\n");
}
