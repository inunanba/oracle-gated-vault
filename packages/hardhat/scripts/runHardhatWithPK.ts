import * as dotenv from "dotenv";
dotenv.config();
import { Wallet } from "ethers";
import password from "@inquirer/password";
import { spawn } from "child_process";
import { config } from "hardhat";

/**
 * Runs a Hardhat task (`deploy`, `run <script>`, ...) with the deployer key decrypted in memory.
 *
 *   ts-node scripts/runHardhatWithPK.ts deploy --network hederaTestnet
 *   ts-node scripts/runHardhatWithPK.ts run scripts/e2eTestnet.ts --network hederaTestnet
 *
 * Local networks use Hardhat's default accounts. For Hedera networks the key comes from
 * DEPLOYER_PRIVATE_KEY_ENCRYPTED (created by `account:generate` / `account:import`), or from
 * __RUNTIME_DEPLOYER_PRIVATE_KEY if a CI job has already injected it.
 */
function runHardhat(args: string[]) {
  const hardhat = spawn("hardhat", args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  hardhat.on("exit", code => process.exit(code ?? 0));
}

async function main() {
  const args = process.argv.slice(2);
  const networkIndex = args.indexOf("--network");
  const networkName = networkIndex !== -1 ? args[networkIndex + 1] : config.defaultNetwork;

  if (networkName === "localhost" || networkName === "hardhat" || process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY) {
    runHardhat(args);
    return;
  }

  const encryptedKey = process.env.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
  if (!encryptedKey) {
    console.log("🚫️ No deployer account. Run `npm run account:generate` or `npm run account:import` first.");
    process.exit(1);
  }

  const pass = await password({ message: "Enter password to decrypt private key:" });
  let wallet: Wallet;
  try {
    wallet = (await Wallet.fromEncryptedJson(encryptedKey, pass)) as Wallet;
  } catch {
    console.error("Failed to decrypt private key. Wrong password?");
    process.exit(1);
  }
  process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY = wallet.privateKey;
  runHardhat(args);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
