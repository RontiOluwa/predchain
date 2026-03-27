/**
 * Market Service Integration Tests
 *
 * Tests DB connection, market creation, and BullMQ job enqueuing.
 * Does NOT deploy a real contract — that's tested separately in factory.test.ts.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *
 * Usage:
 *   cd packages/market-service
 *   ANTHROPIC_API_KEY=sk-ant-... npx tsx tests/market.service.test.ts
 */

import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";

// ── Helpers ───────────────────────────────────────────────────────

function pass(label: string) {
    console.log(`  ✓ ${label}`);
}

function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}

function section(title: string) {
    console.log(`\n── ${title} ${"─".repeat(40 - title.length)}`);
}

// ── Test Runner ───────────────────────────────────────────────────

async function runTests() {
    console.log("\n========================================");
    console.log("  Market Service Integration Tests");
    console.log("========================================");

    let passed = 0;
    let failed = 0;

    // ── Test 1: PostgreSQL connection ─────────────────────────────
    section("Database");

    const prisma = new PrismaClient({
        datasources: { db: { url: process.env["DATABASE_URL"] } },
    });

    try {
        await prisma.$connect();
        pass("PostgreSQL connection established");
        passed++;
    } catch (err) {
        fail("PostgreSQL connection", `${err}`);
        failed++;
        console.log("\n  Make sure Docker is running: docker compose up -d");
        console.log("  And migrations applied: pnpm db:migrate\n");
        process.exit(1);
    }

    // ── Test 2: Tables exist ──────────────────────────────────────
    try {
        const tableCheck = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
        const tables = tableCheck.map((r) => r.tablename);
        const required = ["Market", "Stake", "ResolutionEvidence", "MarketJob", "OnChainEvent"];

        const missing = required.filter(
            (t) => !tables.some((found) => found.toLowerCase() === t.toLowerCase())
        );

        if (missing.length > 0) {
            fail("All tables exist", `Missing: ${missing.join(", ")}`);
            failed++;
            console.log("  Run: pnpm db:migrate");
        } else {
            pass(`All tables exist: ${tables.join(", ")}`);
            passed++;
        }
    } catch (err) {
        fail("Table check", `${err}`);
        failed++;
    }

    // ── Test 3: Market creation (no blockchain) ───────────────────
    section("Market Service");

    try {
        /**
         * We test the DB write directly — bypassing the AI parser
         * so this test doesn't consume API credits.
         * The AI parser is already tested in the ai-agent tests.
         */
        const testMarket = await prisma.market.create({
            data: {
                question: "Will ETH exceed $5,000 by December 31st, 2026?",
                description: "Test market for integration testing",
                subject: "ETH",
                conditionOperator: "gt",
                conditionThreshold: "5000",
                conditionUnit: "USD",
                deadline: new Date("2026-12-31T23:59:59Z"),
                resolutionSource: "CHAINLINK_PRICE",
                resolutionKey: "ETH/USD",
                confidence: 0.95,
                creatorAddress: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
                status: "PENDING",
            },
        });

        pass(`Market created in DB (id: ${testMarket.id})`);
        passed++;

        // ── Test 4: Market retrieval ──────────────────────────────
        const fetched = await prisma.market.findUnique({
            where: { id: testMarket.id },
        });

        if (!fetched) {
            fail("Market retrieval", "Market not found after creation");
            failed++;
        } else if (fetched.status !== "PENDING") {
            fail("Market retrieval", `Expected PENDING, got ${fetched.status}`);
            failed++;
        } else {
            pass(`Market retrieved (status: ${fetched.status})`);
            passed++;
        }

        // ── Test 5: Stake recording ───────────────────────────────
        // First set market to OPEN so stakes can be recorded
        await prisma.market.update({
            where: { id: testMarket.id },
            data: { status: "OPEN", contractAddress: "0x1234567890123456789012345678901234567890" },
        });

        const testStake = await prisma.stake.create({
            data: {
                marketId: testMarket.id,
                userAddress: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
                side: "YES",
                amount: "100000000000000000000", // 100 PRED in wei
                txHash: `0x${"a".repeat(64)}`, // mock tx hash
            },
        });

        pass(`Stake recorded (id: ${testStake.id}, side: ${testStake.side})`);
        passed++;

        // Clean up test data
        await prisma.stake.delete({ where: { id: testStake.id } });
        await prisma.market.delete({ where: { id: testMarket.id } });
        pass("Test data cleaned up");
        passed++;

    } catch (err) {
        fail("Market service DB operations", `${err}`);
        failed++;
    }

    // ── Test 6: Redis / BullMQ connection ────────────────────────
    section("BullMQ / Redis");

    const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
    const redisConnection = {
        host: new URL(redisUrl).hostname,
        port: parseInt(new URL(redisUrl).port || "6379"),
    };

    try {
        const testQueue = new Queue("test-connection-check", {
            connection: redisConnection,
        });

        const job = await testQueue.add("ping", { test: true });
        pass(`Redis connected, BullMQ job enqueued (id: ${job.id})`);
        passed++;

        // Clean up
        await job.remove();
        await testQueue.close();
    } catch (err) {
        fail("Redis / BullMQ connection", `${err}`);
        failed++;
        console.log("  Make sure Docker is running: docker compose up -d");
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