# @predchain/resolution-service

Autonomous market resolution service. Monitors deadlines, fetches oracle data, evaluates outcomes with AI, and settles smart contracts. Runs as an independent background worker process — no human intervention required.

---

## Responsibilities

1. **Deadline monitoring** — polls PostgreSQL every 60 seconds for markets past their deadline
2. **Oracle data fetching** — Chainlink for price markets, Claude web search for event markets
3. **Outcome evaluation** — Claude determines YES/NO/VOID from oracle data
4. **On-chain settlement** — calls `resolve()` on the smart contract
5. **Evidence recording** — stores oracle value and AI reasoning in PostgreSQL

---

## DeadlineMonitor

Polls the database for locked or overdue markets and enqueues resolution jobs.

```ts
import { DeadlineMonitor } from "@predchain/resolution-service";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const monitor = new DeadlineMonitor(prisma);

monitor.start(); // Begins polling every 60 seconds
monitor.stop(); // Graceful shutdown
```

**What it checks:**

- Markets with `status = OPEN` and `deadline < now` → enqueues `lock-market` job
- Markets with `status = LOCKED` → enqueues `resolve-market` job

---

## ChainlinkAdapter

Fetches real-time price data from Chainlink oracle feeds on Base Sepolia.

```ts
import { ChainlinkAdapter } from "@predchain/resolution-service";

const adapter = new ChainlinkAdapter();

const result = await adapter.fetchPrice(feedAddress);
// {
//   found: true,
//   value: "95234.50",       // USD price as string
//   fetchedAt: Date,
//   source: "0x4aDC67..."    // feed address
// }
```

### Supported feeds (Base Sepolia)

| Asset   | Feed Address                                 |
| ------- | -------------------------------------------- |
| ETH/USD | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` |
| BTC/USD | `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298` |

**Adding new feeds:** Add the feed address to `CHAINLINK_*_FEED` environment variables and the parser will map new markets to them automatically.

### How it works

Calls `latestRoundData()` on the Chainlink AggregatorV3 interface:

```solidity
function latestRoundData() external view returns (
  uint80 roundId,
  int256 answer,       // Price × 10^8
  uint256 startedAt,
  uint256 updatedAt,
  uint80 answeredInRound
)
```

Divides `answer` by `10^8` to get the human-readable price.

---

## WebSearchAdapter

Uses Claude's built-in web search tool for event-based market resolution.

```ts
import { WebSearchAdapter } from "@predchain/resolution-service";

const adapter = new WebSearchAdapter();

const result = await adapter.search(
  "Did Arsenal win the Premier League in the 2025-26 season?"
);
// {
//   found: true,
//   value: "YES",
//   summary: "Arsenal won the 2025-26 Premier League title...",
//   source: "https://bbc.com/sport/...",
//   fetchedAt: Date
// }
```

**How it works:**

1. Sends the resolution query to Claude with the `web_search` tool enabled
2. Claude searches the web for current information
3. Returns the factual finding in a structured format
4. If the outcome cannot be determined, returns `found: false` → market resolves as VOID

---

## MarketResolver

Orchestrates the complete resolution pipeline for a single market.

```ts
import { MarketResolver } from "@predchain/resolution-service";

const resolver = new MarketResolver();
await resolver.resolve(marketId);
```

**Pipeline:**

```
1. Fetch market from PostgreSQL
2. Determine oracle type (CHAINLINK_PRICE or AI_WEB_SEARCH)
3. Fetch oracle data (ChainlinkAdapter or WebSearchAdapter)
4. Send market + oracle data to ResolutionAgent (Claude)
5. Claude evaluates: YES / NO / VOID
6. Call PredictionMarket.resolve(outcome) on-chain
7. Wait for transaction confirmation
8. Record ResolutionEvidence in PostgreSQL
9. Update market status to RESOLVED
```

---

## Worker

The `resolve-market` BullMQ worker processes jobs enqueued by the Market Service.

**Queue:** `resolve-market`

**Job data:**

```ts
{
  marketId: string;
}
```

**Retry policy:** 3 attempts. On final failure, market status is not changed — manual intervention may be needed.

---

## Environment Variables

```bash
# Blockchain
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...
CHAIN_ID=84532

# Chainlink feeds
CHAINLINK_ETH_USD_FEED=0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1
CHAINLINK_BTC_USD_FEED=0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/predchain

# Redis
REDIS_URL=redis://localhost:6379

# Runtime
NODE_ENV=development
```

---

## Running

```bash
# Development
pnpm dev

# Production
pnpm build
node dist/index.js
```

On startup:

```json
{"level":"info","service":"resolution-service","message":"Resolution service starting"}
{"level":"info","service":"resolution-service","message":"Deadline monitor started","intervalSeconds":60}
{"level":"info","service":"resolution-service","message":"Workers started","workers":["resolve-market"]}
```

---

## Resolution logic

| Resolution source | Oracle used          | Fallback                   |
| ----------------- | -------------------- | -------------------------- |
| `CHAINLINK_PRICE` | Chainlink price feed | VOID if feed unreachable   |
| `AI_WEB_SEARCH`   | Claude web search    | VOID if not found          |
| `MANUAL`          | Not auto-resolved    | Awaits manual admin action |

Markets always resolve to `VOID` when:

- Oracle data is unavailable
- Claude cannot determine the outcome with confidence
- The market condition is ambiguous

VOID markets are fully refunded to all stakers.

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
├── cron/
│   └── deadline.monitor.ts     # Polls DB for expired markets
├── oracle/
│   ├── chainlink.adapter.ts    # Chainlink price feed client
│   └── websearch.adapter.ts    # Claude web search client
├── resolver/
│   └── market.resolver.ts      # Full resolution pipeline
├── types.ts                    # ResolveMarketJobData type
└── index.ts                    # Entry point — starts monitor + worker
```
