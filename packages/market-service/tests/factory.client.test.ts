/**
 * FactoryClient Integration Test
 *
 * Deploys a real PredictionMarket contract on Base Sepolia.
 * Requires a funded testnet wallet.
 *
 * Usage:
 *   cd packages/market-service
 *   RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... FACTORY_CONTRACT_ADDRESS=0x... \
 *   npx tsx tests/factory.client.test.ts
 */

import { FactoryClient } from "../src/blockchain/factory.client.js";

function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}

async function runTests() {
    console.log("\n========================================");
    console.log("  FactoryClient Integration Tests");
    console.log("  Network: Base Sepolia");
    console.log("========================================\n");

    // Check required env vars
    const required = ["RPC_URL", "DEPLOYER_PRIVATE_KEY", "FACTORY_CONTRACT_ADDRESS"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        console.log(`  Missing env vars: ${missing.join(", ")}`);
        console.log("  Copy .env.example to .env and fill in values\n");
        process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    const factory = new FactoryClient();

    // ── Test 1: Read existing market count ───────────────────────
    console.log("── Read Operations ──────────────────────────────");
    try {
        /**
         * We test a read operation first — if this fails, the RPC
         * or contract address is wrong and we stop before writing anything.
         */
        const nonExistentAddress = await factory.getDeployedMarketAddress(
            "00000000-0000-0000-0000-000000000000"
        );
        pass(`Factory contract readable (non-existent market returns: ${nonExistentAddress})`);
        passed++;
    } catch (err) {
        fail("Factory contract read", `${err}`);
        failed++;
        console.log("\n  Check RPC_URL and FACTORY_CONTRACT_ADDRESS in .env\n");
        process.exit(1);
    }

    // ── Test 2: Deploy a market contract ─────────────────────────
    console.log("\n── Deploy Market ────────────────────────────────");
    console.log("  Deploying to Base Sepolia... (this takes ~10-15 seconds)");

    const testMarketId = `test-${Date.now()}-0000-0000-0000-000000000000`;
    // Deadline 1 hour from now
    const deadline = new Date(Date.now() + 60 * 60 * 1000);

    let contractAddress: string | null = null;

    try {
        const txHash = await factory.deployMarket(testMarketId, deadline);
        pass(`Deploy tx submitted: ${txHash}`);
        passed++;

        // Wait for confirmation
        console.log("  Waiting for on-chain confirmation...");
        await factory.waitForTransaction(txHash);
        pass("Transaction confirmed on Base Sepolia");
        passed++;

        // Fetch deployed address
        contractAddress = await factory.getDeployedMarketAddress(testMarketId);

        if (!contractAddress) {
            fail("Contract address retrieval", "Address is null after deployment");
            failed++;
        } else {
            pass(`Market contract deployed: ${contractAddress}`);
            pass(`View on explorer: https://sepolia.basescan.org/address/${contractAddress}`);
            passed++;
        }
    } catch (err) {
        fail("Market deployment", `${err}`);
        failed++;
    }

    // ── Summary ───────────────────────────────────────────────────
    console.log("\n========================================");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (contractAddress) {
        console.log(`\n  Deployed contract: ${contractAddress}`);
        console.log("  Note: This is a real testnet contract. It will expire in 1 hour.");
    }
    console.log("========================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});