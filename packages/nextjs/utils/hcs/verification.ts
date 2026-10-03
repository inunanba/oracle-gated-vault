import { decodeEventLog, parseAbi } from "viem";

export const AUDIT_SCHEMA = "ogv.audit/1";
export const MIRROR_NODE: Record<number, string> = {
  295: "https://mainnet.mirrornode.hedera.com",
  296: "https://testnet.mirrornode.hedera.com",
};
export type AuditEntry = {
  sequenceNumber: number;
  consensusTimestamp: string;
  chainId: number;
  kind: "deposit" | "withdraw";
  vault: string;
  user: string;
  amount: bigint;
  price: bigint;
  txHash: `0x${string}`;
  logIndex: number;
};
export type AuditVerification = "verified" | "mismatch" | "unknown";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const UINT = /^[0-9]+$/;
const EVENTS = parseAbi([
  "event Deposited(address indexed user, uint256 amount, uint256 price)",
  "event Withdrawn(address indexed user, uint256 amount, uint256 price)",
]);
const sameAddress = (a: unknown, b: string) =>
  typeof a === "string" && ADDRESS.test(a) && a.toLowerCase() === b.toLowerCase();
const nonnegativeInteger = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;

/** Decode the existing wire schema without trusting its claimed chain or vault. */
export function decodeAuditEntry(
  message: string,
  sequenceNumber: number,
  consensusTimestamp: string,
): AuditEntry | null {
  try {
    const w = JSON.parse(message);
    if (
      !w ||
      w.s !== AUDIT_SCHEMA ||
      (w.k !== "deposit" && w.k !== "withdraw") ||
      !nonnegativeInteger(w.c) ||
      !nonnegativeInteger(w.li) ||
      !nonnegativeInteger(w.b) ||
      !nonnegativeInteger(sequenceNumber) ||
      sequenceNumber < 1 ||
      typeof consensusTimestamp !== "string" ||
      !/^\d+\.\d+$/.test(consensusTimestamp) ||
      typeof w.v !== "string" ||
      !ADDRESS.test(w.v) ||
      typeof w.u !== "string" ||
      !ADDRESS.test(w.u) ||
      typeof w.tx !== "string" ||
      !HASH.test(w.tx) ||
      typeof w.a !== "string" ||
      !UINT.test(w.a) ||
      typeof w.p !== "string" ||
      !UINT.test(w.p)
    )
      return null;
    return {
      sequenceNumber,
      consensusTimestamp,
      chainId: w.c,
      kind: w.k,
      vault: w.v,
      user: w.u,
      amount: BigInt(w.a),
      price: BigInt(w.p),
      txHash: w.tx,
      logIndex: w.li,
    };
  } catch {
    return null;
  }
}

/** Numeric contract ID encoded as a 4-byte shard, 8-byte realm and 8-byte number. */
function longZeroAddress(id: unknown): string | undefined {
  if (typeof id !== "string" || !/^\d+\.\d+\.\d+$/.test(id)) return;
  const parts = id.split(".").map(BigInt);
  const widths = [8, 16, 16];
  if (parts.some((part, i) => part >= 1n << BigInt(widths[i] * 4))) return;
  return "0x" + parts.map((part, i) => part.toString(16).padStart(widths[i], "0")).join("");
}

/** Receipt matching proves this entry, not completeness or exactly-once relay delivery. */
export async function verifyAuditEntry(
  chainId: number,
  expectedVault: string,
  entry: AuditEntry,
): Promise<AuditVerification> {
  const base = MIRROR_NODE[chainId];
  if (!base) return "unknown";
  if (
    !ADDRESS.test(expectedVault) ||
    entry.chainId !== chainId ||
    !sameAddress(entry.vault, expectedVault) ||
    !ADDRESS.test(entry.user) ||
    !HASH.test(entry.txHash) ||
    !nonnegativeInteger(entry.logIndex) ||
    entry.amount < 0n ||
    entry.price < 0n
  )
    return "mismatch";
  try {
    // Resolve the configured vault independently of the message/transaction being checked.
    const contractResponse = await fetch(`${base}/api/v1/contracts/${expectedVault}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!contractResponse.ok) return "unknown";
    const contract = await contractResponse.json();
    const numericAddress = longZeroAddress(contract.contract_id);
    if (
      !numericAddress ||
      (!sameAddress(contract.evm_address, expectedVault) && !sameAddress(numericAddress, expectedVault))
    )
      return "unknown";
    const response = await fetch(`${base}/api/v1/contracts/results/${entry.txHash}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return "unknown";
    const result = await response.json();
    if (typeof result.result !== "string" || !Array.isArray(result.logs)) return "unknown";
    if (result.result !== "SUCCESS") return "mismatch";
    const log = result.logs.find((l: { index?: number }) => l.index === entry.logIndex);
    if (!log) return "mismatch";
    if (typeof log.address !== "string" || !ADDRESS.test(log.address)) return "unknown";
    if (!sameAddress(log.address, expectedVault) && !sameAddress(log.address, numericAddress)) return "mismatch";
    if (typeof log.contract_id === "string" && log.contract_id !== contract.contract_id) return "mismatch";
    if (!Array.isArray(log.topics) || !log.topics.length || typeof log.data !== "string") return "unknown";
    const decoded = decodeEventLog({
      abi: EVENTS,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      data: log.data as `0x${string}`,
    });
    const args = decoded.args as { user: string; amount: bigint; price: bigint };
    return decoded.eventName === (entry.kind === "deposit" ? "Deposited" : "Withdrawn") &&
      sameAddress(args.user, entry.user) &&
      args.amount === entry.amount &&
      args.price === entry.price
      ? "verified"
      : "mismatch";
  } catch {
    return "unknown";
  }
}
