"use client";

import { formatUnits } from "viem";
import { useScaffoldReadContract } from "~~/hooks/scaffold-hbar";
import { PRICE_DECIMALS } from "~~/utils/oracle/chainlink";

const usd = (value?: bigint) => (value === undefined ? "…" : `$${formatUnits(value, PRICE_DECIMALS)}`);

/** On-chain view of the gate: the price the vault will use, its age and the configured band. */
export const GateStatus = () => {
  const { data: gate } = useScaffoldReadContract({ contractName: "OracleGatedVault", functionName: "previewGate" });
  const { data: minPrice } = useScaffoldReadContract({ contractName: "OracleGatedVault", functionName: "minPrice" });
  const { data: maxPrice } = useScaffoldReadContract({ contractName: "OracleGatedVault", functionName: "maxPrice" });
  const { data: maxStaleness } = useScaffoldReadContract({
    contractName: "OracleGatedVault",
    functionName: "maxStaleness",
  });
  const { data: totalDeposits } = useScaffoldReadContract({
    contractName: "OracleGatedVault",
    functionName: "totalDeposits",
  });

  const [price, updatedAt, fresh, inBand] = gate ?? [];
  const ageSeconds =
    updatedAt !== undefined ? Math.max(0, Math.floor(Date.now() / 1000) - Number(updatedAt)) : undefined;
  const open = fresh && inBand;

  return (
    <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm uppercase tracking-wider text-base-content/60 m-0">Gate (on-chain)</p>
        {gate && (
          <span className={`badge ${open ? "badge-success" : "badge-warning"}`}>{open ? "OPEN" : "CLOSED"}</span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-y-1 text-sm">
        <dt className="text-base-content/60">Stored oracle price</dt>
        <dd className="font-mono">{usd(price)}</dd>
        <dt className="text-base-content/60">Price age</dt>
        <dd className="font-mono">
          {ageSeconds === undefined ? "…" : `${ageSeconds}s`} {fresh === false && "(stale)"}
        </dd>
        <dt className="text-base-content/60">Allowed band</dt>
        <dd className="font-mono">
          {usd(minPrice)} – {usd(maxPrice)}
        </dd>
        <dt className="text-base-content/60">Max staleness</dt>
        <dd className="font-mono">{maxStaleness === undefined ? "…" : `${maxStaleness}s`}</dd>
        <dt className="text-base-content/60">Total deposits</dt>
        <dd className="font-mono">{totalDeposits === undefined ? "…" : formatUnits(totalDeposits, 18)} HTK</dd>
      </dl>
      {gate && !fresh && (
        <p className="text-xs text-base-content/70 m-0">
          The oracle has not published within the staleness window, so the vault is closed until the next round.
        </p>
      )}
    </div>
  );
};
