"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchHermesPrice } from "~~/utils/oracle/pyth";

/** Off-chain HBAR/USD price straight from Pyth Hermes. Works before any contract is deployed. */
export const LivePythPrice = ({ feedId }: { feedId: string }) => {
  const { data, error, isLoading } = useQuery({
    queryKey: ["hermes-price", feedId],
    queryFn: () => fetchHermesPrice(feedId),
    refetchInterval: 10_000,
  });

  return (
    <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300">
      <p className="text-sm uppercase tracking-wider text-base-content/60 m-0">Pyth HBAR/USD (Hermes, off-chain)</p>
      {isLoading && <div className="h-10 w-40 mt-2 rounded bg-base-200 animate-pulse" />}
      {error && <p className="text-error text-sm mt-2">Could not reach Hermes: {(error as Error).message}</p>}
      {data && (
        <>
          <p className="text-4xl font-bold my-2">${data.price.toFixed(5)}</p>
          <p className="text-sm text-base-content/70 m-0">
            ± ${data.confidence.toFixed(5)} · published {new Date(data.publishTime * 1000).toLocaleTimeString()}
          </p>
        </>
      )}
    </div>
  );
};
