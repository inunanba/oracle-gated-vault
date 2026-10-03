import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { DeployFunction } from "hardhat-deploy/types";

import { HEDERA_CHAIN_IDS } from "../config/oracle";
import { createAuditTopic, hashscanTopicUrl, operatorClient, readAuditTopic, saveAuditTopic } from "../utils/hcsClient";

/**
 * Creates the Hedera Consensus Service (HCS) topic that serves as the vault's audit log.
 *
 * - Hedera networks only (HCS has no local-chain equivalent; set HCS_AUDIT=false to skip).
 * - Submit key = the deployer key, no admin key: only the relayer can append, nobody can delete.
 * - One topic per vault deployment; reruns are no-ops while the vault address is unchanged.
 * - The topic id is saved to packages/nextjs/contracts/hcsAuditTopics.json (read by the /vault page).
 *
 * Messages are appended by `npm run hardhat:e2e:testnet` and `npm run hardhat:hcs:relay`.
 */
const createHcsAuditTopic: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const chainId = Number((await hre.ethers.provider.getNetwork()).chainId);
  if (!HEDERA_CHAIN_IDS.has(chainId) || process.env.HCS_AUDIT === "false") {
    console.log("HCS audit topic: skipped (not a Hedera network)");
    return;
  }

  const vault = (await hre.deployments.get("OracleGatedVault")).address.toLowerCase();
  const existing = readAuditTopic(chainId);
  if (existing && existing.vault.toLowerCase() === vault) {
    console.log(`HCS audit topic: reusing ${existing.topicId} (${hashscanTopicUrl(chainId, existing.topicId)})`);
    return;
  }

  const { deployer } = await hre.getNamedAccounts();
  const { client, key } = await operatorClient(chainId, deployer);
  try {
    const topicId = await createAuditTopic(client, key, `Oracle-gated Vault audit log ${vault}`);
    saveAuditTopic(chainId, { topicId, vault, createdAt: new Date().toISOString() });
    console.log(`HCS audit topic created: ${topicId}`);
    console.log(`  ${hashscanTopicUrl(chainId, topicId)}`);
  } finally {
    client.close();
  }
};

export default createHcsAuditTopic;
createHcsAuditTopic.tags = ["HcsAuditTopic"];
createHcsAuditTopic.dependencies = ["OracleGatedVault"];
