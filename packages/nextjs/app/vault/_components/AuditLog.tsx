"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits } from "viem";
import {
  type AuditEntry,
  type AuditVerification,
  auditTopicFor,
  fetchAuditEntries,
  verifyAuditEntry,
} from "~~/utils/hcs/audit";

const explorer = (chainId: number) => `https://hashscan.io/${chainId === 295 ? "mainnet" : "testnet"}`;
const consensusTime = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000).toLocaleString();
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * Hedera Consensus Service audit log: an operator relays gated deposit/withdraw events to an HCS topic with
 * the EVM tx hash. Entries are read from the mirror node and each one is cross-checked against the
 * contract result and emitter. This checks recorded entries, not relay completeness.
 */
export const AuditLog = ({ chainId, vaultAddress }: { chainId: number; vaultAddress: string }) => {
  const topic = auditTopicFor(chainId);
  const [entries, setEntries] = useState<AuditEntry[]>();
  const [verified, setVerified] = useState<Record<number, AuditVerification>>({});
  const [loadedScope, setLoadedScope] = useState<string>();
  const scope = `${chainId}:${vaultAddress.toLowerCase()}:${topic?.topicId ?? ""}`;
  const [error, setError] = useState<string>();
  const sameVault = topic && topic.vault.toLowerCase() === vaultAddress.toLowerCase();

  useEffect(() => {
    if (!topic || !sameVault) return;
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const list = await fetchAuditEntries(chainId, topic.topicId);
        if (cancelled) return;
        setEntries(list);
        setLoadedScope(scope);
        setVerified({});
        setError(undefined);
        const results = await Promise.all(
          list.map(
            async entry => [entry.sequenceNumber, await verifyAuditEntry(chainId, vaultAddress, entry)] as const,
          ),
        );
        if (!cancelled) setVerified(Object.fromEntries(results));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        loading = false;
      }
    };
    load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [chainId, topic, sameVault, vaultAddress, scope]);

  if (!topic || !sameVault) {
    return (
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 space-y-1">
        <p className="text-sm uppercase tracking-wider text-base-content/60 m-0">Audit log (HCS)</p>
        <p className="text-sm m-0">
          No Hedera Consensus Service topic for this vault yet. Deploying to Hedera creates one; then
          <code className="mx-1">npm run hardhat:hcs:relay</code>appends every deposit and withdrawal.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm uppercase tracking-wider text-base-content/60 m-0">
          Audit log (Hedera Consensus Service)
        </p>
        <a className="link link-primary text-sm" href={`${explorer(chainId)}/topic/${topic.topicId}`} target="_blank">
          Topic {topic.topicId}
        </a>
      </div>
      <p className="text-xs text-base-content/70 m-0">
        Operator-relayed records. Verified means this entry matches this vault on the selected network; it does not
        prove that every event has been recorded. New wallet actions appear after the operator runs the relay.
      </p>
      {error && <p className="text-error text-sm m-0">Mirror node: {error}</p>}
      {!entries || loadedScope !== scope ? (
        <div className="h-16 rounded bg-base-200 animate-pulse" />
      ) : entries.length === 0 ? (
        <p className="text-sm m-0">No entries yet. Make a deposit, then run npm run hardhat:hcs:relay.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>#</th>
                <th>Consensus time</th>
                <th>Action</th>
                <th>User</th>
                <th>HBAR/USD</th>
                <th>EVM tx</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr key={e.sequenceNumber}>
                  <td className="font-mono">{e.sequenceNumber}</td>
                  <td className="text-xs">{consensusTime(e.consensusTimestamp)}</td>
                  <td>
                    {e.kind} {formatEther(e.amount)} HTK
                  </td>
                  <td className="font-mono text-xs">{short(e.user)}</td>
                  <td className="font-mono">${formatUnits(e.price, 8)}</td>
                  <td>
                    <a
                      className="link link-primary font-mono text-xs"
                      href={`${explorer(chainId)}/transaction/${e.txHash}`}
                      target="_blank"
                    >
                      {short(e.txHash)}
                    </a>
                    {verified[e.sequenceNumber] === undefined ? null : verified[e.sequenceNumber] === "verified" ? (
                      <span
                        className="badge badge-success badge-sm ml-2"
                        title="Matches this vault’s event on the selected network; completeness is not proven"
                      >
                        verified
                      </span>
                    ) : (
                      <span
                        className={`badge ${verified[e.sequenceNumber] === "unknown" ? "badge-warning" : "badge-error"} badge-sm ml-2`}
                        title="Mirror unavailable or entry does not match the selected vault"
                      >
                        {verified[e.sequenceNumber]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
