import { artifacts, deployments, ethers } from "hardhat";

/**
 * Verifies every deployed contract of this network on Sourcify through its v2 API (HashScan reads
 * verification status from sourcify.dev). `hardhat verify` in @nomicfoundation/hardhat-verify still
 * calls the removed v1 endpoints, so this script talks to v2 directly.
 *
 *   npm run hardhat:verify:sourcify -- --network hederaTestnet
 */
const SOURCIFY = process.env.SOURCIFY_URL || "https://sourcify.dev/server";
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function verifyOne(chainId: number, name: string) {
  const deployment = await deployments.get(name);
  const existing = await fetch(`${SOURCIFY}/v2/contract/${chainId}/${deployment.address}`).then(r => r.json());
  if (existing.match) {
    console.log(`✅ ${name} already verified (${existing.match})`);
    return;
  }

  const artifact = await artifacts.readArtifact(name);
  const fqn = `${artifact.sourceName}:${artifact.contractName}`;
  const buildInfo = await artifacts.getBuildInfo(fqn);
  if (!buildInfo) throw new Error(`No build info for ${fqn}; run hardhat compile`);

  const res = await fetch(`${SOURCIFY}/v2/verify/${chainId}/${deployment.address}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "oracle-gated-vault-template" },
    body: JSON.stringify({
      stdJsonInput: buildInfo.input,
      compilerVersion: buildInfo.solcLongVersion,
      contractIdentifier: fqn,
      creationTransactionHash: deployment.transactionHash,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`${name}: Sourcify ${res.status} ${JSON.stringify(body)}`);

  for (let i = 0; i < 30; i++) {
    await sleep(3000);
    const job = await fetch(`${SOURCIFY}/v2/verify/${body.verificationId}`).then(r => r.json());
    if (!job.isJobCompleted) continue;
    if (job.error)
      throw new Error(`${name}: ${job.error.customCode ?? ""} ${job.error.message ?? JSON.stringify(job.error)}`);
    console.log(`✅ ${name} verified on Sourcify (${job.contract?.match ?? "match"})`);
    return;
  }
  throw new Error(`${name}: verification job ${body.verificationId} did not finish`);
}

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const names = Object.keys(await deployments.all());
  let failed = 0;
  for (const name of names) {
    try {
      await verifyOne(chainId, name);
    } catch (e) {
      failed++;
      console.error(`❌ ${(e as Error).message}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
