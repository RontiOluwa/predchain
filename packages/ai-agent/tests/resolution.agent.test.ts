/**
 * Integration test for ResolutionAgent.
 *
 * Tests both the fast path (numeric local resolution)
 * and the LLM path (event-based resolution).
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx tests/resolution.agent.test.ts
 */

import { ResolutionAgent } from "../src/agents/resolution.agent.js";
import type { Market } from "@predchain/shared";

// ── Helpers ───────────────────────────────────────────────────────────────────
/**
 * Builds a minimal mock Market object for testing.
 * Only fills in the fields the ResolutionAgent actually reads.
 */
function mockMarket(overrides: Partial<Market>): Market {
    const base: Market = {
        id: "test-market-001",
        question: "Will ETH exceed $4,000 by December 31st 2025?",
        description: "ETH price prediction",
        subject: "ETH",
        condition: {
            operator: "gt",
            threshold: "4000",
            unit: "USD",
        },
        deadline: "2025-12-31T23:59:59Z",
        resolutionSource: "CHAINLINK_PRICE",
        resolutionKey: "ETH/USD",
        confidence: 0.95,
        status: "LOCKED",
        yesPool: "1000",
        noPool: "800",
        creatorAddress: "0x0000000000000000000000000000000000000001",
        createdAt: new Date(),
        updatedAt: new Date(),
    };
    return { ...base, ...overrides };
}

const NOW = new Date().toISOString();

// ── Test cases ────────────────────────────────────────────────────────────────
const TEST_CASES = [
    {
        label: "Fast path: ETH above threshold → YES",
        market: mockMarket({
            condition: { operator: "gt", threshold: "4000", unit: "USD" },
            resolutionSource: "CHAINLINK_PRICE",
        }),
        oracleValue: "4523.88",
        expectedOutcome: "YES",
    },
    {
        label: "Fast path: ETH below threshold → NO",
        market: mockMarket({
            condition: { operator: "gte", threshold: "5000", unit: "USD" },
            resolutionSource: "CHAINLINK_PRICE",
        }),
        oracleValue: "4200.00",
        expectedOutcome: "NO",
    },
    {
        label: "Fast path: Exact equality match → YES",
        market: mockMarket({
            condition: { operator: "eq", threshold: "3000", unit: "USD" },
            resolutionSource: "CHAINLINK_PRICE",
        }),
        oracleValue: "3000",
        expectedOutcome: "YES",
    },
    {
        label: "LLM path: Arsenal win (web search type)",
        market: mockMarket({
            question: "Did Arsenal win the Premier League in the 2024-25 season?",
            condition: { operator: "eq", threshold: "1", unit: "boolean" },
            resolutionSource: "AI_WEB_SEARCH",
            resolutionKey: "Arsenal Premier League winners 2024-25",
        }),
        oracleValue: "Arsenal finished 2nd in the 2024-25 Premier League",
        expectedOutcome: "NO",
    },
] as const;

// ── Runner ────────────────────────────────────────────────────────────────────
async function runTests() {
    const agent = new ResolutionAgent();

    console.log("\n========================================");
    console.log("  ResolutionAgent Integration Tests");
    console.log("========================================\n");

    let passed = 0;
    let failed = 0;

    for (const tc of TEST_CASES) {
        console.log(`▶ ${tc.label}`);
        console.log(`  Oracle value: ${tc.oracleValue}`);
        console.log(`  Expected:     ${tc.expectedOutcome}`);

        const result = await agent.evaluate(tc.market, tc.oracleValue, NOW);

        if (!result.success) {
            console.log(`  ✗ FAILED — Agent error: ${result.error}\n`);
            failed++;
            continue;
        }

        const { evidence } = result;

        if (evidence.outcome !== tc.expectedOutcome) {
            console.log(
                `  ✗ FAILED — Expected "${tc.expectedOutcome}", got "${evidence.outcome}"`
            );
            console.log(`  Reasoning: ${evidence.reasoning}`);
            failed++;
        } else {
            console.log(`  ✓ PASSED — ${evidence.outcome}`);
            console.log(`  Reasoning: ${evidence.reasoning}`);
            passed++;
        }

        console.log();
    }

    console.log("========================================");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("========================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});