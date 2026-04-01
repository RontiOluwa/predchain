# @predchain/shared

Shared types, Zod validation schemas, and structured logger used across all Predchain packages. This is the single source of truth for data contracts between services.

---

## Installation

This package is a workspace dependency — no manual installation needed.

```json
// In any package's package.json
{
  "dependencies": {
    "@predchain/shared": "workspace:*"
  }
}
```

---

## Exports

### Types

```ts
import type {
  MarketSchema,
  CreateMarketRequest,
  StakeRequest,
  MarketStatus,
  MarketOutcome,
  ResolutionSource,
} from "@predchain/shared";
```

#### MarketSchema

The structured output from Claude's intent parser. Represents a fully parsed prediction market.

```ts
interface MarketSchema {
  question: string; // Full natural language question
  description: string; // Plain English explanation of the market
  subject: string; // What's being measured e.g. "ETH", "Arsenal FC"
  condition: {
    operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
    threshold: string; // Numeric string e.g. "5000"
    unit: string; // e.g. "USD", "goals", "points"
  };
  deadline: string; // ISO 8601 date string
  resolutionSource: ResolutionSource;
  resolutionKey: string; // Chainlink feed address or web search query
  confidence: number; // 0.0–1.0 — how resolvable the market is
  parserNotes?: string; // AI reasoning notes
}
```

#### CreateMarketRequest

```ts
interface CreateMarketRequest {
  rawInput: string; // Plain English prediction
  creatorAddress: string; // 0x-prefixed Ethereum address
}
```

#### StakeRequest

```ts
interface StakeRequest {
  marketId: string; // UUID
  side: "YES" | "NO";
  amount: string; // Wei amount as string
  userAddress: string; // 0x-prefixed Ethereum address
  txHash: string; // On-chain transaction hash
}
```

---

### Schemas (Zod)

Runtime validation schemas used at API boundaries.

```ts
import {
  MarketSchemaValidator,
  CreateMarketRequestSchema,
  StakeRequestSchema,
} from "@predchain/shared";

// Validate incoming API request
const result = CreateMarketRequestSchema.safeParse(req.body);
if (!result.success) {
  return reply.status(400).send({ error: "Invalid request" });
}
```

---

### Logger

Structured JSON logger with service-scoped instances. Outputs JSON in production, readable logs in development.

```ts
import { loggers, createLogger } from "@predchain/shared";

// Use a pre-built logger
const log = loggers.apiGateway;
const log = loggers.marketService;
const log = loggers.resolutionService;
const log = loggers.aiAgent;

// Or create a custom one
const log = createLogger("my-service");

// Logging methods
log.info("Server started", { port: 3001 });
log.warn("Rate limit approaching", { remaining: 10 });
log.error("Job failed", error, { jobId: "123" });
log.debug("Query executed", { sql: "SELECT..." }); // dev only
```

**Log format:**

```json
{
  "level": "info",
  "service": "api-gateway",
  "message": "Server started",
  "timestamp": "2026-03-31T10:00:00.000Z",
  "port": 3001
}
```

---

## Build

```bash
pnpm build     # Compile TypeScript to dist/
pnpm dev       # Watch mode
pnpm clean     # Remove dist/
```

---

## Structure

```
src/
├── types/
│   ├── index.ts          # Re-exports all types
│   └── market.ts         # MarketSchema, StakeRequest, etc.
├── schemas/
│   └── market.schema.ts  # Zod validation schemas
├── utils/
│   └── logger.ts         # Structured JSON logger
└── index.ts              # Public exports
```
