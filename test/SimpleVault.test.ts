import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { SimpleVault, MockERC20, MockStrategy } from "../typechain-types";

// Reusable fixture — runs once, snapshot is restored between tests.
// Deploys a mock USDC, a vault on top of it, and (optionally) a strategy.
async function deployFixture() {
  const [owner, alice, bob] = await ethers.getSigners();

  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = (await Token.deploy("Mock USDC", "mUSDC")) as MockERC20;

  const Vault = await ethers.getContractFactory("SimpleVault");
  const vault = (await Vault.deploy(
    await usdc.getAddress(),
    "Vaulted USDC",
    "vUSDC",
    owner.address
  )) as SimpleVault;

  const Strategy = await ethers.getContractFactory("MockStrategy");
  const strategy = (await Strategy.deploy(
    await usdc.getAddress(),
    await vault.getAddress()
  )) as MockStrategy;

  const ONE = 10n ** 6n; // mUSDC has 6 decimals like real USDC
  const INITIAL = 1_000_000n * ONE; // 1M mUSDC for owner

  await usdc.mint(owner.address, INITIAL);
  await usdc.mint(alice.address, INITIAL);
  await usdc.mint(bob.address, INITIAL);

  return { usdc, vault, strategy, owner, alice, bob, ONE, INITIAL };
}

