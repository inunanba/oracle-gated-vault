"use client";

import Link from "next/link";
import { GateStatus } from "./_components/GateStatus";
import { LivePythPrice } from "./_components/LivePythPrice";
import { VaultActions } from "./_components/VaultActions";
import type { NextPage } from "next";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { DEFAULT_FEED_ID } from "~~/utils/oracle/pyth";

const hashscanBase = (chainId: number) =>
  chainId === 295 ? "https://hashscan.io/mainnet" : chainId === 296 ? "https://hashscan.io/testnet" : undefined;

const VaultPage: NextPage = () => {
  const { targetNetwork } = useTargetNetwork();
  const { data: vault, isLoading } = useDeployedContractInfo({ contractName: "OracleGatedVault" });
  const explorer = hashscanBase(targetNetwork.id);

  return (
    <div className="flex flex-col items-center grow px-5 py-10">
      <div className="max-w-4xl w-full space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">Oracle-gated Vault</h1>
          <p className="text-base-content/80 m-0">
            Deposits and withdrawals only go through while the Pyth HBAR/USD price is fresh and inside the vault&apos;s
            band. The price is pulled from Pyth Hermes and verified on Hedera in the same transaction.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <LivePythPrice feedId={DEFAULT_FEED_ID} />
          {vault ? <GateStatus /> : null}
        </div>

        {isLoading ? (
          <div className="h-24 rounded-2xl bg-base-200 animate-pulse" />
        ) : vault ? (
          <>
            <VaultActions vaultAddress={vault.address} />
            {explorer && (
              <p className="text-sm m-0">
                Vault on HashScan:{" "}
                <a
                  className="link link-primary break-all"
                  href={`${explorer}/contract/${vault.address}`}
                  target="_blank"
                >
                  {vault.address}
                </a>
              </p>
            )}
          </>
        ) : (
          <div className="bg-base-100 rounded-2xl shadow p-6 border border-base-300 space-y-2">
            <h2 className="text-xl font-semibold m-0">No vault deployed on {targetNetwork.name}</h2>
            <p className="text-sm m-0">Deploy one, then reload this page:</p>
            <pre className="bg-base-200 rounded p-3 text-xs overflow-x-auto">
              {`# local chain (MockPriceOracle)\nnpm run hardhat:chain\nnpm run hardhat:deploy -- --network localhost\n\n# Hedera testnet (live Pyth HBAR/USD)\nnpm run hardhat:account:generate\nnpm run hardhat:deploy -- --network hederaTestnet`}
            </pre>
            <p className="text-sm m-0">
              Contracts can also be explored on the{" "}
              <Link href="/debug" className="link link-primary">
                Debug page
              </Link>
              .
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default VaultPage;
