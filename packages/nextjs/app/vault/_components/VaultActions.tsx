"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { notification } from "~~/utils/scaffold-hbar";

/**
 * Faucet / approve / deposit / withdraw panel. Every vault call is checked on-chain against the oracle;
 * a closed gate surfaces as a decoded revert (PriceOutOfBand, StalePrice) in the transaction toast.
 */
export const VaultActions = ({ vaultAddress }: { vaultAddress: string }) => {
  const { address } = useAccount();
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState<string>();

  const { data: walletBalance } = useScaffoldReadContract({
    contractName: "HederaToken",
    functionName: "balanceOf",
    args: [address],
  });
  const { data: allowance } = useScaffoldReadContract({
    contractName: "HederaToken",
    functionName: "allowance",
    args: [address, vaultAddress],
  });
  const { data: vaultBalance } = useScaffoldReadContract({
    contractName: "OracleGatedVault",
    functionName: "balances",
    args: [address],
  });

  const { writeContractAsync: writeToken } = useScaffoldWriteContract({ contractName: "HederaToken" });
  const { writeContractAsync: writeVault } = useScaffoldWriteContract({ contractName: "OracleGatedVault" });

  let parsedAmount: bigint | undefined;
  try {
    parsedAmount = amount ? parseEther(amount) : undefined;
  } catch {
    parsedAmount = undefined;
  }
  const needsApproval = parsedAmount !== undefined && (allowance ?? 0n) < parsedAmount;

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await action();
    } catch (e) {
      // useTransactor already shows the decoded revert reason
      console.error(e);
    } finally {
      setBusy(undefined);
    }
  };

  const gated = (functionName: "deposit" | "withdraw") => {
    if (!parsedAmount) {
      notification.error("Enter a valid amount");
      return Promise.resolve();
    }
    // Explicit gas: Hedera charges for the limit, and estimation of a reverting call fails early.
    return writeVault({ functionName, args: [parsedAmount], gas: 300_000n });
  };

  if (!address) {
    return (
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
        <p className="m-0">Connect a wallet to deposit and withdraw.</p>
      </div>
    );
  }

  const spinner = <span className="loading loading-spinner loading-xs" />;

  return (
    <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 space-y-4">
      <div className="grid grid-cols-2 gap-y-1 text-sm">
        <span className="text-base-content/60">Wallet HTK</span>
        <span className="font-mono">{walletBalance === undefined ? "…" : formatEther(walletBalance)}</span>
        <span className="text-base-content/60">Your vault balance</span>
        <span className="font-mono">{vaultBalance === undefined ? "…" : formatEther(vaultBalance)}</span>
      </div>

      <input
        className="input input-bordered w-full"
        inputMode="decimal"
        value={amount}
        onChange={e => setAmount(e.target.value)}
        placeholder="Amount of HTK"
      />

      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-outline btn-sm"
          disabled={!!busy}
          onClick={() => run("faucet", () => writeToken({ functionName: "faucet", gas: 150_000n }))}
        >
          {busy === "faucet" ? spinner : "Get 100 demo HTK"}
        </button>
        {needsApproval ? (
          <button
            className="btn btn-primary btn-sm"
            disabled={!!busy}
            onClick={() =>
              run("approve", () => writeToken({ functionName: "approve", args: [vaultAddress, parsedAmount] }))
            }
          >
            {busy === "approve" ? spinner : "Approve"}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            disabled={!!busy}
            onClick={() => run("deposit", () => gated("deposit"))}
          >
            {busy === "deposit" ? spinner : "Deposit"}
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          disabled={!!busy}
          onClick={() => run("withdraw", () => gated("withdraw"))}
        >
          {busy === "withdraw" ? spinner : "Withdraw"}
        </button>
      </div>
    </div>
  );
};
