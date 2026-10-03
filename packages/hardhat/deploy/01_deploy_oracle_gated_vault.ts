import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import {
  DEFAULT_MAX_CONFIDENCE_BPS,
  HEDERA_CHAIN_IDS,
  HEDERA_VAULT_DEFAULTS,
  LOCAL_VAULT_DEFAULTS,
  PRICE_DECIMALS,
  PYTH_HBAR_USD_FEED_ID,
  PYTH_HEDERA_ADDRESS,
  vaultParamsFromEnv,
} from "../config/oracle";
import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { hashscanContractUrl } from "../utils/hashscan";

/**
 * Deploys the price oracle and the OracleGatedVault.
 *
 * - Hedera testnet/mainnet: PythPriceOracle wrapping the live Pyth contract (HBAR/USD by default).
 * - Local chain: MockPriceOracle, so the gate works offline and the price can be moved by hand.
 *
 * The vault asset is the HederaToken ERC-20 from 00_deploy_hedera_token.ts.
 */
const deployOracleGatedVault: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;
  const gasPrice = await getDeployGasPrice(hre);
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  const onHedera = HEDERA_CHAIN_IDS.has(chainId);

  let oracleAddress: string;
  if (onHedera) {
    const pythAddress = process.env.PYTH_CONTRACT_ADDRESS || PYTH_HEDERA_ADDRESS;
    const feedId = process.env.PYTH_PRICE_FEED_ID || PYTH_HBAR_USD_FEED_ID;
    const maxConfBps = Number(process.env.PYTH_MAX_CONFIDENCE_BPS || DEFAULT_MAX_CONFIDENCE_BPS);
    const oracle = await deploy("PythPriceOracle", {
      from: deployer,
      args: [pythAddress, feedId, PRICE_DECIMALS, maxConfBps],
      log: true,
      gasLimit: 800_000,
      gasPrice,
    });
    oracleAddress = oracle.address;
  } else {
    const oracle = await deploy("MockPriceOracle", {
      from: deployer,
      args: [100_000_000n, PRICE_DECIMALS, deployer], // $1.00
      log: true,
      autoMine: true,
      gasPrice,
    });
    oracleAddress = oracle.address;
  }

  const asset = await get("HederaToken");
  const params = vaultParamsFromEnv(onHedera ? HEDERA_VAULT_DEFAULTS : LOCAL_VAULT_DEFAULTS);

  const vault = await deploy("OracleGatedVault", {
    from: deployer,
    args: [asset.address, oracleAddress, params.minPrice, params.maxPrice, params.maxStaleness, deployer],
    log: true,
    autoMine: true,
    gasLimit: onHedera ? 1_400_000 : undefined,
    gasPrice,
  });

  if (onHedera) {
    console.log(`\nOracleGatedVault: ${hashscanContractUrl(chainId, vault.address)}`);
    console.log(`Oracle:           ${hashscanContractUrl(chainId, oracleAddress)}`);
    console.log(`Asset:            ${hashscanContractUrl(chainId, asset.address)}\n`);
  }
};

deployOracleGatedVault.tags = ["OracleGatedVault"];
deployOracleGatedVault.dependencies = ["HederaToken"];
export default deployOracleGatedVault;
