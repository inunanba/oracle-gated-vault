import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// HBAR/USD feed id (same id on every Pyth deployment, including Hedera testnet and mainnet).
const HBAR_USD = "0x3728e591097635310e6341af53db8b7ee42da9b3a8d918f9463ce9cca886dfbd";
const UPDATE_FEE = 1n; // Pyth on Hedera charges 1 tinybar per update; MockPyth mirrors that.

describe("PythPriceOracle + OracleGatedVault (pull-oracle path)", function () {
  async function deployFixture() {
    const [owner, alice] = await ethers.getSigners();

    const MockPyth = await ethers.getContractFactory("MockPyth");
    const pyth = await MockPyth.deploy(60, UPDATE_FEE);

    const PythPriceOracle = await ethers.getContractFactory("PythPriceOracle");
    // 8 output decimals, max 2% confidence interval
    const oracle = await PythPriceOracle.deploy(await pyth.getAddress(), HBAR_USD, 8, 200);

    const HederaToken = await ethers.getContractFactory("HederaToken");
    const token = await HederaToken.deploy(owner.address);

    const OracleGatedVault = await ethers.getContractFactory("OracleGatedVault");
    // Accept deposits while HBAR/USD is between $0.05 and $0.50, price no older than 120 s
    const vault = await OracleGatedVault.deploy(
      await token.getAddress(),
      await oracle.getAddress(),
      5_000_000n,
      50_000_000n,
      120,
      owner.address,
    );

    await token.transfer(alice.address, ethers.parseEther("100"));
    await token.connect(alice).approve(await vault.getAddress(), ethers.MaxUint256);

    async function update(price: bigint, expo = -8, conf = 1_000n, publishTime?: number) {
      const ts = publishTime ?? (await time.latest());
      return pyth.createPriceFeedUpdateData(HBAR_USD, price, conf, expo, price, conf, ts, ts - 1);
    }

    return { owner, alice, pyth, oracle, token, vault, update };
  }

  describe("PythPriceOracle", function () {
    it("reads and normalises a Pyth price to the configured decimals", async function () {
      const { oracle, pyth, update } = await deployFixture();
      // $0.0805 with expo -5 -> 8050 * 10^-5, must become 8_050_000 at 8 decimals
      const data = await update(8_050n, -5, 1n);
      await pyth.updatePriceFeeds([data], { value: UPDATE_FEE });
      const [price] = await oracle.latestPrice();
      expect(price).to.equal(8_050_000n);
      expect(await oracle.decimals()).to.equal(8);
    });

    it("scales down when Pyth reports more decimals than requested", async function () {
      const { pyth, update } = await deployFixture();
      const PythPriceOracle = await ethers.getContractFactory("PythPriceOracle");
      const twoDecimals = await PythPriceOracle.deploy(await pyth.getAddress(), HBAR_USD, 2, 200);
      await pyth.updatePriceFeeds([await update(8_055_012n)], { value: UPDATE_FEE });
      const [price] = await twoDecimals.latestPrice();
      expect(price).to.equal(8n); // $0.08
    });

    it("rejects non-positive prices", async function () {
      const { oracle, pyth, update } = await deployFixture();
      await pyth.updatePriceFeeds([await update(-1n)], { value: UPDATE_FEE });
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "NonPositivePrice");
    });

    it("rejects prices whose confidence interval is too wide", async function () {
      const { oracle, pyth, update } = await deployFixture();
      // conf = 5% of price, limit is 2%
      await pyth.updatePriceFeeds([await update(10_000_000n, -8, 500_000n)], { value: UPDATE_FEE });
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "ConfidenceTooWide");
    });

    it("does not round away an excessive confidence interval", async function () {
      const { oracle, pyth, update } = await deployFixture();
      // At exponent -10, confidence 3 rounds to zero at 8 decimals, but is 3% of raw price.
      await pyth.updatePriceFeeds([await update(100n, -10, 3n)], { value: UPDATE_FEE });
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "ConfidenceTooWide");
    });

    it("rejects a positive raw price that rounds to zero", async function () {
      const { oracle, pyth, update } = await deployFixture();
      await pyth.updatePriceFeeds([await update(1n, -10, 0n)], { value: UPDATE_FEE });
      await expect(oracle.latestPrice()).to.be.revertedWithCustomError(oracle, "PriceRoundsToZero");
    });

    it("requires the exact update fee", async function () {
      const { oracle, update } = await deployFixture();
      const data = await update(10_000_000n);
      expect(await oracle.getUpdateFee([data])).to.equal(UPDATE_FEE);
      await expect(oracle.updatePrice([data], { value: 0n }))
        .to.be.revertedWithCustomError(oracle, "IncorrectUpdateFee")
        .withArgs(0n, UPDATE_FEE);
      await expect(oracle.updatePrice([data], { value: UPDATE_FEE })).to.not.be.reverted;
    });
  });

  describe("vault with a pull oracle", function () {
    it("reverts a plain deposit until a price has been pushed", async function () {
      const { vault, alice } = await deployFixture();
      // MockPyth has never seen this feed, so the read itself reverts (PriceFeedNotFound)
      await expect(vault.connect(alice).deposit(ethers.parseEther("1"))).to.be.reverted;
    });

    it("posts the update and deposits in one transaction", async function () {
      const { vault, alice, update } = await deployFixture();
      const data = await update(8_055_012n);
      const amount = ethers.parseEther("10");
      await expect(vault.connect(alice).depositWithPriceUpdate(amount, [data], { value: UPDATE_FEE }))
        .to.emit(vault, "PriceRefreshed")
        .withArgs(alice.address, UPDATE_FEE)
        .and.to.emit(vault, "Deposited")
        .withArgs(alice.address, amount, 8_055_012n);
      expect(await vault.balances(alice.address)).to.equal(amount);
    });

    it("refunds value sent above the update fee", async function () {
      const { vault, alice, update } = await deployFixture();
      const data = await update(8_055_012n);
      await expect(
        vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [data], { value: 1_000n }),
      ).to.changeEtherBalances([alice, vault], [-UPDATE_FEE, 0n]);
    });

    it("reverts when the update fee is not covered", async function () {
      const { vault, alice, update } = await deployFixture();
      const data = await update(8_055_012n);
      await expect(vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [data]))
        .to.be.revertedWithCustomError(vault, "InsufficientUpdateFee")
        .withArgs(0n, UPDATE_FEE);
    });

    it("keeps the gate closed when the pushed price is outside the band", async function () {
      const { vault, alice, update } = await deployFixture();
      const data = await update(60_000_000n); // $0.60 > $0.50 max
      await expect(
        vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [data], { value: UPDATE_FEE }),
      ).to.be.revertedWithCustomError(vault, "PriceOutOfBand");
    });

    it("treats an old Pyth publish time as stale", async function () {
      const { vault, alice, update } = await deployFixture();
      const old = (await time.latest()) - 600;
      const data = await update(8_055_012n, -8, 1_000n, old);
      await expect(
        vault.connect(alice).depositWithPriceUpdate(ethers.parseEther("1"), [data], { value: UPDATE_FEE }),
      ).to.be.revertedWithCustomError(vault, "StalePrice");
    });

    it("withdraws with a fresh update after the stored price went stale", async function () {
      const { vault, alice, token, update } = await deployFixture();
      const amount = ethers.parseEther("4");
      await vault.connect(alice).depositWithPriceUpdate(amount, [await update(8_055_012n)], { value: UPDATE_FEE });
      await time.increase(300);
      await expect(vault.connect(alice).withdraw(amount)).to.be.revertedWithCustomError(vault, "StalePrice");
      const before = await token.balanceOf(alice.address);
      await expect(
        vault.connect(alice).withdrawWithPriceUpdate(amount, [await update(8_100_000n)], { value: UPDATE_FEE }),
      ).to.emit(vault, "Withdrawn");
      expect(await token.balanceOf(alice.address)).to.equal(before + amount);
    });
  });
});
