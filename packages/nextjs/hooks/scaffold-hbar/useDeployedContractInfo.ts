import { useEffect, useState } from "react";
import { useIsMounted } from "usehooks-ts";
import { usePublicClient } from "wagmi";
import { useSelectedNetwork } from "~~/hooks/scaffold-hbar";
import {
  Contract,
  ContractCodeStatus,
  ContractName,
  UseDeployedContractConfig,
  contracts,
} from "~~/utils/scaffold-hbar/contract";

type DeployedContractData<TContractName extends ContractName> = {
  data: Contract<TContractName> | undefined;
  isLoading: boolean;
  error?: Error;
  configuredAddress?: `0x${string}`;
};

/**
 * Gets the matching contract info for the provided contract name from the contracts present in deployedContracts.ts
 * and externalContracts.ts corresponding to targetNetworks configured in scaffold.config.ts
 */
export function useDeployedContractInfo<TContractName extends ContractName>(
  config: UseDeployedContractConfig<TContractName>,
): DeployedContractData<TContractName>;
/**
 * @deprecated Use object parameter version instead: useDeployedContractInfo({ contractName: "YourContract" })
 */
export function useDeployedContractInfo<TContractName extends ContractName>(
  contractName: TContractName,
): DeployedContractData<TContractName>;

export function useDeployedContractInfo<TContractName extends ContractName>(
  configOrName: UseDeployedContractConfig<TContractName> | TContractName,
): DeployedContractData<TContractName> {
  const isMounted = useIsMounted();

  const finalConfig: UseDeployedContractConfig<TContractName> =
    typeof configOrName === "string" ? { contractName: configOrName } : (configOrName as any);

  useEffect(() => {
    if (typeof configOrName === "string") {
      console.warn(
        "Using `useDeployedContractInfo` with a string parameter is deprecated. Please use the object parameter version instead.",
      );
    }
  }, [configOrName]);
  const { contractName, chainId } = finalConfig;
  const selectedNetwork = useSelectedNetwork(chainId);
  const deployedContract = contracts?.[selectedNetwork.id]?.[String(contractName)] as Contract<TContractName>;
  const scope = `${selectedNetwork.id}:${deployedContract?.address ?? ""}:${contractName}`;
  const [checked, setChecked] = useState<{ scope: string; status: ContractCodeStatus; error?: Error }>();
  const publicClient = usePublicClient({ chainId: selectedNetwork.id });

  useEffect(() => {
    let cancelled = false;
    const finish = (status: ContractCodeStatus, error?: Error) => {
      if (!cancelled) setChecked({ scope, status, error });
    };
    const checkContractDeployment = async () => {
      if (!isMounted()) return;
      finish(ContractCodeStatus.LOADING);
      if (!deployedContract) {
        finish(ContractCodeStatus.NOT_FOUND);
        return;
      }
      if (!publicClient) return;
      try {
        const code = await publicClient.getCode({ address: deployedContract.address });
        finish(!code || code === "0x" ? ContractCodeStatus.NOT_FOUND : ContractCodeStatus.DEPLOYED);
      } catch (e) {
        // An unavailable RPC cannot establish that a configured deployment is absent.
        finish(ContractCodeStatus.NOT_FOUND, e instanceof Error ? e : new Error("Deployment check unavailable"));
      }
    };
    checkContractDeployment();
    return () => {
      cancelled = true;
    };
  }, [isMounted, contractName, deployedContract, publicClient, scope]);
  const current = checked?.scope === scope ? checked : undefined;

  return {
    data: current?.status === ContractCodeStatus.DEPLOYED ? deployedContract : undefined,
    isLoading: !current || current.status === ContractCodeStatus.LOADING,
    error: current?.error,
    configuredAddress: deployedContract?.address,
  };
}
