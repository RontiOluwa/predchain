/**
 * Integration test for IntentParser.
 *
 * Run this manually to verify the parser works end-to-end
 * against the real OpenAI API before wiring it into the gateway.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npx tsx tests/intent.parser.test.ts
 */

import { IntentParser } from "../src/parsers/intent.parser.js";

// ── Test cases ────────────────────────────────────────────────────────────────
/**
 * Each test case exercises a different parsing scenario.
 * We test: crypto price, sports event, vague deadline, and an unresolvable input.
 */
const TEST_CASES = [
    {
        label: "Crypto price prediction (high confidence expected)",
        input: "Will ETH hit $5,000 before the end of 2025?",
        expectSource: "CHAINLINK_PRICE",
        expectHighConfidence: true,
    },
    {
        label: "Sports event prediction (AI_WEB_SEARCH expected)",
        input: "Will Arsenal win the Premier League title in the 2024-25 season?",
        expectSource: "AI_WEB_SEARCH",
        expectHighConfidence: true,
    },
    {
        label: "Vague deadline prediction (lower confidence expected)",
        input: "Will Bitcoin go up soon?",
        expectSource: null, // anything valid
        expectHighConfidence: false,
    },
    {
        label: "BTC price with specific threshold",
        input: "Will BTC exceed $100,000 by March 31st, 2026?",
        expectSource: "CHAINLINK_PRICE",
        expectHighConfidence: true,
    },
] as const;

// ── Runner ────────────────────────────────────────────────────────────────────
async function runTests() {
    const parser = new IntentParser();

    console.log("\n========================================");
    console.log("  IntentParser Integration Tests");
    console.log("========================================\n");

    let passed = 0;
    let failed = 0;

    for (const tc of TEST_CASES) {
        console.log(`▶ ${tc.label}`);
        console.log(`  Input: "${tc.input}"`);

        const result = await parser.parse(tc.input);

        if (!result.success) {
            console.log(`  ✗ FAILED — Parser error: ${result.error}\n`);
            failed++;
            continue;
        }

        const { data } = result;
        const issues: string[] = [];

        // Check resolution source expectation
        if (tc.expectSource && data.resolutionSource !== tc.expectSource) {
            issues.push(
                `Expected resolutionSource "${tc.expectSource}", got "${data.resolutionSource}"`
            );
        }

        // Check confidence expectation
        if (tc.expectHighConfidence && data.confidence < 0.7) {
            issues.push(
                `Expected high confidence (>=0.7), got ${data.confidence}`
            );
        }

        if (issues.length > 0) {
            console.log(`  ✗ FAILED`);
            issues.forEach((i) => console.log(`    → ${i}`));
        } else {
            console.log(`  ✓ PASSED`);
            passed++;
        }

        // Always print the full parsed schema for visual inspection
        console.log(`  Question:     ${data.question}`);
        console.log(`  Subject:      ${data.subject}`);
        console.log(`  Condition:    ${data.condition.operator} ${data.condition.threshold} ${data.condition.unit}`);
        console.log(`  Deadline:     ${data.deadline}`);
        console.log(`  Source:       ${data.resolutionSource}`);
        console.log(`  Key:          ${data.resolutionKey}`);
        console.log(`  Confidence:   ${data.confidence}`);
        if (data.parserNotes) {
            console.log(`  Notes:        ${data.parserNotes}`);
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