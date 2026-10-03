import { deployments, ethers, network } from "hardhat";

import { type AuditEvent, auditEventsFromReceipt } from "../utils/hcsAudit";
import { hashscanTxUrl } from "../utils/hashscan";
import { hashscanTopicUrl, readAuditTopic } from "../utils/hcsClient";
import { relayToTopic } from "../utils/hcsRelay";
import { TINYBAR_TO_WEIBAR, fetchPriceUpdate } from "../utils/hermes";

/**
 * End-to-end run against the contracts deployed on a Hedera network. Prints a HashScan link for
 * every transaction:
 *   1. read the gate and the oracle price
 *   2. mint demo HTK from the faucet if needed, approve the vault
 *   3. deposit, then withdraw half
 *   4. append both vault events to the HCS audit topic (Hedera Consensus Service)
 * With a Pyth oracle (ORACLE_PROVIDER=pyth at deploy time) steps 3 post a signed Hermes update in
 * the same transaction; that needs PYTH_API_KEY.
 *
 *   npm run hardhat:e2e:testnet
 */
async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("OracleGatedVault", (await deployments.get("OracleGatedVault")).address);
  const vaultAddress = await vault.getAddress();
  const asset = await ethers.getContractAt("HederaToken", await vault.asset());
  const oracleAddress = await vault.oracle();
  const pyth = await deployments.getOrNull("PythPriceOracle");
  const usesPyth = pyth?.address.toLowerCase() === oracleAddress.toLowerCase();
  const amount = ethers.parseEther(process.env.E2E_AMOUNT || "10");

  console.log(`Network ${network.name} (${chainId}), signer ${signer.address}`);
  console.log(`Vault ${vaultAddress}, oracle ${oracleAddress} (${usesPyth ? "Pyth, pull" : "Chainlink, push"})`);

  const [price, updatedAt, fresh, inBand] = await vault.previewGate();
  const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
  console.log(`Oracle price $${ethers.formatUnits(price, 8)}, ${age}s old, fresh=${fresh}, inBand=${inBand}`);

  const auditEvents: AuditEvent[] = [];
  const step = async (
    label: string,
    send: () => Promise<{ hash: string; wait: () => Promise<import("ethers").TransactionReceipt | null> }>,
  ) => {
    const tx = await send();
    const receipt = await tx.wait();
    if (receipt) auditEvents.push(...auditEventsFromReceipt(receipt, vaultAddress, chainId));
    console.log(`✅ ${label}: ${hashscanTxUrl(chainId, tx.hash)}`);
    return tx.hash;
  };

  if ((await asset.balanceOf(signer.address)) < amount) {
    await step("faucet (100 HTK)", () => asset.faucet({ gasLimit: 120_000 }));
  }
  if ((await asset.allowance(signer.address, vaultAddress)) < amount) {
    await step("approve", () => asset.approve(vaultAddress, ethers.MaxUint256, { gasLimit: 80_000 }));
  }

  const gated = async (kind: "deposit" | "withdraw", value: bigint) => {
    if (!usesPyth) {
      return step(`${kind}(${ethers.formatEther(value)} HTK) gated by Chainlink HBAR/USD`, () =>
        kind === "deposit" ? vault.deposit(value, { gasLimit: 250_000 }) : vault.withdraw(value, { gasLimit: 250_000 }),
      );
    }
    const feedId = await (await ethers.getContractAt("PythPriceOracle", oracleAddress)).priceId();
    const { updateData, publishTime } = await fetchPriceUpdate([feedId]);
    const fee = (await vault.getUpdateFee(updateData)) * TINYBAR_TO_WEIBAR;
    return step(`${kind}WithPriceUpdate(${ethers.formatEther(value)} HTK), Pyth publishTime ${publishTime}`, () =>
      kind === "deposit"
        ? vault.depositWithPriceUpdate(value, updateData, { value: fee, gasLimit: 600_000 })
        : vault.withdrawWithPriceUpdate(value, updateData, { value: fee, gasLimit: 600_000 }),
    );
  };

  await gated("deposit", amount);
  await gated("withdraw", amount / 2n);

  console.log(`Vault balance of signer: ${ethers.formatEther(await vault.balances(signer.address))} HTK`);

  const topic = readAuditTopic(network.name, chainId);
  if (!topic || topic.vault.toLowerCase() !== vaultAddress.toLowerCase()) {
    console.log("HCS audit topic not found for this vault (deploy with HCS_AUDIT unset to create one); skipping.");
    return;
  }
  const relayed = await relayToTopic({
    chainId,
    topicId: topic.topicId,
    operatorEvm: signer.address,
    vault: vaultAddress,
    events: auditEvents,
  });
  for (const { event, sequenceNumber } of relayed) {
    console.log(
      `📝 HCS audit #${sequenceNumber}: ${event.kind} ${ethers.formatEther(event.amount)} HTK @ $${ethers.formatUnits(event.price, 8)}`,
    );
  }
  console.log(`✅ HCS audit topic ${topic.topicId}: ${hashscanTopicUrl(chainId, topic.topicId)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
