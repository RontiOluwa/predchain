/**
 * WebSearch Adapter Integration Test
 *
 * Usage:
 *   cd packages/resolution-service
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx tests/websearch.test.ts
 */

import { WebSearchAdapter } from "../src/oracle/websearch.adapter.js";

function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}

async function runTests() {
    console.log("\n========================================");
    console.log("  WebSearch Adapter Integration Tests");
    console.log("========================================\n");

    if (!process.env["ANTHROPIC_API_KEY"]) {
        console.log("  Missing ANTHROPIC_API_KEY in environment\n");
        process.exit(1);
    }

    let passed = 0;
    let failed = 0;

    const adapter = new WebSearchAdapter();

    // ── Test 1: Known past event ──────────────────────────────────
    console.log("── Web Search Results ───────────────────────────");
    try {
        console.log("  Searching for known past result...");
        // Use a past event we know the answer to
        const result = await adapter.search(
            "FIFA World Cup 2022 winner country",
            new Date("2023-01-01") // deadline well after the event
        );

        if (!result.found) {
            fail("Known past event", "Expected found: true for 2022 World Cup winner");
            failed++;
        } else if (!result.value.toLowerCase().includes("argentina")) {
            fail("Known past event", `Expected Argentina in result, got: ${result.value}`);
            failed++;
        } else {
            pass(`Found result: "${result.value}"`);
            pass(`Source: ${result.source ?? "not specified"}`);
            pass(`Summary: ${result.summary}`);
            passed += 3;
        }
    } catch (err) {
        fail("Known past event search", `${err}`);
        failed++;
    }

    // ── Test 2: Event before deadline returns not found ───────────
    console.log("\n── Deadline Enforcement ─────────────────────────");
    try {
        console.log("  Searching for event before it happened...");
        // Ask about a future event with a past deadline
        const result = await adapter.search(
            "FIFA World Cup 2030 winner",
            new Date("2026-01-01") // deadline before the 2030 event
        );

        if (result.found) {
            fail("Future event check", `Should not find 2030 World Cup winner before deadline`);
            failed++;
        } else {
            pass("Future event correctly returned found: false");
            pass(`Explanation: ${result.summary}`);
            passed += 2;
        }
    } catch (err) {
        fail("Future event deadline check", `${err}`);
        failed++;
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