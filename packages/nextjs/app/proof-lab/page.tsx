"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import fixture from "./fixture.json";
import { decodeEventLog, encodeAbiParameters, formatUnits, parseAbi } from "viem";
import { type AuditEvidence, decodeAuditEntry, verifyAuditEvidence } from "~~/utils/hcs/verification";

const scenarios = [
  ["valid", "Valid admission"],
  ["amount", "Change the amount"],
  ["emitter", "Substitute the vault"],
  ["future", "Future observation"],
  ["band", "Violate the band"],
  ["offline", "Mirror unavailable"],
] as const;
type Scenario = (typeof scenarios)[number][0];
const admissionAbi = parseAbi([
  "event AdmissionRecorded(address indexed user, bool depositAction, address indexed source, uint256 price, uint256 observedAt, uint256 minimum, uint256 maximum, uint256 freshnessWindow, uint256 evaluatedAt)",
]);

/** Explicit replay mode. Production verification retains its real network fetcher. */
async function replay(scenario: Scenario): Promise<AuditEvidence> {
  const wire = { ...fixture.entry, ...(scenario === "amount" ? { a: "11" } : {}) };
  const result = structuredClone(fixture.result);
  if (scenario === "emitter") result.logs.find(l => l.index === wire.li)!.address = "0x" + "cd".repeat(20);
  if (scenario === "future" || scenario === "band") {
    const log = result.logs.find(l => l.index === wire.li + 1)!;
    const p = decodeEventLog({
      abi: admissionAbi,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
      data: log.data as `0x${string}`,
    }).args;
    log.data = encodeAbiParameters(
      [{ type: "bool" }, ...Array.from({ length: 6 }, () => ({ type: "uint256" }))],
      [
        p.depositAction,
        p.price,
        scenario === "future" ? p.evaluatedAt + 1n : p.observedAt,
        scenario === "band" ? p.price + 1n : p.minimum,
        p.maximum,
        p.freshnessWindow,
        p.evaluatedAt,
      ],
    );
  }
  const fetcher: typeof fetch = async input =>
    new Response(
      scenario === "offline"
        ? "Unavailable"
        : JSON.stringify(String(input).includes("/results/") ? result : fixture.contract),
      { status: scenario === "offline" ? 503 : 200, headers: { "Content-Type": "application/json" } },
    );
  const entry = decodeAuditEntry(JSON.stringify(wire), 1, "1.000000001")!;
  return verifyAuditEvidence(296, fixture.vault, entry, fetcher);
}

export default function ProofLab() {
  const [scenario, setScenario] = useState<Scenario>("valid");
  const [evidence, setEvidence] = useState<AuditEvidence>();
  useEffect(() => {
    let active = true;
    setEvidence(undefined);
    replay(scenario).then(result => {
      if (active) setEvidence(result);
    });
    return () => {
      active = false;
    };
  }, [scenario]);
  return (
    <main className="max-w-5xl mx-auto w-full px-5 py-10 space-y-6">
      <div>
        <p className="text-primary uppercase text-xs tracking-widest font-semibold">
          Oracle-gated Vault · receipt verifier
        </p>
        <h1 className="text-4xl font-bold mb-3">Try to break the evidence.</h1>
        <p className="text-base-content/75 max-w-3xl">
          A matching transfer is only the first check. The next check reconstructs the price, observation time and
          policy used to admit it.
        </p>
      </div>
      <div className="alert border border-warning/40 bg-warning/10 text-sm block">
        <strong>LOCAL REPLAY · no wallet, no live transactions.</strong> The action and policy logs come from a real
        local Hardhat deposit. Contract identity, Hedera network and HCS envelope are fixtures. This page changes
        fixture inputs and runs the same verifier as the live audit panel.
      </div>
      <div className="flex flex-wrap gap-2">
        {scenarios.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setScenario(id)}
            className={`btn btn-sm ${scenario === id ? "btn-primary" : "btn-outline"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <section className="rounded-2xl bg-base-100 border border-base-300 p-6 space-y-4">
          <h2 className="text-xl font-semibold m-0">1 · Match the action</h2>
          <p className="text-sm m-0">
            Successful receipt → independently resolved vault → exact log → action, user, amount and price.
          </p>
          <p
            data-testid="receipt-status"
            className={`text-3xl uppercase font-bold m-0 ${evidence?.receipt === "verified" ? "text-emerald-700 dark:text-emerald-300" : evidence?.receipt === "mismatch" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}
          >
            {evidence?.receipt ?? "checking"}
          </p>
          <p className="text-xs m-0 text-base-content/65">
            A foreign emitter or changed amount cannot pass this check.
          </p>
        </section>
        <section className="rounded-2xl bg-base-100 border border-base-300 p-6 space-y-4">
          <h2 className="text-xl font-semibold m-0">2 · Explain the admission</h2>
          <p className="text-sm m-0">
            Same vault, adjacent policy event → matching user/action/price → band and observation age.
          </p>
          <p
            data-testid="admission-status"
            className={`text-3xl uppercase font-bold m-0 ${evidence?.admission === "verified" ? "text-emerald-700 dark:text-emerald-300" : evidence?.admission === "mismatch" ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"}`}
          >
            {evidence?.admission ?? "checking"}
          </p>
          <p className="text-xs m-0 text-base-content/65">
            Receipt verification can succeed while admission evidence fails.
          </p>
        </section>
      </div>
      {evidence?.policy && (
        <div className="rounded-2xl bg-base-100 border border-base-300 p-5">
          <h2 className="text-lg font-semibold mt-0">Policy captured at the action</h2>
          <table className="table table-sm">
            <tbody>
              <tr>
                <th>Admission price</th>
                <td>${formatUnits(BigInt(fixture.entry.p), 8)}</td>
              </tr>
              <tr>
                <th>Allowed band</th>
                <td>
                  ${formatUnits(evidence.policy.minimum, 8)}–${formatUnits(evidence.policy.maximum, 8)}
                </td>
              </tr>
              <tr>
                <th>Observation age / maximum</th>
                <td>
                  {String(evidence.policy.evaluatedAt - evidence.policy.observedAt)}s /{" "}
                  {String(evidence.policy.freshnessWindow)}s
                </td>
              </tr>
              <tr>
                <th>Price source</th>
                <td className="font-mono break-all text-xs">{evidence.policy.source}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-base-content/65 mb-0">
            Historical settings come from the receipt. Changing today&apos;s owner configuration does not rewrite them.
          </p>
        </div>
      )}
      <p className="text-sm text-base-content/70">
        UNKNOWN means there is insufficient evidence. Verification depends on the receipt provider and chosen oracle; it
        does not prove market-price truth, safe custody or that every action reached HCS.
      </p>
      <Link href="/vault" className="link link-primary">
        Open the live vault audit panel →
      </Link>
    </main>
  );
}
