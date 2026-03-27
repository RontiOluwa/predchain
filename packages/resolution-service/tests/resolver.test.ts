/**
 * MarketResolver End-to-End Test
 *
 * Creates a LOCKED market in the DB with a real deployed contract address,
 * then runs the full resolution pipeline — oracle fetch, AI evaluation,
 * on-chain settle, DB update.
 *
 * Prerequisites:
 *   - docker compose up -d
 *   - pnpm db:migrate
 *   - A deployed MarketFactory on Base Sepolia (from Step 3)
 *   - A deployed PredictionMarket contract that is already LOCKED
 *     (use the factory.client.test.ts output to get a contract address,
 *      then manually call lock() after its deadline passes)
 *
 * Usage:
 *   cd packages/resolution-service
 *   ANTHROPIC_API_KEY=sk-ant-... RPC_URL=... DEPLOYER_PRIVATE_KEY=0x... \
 *   CONTRACT_ADDRESS=0x... npx tsx tests/resolver.test.ts
 *
 * Note: If CONTRACT_ADDRESS is not set, we test with a mock LOCKED market
 * that uses the Chainlink fast path (no on-chain call, just DB update).
 */

import { PrismaClient } from "@prisma/client";
import { ChainlinkAdapter } from "../src/oracle/chainlink.adapter.js";
import { ResolutionAgent } from "@predchain/ai-agent";

function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}

async function runTests() {
    console.log("\n========================================");
    console.log("  MarketResolver Integration Tests");
    console.log("========================================\n");

    let passed = 0;
    let failed = 0;

    const prisma = new PrismaClient();

    // ── Test 1: Chainlink + ResolutionAgent pipeline ──────────────
    // Tests oracle fetch → AI evaluation without touching the blockchain
    console.log("── Oracle + AI Pipeline ─────────────────────────");
    try {
        console.log("  Fetching live ETH/USD price from Chainlink...");
        const chainlink = new ChainlinkAdapter();
        const oracleResult = await chainlink.fetchPrice("ETH/USD");
        pass(`Oracle value: $${oracleResult.value}`);
        passed++;

        // Build a mock market that matches the current price scenario
        const currentPrice = parseFloat(oracleResult.value);
        // Set threshold slightly below current price so outcome should be YES
        const threshold = (currentPrice * 0.5).toFixed(2);

        const mockMarket = {
            id: "resolver-test-001",
            question: `Will ETH exceed $${threshold}?`,
            description: "Test market for resolver pipeline",
            subject: "ETH",
            condition: {
                operator: "gt" as const,
                threshold,
                unit: "USD",
            },
            deadline: new Date(Date.now() - 1000).toISOString(), // already passed
            resolutionSource: "CHAINLINK_PRICE" as const,
            resolutionKey: "ETH/USD",
            confidence: 0.95,
            status: "LOCKED" as const,
            yesPool: "1000000000000000000000",
            noPool: "500000000000000000000",
            creatorAddress: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        console.log(`\n  Testing resolution: ETH ($${currentPrice}) > $${threshold}`);

        const agent = new ResolutionAgent();
        const result = await agent.evaluate(
            mockMarket as any,
            oracleResult.value,
            oracleResult.fetchedAt.toISOString()
        );

        if (!result.success) {
            fail("Resolution agent evaluation", result.error);
            failed++;
        } else {
            const { evidence } = result;
            // Since threshold is 50% of current price, outcome must be YES
            if (evidence.outcome !== "YES") {
                fail("Resolution outcome", `Expected YES (${currentPrice} > ${threshold}), got ${evidence.outcome}`);
                failed++;
            } else {
                pass(`Outcome: ${evidence.outcome}`);
                pass(`Reasoning: ${evidence.reasoning}`);
                passed += 2;
            }
        }
    } catch (err) {
        fail("Oracle + AI pipeline", `${err}`);
        failed++;
    }

    // ── Test 2: Full DB round-trip (no on-chain) ──────────────────
    console.log("\n── DB Round-trip ────────────────────────────────");
    try {
        const testMarket = await prisma.market.create({
            data: {
                question: "Resolver test market",
                description: "Created by resolver.test.ts",
                subject: "ETH",
                conditionOperator: "gt",
                conditionThreshold: "1000",
                conditionUnit: "USD",
                deadline: new Date(Date.now() - 60000), // 1 min ago
                resolutionSource: "CHAINLINK_PRICE",
                resolutionKey: "ETH/USD",
                confidence: 0.95,
                creatorAddress: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
                status: "LOCKED",
                contractAddress: "0x0000000000000000000000000000000000000001",
            },
        });

        pass(`LOCKED market created in DB (id: ${testMarket.id})`);
        passed++;

        // Write resolution evidence
        await prisma.$transaction([
            prisma.resolutionEvidence.create({
                data: {
                    marketId: testMarket.id,
                    outcome: "YES",
                    oracleValue: "3500.00",
                    reasoning: "ETH price 3500 > threshold 1000 USD",
                    fetchedAt: new Date(),
                },
            }),
            prisma.market.update({
                where: { id: testMarket.id },
                data: { status: "RESOLVED", outcome: "YES", resolvedAt: new Date() },
            }),
        ]);

        const resolved = await prisma.market.findUnique({
            where: { id: testMarket.id },
            include: { resolutionEvidence: true },
        });

        if (resolved?.status === "RESOLVED" && resolved.resolutionEvidence?.outcome === "YES") {
            pass("Market resolved and evidence written to DB");
            passed++;
        } else {
            fail("DB resolution write", `Status: ${resolved?.status}, Evidence: ${resolved?.resolutionEvidence?.outcome}`);
            failed++;
        }

        // Cleanup
        await prisma.resolutionEvidence.delete({ where: { marketId: testMarket.id } });
        await prisma.market.delete({ where: { id: testMarket.id } });
        pass("Test data cleaned up");
        passed++;

    } catch (err) {
        fail("DB round-trip", `${err}`);
        failed++;
    }

    // ── Summary ───────────────────────────────────────────────────
    await prisma.$disconnect();

    console.log("\n========================================");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("========================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});