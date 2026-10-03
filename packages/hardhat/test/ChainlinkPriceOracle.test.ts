import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("ChainlinkPriceOracle + OracleGatedVault (push-oracle path)", function () {
  async function deployFixture(feedDecimals = 8, answer = 10_167_308n) {
    const [owner, alice] = await ethers.getSigners();

    const MockAggregatorV3 = await ethers.getContractFactory("MockAggregatorV3");
    const feed = await MockAggregatorV3.deploy(feedDecimals, "HBAR / USD", answer);

    const ChainlinkPriceOracle = await ethers.getContractFactory("ChainlinkPriceOracle");
    const oracle = await ChainlinkPriceOracle.deploy(await feed.getAddress(), 8);

    const HederaToken = await ethers.getContractFactory("HederaToken");
    const token = await HederaToken.deploy(owner.address);

    const OracleGatedVault = await ethers.getContractFactory("OracleGatedVault");
    // $0.05 – $0.50, accept rounds up to 25 h old (24 h heartbeat + margin)
    const vault = await OracleGatedVault.deploy(
      await token.getAddress(),
      await oracle.getAddress(),
      5_000_000n,
      50_000_000n,
      90_000,
      owner.address,
    );

    await token.transfer(alice.address, ethers.parseEther("100"));
    await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);
    return { owner, alice, feed, oracle, token, vault };
  }

  describe("ChainlinkPriceOracle", function () {
    it("returns the latest answer and round time", async function () {
      const { feed, oracle } = await deployFixture();
      const now = await time.latest();
      await feed.setRound(9_876_543n, now);
      const [price, updatedAt] = await oracle.latestPrice();
      expect(price).to.equal(9_876_543n);
      expect(updatedAt).to.equal(now);
      expect(await oracle.description()).to.equal("HBAR / USD");
    });

    it("scales feeds with more decimals down to 8", async function () {
      const { oracle } = await deployFixture(18, ethers.parseUnits("0.1", 18));
      const [price] = await oracle.latestPrice();
      expect(price).to.equal(10_000_000n);
    });

    it("scales feeds with fewer decimals up to 8", async function () {
      const { oracle } = await deployFixture(6, 101_673n);
      const [price] = await oracle.latestPrice();
      expect(price).to.equal(10_167_300n);
    });

    it("rejects non-positive answers and incomplete rounds", async function () {
      const { feed, oracle } = await deployFixture();
      await feed.setRound(0n, await time.latest());
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "NonPositivePrice").withArgs(0n);
      await feed.setRound(10_000_000n, 0);
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "IncompleteRound");
    });
  });

  describe("vault with a push oracle", function () {
    it("deposits and withdraws while the Chainlink price is in band", async function () {
      const { vault, alice } = await deployFixture();
      const amount = ethers.parseEther("10");
      await expect(vault.connect(alice).deposit(amount))
        .to.emit(vault, "Deposited")
        .withArgs(alice.address, amount, 10_167_308n);
      await expect(vault.connect(alice).withdraw(amount)).to.emit(vault, "Withdrawn");
    });

    it("closes when a new round leaves the band and reopens when it returns", async function () {
      const { vault, feed, alice } = await deployFixture();
      await feed.setRound(70_000_000n, await time.latest()); // $0.70
      await expect(vault.connect(alice).deposit(ethers.parseEther("1")))
        .to.be.revertedWithCustomError(vault, "PriceOutOfBand")
        .withArgs(70_000_000n, 5_000_000n, 50_000_000n);
      await feed.setRound(12_000_000n, await time.latest());
      await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.emit(vault, "Deposited");
    });

    it("closes when the feed misses its heartbeat", async function () {
      const { vault, alice } = await deployFixture();
      await time.increase(90_001);
      await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.be.revertedWithCustomError(
        vault,
        "StalePrice",
      );
    });

    it("rejects the pull-update path because a push feed has no update fee", async function () {
      const { vault, alice } = await deployFixture();
      await expect(vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), ["0x01"], { value: 1n })).to.be
        .reverted;
    });
  });
});
