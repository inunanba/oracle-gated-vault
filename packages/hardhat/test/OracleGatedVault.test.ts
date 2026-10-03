import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("OracleGatedVault", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();

    const HederaToken = await ethers.getContractFactory("HederaToken");
    const token = await HederaToken.deploy(owner.address);
    await token.waitForDeployment();

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockPriceOracle.deploy(100_000_000n, 8, owner.address);
    await oracle.waitForDeployment();

    const OracleGatedVault = await ethers.getContractFactory("OracleGatedVault");
    const vault = await OracleGatedVault.deploy(
      await token.getAddress(),
      await oracle.getAddress(),
      80_000_000n,
      120_000_000n,
      3600,
      owner.address,
    );
    await vault.waitForDeployment();

    await token.transfer(alice.address, ethers.parseEther("1000"));
    await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

    return { token, oracle, vault, owner, alice, bob };
  }

  it("deposits when price is in band", async function () {
    const { vault, alice, token } = await deployFixture();
    const amount = ethers.parseEther("10");
    await expect(vault.connect(alice).deposit(amount)).to.emit(vault, "Deposited");
    expect(await vault.balances(alice.address)).to.equal(amount);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(amount);
    expect(await vault.totalDeposits()).to.equal(amount);
  });

  it("reverts deposit when price out of band", async function () {
    const { vault, oracle, alice } = await deployFixture();
    await oracle.setPrice(50_000_000n); // below min
    await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.be.revertedWithCustomError(
      vault,
      "PriceOutOfBand",
    );
  });

  it("reverts deposit when price above max band", async function () {
    const { vault, oracle, alice } = await deployFixture();
    await oracle.setPrice(150_000_000n);
    await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.be.revertedWithCustomError(
      vault,
      "PriceOutOfBand",
    );
  });

  it("withdraws when price is in band", async function () {
    const { vault, alice } = await deployFixture();
    const amount = ethers.parseEther("5");
    await vault.connect(alice).deposit(amount);
    await expect(vault.connect(alice).withdraw(amount)).to.emit(vault, "Withdrawn");
    expect(await vault.balances(alice.address)).to.equal(0n);
    expect(await vault.totalDeposits()).to.equal(0n);
  });

  it("requirePriceInBand returns current price", async function () {
    const { vault } = await deployFixture();
    expect(await vault.requirePriceInBand()).to.equal(100_000_000n);
  });

  it("reverts on zero deposit", async function () {
    const { vault, alice } = await deployFixture();
    await expect(vault.connect(alice).deposit(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
  });

  it("reverts withdraw when insufficient balance", async function () {
    const { vault, alice } = await deployFixture();
    await expect(vault.connect(alice).withdraw(ethers.parseEther("1")))
      .to.be.revertedWithCustomError(vault, "WithdrawExceedsBalance")
      .withArgs(ethers.parseEther("1"), 0n);
  });

  it("reverts when oracle price is stale", async function () {
    const { vault, oracle, alice } = await deployFixture();
    // Advance past maxStaleness (3600s) without refreshing price
    await time.increase(3601);
    await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.be.revertedWithCustomError(
      vault,
      "StalePrice",
    );
    // A fresh observation reopens the gate.
    await oracle.setPrice(100_000_000n);
    await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.emit(vault, "Deposited");
  });

  it("previewGate reports status without reverting", async function () {
    const { vault, oracle } = await deployFixture();
    let [price, , fresh, inBand] = await vault.previewGate();
    expect(price).to.equal(100_000_000n);
    expect(fresh).to.equal(true);
    expect(inBand).to.equal(true);

    await oracle.setPrice(10_000_000n);
    await time.increase(3601);
    [price, , fresh, inBand] = await vault.previewGate();
    expect(price).to.equal(10_000_000n);
    expect(fresh).to.equal(false);
    expect(inBand).to.equal(false);
  });

  it("blocks withdrawals while the price is out of band", async function () {
    const { vault, oracle, alice } = await deployFixture();
    await vault.connect(alice).deposit(ethers.parseEther("3"));
    await oracle.setPrice(200_000_000n);
    await expect(vault.connect(alice).withdraw(ethers.parseEther("3"))).to.be.revertedWithCustomError(
      vault,
      "PriceOutOfBand",
    );
    expect(await vault.balances(alice.address)).to.equal(ethers.parseEther("3"));
  });

  it("rejects value on the price-update path when no update is supplied", async function () {
    const { vault, alice } = await deployFixture();
    await expect(
      vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [], { value: 1n }),
    ).to.be.revertedWithCustomError(vault, "UnexpectedValue");
    await expect(vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [])).to.emit(vault, "Deposited");
  });

  it("rejects zero addresses and inverted bands", async function () {
    const { vault, token, oracle, owner } = await deployFixture();
    const OracleGatedVault = await ethers.getContractFactory("OracleGatedVault");
    await expect(
      OracleGatedVault.deploy(ethers.ZeroAddress, await oracle.getAddress(), 1, 2, 60, owner.address),
    ).to.be.revertedWithCustomError(OracleGatedVault, "ZeroAddress");
    await expect(
      OracleGatedVault.deploy(await token.getAddress(), await oracle.getAddress(), 3, 2, 60, owner.address),
    ).to.be.revertedWithCustomError(OracleGatedVault, "InvalidBand");
    await expect(vault.setBand(5, 4, 60))
      .to.be.revertedWithCustomError(vault, "InvalidBand")
      .withArgs(5, 4);
    await expect(vault.setOracle(ethers.ZeroAddress)).to.be.revertedWithCustomError(vault, "ZeroAddress");
  });

  it("owner can update band and oracle", async function () {
    const { vault, owner, alice } = await deployFixture();
    await expect(vault.connect(owner).setBand(90_000_000n, 110_000_000n, 7200))
      .to.emit(vault, "BandUpdated")
      .withArgs(90_000_000n, 110_000_000n, 7200);
    expect(await vault.minPrice()).to.equal(90_000_000n);
    expect(await vault.maxPrice()).to.equal(110_000_000n);
    expect(await vault.maxStaleness()).to.equal(7200);

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle2 = await MockPriceOracle.deploy(100_000_000n, 8, owner.address);
    await oracle2.waitForDeployment();
    await expect(vault.connect(owner).setOracle(await oracle2.getAddress())).to.emit(vault, "OracleUpdated");
    await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.emit(vault, "Deposited");
  });

  it("non-owner cannot setOracle or setBand", async function () {
    const { vault, alice } = await deployFixture();
    await expect(vault.connect(alice).setOracle(alice.address)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount",
    );
    await expect(vault.connect(alice).setBand(1, 2, 3)).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount",
    );
  });
  it("records the exact admission policy and preserves it after configuration changes", async function () {
    const { vault, oracle, alice } = await deployFixture();
    const [, observedAt] = await oracle.latestPrice();
    const tx = await vault.connect(alice).deposit(10n);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    await expect(tx)
      .to.emit(vault, "AdmissionRecorded")
      .withArgs(
        alice.address,
        true,
        await oracle.getAddress(),
        100_000_000n,
        observedAt,
        80_000_000n,
        120_000_000n,
        3600n,
        BigInt(block!.timestamp),
      );
    const parsed = receipt!.logs.filter(l => l.address === receipt!.to).map(l => vault.interface.parseLog(l));
    expect(parsed.map(l => l!.name)).to.deep.equal(["Deposited", "AdmissionRecorded"]);
    await vault.setBand(90_000_000n, 110_000_000n, 7200);
    const withdrawal = await vault.connect(alice).withdraw(10n);
    const withdrawalReceipt = await withdrawal.wait();
    const withdrawalBlock = await ethers.provider.getBlock(withdrawalReceipt!.blockNumber);
    await expect(withdrawal)
      .to.emit(vault, "AdmissionRecorded")
      .withArgs(
        alice.address,
        false,
        await oracle.getAddress(),
        100_000_000n,
        observedAt,
        90_000_000n,
        110_000_000n,
        7200n,
        BigInt(withdrawalBlock!.timestamp),
      );
    expect(parsed[1]!.args.minimum).to.equal(80_000_000n);
  });

  it("rejects a wrong-decimal adapter during construction and replacement", async function () {
    const { vault, token, owner } = await deployFixture();
    const wrong = await (await ethers.getContractFactory("MockPriceOracle")).deploy(100n, 6, owner.address);
    await expect(vault.setOracle(await wrong.getAddress()))
      .to.be.revertedWithCustomError(vault, "InvalidOracleDecimals")
      .withArgs(6);
    const factory = await ethers.getContractFactory("OracleGatedVault");
    await expect(factory.deploy(await token.getAddress(), await wrong.getAddress(), 1, 200, 60, owner.address))
      .to.be.revertedWithCustomError(factory, "InvalidOracleDecimals")
      .withArgs(6);
  });

  it("rolls back a taxed token deposit instead of creating an insolvent balance", async function () {
    const [owner] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("FeeToken")).deploy();
    const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(100n, 8, owner.address);
    const vault = await (
      await ethers.getContractFactory("OracleGatedVault")
    ).deploy(await token.getAddress(), await oracle.getAddress(), 80, 120, 3600, owner.address);
    await token.approve(await vault.getAddress(), 100);
    const before = await token.balanceOf(owner.address);
    await expect(vault.deposit(100)).to.be.revertedWithCustomError(vault, "UnsupportedTransfer").withArgs(100, 99);
    expect(await token.balanceOf(owner.address)).to.equal(before);
    expect(await token.balanceOf(await vault.getAddress())).to.equal(0);
    expect(await vault.totalDeposits()).to.equal(0);
    expect(await vault.balances(owner.address)).to.equal(0);
  });
  it("records the checked policy even when an owner token changes settings during transfer", async function () {
    const [owner] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("PolicyChangingToken")).deploy();
    const oracle = await (await ethers.getContractFactory("MockPriceOracle")).deploy(100n, 8, owner.address);
    const vault = await (
      await ethers.getContractFactory("OracleGatedVault")
    ).deploy(await token.getAddress(), await oracle.getAddress(), 80, 120, 3600, owner.address);
    await vault.transferOwnership(await token.getAddress());
    await token.setTarget(await vault.getAddress());
    await token.approve(await vault.getAddress(), 10);
    const tx = await vault.deposit(10);
    const receipt = await tx.wait();
    const policy = receipt!.logs
      .map(l => {
        try {
          return vault.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find(l => l?.name === "AdmissionRecorded");
    expect(await vault.minPrice()).to.equal(101);
    expect(policy!.args.minimum).to.equal(80);
    expect(policy!.args.maximum).to.equal(120);
    expect(policy!.args.freshnessWindow).to.equal(3600);
    expect(await vault.balances(owner.address)).to.equal(10);
  });
});
