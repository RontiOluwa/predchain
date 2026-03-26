import { ethers } from "hardhat";
import { writeFileSync } from "fs";
import { join } from "path";

/**
 * Deployment script for Predchain contracts.
 *
 * Deploys in order:
 * 1. PredToken  — the testnet staking token
 * 2. MarketFactory — the factory (needs token address)
 *
 * PredictionMarket contracts are NOT deployed here.
 * They are deployed dynamically by the factory when the
 * Market Service calls createMarket().
 *
 * After deployment, writes contract addresses to:
 *   contracts/deployments/<network>.json
 * Copy these values into your .env file.
 *
 * Run:
 *   pnpm deploy:testnet   → Base Sepolia
 *   pnpm deploy:local     → local Hardhat node
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("\n================================================");
  console.log("  Predchain Contract Deployment");
  console.log("================================================");
  console.log(`Network:   ${network.name} (chainId: ${network.chainId})`);
  console.log(`Deployer:  ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH`);

  if (balance === 0n) {
    throw new Error(
      "Deployer has no ETH. Get Base Sepolia ETH from: https://www.alchemy.com/faucets/base-sepolia"
    );
  }

  console.log("\n--- Deploying PredToken ---");

  // ── 1. Deploy PredToken ───────────────────────────────────────
  const PredToken = await ethers.getContractFactory("PredToken");
  const predToken = await PredToken.deploy(deployer.address);
  await predToken.waitForDeployment();
  const predTokenAddress = await predToken.getAddress();

  console.log(`✓ PredToken deployed: ${predTokenAddress}`);

  // ── 2. Deploy MarketFactory ───────────────────────────────────
  console.log("\n--- Deploying MarketFactory ---");

  /**
   * RESOLVER: The wallet address our Resolution Service uses to sign
   * resolve() transactions. For now this is the deployer wallet.
   * In production, use a dedicated hot wallet with minimal funds.
   *
   * TREASURY: Where protocol fees (2% of losing pool) go.
   * Using deployer address for testnet. Use a multisig in production.
   */
  const resolverAddress = deployer.address;
  const treasuryAddress = deployer.address;

  const MarketFactory = await ethers.getContractFactory("MarketFactory");
  const factory = await MarketFactory.deploy(
    predTokenAddress,
    resolverAddress,
    treasuryAddress,
    deployer.address
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();

  console.log(`✓ MarketFactory deployed: ${factoryAddress}`);

  // ── 3. Fund deployer with test tokens ─────────────────────────
  console.log("\n--- Funding deployer with test tokens ---");
  const mintAmount = ethers.parseEther("100000"); // 100k PRED
  const mintTx = await predToken.mint(deployer.address, mintAmount);
  await mintTx.wait();
  console.log(`✓ Minted 100,000 PRED to deployer`);

  // ── 4. Write deployment addresses ─────────────────────────────
  const deployment = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      PredToken: predTokenAddress,
      MarketFactory: factoryAddress,
    },
    env: {
      PRED_TOKEN_ADDRESS: predTokenAddress,
      FACTORY_CONTRACT_ADDRESS: factoryAddress,
    },
  };

  // Write to deployments folder
  const deploymentsDir = join(process.cwd(), "deployments");
  try {
    const { mkdirSync } = await import("fs");
    mkdirSync(deploymentsDir, { recursive: true });
  } catch { }

  const outPath = join(deploymentsDir, `${network.name}.json`);
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  // ── 5. Print summary ──────────────────────────────────────────
  console.log("\n================================================");
  console.log("  Deployment Complete");
  console.log("================================================");
  console.log(`PredToken:      ${predTokenAddress}`);
  console.log(`MarketFactory:  ${factoryAddress}`);
  console.log(`\nSaved to: ${outPath}`);
  console.log("\nAdd these to your .env:");
  console.log(`PRED_TOKEN_ADDRESS=${predTokenAddress}`);
  console.log(`FACTORY_CONTRACT_ADDRESS=${factoryAddress}`);

  // Testnet explorer links
  if (Number(network.chainId) === 84532) {
    console.log("\nView on Base Sepolia explorer:");
    console.log(`  PredToken:     https://sepolia.basescan.org/address/${predTokenAddress}`);
    console.log(`  MarketFactory: https://sepolia.basescan.org/address/${factoryAddress}`);
  }

  console.log("\n================================================\n");
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
