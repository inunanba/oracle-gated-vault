import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import {
  CHAINLINK_HBAR_USD,
  DEFAULT_MAX_CONFIDENCE_BPS,
  HEDERA_CHAIN_IDS,
  HEDERA_VAULT_DEFAULTS,
  LOCAL_VAULT_DEFAULTS,
  PRICE_DECIMALS,
  PYTH_HBAR_USD_FEED_ID,
  PYTH_HEDERA_ADDRESS,
  oracleProviderFromEnv,
  vaultParamsFromEnv,
} from "../config/oracle";
import { getDeployGasPrice } from "../utils/getDeployGasPrice";
import { hashscanContractUrl } from "../utils/hashscan";

/**
 * Deploys the price oracle adapter and the OracleGatedVault.
 *
 * - Hedera testnet/mainnet: ChainlinkPriceOracle on the live HBAR/USD Data Feed (default), or
 *   PythPriceOracle on the live Pyth contract with ORACLE_PROVIDER=pyth.
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
  const provider = oracleProviderFromEnv();

  let oracleAddress: string;
  let params = vaultParamsFromEnv(LOCAL_VAULT_DEFAULTS);

  if (onHedera && provider === "chainlink") {
    const feed = process.env.CHAINLINK_FEED_ADDRESS || CHAINLINK_HBAR_USD[chainId];
    const oracle = await deploy("ChainlinkPriceOracle", {
      from: deployer,
      args: [feed, PRICE_DECIMALS],
      log: true,
      gasLimit: 600_000,
      gasPrice,
    });
    oracleAddress = oracle.address;
    params = vaultParamsFromEnv(HEDERA_VAULT_DEFAULTS.chainlink);
  } else if (onHedera && provider === "pyth") {
    const oracle = await deploy("PythPriceOracle", {
      from: deployer,
      args: [
        process.env.PYTH_CONTRACT_ADDRESS || PYTH_HEDERA_ADDRESS,
        process.env.PYTH_PRICE_FEED_ID || PYTH_HBAR_USD_FEED_ID,
        PRICE_DECIMALS,
        Number(process.env.PYTH_MAX_CONFIDENCE_BPS || DEFAULT_MAX_CONFIDENCE_BPS),
      ],
      log: true,
      gasLimit: 800_000,
      gasPrice,
    });
    oracleAddress = oracle.address;
    params = vaultParamsFromEnv(HEDERA_VAULT_DEFAULTS.pyth);
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
    console.log(`Oracle (${provider}): ${hashscanContractUrl(chainId, oracleAddress)}`);
    console.log(`Asset (HTK):      ${hashscanContractUrl(chainId, asset.address)}\n`);
  }
};

deployOracleGatedVault.tags = ["OracleGatedVault"];
deployOracleGatedVault.dependencies = ["HederaToken"];
export default deployOracleGatedVault;
