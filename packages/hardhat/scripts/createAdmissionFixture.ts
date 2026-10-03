import { ethers } from "hardhat";
import { writeFileSync } from "fs";
import { resolve } from "path";

async function main() {
  const [owner] = await ethers.getSigners();
  const token = await (await ethers.getContractFactory("HederaToken")).deploy(owner.address);
  const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(100_000_000n, 8, owner.address);
  const vault = await (
    await ethers.getContractFactory("OracleGatedVault")
  ).deploy(await token.getAddress(), await oracle.getAddress(), 80_000_000n, 120_000_000n, 3600, owner.address);
  await token.approve(await vault.getAddress(), 10);
  const tx = await vault.deposit(10);
  const receipt = await tx.wait();
  const action = receipt!.logs.find(l => {
    try {
      return vault.interface.parseLog(l)?.name === "Deposited";
    } catch {
      return false;
    }
  })!;
  const numericId = "0.0.1234";
  const fixture = {
    provenance: "Generated from a successful local Hardhat deposit; not a Hedera transaction or HCS message",
    generationCommand: "cd packages/hardhat && npx hardhat run scripts/createAdmissionFixture.ts",
    vault: await vault.getAddress(),
    contract: { contract_id: numericId, evm_address: await vault.getAddress() },
    entry: {
      s: "ogv.audit/1",
      c: 296,
      k: "deposit",
      v: await vault.getAddress(),
      u: owner.address,
      a: "10",
      p: "100000000",
      tx: tx.hash,
      li: action.index,
      b: receipt!.blockNumber,
    },
    result: {
      result: "SUCCESS",
      logs: receipt!.logs.map(l => ({
        index: l.index,
        address: l.address,
        topics: l.topics,
        data: l.data,
        ...(l.address === receipt!.to ? { contract_id: numericId } : {}),
      })),
    },
  };
  writeFileSync(resolve(__dirname, "../../nextjs/app/proof-lab/fixture.json"), JSON.stringify(fixture, null, 2) + "\n");
  console.log("Local receipt fixture written; numeric identity and HCS envelope are replay fixtures.");
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
