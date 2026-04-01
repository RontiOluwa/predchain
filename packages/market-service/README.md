# @predchain/market-service

BullMQ worker service responsible for the market lifecycle — contract deployment, market locking, and database operations. Runs as an independent background worker process.

---

## Responsibilities

1. **Deploy contracts** — when a market is created, deploys a `PredictionMarket` smart contract on Base Sepolia
2. **Lock markets** — at the market deadline, calls `lock()` on the contract to close staking
3. **Database operations** — CRUD for markets and stakes via Prisma

---

## Workers

The service runs two BullMQ workers that listen on Redis queues.

### deploy-contract

**Triggered by:** `POST /markets` in the API Gateway

**Queue:** `deploy-contract`

**Flow:**

```
1. Fetch market from PostgreSQL by marketId
2. Convert UUID to bytes32 (for Solidity)
3. Call MarketFactory.createMarket(marketId, deadline) via viem
4. Wait for transaction confirmation
5. Update market: status=OPEN, contractAddress, deploymentTxHash
6. Schedule "lock-market" job at the market deadline
```

**Retry policy:** 3 attempts with exponential backoff

### lock-market

**Triggered by:** deploy-contract worker (scheduled at deadline)

**Queue:** `lock-market`

**Flow:**

```
1. Fetch market from PostgreSQL
2. Call PredictionMarket.lock() on the contract
3. Update market status to LOCKED
4. Enqueue "resolve-market" job for the Resolution Service
```

---

## FactoryClient

Wraps viem for blockchain interactions with the `MarketFactory` contract.

```ts
import { FactoryClient } from "@predchain/market-service";

const client = new FactoryClient();

// Deploy a new market contract
const contractAddress = await client.deployMarket(marketId, deadline);
// Returns "0x..." — the deployed PredictionMarket address

// Lock a market after deadline
await client.lockMarket(contractAddress);
```

**Constructor reads from environment:**

- `DEPLOYER_PRIVATE_KEY` — wallet that owns MarketFactory
- `RPC_URL` — Base Sepolia RPC endpoint
- `FACTORY_CONTRACT_ADDRESS` — deployed MarketFactory address

---

## MarketService

Database operations for markets and stakes. Used by the API Gateway directly.

```ts
import { MarketService } from "@predchain/market-service";

const service = new MarketService();

// Create a market (parses with AI, then queues deployment)
const market = await service.createMarket({
  rawInput: "Will ETH exceed $5,000 by Dec 31 2026?",
  creatorAddress: "0x...",
});

// List markets with optional filters
const { markets, total } = await service.listMarkets({
  status: "OPEN",
  limit: 20,
  offset: 0,
});

// Get a single market
const market = await service.getMarketById("uuid");

// Get markets created by a wallet
const markets = await service.getMarketsByCreator("0x...");

// Record an on-chain stake (called after tx confirmation)
const stake = await service.recordStake({
  marketId: "uuid",
  side: "YES",
  amount: "100000000000000000000", // wei
  userAddress: "0x...",
  txHash: "0x...",
});

// Get all stakes for a user
const stakes = await service.getUserStakes("0x...");
```

---

## StakeVerifier

Verifies that a stake transaction actually exists on-chain before recording it.

```ts
import { StakeVerifier } from "@predchain/market-service";

const verifier = new StakeVerifier();
const isValid = await verifier.verify(txHash, userAddress, amount);
```

---

## Environment Variables

```bash
# Blockchain
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...        # Must start with 0x, 66 chars total
FACTORY_CONTRACT_ADDRESS=0x...
PRED_TOKEN_ADDRESS=0x...
CHAIN_ID=84532

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/predchain

# Redis
REDIS_URL=redis://localhost:6379

# AI
ANTHROPIC_API_KEY=sk-ant-...

# Runtime
NODE_ENV=development
```

---

## Running

```bash
# Development (with hot reload)
pnpm dev

# Production
pnpm build
node dist/index.js
```

On startup you should see:

```json
{"level":"info","service":"market-service","message":"Market service starting"}
{"level":"info","service":"market-service","message":"Workers started","workers":["deploy-contract","lock-market"]}
```

---

## Redis Queue Names

| Queue             | Purpose                                          |
| ----------------- | ------------------------------------------------ |
| `deploy-contract` | Contract deployment jobs                         |
| `lock-market`     | Market locking jobs (scheduled)                  |
| `resolve-market`  | Resolution jobs (consumed by resolution-service) |

---

## Clearing stuck jobs

If jobs fail repeatedly and need to be cleared:

```bash
npx tsx -e "
async function main() {
  const { Queue } = await import('bullmq');
  const conn = { connection: { host: 'localhost', port: 6379 }};
  for (const name of ['deploy-contract', 'lock-market', 'resolve-market']) {
    const q = new Queue(name, conn);
    await q.obliterate({ force: true });
    await q.close();
    console.log('Cleared:', name);
  }
}
main().catch(console.error);
"
```

---

## Build

```bash
pnpm build     # Compile TypeScript to dist/
pnpm dev       # Watch mode with tsx
pnpm clean     # Remove dist/
```

---

## Structure

```
src/
├── blockchain/
│   ├── factory.client.ts     # viem wrapper for MarketFactory
│   └── stake.verifier.ts     # On-chain stake verification
├── db/
│   └── client.ts             # Prisma client singleton
├── jobs/
│   ├── market.jobs.ts        # BullMQ queue definitions
│   └── market.worker.ts      # Worker implementations
├── services/
│   └── market.service.ts     # Database operations
├── exports.ts                # Public API exports
└── index.ts                  # Entry point — starts workers
```
