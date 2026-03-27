/**
 * Chainlink Adapter Integration Test
 *
 * Reads live price data from Base Sepolia Chainlink feeds.
 *
 * Usage:
 *   cd packages/resolution-service
 *   RPC_URL=... npx tsx tests/chainlink.test.ts
 */

import { ChainlinkAdapter } from "../src/oracle/chainlink.adapter.js";

function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}

async function runTests() {
    console.log("\n========================================");
    console.log("  Chainlink Adapter Integration Tests");
    console.log("  Network: Base Sepolia");
    console.log("========================================\n");

    if (!process.env["RPC_URL"]) {
        console.log("  Missing RPC_URL in environment\n");
        process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    const adapter = new ChainlinkAdapter();

    // ── Test 1: ETH/USD price feed ────────────────────────────────
    console.log("── Price Feeds ──────────────────────────────────");
    try {
        console.log("  Fetching ETH/USD from Base Sepolia...");
        const result = await adapter.fetchPrice("ETH/USD");

        const price = parseFloat(result.value);

        if (isNaN(price) || price <= 0) {
            fail("ETH/USD price", `Invalid price: ${result.value}`);
            failed++;
        } else {
            pass(`ETH/USD: $${result.value}`);
            pass(`Feed description: ${result.description}`);
            pass(`Last updated: ${result.updatedAt.toISOString()}`);
            passed += 3;
        }
    } catch (err) {
        fail("ETH/USD price fetch", `${err}`);
        failed++;
    }

    // ── Test 2: BTC/USD price feed ────────────────────────────────
    try {
        console.log("\n  Fetching BTC/USD from Base Sepolia...");
        const result = await adapter.fetchPrice("BTC/USD");

        const price = parseFloat(result.value);
        if (isNaN(price) || price <= 0) {
            fail("BTC/USD price", `Invalid price: ${result.value}`);
            failed++;
        } else {
            pass(`BTC/USD: $${result.value}`);
            passed++;
        }
    } catch (err) {
        fail("BTC/USD price fetch", `${err}`);
        failed++;
    }

    // ── Test 3: Unknown feed error handling ───────────────────────
    console.log("\n── Error Handling ───────────────────────────────");
    try {
        await adapter.fetchPrice("NONEXISTENT/USD");
        fail("Unknown feed", "Should have thrown an error");
        failed++;
    } catch (err) {
        if (err instanceof Error && err.message.includes("No Chainlink feed address")) {
            pass("Unknown feed throws correct error");
            passed++;
        } else {
            fail("Unknown feed error type", `${err}`);
            failed++;
        }
    }

    // ── Summary ───────────────────────────────────────────────────
    console.log("\n========================================");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("========================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});