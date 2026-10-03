"use client";

import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { CHAINLINK_HBAR_USD, aggregatorV3Abi } from "~~/utils/oracle/chainlink";

/**
 * Reads the Chainlink HBAR/USD feed directly from Hedera, so the card works before any vault is deployed.
 * On the local chain it falls back to Hedera testnet.
 */
export const LiveFeedPrice = () => {
  const { targetNetwork } = useTargetNetwork();
  const chainId = CHAINLINK_HBAR_USD[targetNetwork.id] ? targetNetwork.id : 296;
  const address = CHAINLINK_HBAR_USD[chainId];
  const explorer = chainId === 295 ? "https://hashscan.io/mainnet" : "https://hashscan.io/testnet";

  const {
    data: round,
    error,
    isLoading,
  } = useReadContract({
    address,
    abi: aggregatorV3Abi,
    functionName: "latestRoundData",
    chainId,
    query: { refetchInterval: 15_000 },
  });
  const { data: decimals } = useReadContract({ address, abi: aggregatorV3Abi, functionName: "decimals", chainId });

  return (
    <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
      <p className="text-sm uppercase tracking-wider text-base-content/60 m-0">
        Chainlink HBAR/USD · {chainId === 295 ? "mainnet" : "testnet"}
      </p>
      {isLoading && <div className="h-10 w-40 mt-2 rounded bg-base-200 animate-pulse" />}
      {error && <p className="text-error text-sm mt-2">Could not read the feed: {error.message.split("\n")[0]}</p>}
      {round && decimals !== undefined && (
        <>
          <p className="text-4xl font-bold my-2">${Number(formatUnits(round[1], decimals)).toFixed(5)}</p>
          <p className="text-sm text-base-content/70 m-0">
            round {round[0].toString()} · updated {new Date(Number(round[3]) * 1000).toLocaleString()}
          </p>
        </>
      )}
      <a
        className="link link-primary text-xs"
        href={`${explorer}/contract/${address}`}
        target="_blank"
        rel="noreferrer"
      >
        Feed on HashScan
      </a>
    </div>
  );
};
