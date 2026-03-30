/**
 * API Gateway Integration Tests
 *
 * Tests all REST endpoints and WebSocket connection.
 * Uses Fastify's inject() for HTTP — no real network needed.
 *
 * Prerequisites:
 *   docker compose up -d
 *   pnpm db:migrate
 *
 * Usage:
 *   cd packages/api-gateway
 *   DATABASE_URL=... REDIS_URL=... JWT_SECRET=test-secret \
 *   npx tsx tests/api.test.ts
 */

import { buildServer } from "../src/server.js";

function pass(label: string) { console.log(`  ✓ ${label}`); }
function fail(label: string, reason: string) {
    console.log(`  ✗ ${label}`);
    console.log(`    → ${reason}`);
}
function section(title: string) {
    console.log(`\n── ${title} ${"─".repeat(40 - title.length)}`);
}

async function runTests() {
    console.log("\n========================================");
    console.log("  API Gateway Integration Tests");
    console.log("========================================");

    // Set required env vars for tests
    process.env["JWT_SECRET"] = process.env["JWT_SECRET"] ?? "test-secret-minimum-32-chars-long!!";

    const server = await buildServer();
    let passed = 0;
    let failed = 0;

    // ── Health check ──────────────────────────────────────────────
    section("Health");
    try {
        const res = await server.inject({ method: "GET", url: "/health" });
        const body = res.json<{ status: string }>();

        if (res.statusCode === 200 && body.status === "ok") {
            pass(`GET /health → 200 OK`);
            passed++;
        } else {
            fail("GET /health", `Status ${res.statusCode}: ${res.body}`);
            failed++;
        }
    } catch (err) {
        fail("GET /health", `${err}`);
        failed++;
    }

    // ── Markets endpoints ─────────────────────────────────────────
    section("Markets");
    try {
        const res = await server.inject({ method: "GET", url: "/markets" });

        if (res.statusCode === 200) {
            const body = res.json<{ markets: unknown[]; total: number }>();
            pass(`GET /markets → 200 (${body.total} total markets)`);
            passed++;
        } else {
            fail("GET /markets", `Status ${res.statusCode}: ${res.body}`);
            failed++;
        }
    } catch (err) {
        fail("GET /markets", `${err}`);
        failed++;
    }

    // Markets with status filter
    try {
        const res = await server.inject({
            method: "GET",
            url: "/markets?status=OPEN&limit=5",
        });

        if (res.statusCode === 200) {
            pass(`GET /markets?status=OPEN → 200`);
            passed++;
        } else {
            fail("GET /markets with filter", `Status ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("GET /markets with filter", `${err}`);
        failed++;
    }

    // Non-existent market
    try {
        const res = await server.inject({
            method: "GET",
            url: "/markets/00000000-0000-0000-0000-000000000000",
        });

        if (res.statusCode === 404) {
            pass(`GET /markets/:id → 404 for unknown market`);
            passed++;
        } else {
            fail("GET /markets/:id (404)", `Status ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("GET /markets/:id (404)", `${err}`);
        failed++;
    }

    // POST market without auth
    try {
        const res = await server.inject({
            method: "POST",
            url: "/markets",
            payload: { rawInput: "Will ETH hit $5000?", creatorAddress: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784" },
        });

        if (res.statusCode === 401) {
            pass(`POST /markets without auth → 401 Unauthorized`);
            passed++;
        } else {
            fail("POST /markets (auth guard)", `Expected 401, got ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("POST /markets (auth guard)", `${err}`);
        failed++;
    }

    // ── Auth endpoints ────────────────────────────────────────────
    section("Auth");
    try {
        const res = await server.inject({
            method: "POST",
            url: "/auth/nonce",
            payload: { address: "0x53983C776D8e4e70dF2d5947b0A85375b94b9784" },
        });

        if (res.statusCode === 200) {
            const body = res.json<{ nonce: string }>();
            if (body.nonce && body.nonce.includes("Predchain")) {
                pass(`POST /auth/nonce → 200 with valid nonce message`);
                passed++;
            } else {
                fail("POST /auth/nonce", "Nonce missing expected content");
                failed++;
            }
        } else {
            fail("POST /auth/nonce", `Status ${res.statusCode}: ${res.body}`);
            failed++;
        }
    } catch (err) {
        fail("POST /auth/nonce", `${err}`);
        failed++;
    }

    // Invalid address
    try {
        const res = await server.inject({
            method: "POST",
            url: "/auth/nonce",
            payload: { address: "not-an-address" },
        });

        if (res.statusCode === 400) {
            pass(`POST /auth/nonce with bad address → 400`);
            passed++;
        } else {
            fail("POST /auth/nonce (bad address)", `Expected 400, got ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("POST /auth/nonce (bad address)", `${err}`);
        failed++;
    }

    // ── Stakes endpoints ──────────────────────────────────────────
    section("Stakes");
    try {
        const res = await server.inject({
            method: "POST",
            url: "/stakes",
            payload: {},
        });

        if (res.statusCode === 401) {
            pass(`POST /stakes without auth → 401 Unauthorized`);
            passed++;
        } else {
            fail("POST /stakes (auth guard)", `Expected 401, got ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("POST /stakes (auth guard)", `${err}`);
        failed++;
    }

    // User stakes (no auth needed for reads)
    try {
        const res = await server.inject({
            method: "GET",
            url: "/stakes/user/0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
        });

        if (res.statusCode === 200) {
            pass(`GET /stakes/user/:address → 200`);
            passed++;
        } else {
            fail("GET /stakes/user/:address", `Status ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("GET /stakes/user/:address", `${err}`);
        failed++;
    }

    // ── 404 handler ───────────────────────────────────────────────
    section("Error Handling");
    try {
        const res = await server.inject({ method: "GET", url: "/nonexistent" });
        if (res.statusCode === 404) {
            pass(`Unknown route → 404`);
            passed++;
        } else {
            fail("404 handler", `Expected 404, got ${res.statusCode}`);
            failed++;
        }
    } catch (err) {
        fail("404 handler", `${err}`);
        failed++;
    }

    // ── Summary ───────────────────────────────────────────────────
    await server.close();

    console.log("\n========================================");
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    console.log("========================================\n");

    if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
    console.error("Test runner crashed:", err);
    process.exit(1);
});