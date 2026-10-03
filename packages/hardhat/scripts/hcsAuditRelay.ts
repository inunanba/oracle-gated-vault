import { deployments, ethers } from "hardhat";

import { hashscanTopicUrl, readAuditTopic } from "../utils/hcsClient";
import { relayToTopic } from "../utils/hcsRelay";

/**
 * Backfills the HCS audit topic: reads every Deposited/Withdrawn event of the vault from the mirror
 * node and appends the ones not yet on the topic (idempotent, safe to rerun or schedule).
 *
 *   npm run hardhat:hcs:relay
 */
async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();
  const vault = (await deployments.get("OracleGatedVault")).address;
  const topic = readAuditTopic(chainId);
  if (!topic) throw new Error(`No HCS audit topic for chain ${chainId}; run the deploy first.`);

  const relayed = await relayToTopic({ chainId, topicId: topic.topicId, operatorEvm: signer.address, vault });
  for (const { event, sequenceNumber } of relayed) {
    console.log(
      `📝 HCS #${sequenceNumber}: ${event.kind} ${ethers.formatEther(event.amount)} by ${event.user} (${event.txHash})`,
    );
  }
  console.log(`${relayed.length} new audit message(s). Topic: ${hashscanTopicUrl(chainId, topic.topicId)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
