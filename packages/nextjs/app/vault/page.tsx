"use client";

import Link from "next/link";
import { AuditLog } from "./_components/AuditLog";
import { GateStatus } from "./_components/GateStatus";
import { LiveFeedPrice } from "./_components/LiveFeedPrice";
import { VaultActions } from "./_components/VaultActions";
import type { NextPage } from "next";
import { useDeployedContractInfo, useTargetNetwork } from "~~/hooks/scaffold-hbar";

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
            Deposits and withdrawals only go through while the HBAR/USD oracle price is fresh and inside the
            vault&apos;s band. On Hedera the vault reads the Chainlink Data Feed through an adapter; a Pyth pull-oracle
            adapter ships alongside it. Every gated action is also appended to a Hedera Consensus Service topic as a
            public audit log.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <LiveFeedPrice />
          {vault ? <GateStatus /> : null}
        </div>

        {isLoading ? (
          <div className="h-24 rounded-2xl bg-base-200 animate-pulse" />
        ) : vault ? (
          <>
            <VaultActions vaultAddress={vault.address} />
            <AuditLog chainId={targetNetwork.id} vaultAddress={vault.address} />
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
              {`# local chain (MockPriceOracle)\nnpm run hardhat:chain\nnpm run hardhat:deploy -- --network localhost\n\n# Hedera testnet (live Chainlink HBAR/USD)\nnpm run hardhat:account:generate\nnpm run hardhat:deploy -- --network hederaTestnet`}
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
