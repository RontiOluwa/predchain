# Predchain

An autonomous prediction market platform powered by AI and blockchain. Users type a prediction in plain English — Claude parses it, a smart contract deploys automatically on Base Sepolia, and Chainlink oracles or AI web search resolves the outcome at the deadline. No manual intervention required at any stage.

**Live demo:** [https://predchain-web.vercel.app](https://predchain-web.vercel.app)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Repository Structure](#repository-structure)
- [Smart Contracts](#smart-contracts)
- [Packages](#packages)
  - [shared](#shared)
  - [ai-agent](#ai-agent)
  - [market-service](#market-service)
  - [resolution-service](#resolution-service)
  - [api-gateway](#api-gateway)
- [Frontend](#frontend)
- [Database Schema](#database-schema)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [API Reference](#api-reference)

---

## Overview

### What it does

1. **Create** — User types a prediction in plain English. Claude parses it into a structured market schema.
2. **Deploy** — A Solidity smart contract deploys automatically on Base Sepolia (~15 seconds).
3. **Stake** — Users stake PRED tokens on YES or NO outcomes. Pool totals update in real-time via WebSocket.
4. **Resolve** — At the deadline, Chainlink fetches the oracle price (for price markets) or Claude searches the web (for event markets). The outcome is written to the smart contract automatically.
5. **Claim** — Winners claim proportional payouts. The contract distributes funds trustlessly.

### Key design decisions

| Decision                            | Reason                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| OZ v4 instead of v5                 | OZ v5 `ReentrancyGuard` uses `TLOAD`/`TSTORE` (Cancun opcodes) unsupported on Base Sepolia |
| `evmVersion: "istanbul"` in Hardhat | Most conservative EVM version — broadest Base Sepolia compatibility                        |
| Server-side faucet via API          | No on-chain faucet function — avoids opcode issues, cooldown enforced in Redis             |
| BullMQ + Redis for job queues       | Decouples contract deployment and resolution from the HTTP request cycle                   |
| Three independent backend services  | Each service does one job — API Gateway, Market workers, Resolution workers                |
| EIP-191 signed messages for auth    | Wallet-native auth — no passwords, no OAuth                                                |
| Pool totals cached in PostgreSQL    | Fast reads without hitting the chain on every market list request                          |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                           │
│         Next.js 15 · RainbowKit · Wagmi                 │
│         Vercel · WebSocket real-time updates            │
└────────────────────┬────────────────────────────────────┘
                     │ HTTPS / WSS
┌────────────────────▼────────────────────────────────────┐
│                   API Gateway                           │
│         Fastify · REST · WebSocket · JWT Auth           │
│         Railway Web Service · Port 3001                 │
└──────┬──────────────────────────────────┬───────────────┘
       │ PostgreSQL                        │ Redis (BullMQ)
┌──────▼──────────┐              ┌─────────▼──────────────┐
│  Market Service │              │  Resolution Service     │
│  BullMQ workers │              │  BullMQ workers         │
│  Contract deploy│              │  Deadline monitor       │
│  Railway Worker │              │  Chainlink + AI         │
└──────┬──────────┘              └─────────┬───────────────┘
       │                                   │
┌──────▼───────────────────────────────────▼───────────────┐
│                    Base Sepolia                           │
│   PredToken (ERC-20) · MarketFactory · PredictionMarket  │
└──────────────────────────────────────────────────────────┘
```

### Communication flow

The three backend services **never call each other directly**. They communicate through shared infrastructure:

- **PostgreSQL** — shared market state (status, pools, outcomes)
- **Redis queues** — BullMQ jobs trigger async processing across services

```
HTTP Request → API Gateway
  → writes Market to PostgreSQL (status: PENDING)
  → enqueues "deploy-contract" job to Redis

Market Service Worker
  → picks up "deploy-contract" from Redis
  → deploys PredictionMarket contract
  → updates PostgreSQL (status: OPEN, contractAddress)
  → enqueues "lock-market" job (scheduled for deadline)

Resolution Service Worker
  → picks up "lock-market" at deadline
  → calls lock() on contract
  → enqueues "resolve-market"
  → fetches oracle data (Chainlink / Claude)
  → calls resolve() on contract
  → updates PostgreSQL (status: RESOLVED, outcome)
```

---

## Repository Structure

```
predchain/
├── apps/
│   └── web/                    # Next.js 15 frontend
│       ├── app/                # App Router pages
│       ├── components/         # React components
│       ├── hooks/              # Custom React hooks
│       └── lib/                # API client, wagmi config, WebSocket
├── contracts/                  # Hardhat + Solidity
│   ├── contracts/
│   │   ├── PredToken.sol       # ERC-20 staking token
│   │   ├── PredictionMarket.sol # Individual market contract
│   │   └── MarketFactory.sol   # Deploys prediction markets
│   └── scripts/
│       └── deploy.ts           # Deployment script
├── packages/
│   ├── shared/                 # Shared types, schemas, logger
│   ├── ai-agent/               # Claude intent parser + resolution agent
│   ├── market-service/         # BullMQ workers + contract deployment
│   ├── resolution-service/     # Deadline monitor + oracle resolution
│   └── api-gateway/            # Fastify REST + WebSocket server
├── prisma/
│   └── schema.prisma           # Database schema
├── docker-compose.yml          # Local PostgreSQL + Redis
├── turbo.json                  # Turborepo pipeline config
└── pnpm-workspace.yaml         # pnpm workspace config
```

---

## Smart Contracts

Deployed on **Base Sepolia** (Chain ID: 84532).

### PredToken.sol

A standard ERC-20 token used for staking. The on-chain contract is intentionally minimal — the faucet is handled server-side via the API.

```solidity
// Key functions
function mint(address to, uint256 amount) external onlyOwner
```

| Property       | Value                                |
| -------------- | ------------------------------------ |
| Name           | Predchain Token                      |
| Symbol         | PRED                                 |
| Decimals       | 18                                   |
| Initial supply | 10,000,000 PRED (minted to deployer) |
| Faucet amount  | 10,000 PRED (via API, not on-chain)  |

### PredictionMarket.sol

Deployed per market by the MarketFactory. Handles staking, locking, resolution, and payouts.

**Lifecycle:**

```
OPEN → (deadline) → LOCKED → (resolver) → RESOLVED / CANCELLED
```

**Payout formula:**

```
winnerShare = (userStake / winningPool) × losingPool
fee         = winnerShare × 2% (protocol fee)
payout      = userStake + winnerShare - fee
```

**Key functions:**

```solidity
function stakeYes(uint256 amount) external
function stakeNo(uint256 amount) external
function lock() external                          // anyone can call after deadline
function resolve(Outcome outcome) external        // only resolver
function claimPayout() external                   // winners
function claimRefund() external                   // cancelled markets
function getMarketInfo() external view returns (...)
function impliedProbabilityYes() external view returns (uint256)
```

### MarketFactory.sol

Creates and registers PredictionMarket contracts. The deployer wallet calls `createMarket()` via the Market Service.

```solidity
function createMarket(bytes32 marketId, uint256 deadline) external onlyOwner returns (address)
function updateResolver(address newResolver) external onlyOwner
function updateTreasury(address newTreasury) external onlyOwner
```

### Compile and deploy

```bash
cd contracts

# Install dependencies
pnpm install

# Compile
pnpm compile

# Deploy to Base Sepolia
pnpm deploy:testnet
```

Output includes the deployed addresses — update `.env` with:

```
PRED_TOKEN_ADDRESS=0x...
FACTORY_CONTRACT_ADDRESS=0x...
```

---

## Packages

### shared

`packages/shared` — Shared types, Zod schemas, and logger used across all packages.

**Exports:**

```ts
// Types
import type {
  MarketSchema,
  CreateMarketRequest,
  StakeRequest,
} from "@predchain/shared";

// Schemas (Zod)
import {
  MarketSchemaValidator,
  CreateMarketRequestSchema,
} from "@predchain/shared";

// Logger
import { loggers } from "@predchain/shared";
const log = loggers.apiGateway; // or marketService, resolutionService, aiAgent
```

**MarketSchema** — the structured output from Claude's intent parser:

```ts
interface MarketSchema {
  question: string; // "Will ETH exceed $5,000 by Dec 31, 2026?"
  description: string; // Plain English explanation
  subject: string; // "ETH"
  condition: {
    operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
    threshold: string; // "5000"
    unit: string; // "USD"
  };
  deadline: string; // ISO date string
  resolutionSource:
    | "CHAINLINK_PRICE"
    | "CHAINLINK_EVENT"
    | "AI_WEB_SEARCH"
    | "MANUAL";
  resolutionKey: string; // Chainlink feed address or search query
  confidence: number; // 0.0–1.0
  parserNotes?: string;
}
```

---

### ai-agent

`packages/ai-agent` — Claude-powered intent parser and resolution agent.

#### IntentParser

Parses natural language predictions into structured `MarketSchema` objects.

```ts
import { IntentParser } from "@predchain/ai-agent";

const parser = new IntentParser();
const market = await parser.parse("Will BTC hit $100k by end of 2026?");
// Returns MarketSchema with subject, condition, deadline, resolutionSource, confidence
```

**How it works:**

1. Sends the raw input to Claude with a structured system prompt
2. Claude extracts: subject, operator, threshold, unit, deadline
3. Claude determines the best resolution source (Chainlink for price, web search for events)
4. Returns a validated `MarketSchema` with a confidence score

#### ResolutionAgent

Evaluates oracle data and determines YES/NO/VOID outcomes.

```ts
import { ResolutionAgent } from "@predchain/ai-agent";

const agent = new ResolutionAgent();
const result = await agent.resolve(market, oracleValue);
// Returns { outcome: "YES" | "NO" | "VOID", reasoning: string }
```

---

### market-service

`packages/market-service` — BullMQ workers for contract deployment and market lifecycle management.

#### Workers

**deploy-contract** — Triggered when a market is created:

1. Fetches market from PostgreSQL
2. Converts market UUID to `bytes32`
3. Calls `MarketFactory.createMarket()` via viem
4. Waits for transaction confirmation
5. Updates market status to `OPEN` with `contractAddress`
6. Schedules `lock-market` job for the deadline

**lock-market** — Triggered at the market deadline:

1. Calls `PredictionMarket.lock()` on the contract
2. Updates market status to `LOCKED`
3. Enqueues `resolve-market` job

**resolve-market** — Triggered after locking:

1. Handled by the Resolution Service

#### FactoryClient

Wraps viem for contract interactions:

```ts
import { FactoryClient } from "@predchain/market-service";

const client = new FactoryClient();
const contractAddress = await client.deployMarket(marketId, deadline);
```

#### MarketService

Database operations for markets and stakes:

```ts
const service = new MarketService();

await service.createMarket(parsedInput); // Parse + queue deploy
await service.listMarkets({ status, limit }); // Paginated list
await service.getMarketById(id); // Single market
await service.recordStake(stakeData); // Record on-chain stake
await service.getUserStakes(address); // User's stake history
```

---

### resolution-service

`packages/resolution-service` — Monitors market deadlines and resolves outcomes.

#### DeadlineMonitor

Polls PostgreSQL every minute for markets past their deadline:

```ts
const monitor = new DeadlineMonitor(prisma);
monitor.start(); // Polls every 60 seconds
```

When a deadline is detected:

1. Enqueues `lock-market` job in BullMQ
2. BullMQ calls `lock()` on the contract
3. Then enqueues `resolve-market` for the resolution step

#### ChainlinkAdapter

Fetches prices from Chainlink oracle feeds:

```ts
import { ChainlinkAdapter } from "@predchain/resolution-service";

const adapter = new ChainlinkAdapter();
const result = await adapter.fetchPrice(feedAddress);
// Returns { value: "95000", fetchedAt: Date, found: true }
```

Supported feeds (Base Sepolia):

- ETH/USD: `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`
- BTC/USD: `0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298`

#### WebSearchAdapter

Uses Claude's web search tool for event-based markets:

```ts
import { WebSearchAdapter } from "@predchain/resolution-service";

const adapter = new WebSearchAdapter();
const result = await adapter.search(
  "Did Arsenal win the Premier League 2025-26?"
);
// Returns { found: true, value: "YES", summary: "...", source: "..." }
```

#### MarketResolver

Orchestrates the full resolution flow:

```ts
const resolver = new MarketResolver();
await resolver.resolve(marketId);
// Fetches oracle data → evaluates with Claude → calls resolve() on contract → updates DB
```

---

### api-gateway

`packages/api-gateway` — Fastify HTTP server and WebSocket server.

#### REST Endpoints

See [API Reference](#api-reference) for full details.

#### WebSocket Server

Real-time market updates pushed to connected clients:

```ts
// Client subscribes to a specific market
ws.send(JSON.stringify({ type: "subscribe", marketId: "uuid" }));

// Or subscribe to all markets
ws.send(JSON.stringify({ type: "subscribe:all" }));

// Server pushes events:
// { type: "market:update", data: { id, status, outcome } }
// { type: "market:pool", data: { marketId, yesPool, noPool, probability } }
// { type: "market:resolved", data: { marketId, outcome } }
// { type: "ping" }  — client should respond with { type: "pong" }
```

#### Auth Middleware

Wallet-based authentication using EIP-191 signed messages:

```
POST /auth/nonce  { address }  → { nonce }
POST /auth/verify { address, signature } → { token }

# Include JWT in subsequent requests:
Authorization: Bearer <token>
```

JWT payload:

```json
{ "address": "0x...", "iat": 1234567890, "exp": 1234567890 }
```

#### Faucet

Server-side token distribution:

```
POST /faucet { address }
→ Checks Redis for 24hr cooldown key (faucet:{address})
→ Calls PredToken.mint() using deployer wallet
→ Sets Redis key with 86400s TTL
→ Returns { success, txHash, amount }
```

---

## Frontend

`apps/web` — Next.js 15 App Router frontend.

### Pages

| Route           | Description                                                     |
| --------------- | --------------------------------------------------------------- |
| `/`             | Market dashboard — lists all markets with live probability bars |
| `/create`       | Create market — plain English input, Claude parses              |
| `/markets/[id]` | Market detail — probability, staking panel, resolution evidence |
| `/portfolio`    | User's stakes — won/lost/refund status                          |

### Components

| Component                   | Description                                                                                                                               |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Navbar`                    | Logo, nav links, PRED balance, faucet button (shows when balance < 1000), wallet connect. Fully responsive with hamburger menu on mobile. |
| `MarketCard`                | Clickable card with live probability bar, status badge, deadline                                                                          |
| `StakePanel`                | YES/NO selector, amount input, 6-step staking flow with step labels                                                                       |
| `ProbabilityBar`            | Animated YES/NO bar from pool totals, updates live via WebSocket                                                                          |
| `MarketStatus`              | Coloured status badge with pulsing dot for OPEN markets                                                                                   |
| `FaucetButton` (deprecated) | Replaced by inline faucet in Navbar                                                                                                       |

### Hooks

| Hook              | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `useIsMounted`    | Returns true after client mount — guards wagmi hooks from SSR errors |
| `useAuth`         | Wallet signature → JWT flow. Stores JWT in localStorage.             |
| `useMarkets`      | TanStack Query + WebSocket live updates for market list              |
| `useMarket`       | Single market with real-time pool updates via WebSocket              |
| `useCreateMarket` | TanStack mutation for market creation                                |
| `useStake`        | Full staking flow: auth → approve → wait → stake → wait → record     |

### Staking flow (useStake)

```
Step 1: authenticating      → Sign message with MetaMask → get JWT
Step 2: approving           → MetaMask popup #1: approve PRED spend
Step 3: waiting-approve     → Wait for approval confirmation
Step 4: staking             → MetaMask popup #2: stake YES or NO
Step 5: waiting-stake       → Wait for stake confirmation
Step 6: recording           → POST /stakes to record in DB
Step 7: done
```

### lib

| File              | Description                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| `wagmi.config.ts` | Wagmi config, chain setup (Base Sepolia), contract ABIs                                                     |
| `api.ts`          | Typed fetch client — `marketsApi`, `stakesApi`, `authApi`, `faucetApi`                                      |
| `websocket.ts`    | Auto-reconnecting WebSocket hook with keepalive ping/pong                                                   |
| `empty-module.js` | Webpack stub for browser-incompatible packages (`@react-native-async-storage`, `pino-pretty`, `idb-keyval`) |

### SSR / hydration notes

Wagmi, RainbowKit and WalletConnect use browser-only APIs (`indexedDB`, `localStorage`) that break Next.js SSR. The solution:

1. `WalletProviders.tsx` is dynamically imported with `ssr: false`
2. `ConnectButton` in Navbar is dynamically imported with `ssr: false`
3. Webpack aliases stub out `idb-keyval`, `@react-native-async-storage`, and `pino-pretty`
4. `suppressHydrationWarning` on `<html>` and `<body>` handles browser extension injections (Leather wallet, MetaMask)

---

## Database Schema

Managed by Prisma with PostgreSQL.

### Market

Core market record created when a user submits a prediction.

| Field                | Type     | Description                               |
| -------------------- | -------- | ----------------------------------------- |
| `id`                 | UUID     | Primary key                               |
| `question`           | String   | Full market question                      |
| `subject`            | String   | What's being measured (e.g. "ETH")        |
| `conditionOperator`  | String   | "gt", "lt", "eq", etc.                    |
| `conditionThreshold` | String   | Numeric threshold (string)                |
| `conditionUnit`      | String   | "USD", "ETH", etc.                        |
| `deadline`           | DateTime | When staking closes                       |
| `resolutionSource`   | Enum     | CHAINLINK_PRICE, AI_WEB_SEARCH, etc.      |
| `status`             | Enum     | PENDING → OPEN → LOCKED → RESOLVED        |
| `contractAddress`    | String?  | Set after deployment                      |
| `yesPool`            | String   | Wei amount (string to avoid float issues) |
| `noPool`             | String   | Wei amount                                |
| `creatorAddress`     | String   | Lowercase wallet address                  |

### Stake

Individual user stakes recorded after on-chain confirmation.

| Field         | Type   | Description                      |
| ------------- | ------ | -------------------------------- |
| `userAddress` | String | Lowercase wallet address         |
| `side`        | Enum   | YES or NO                        |
| `amount`      | String | Wei amount (string)              |
| `txHash`      | String | Unique on-chain transaction hash |

### ResolutionEvidence

Oracle data and AI reasoning for resolved markets.

| Field              | Type    | Description                            |
| ------------------ | ------- | -------------------------------------- |
| `oracleValue`      | String  | Raw value from Chainlink or web search |
| `reasoning`        | String  | Claude's explanation of the outcome    |
| `outcome`          | Enum    | YES, NO, or VOID                       |
| `settlementTxHash` | String? | On-chain resolve() transaction         |

### MarketJob

Tracks BullMQ job status for each market operation.

| Field       | Type    | Description                                        |
| ----------- | ------- | -------------------------------------------------- |
| `jobType`   | String  | "deploy-contract", "lock-market", "resolve-market" |
| `status`    | Enum    | PENDING, PROCESSING, COMPLETED, FAILED             |
| `bullJobId` | String? | BullMQ job identifier                              |
| `error`     | String? | Error message if failed                            |

---

## Environment Variables

### Root `.env` (backend services)

```bash
# AI
ANTHROPIC_API_KEY=sk-ant-...

# Blockchain
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
CHAIN_ID=84532
DEPLOYER_PRIVATE_KEY=0x...          # Must start with 0x, 66 chars total
PRED_TOKEN_ADDRESS=0x...
FACTORY_CONTRACT_ADDRESS=0x...

# Chainlink feeds (Base Sepolia)
CHAINLINK_ETH_USD_FEED=0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1
CHAINLINK_BTC_USD_FEED=0x0FB99723Aee6f420beAD13e6bBB79b7E6F034298

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/predchain

# Redis
REDIS_URL=redis://localhost:6379
# Production Upstash: rediss://default:TOKEN@host.upstash.io:6380

# Server
API_PORT=3001
JWT_SECRET=your-64-char-secret
NODE_ENV=development
```

### `apps/web/.env.local` (frontend)

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/markets
NEXT_PUBLIC_PRED_TOKEN_ADDRESS=0x...
NEXT_PUBLIC_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...  # From cloud.walletconnect.com
```

---

## Local Development

### Prerequisites

- Node.js >= 22
- pnpm >= 9
- Docker (for PostgreSQL and Redis)

### Setup

```bash
# Clone the repo
git clone https://github.com/RontiOluwa/predchain.git
cd predchain

# Install dependencies
pnpm install

# Copy and fill environment variables
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local
# Edit both files with your values

# Start PostgreSQL and Redis
docker compose up -d

# Run database migrations
pnpm db:generate
pnpm db:migrate
```

### Running all services

Open 4 separate terminals from the project root:

```bash
# Terminal 1 — API Gateway (port 3001)
pnpm --filter @predchain/api-gateway dev

# Terminal 2 — Market Service workers
pnpm --filter @predchain/market-service dev

# Terminal 3 — Resolution Service workers
pnpm --filter @predchain/resolution-service dev

# Terminal 4 — Frontend (port 3000)
pnpm --filter @predchain/web dev
```

Open [http://localhost:3000](http://localhost:3000).

### Utility commands

```bash
# View database in browser
pnpm db:studio

# Reset database and queues (from packages/market-service)
npx tsx -e "
async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const { Queue } = await import('bullmq');
  const prisma = new PrismaClient();
  await prisma.onChainEvent.deleteMany({});
  await prisma.resolutionEvidence.deleteMany({});
  await prisma.stake.deleteMany({});
  await prisma.marketJob.deleteMany({});
  await prisma.market.deleteMany({});
  await prisma.\$disconnect();
  const conn = { connection: { host: 'localhost', port: 6379 }};
  for (const name of ['deploy-contract', 'lock-market', 'resolve-market']) {
    const q = new Queue(name, conn);
    await q.obliterate({ force: true });
    await q.close();
  }
  console.log('Done');
}
main().catch(console.error);
"

# Build all packages
pnpm build

# Type check all packages
pnpm typecheck
```

---

## Deployment

### Infrastructure

| Service            | Platform     | Type          |
| ------------------ | ------------ | ------------- |
| Frontend           | Vercel       | Web           |
| API Gateway        | Railway      | Web Service   |
| Market Service     | Railway      | Worker        |
| Resolution Service | Railway      | Worker        |
| PostgreSQL         | Railway      | Managed DB    |
| Redis              | Upstash      | Managed Redis |
| Smart Contracts    | Base Sepolia | Testnet       |

### Railway (Backend)

**API Gateway — Build Command:**

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @predchain/shared build && pnpm --filter @predchain/ai-agent build && pnpm --filter @predchain/market-service build && pnpm --filter @predchain/api-gateway build && pnpm db:generate
```

**API Gateway — Start Command:**

```bash
npx prisma migrate deploy --schema=./prisma/schema.prisma && cd packages/api-gateway && node dist/index.js
```

**Market Service — Build Command:**

```bash
pnpm install --no-frozen-lockfile && pnpm --filter @predchain/shared build && pnpm --filter @predchain/ai-agent build && pnpm --filter @predchain/market-service build
```

**Market Service — Start Command:**

```bash
cd packages/market-service && node dist/index.js
```

**Resolution Service — Build/Start Command:** Same pattern as Market Service.

All services share the same environment variables. Use Railway's variable reference syntax:

```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

### Vercel (Frontend)

- Framework: Next.js (auto-detected)
- Root Directory: `apps/web`
- Set all `NEXT_PUBLIC_*` environment variables in the Vercel dashboard
- `NEXT_PUBLIC_API_URL` must point to your Railway API Gateway URL
- `NEXT_PUBLIC_WS_URL` must use `wss://` (not `ws://`) for HTTPS pages

---

## API Reference

### Health

```
GET /health
→ { status: "ok", service: "api-gateway", timestamp: "..." }
```

### Auth

```
POST /auth/nonce
Body: { address: "0x..." }
→ { nonce: "Sign this message to authenticate with Predchain: <uuid>", address: "0x..." }

POST /auth/verify
Body: { address: "0x...", signature: "0x..." }
→ { token: "<jwt>", address: "0x..." }
```

### Markets

```
GET /markets?status=OPEN&limit=20&offset=0
→ { markets: Market[], total: number }

GET /markets/:id
→ { market: Market }

POST /markets                    ← requires Authorization: Bearer <token>
Body: { rawInput: string, creatorAddress: string }
→ { market: Market, message: string }

GET /markets/user/:address
→ { markets: Market[] }
```

### Stakes

```
POST /stakes                     ← requires Authorization: Bearer <token>
Body: { marketId, side, amount, userAddress, txHash }
→ { stake: Stake }

GET /stakes/user/:address
→ { stakes: Stake[] }
```

### Faucet

```
POST /faucet
Body: { address: "0x..." }
→ { success: true, txHash: "0x...", amount: "10000", address: "0x..." }
→ 429 if cooldown active: { error: "Cooldown active. Try again in X hours." }
```

---

## Troubleshooting

### Market stuck on "Deploying"

The market-service workers aren't running or the `DEPLOYER_PRIVATE_KEY` isn't loaded.

```bash
# Check market-service logs for:
# "invalid private key" → .env not loaded or missing 0x prefix
# "Workers started" → workers running normally

# Ensure key format:
DEPLOYER_PRIVATE_KEY=0xabc123...  # starts with 0x, 66 chars total
```

### `WagmiProviderNotFoundError`

A component is using wagmi hooks before `WagmiProvider` mounts. Ensure `useIsMounted()` is the **first** hook called and `if (!mounted) return null` comes **after all other hooks**.

### `indexedDB is not defined`

WalletConnect/wagmi SSR issue. Ensure `WalletProviders` is dynamically imported with `ssr: false` and webpack aliases are set in `next.config.ts`.

### `invalid opcode 0xde` or `stack underflow`

EVM version mismatch. Ensure `hardhat.config.ts` has:

```ts
evmVersion: "istanbul";
```

And OpenZeppelin version is `4.x.x` not `5.x.x`.

### `exceeds maximum per-transaction gas limit`

Explicit gas limits missing on contract calls. Add:

```ts
gas: 100_000n; // for approve
gas: 150_000n; // for stakeYes/stakeNo
```

---

## License

MIT
