import { expect } from "chai";
import { ethers } from "hardhat";

import {
  AUDIT_SCHEMA,
  HCS_MAX_MESSAGE_BYTES,
  MemoryAuditSink,
  auditEventsFromReceipt,
  auditKey,
  decodeAuditMessage,
  encodeAuditMessage,
  relayAuditEvents,
  requireEvmTransactionHash,
  type AuditEvent,
} from "../utils/hcsAudit";

describe("HCS audit log", function () {
  async function vaultWithActivity() {
    const [owner, alice] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("HederaToken")).deploy(owner.address);
    const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(100_000_000n, 8, owner.address);
    const vault = await (
      await ethers.getContractFactory("OracleGatedVault")
    ).deploy(await token.getAddress(), await oracle.getAddress(), 80_000_000n, 120_000_000n, 3600, owner.address);
    const vaultAddress = await vault.getAddress();
    const chainId = Number((await ethers.provider.getNetwork()).chainId);

    await token.transfer(alice.address, ethers.parseEther("100"));
    await token.connect(alice).approve(vaultAddress, ethers.MaxUint256);
    const depositReceipt = await (await vault.connect(alice).deposit(ethers.parseEther("10"))).wait();
    await oracle.setPrice(110_000_000n);
    const withdrawReceipt = await (await vault.connect(alice).withdraw(ethers.parseEther("4"))).wait();

    return {
      token,
      oracle,
      vault,
      vaultAddress,
      chainId,
      alice,
      depositReceipt: depositReceipt!,
      withdrawReceipt: withdrawReceipt!,
    };
  }

  const sample: AuditEvent = {
    kind: "deposit",
    chainId: 296,
    vault: "0x" + "ab".repeat(20),
    user: "0x" + "cd".repeat(20),
    amount: ethers.parseEther("10").toString(),
    price: "10167000",
    txHash: "0x" + "11".repeat(32),
    logIndex: 2,
    blockNumber: 123,
  };

  it("encodes a compact single-chunk message and decodes it back", function () {
    const message = encodeAuditMessage(sample);
    expect(Buffer.byteLength(message)).to.be.lessThan(HCS_MAX_MESSAGE_BYTES);
    expect(JSON.parse(message).s).to.equal(AUDIT_SCHEMA);
    expect(decodeAuditMessage(message)).to.deep.equal(sample);
  });

  it("never truncates a native transaction hash into a claimed EVM proof", function () {
    expect(requireEvmTransactionHash(sample.txHash)).to.equal(sample.txHash);
    const nativeHash = "0x" + "11".repeat(48);
    expect(() => requireEvmTransactionHash(nativeHash)).to.throw("Unsupported mirror transaction hash");
    expect(() => encodeAuditMessage({ ...sample, txHash: nativeHash })).to.throw("Unsupported mirror transaction hash");
  });

  it("rejects foreign or malformed topic messages", function () {
    expect(decodeAuditMessage("hello")).to.equal(null);
    expect(decodeAuditMessage(JSON.stringify({ ...JSON.parse(encodeAuditMessage(sample)), s: "other/1" }))).to.equal(
      null,
    );
    expect(decodeAuditMessage(JSON.stringify({ ...JSON.parse(encodeAuditMessage(sample)), tx: "0x1234" }))).to.equal(
      null,
    );
    expect(decodeAuditMessage(JSON.stringify({ ...JSON.parse(encodeAuditMessage(sample)), a: "-5" }))).to.equal(null);
    expect(decodeAuditMessage(JSON.stringify({ ...JSON.parse(encodeAuditMessage(sample)), k: "drain" }))).to.equal(
      null,
    );
  });

  it("extracts Deposited/Withdrawn events with the gate price from vault receipts", async function () {
    const { vaultAddress, chainId, alice, depositReceipt, withdrawReceipt } = await vaultWithActivity();

    const [dep] = auditEventsFromReceipt(depositReceipt, vaultAddress, chainId);
    expect(dep).to.include({
      kind: "deposit",
      chainId,
      vault: vaultAddress.toLowerCase(),
      user: alice.address.toLowerCase(),
      amount: ethers.parseEther("10").toString(),
      price: "100000000",
      txHash: depositReceipt.hash.toLowerCase(),
      blockNumber: depositReceipt.blockNumber,
    });

    const [wd] = auditEventsFromReceipt(withdrawReceipt, vaultAddress, chainId);
    expect(wd).to.include({ kind: "withdraw", amount: ethers.parseEther("4").toString(), price: "110000000" });
  });

  it("ignores logs from other contracts (the ERC-20 Transfer in the same tx)", async function () {
    const { vaultAddress, chainId, token, depositReceipt } = await vaultWithActivity();
    expect(depositReceipt.logs.some(l => l.address === (token.target as string))).to.equal(true);
    expect(auditEventsFromReceipt(depositReceipt, vaultAddress, chainId)).to.have.length(1);
    expect(auditEventsFromReceipt(depositReceipt, ethers.ZeroAddress, chainId)).to.have.length(0);
  });

  it("relays each event once, in order, and skips events already on the topic", async function () {
    const { vaultAddress, chainId, depositReceipt, withdrawReceipt } = await vaultWithActivity();
    const events = [
      ...auditEventsFromReceipt(depositReceipt, vaultAddress, chainId),
      ...auditEventsFromReceipt(withdrawReceipt, vaultAddress, chainId),
    ];
    const sink = new MemoryAuditSink();

    const first = await relayAuditEvents(events, sink);
    expect(first.map(r => r.sequenceNumber)).to.deep.equal([1, 2]);
    expect(sink.messages.map(m => decodeAuditMessage(m)?.kind)).to.deep.equal(["deposit", "withdraw"]);

    // Rerun with what the mirror node would return: nothing new is submitted.
    const logged = sink.messages.map(m => decodeAuditMessage(m)!);
    expect(await relayAuditEvents([...events, events[0]], sink, logged)).to.have.length(0);
    expect(sink.messages).to.have.length(2);
    expect(new Set(logged.map(auditKey)).size).to.equal(2);
  });
});