describe("SimpleVault", () => {
  describe("ERC-4626 basics", () => {
    it("has correct asset and metadata", async () => {
      const { usdc, vault } = await loadFixture(deployFixture);
      expect(await vault.asset()).to.equal(await usdc.getAddress());
      expect(await vault.name()).to.equal("Vaulted USDC");
      expect(await vault.symbol()).to.equal("vUSDC");
    });

    it("starts with zero total assets and zero supply", async () => {
      const { vault } = await loadFixture(deployFixture);
      expect(await vault.totalAssets()).to.equal(0);
      expect(await vault.totalSupply()).to.equal(0);
    });

    it("deposit mints shares at 1:1 when vault is empty", async () => {
      const { usdc, vault, alice, ONE } = await loadFixture(deployFixture);

      const amount = 1000n * ONE;
      await usdc.connect(alice).approve(await vault.getAddress(), amount);
      await vault.connect(alice).deposit(amount, alice.address);

      expect(await vault.balanceOf(alice.address)).to.equal(amount);
      expect(await vault.totalAssets()).to.equal(amount);
    });

    it("withdraw returns assets and burns shares", async () => {
      const { usdc, vault, alice, ONE } = await loadFixture(deployFixture);

      const amount = 1000n * ONE;
      await usdc.connect(alice).approve(await vault.getAddress(), amount);
      await vault.connect(alice).deposit(amount, alice.address);

      await vault.connect(alice).withdraw(amount, alice.address, alice.address);

      expect(await vault.balanceOf(alice.address)).to.equal(0);
      expect(await vault.totalAssets()).to.equal(0);
    });

    it("second depositor gets shares proportional to assets", async () => {
      const { usdc, vault, alice, bob, ONE } = await loadFixture(deployFixture);

      const aliceAmount = 1000n * ONE;
      await usdc.connect(alice).approve(await vault.getAddress(), aliceAmount);
      await vault.connect(alice).deposit(aliceAmount, alice.address);

      // Bob deposits half as much — should get half the shares.
      const bobAmount = 500n * ONE;
      await usdc.connect(bob).approve(await vault.getAddress(), bobAmount);
      await vault.connect(bob).deposit(bobAmount, bob.address);

      expect(await vault.balanceOf(alice.address)).to.equal(aliceAmount);
      expect(await vault.balanceOf(bob.address)).to.equal(bobAmount);
      expect(await vault.totalSupply()).to.equal(aliceAmount + bobAmount);
    });
  });

  describe("Strategy integration", () => {
    it("rejects deploy when no strategy is set", async () => {
      const { vault, owner, ONE } = await loadFixture(deployFixture);
      await expect(vault.connect(owner).deployToStrategy(100n * ONE)).to.be.revertedWith(
        "Vault: no strategy set"
      );
    });

    it("setStrategy stores the strategy address", async () => {
      const { vault, strategy, owner } = await loadFixture(deployFixture);
      await expect(vault.connect(owner).setStrategy(await strategy.getAddress()))
        .to.emit(vault, "StrategySet")
        .withArgs(ethers.ZeroAddress, await strategy.getAddress());

      expect(await vault.strategy()).to.equal(await strategy.getAddress());
    });

    it("only owner can set the strategy", async () => {
      const { vault, strategy, alice } = await loadFixture(deployFixture);
      await expect(
        vault.connect(alice).setStrategy(await strategy.getAddress())
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });

    it("cannot set strategy while assets are deployed to current one", async () => {
      const { usdc, vault, strategy, owner, ONE } = await loadFixture(deployFixture);

      // Seed and deploy.
      await usdc.connect(owner).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(owner).deposit(1000n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await vault.connect(owner).deployToStrategy(500n * ONE);

      await expect(
        vault.connect(owner).setStrategy(ethers.ZeroAddress)
      ).to.be.revertedWith("Vault: strategy has assets deployed");
    });

    it("deployToStrategy moves assets and tracks them in totalAssets", async () => {
      const { usdc, vault, strategy, owner, ONE } = await loadFixture(deployFixture);

      await usdc.connect(owner).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(owner).deposit(1000n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());

      const deployAmount = 800n * ONE;
      await expect(vault.connect(owner).deployToStrategy(deployAmount))
        .to.emit(vault, "Deployed")
        .withArgs(await strategy.getAddress(), deployAmount);

      // Vault's idle balance should be 200, strategy should hold 800.
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(200n * ONE);
      expect(await usdc.balanceOf(await strategy.getAddress())).to.equal(deployAmount);

      // totalAssets includes both.
      expect(await vault.totalAssets()).to.equal(1000n * ONE);
    });

    it("recallFromStrategy brings assets back and updates totalAssets", async () => {
      const { usdc, vault, strategy, owner, ONE } = await loadFixture(deployFixture);

      await usdc.connect(owner).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(owner).deposit(1000n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await vault.connect(owner).deployToStrategy(800n * ONE);

      const recallAmount = 300n * ONE;
      await expect(vault.connect(owner).recallFromStrategy(recallAmount))
        .to.emit(vault, "Recalled")
        .withArgs(await strategy.getAddress(), recallAmount);

      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(500n * ONE);
      expect(await strategy.totalDeployed()).to.equal(500n * ONE);
      expect(await vault.totalAssets()).to.equal(1000n * ONE);
    });

    it("reverts when deploying more than idle balance", async () => {
      const { usdc, vault, strategy, owner, ONE } = await loadFixture(deployFixture);

      await usdc.connect(owner).approve(await vault.getAddress(), 500n * ONE);
      await vault.connect(owner).deposit(500n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());

      await expect(
        vault.connect(owner).deployToStrategy(600n * ONE)
      ).to.be.revertedWith("Vault: insufficient idle balance");
    });

    it("recall caps at what the strategy actually has", async () => {
      const { usdc, vault, strategy, owner, ONE } = await loadFixture(deployFixture);

      await usdc.connect(owner).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(owner).deposit(1000n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await vault.connect(owner).deployToStrategy(300n * ONE);

      // Ask for more than deployed — strategy returns what it has.
      await vault.connect(owner).recallFromStrategy(1000n * ONE);

      expect(await strategy.totalDeployed()).to.equal(0);
      expect(await usdc.balanceOf(await vault.getAddress())).to.equal(1000n * ONE);
    });

    it("only owner can deploy or recall", async () => {
      const { usdc, vault, strategy, owner, alice, ONE } = await loadFixture(deployFixture);

      await usdc.connect(owner).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(owner).deposit(1000n * ONE, owner.address);
      await vault.connect(owner).setStrategy(await strategy.getAddress());

      await expect(
        vault.connect(alice).deployToStrategy(100n * ONE)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
      await expect(
        vault.connect(alice).recallFromStrategy(100n * ONE)
      ).to.be.revertedWithCustomError(vault, "OwnableUnauthorizedAccount");
    });
  });

  describe("Yield reflection", () => {
    it("share price rises when the strategy earns yield, and recall brings assets back", async () => {
      const { usdc, vault, strategy, owner, alice, ONE } = await loadFixture(deployFixture);

      // Track the delta, not the absolute balance. Alice got 1M mUSDC in the
      // fixture, so her absolute balance at the end of this test will be
      // ~1M again. What we care about is the gain relative to what she started
      // this test with.
      const aliceBalanceBefore = await usdc.balanceOf(alice.address);

      // Alice deposits 1000 mUSDC.
      await usdc.connect(alice).approve(await vault.getAddress(), 1000n * ONE);
      await vault.connect(alice).deposit(1000n * ONE, alice.address);

      // Owner deploys everything to the strategy.
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await vault.connect(owner).deployToStrategy(1000n * ONE);

      // Simulate yield: 100 mUSDC of extra assets materialise in the strategy.
      // In a real integration these would come from lending interest or LP
      // fees. Here we mint them straight to the strategy and tell it to
      // count them. The vault sees totalAssets() rise without any new shares
      // being issued, which is exactly the effect of real yield.
      await usdc.connect(owner).transfer(await strategy.getAddress(), 100n * ONE);
      await strategy.simulateYield(100n * ONE);

      // Vault now reports 1100 total assets against 1000 outstanding shares.
      expect(await vault.totalAssets()).to.equal(1100n * ONE);
      expect(await vault.totalSupply()).to.equal(1000n * ONE);

      // Important limitation of this vault: it does NOT auto-recall from the
      // strategy on withdraw. If the vault has zero idle balance, a user
      // cannot redeem. This is deliberate — a real production vault would
      // override _withdraw to pull from strategy first, but that adds a lot
      // of complexity (reentrancy considerations, strategy failure modes,
      // withdrawal queues). This demo keeps the vault dumb on purpose.
      await expect(
        vault.connect(alice).redeem(1000n * ONE, alice.address, alice.address)
      ).to.be.reverted; // no idle balance to pay from

      // Owner recalls the whole position. Alice can now redeem.
      await vault.connect(owner).recallFromStrategy(1100n * ONE);
      expect(await vault.totalAssets()).to.equal(1100n * ONE);

      const shares = await vault.balanceOf(alice.address);
      await vault.connect(alice).redeem(shares, alice.address, alice.address);
      expect(await vault.balanceOf(alice.address)).to.equal(0);

      // Delta = final - before. She started the test with X, ended with X + gain.
      // Expected gain is 100 mUSDC (the simulated yield), but OpenZeppelin v5
      // virtual-offset rounding means the last wei of precision can be lost.
      // So we assert within 2 wei of the expected gain.
      const aliceBalanceAfter = await usdc.balanceOf(alice.address);
      const gain = aliceBalanceAfter - aliceBalanceBefore;
      const expectedGain = 100n * ONE;
      const roundingTolerance = 2n;

      expect(gain).to.be.gte(expectedGain - roundingTolerance);
      expect(gain).to.be.lte(expectedGain + roundingTolerance);
    });
  });

  describe("Edge cases", () => {
    it("reverts deployToStrategy with zero amount", async () => {
      const { vault, strategy, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await expect(vault.connect(owner).deployToStrategy(0)).to.be.revertedWith(
        "Vault: amount must be > 0"
      );
    });

    it("reverts recallFromStrategy with zero amount", async () => {
      const { vault, strategy, owner } = await loadFixture(deployFixture);
      await vault.connect(owner).setStrategy(await strategy.getAddress());
      await expect(vault.connect(owner).recallFromStrategy(0)).to.be.revertedWith(
        "Vault: amount must be > 0"
      );
    });

    it("reverts when a non-vault calls strategy.deploy", async () => {
      const { strategy, alice, ONE } = await loadFixture(deployFixture);
      await expect(
        strategy.connect(alice).deploy(100n * ONE)
      ).to.be.revertedWith("MockStrategy: only vault");
    });
  });
});