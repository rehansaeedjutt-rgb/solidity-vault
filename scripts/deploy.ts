import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Deploys a SimpleVault on top of a fresh MockERC20. The MockERC20 stands in
// for USDC here — on a real Sepolia deploy you would pass the real USDC
// address (0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 on Sepolia).
//
// Writes the deployed addresses to deployments/<network>.json so the
// frontend or a follow-up script can pick them up without scraping logs.

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Deploying to ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH`);
  console.log("");

  // 1. Deploy the underlying asset (mock USDC).
  const Token = await ethers.getContractFactory("MockERC20");
  const usdc = await Token.deploy("Mock USDC", "mUSDC");
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`MockUSDC:   ${usdcAddr}`);

  // 2. Deploy the vault on top of it.
  const Vault = await ethers.getContractFactory("SimpleVault");
  const vault = await Vault.deploy(usdcAddr, "Vaulted USDC", "vUSDC", deployer.address);
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();
  console.log(`SimpleVault: ${vaultAddr}`);

  // 3. Mint some test liquidity to the deployer for the demo.
  const initialSupply = 1_000_000n * 10n ** 6n;
  const mintTx = await usdc.mint(deployer.address, initialSupply);
  await mintTx.wait();
  console.log(`Minted ${initialSupply / 10n ** 6n} mUSDC to deployer`);

  // 4. Persist addresses.
  const outDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, `${network.name}.json`);
  const payload = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      mockUSDC: usdcAddr,
      simpleVault: vaultAddr,
    },
  };
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log("");
  console.log(`Addresses written to ${outPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });