import { ethers, deployments, network } from "hardhat";

import { hashscanTxUrl } from "../utils/hashscan";
import { TINYBAR_TO_WEIBAR, fetchPriceUpdate } from "../utils/hermes";

/**
 * End-to-end run against the deployed contracts on a Hedera network:
 *   1. read the gate (stored Pyth price is usually stale)
 *   2. approve the vault
 *   3. fetch a signed HBAR/USD update from Hermes and deposit in the same tx
 *   4. fetch a newer update and withdraw half
 * Prints a HashScan link for every transaction.
 *
 *   npm run hardhat:e2e:testnet
 */
async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [signer] = await ethers.getSigners();
  const vault = await ethers.getContractAt("OracleGatedVault", (await deployments.get("OracleGatedVault")).address);
  const oracle = await ethers.getContractAt("PythPriceOracle", await vault.oracle());
  const asset = await ethers.getContractAt("HederaToken", await vault.asset());
  const feedId = await oracle.priceId();
  const amount = ethers.parseEther(process.env.E2E_AMOUNT || "10");

  console.log(`Network ${network.name} (${chainId}), signer ${signer.address}`);
  console.log(`Vault ${await vault.getAddress()}  oracle ${await oracle.getAddress()}  feed ${feedId}`);

  const [storedPrice, updatedAt, fresh, inBand] = await vault.previewGate();
  const age = Math.floor(Date.now() / 1000) - Number(updatedAt);
  console.log(`Stored price ${ethers.formatUnits(storedPrice, 8)} USD, ${age}s old, fresh=${fresh}, inBand=${inBand}`);

  const step = async (label: string, tx: Promise<{ hash: string; wait: () => Promise<unknown> }>) => {
    const sent = await tx;
    await sent.wait();
    console.log(`✅ ${label}: ${hashscanTxUrl(chainId, sent.hash)}`);
  };

  if ((await asset.allowance(signer.address, await vault.getAddress())) < amount) {
    await step("approve", asset.approve(await vault.getAddress(), ethers.MaxUint256, { gasLimit: 80_000 }));
  }

  const depositUpdate = await fetchPriceUpdate([feedId]);
  const depositFee = await vault.getUpdateFee(depositUpdate.updateData);
  await step(
    `depositWithPriceUpdate(${ethers.formatEther(amount)}) at Hermes publishTime ${depositUpdate.publishTime}`,
    vault.depositWithPriceUpdate(amount, depositUpdate.updateData, {
      value: depositFee * TINYBAR_TO_WEIBAR,
      gasLimit: 600_000,
    }),
  );

  const withdrawUpdate = await fetchPriceUpdate([feedId]);
  const withdrawFee = await vault.getUpdateFee(withdrawUpdate.updateData);
  await step(
    `withdrawWithPriceUpdate(${ethers.formatEther(amount / 2n)})`,
    vault.withdrawWithPriceUpdate(amount / 2n, withdrawUpdate.updateData, {
      value: withdrawFee * TINYBAR_TO_WEIBAR,
      gasLimit: 600_000,
    }),
  );

  const [price] = await vault.previewGate();
  console.log(
    `Gate price now ${ethers.formatUnits(price, 8)} USD; vault balance ${ethers.formatEther(await vault.balances(signer.address))}`,
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
