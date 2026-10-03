"use client";

import { useState } from "react";
import { formatEther, parseEther } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-hbar";
import { DEFAULT_FEED_ID, TINYBAR_TO_WEIBAR, fetchPriceUpdateData } from "~~/utils/oracle/pyth";
import { notification } from "~~/utils/scaffold-hbar";

const HEDERA_CHAIN_IDS = new Set([295, 296]);

/**
 * Deposit / withdraw panel. On Hedera networks each action fetches a signed Pyth update from Hermes
 * and calls the `*WithPriceUpdate` variant so the gate is evaluated against a price seconds old.
 * On the local chain (MockPriceOracle) it calls plain `deposit` / `withdraw`.
 */
export const VaultActions = ({ vaultAddress }: { vaultAddress: string }) => {
  const { address } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const usesPullOracle = HEDERA_CHAIN_IDS.has(targetNetwork.id);
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const { data: vault } = useDeployedContractInfo({ contractName: "OracleGatedVault" });
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
      // useTransactor already shows the decoded revert reason (e.g. PriceOutOfBand)
      console.error(e);
    } finally {
      setBusy(undefined);
    }
  };

  const gated = async (functionName: "deposit" | "withdraw") => {
    if (!parsedAmount) return notification.error("Enter a valid amount");
    if (!usesPullOracle) {
      return writeVault({ functionName, args: [parsedAmount] });
    }
    if (!publicClient || !vault) throw new Error("Vault not loaded");
    const updateData = await fetchPriceUpdateData(DEFAULT_FEED_ID);
    // Fee is quoted in tinybars (Hedera's in-EVM unit); the wallet sends weibars.
    const feeTinybars = (await publicClient.readContract({
      address: vault.address,
      abi: vault.abi,
      functionName: "getUpdateFee",
      args: [updateData],
    })) as bigint;
    return writeVault({
      functionName: functionName === "deposit" ? "depositWithPriceUpdate" : "withdrawWithPriceUpdate",
      args: [parsedAmount, updateData],
      value: feeTinybars * TINYBAR_TO_WEIBAR,
      gas: 600_000n,
    });
  };

  if (!address) {
    return (
      <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
        <p className="m-0">Connect a wallet to deposit and withdraw.</p>
      </div>
    );
  }

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
          onClick={() => run("faucet", () => writeToken({ functionName: "faucet" }))}
        >
          {busy === "faucet" ? <span className="loading loading-spinner loading-xs" /> : "Get 100 demo HTK"}
        </button>
        {needsApproval ? (
          <button
            className="btn btn-primary btn-sm"
            disabled={!!busy}
            onClick={() =>
              run("approve", () => writeToken({ functionName: "approve", args: [vaultAddress, parsedAmount] }))
            }
          >
            {busy === "approve" ? <span className="loading loading-spinner loading-xs" /> : "Approve"}
          </button>
        ) : (
          <button
            className="btn btn-primary btn-sm"
            disabled={!!busy}
            onClick={() => run("deposit", () => gated("deposit"))}
          >
            {busy === "deposit" ? <span className="loading loading-spinner loading-xs" /> : "Deposit"}
          </button>
        )}
        <button
          className="btn btn-secondary btn-sm"
          disabled={!!busy}
          onClick={() => run("withdraw", () => gated("withdraw"))}
        >
          {busy === "withdraw" ? <span className="loading loading-spinner loading-xs" /> : "Withdraw"}
        </button>
      </div>

      <p className="text-xs text-base-content/60 m-0">
        {usesPullOracle
          ? "Each action fetches a signed HBAR/USD update from Pyth Hermes and verifies it on-chain in the same transaction (Pyth fee: 1 tinybar)."
          : "Local chain: the vault reads MockPriceOracle. Move the price with setPrice on the Debug page to see the gate close."}
      </p>
    </div>
  );
};
