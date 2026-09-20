import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { getDeployGasPrice } from "../utils/getDeployGasPrice";

/**
 * Deploys MockPriceOracle + OracleGatedVault using the sample HederaToken as asset.
 * Local/mock path needs no live Supra/Pyth keys. Owner swaps oracle via setOracle later.
 */
const deployOracleGatedVault: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const gasPrice = await getDeployGasPrice(hre);

  // $1.00 with 8 decimals — typical Pyth-style scale
  const initialPrice = 100_000_000n;
  const priceDecimals = 8;

  const mockOracle = await deploy("MockPriceOracle", {
    from: deployer,
    args: [initialPrice.toString(), priceDecimals, deployer],
    log: true,
    autoMine: true,
    gasLimit: "3000000",
    gasPrice,
  });

  const hederaToken = await get("HederaToken");

  // Allow ±20% band; 1 hour staleness for local demos
  const minPrice = 80_000_000n;
  const maxPrice = 120_000_000n;
  const maxStaleness = 3600;

  await deploy("OracleGatedVault", {
    from: deployer,
    args: [hederaToken.address, mockOracle.address, minPrice.toString(), maxPrice.toString(), maxStaleness, deployer],
    log: true,
    autoMine: true,
    gasLimit: "5000000",
    gasPrice,
  });
};

deployOracleGatedVault.tags = ["OracleGatedVault"];
deployOracleGatedVault.dependencies = ["HederaToken"];
export default deployOracleGatedVault;
