# @predchain/api-gateway

Fastify HTTP server and WebSocket server. The only service exposed to the internet — all client requests go through here. Handles authentication, request validation, and proxies operations to the database and Redis queues.

---

## Responsibilities

1. **REST API** — market CRUD, stake recording, auth, faucet
2. **WebSocket** — real-time market updates pushed to connected clients
3. **Authentication** — EIP-191 wallet signatures verified, JWT issued
4. **Faucet** — server-side PRED token minting with Redis cooldown

---

## Starting the server

```bash
# Development
pnpm dev

# Production
pnpm build
node dist/index.js
```

On startup:

```json
{
  "level": "info",
  "service": "api-gateway",
  "message": "API Gateway started",
  "port": 3001,
  "endpoints": {
    "health": "http://localhost:3001/health",
    "markets": "http://localhost:3001/markets",
    "stakes": "http://localhost:3001/stakes",
    "websocket": "ws://localhost:3001/ws/markets",
    "authNonce": "http://localhost:3001/auth/nonce",
    "authVerify": "http://localhost:3001/auth/verify"
  }
}
```

---

## REST API

### Health

```
GET /health
→ 200 { status: "ok", service: "api-gateway", timestamp: "..." }
```

---

### Authentication

Predchain uses wallet-based authentication. Users sign a nonce with MetaMask — no passwords.

#### Get nonce

```
POST /auth/nonce
Content-Type: application/json

{ "address": "0x53983C776D8e4e70dF2d5947b0A85375b94b9784" }

→ 200 {
    "nonce": "Sign this message to authenticate with Predchain: abc123-uuid",
    "address": "0x53983c776d8e4e70df2d5947b0a85375b94b9784"
  }
```

#### Verify signature

```
POST /auth/verify
Content-Type: application/json

{
  "address": "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
  "signature": "0x..."
}

→ 200 { "token": "<jwt>", "address": "0x..." }
→ 401 { "error": "Invalid signature" }
```

**JWT payload:**

```json
{ "address": "0x53983c...", "iat": 1234567890, "exp": 1234567890 }
```

JWT expires in 24 hours. Include in subsequent requests:

```
Authorization: Bearer <token>
```

---

### Markets

#### List markets

```
GET /markets?status=OPEN&limit=20&offset=0

Query params:
  status  — PENDING | OPEN | LOCKED | RESOLVED | SETTLED | CANCELLED (optional)
  limit   — default 20, max 100
  offset  — default 0

→ 200 {
    "markets": Market[],
    "total": number
  }
```

#### Get market

```
GET /markets/:id

→ 200 { "market": Market }
→ 404 { "error": "Market not found" }
```

#### Create market

```
POST /markets
Authorization: Bearer <token>
Content-Type: application/json

{
  "rawInput": "Will ETH exceed $5,000 by December 31st, 2026?",
  "creatorAddress": "0x53983C776D8e4e70dF2d5947b0A85375b94b9784"
}

→ 202 { "market": Market, "message": "Market created, contract deploying" }
→ 400 { "error": "Invalid request" }
→ 401 { "error": "Unauthorized" }
```

The `202 Accepted` status means the market was created in the DB and the contract deployment job was queued. The contract deploys asynchronously (~15 seconds).

#### Get user's markets

```
GET /markets/user/:address

→ 200 { "markets": Market[] }
```

---

### Stakes

#### Record stake

```
POST /stakes
Authorization: Bearer <token>
Content-Type: application/json

{
  "marketId": "uuid",
  "side": "YES",
  "amount": "100000000000000000000",
  "userAddress": "0x53983C776D8e4e70dF2d5947b0A85375b94b9784",
  "txHash": "0x..."
}

→ 201 { "stake": Stake }
→ 400 { "error": "Invalid request" }
→ 401 { "error": "Unauthorized" }
```

Called by the frontend after the on-chain `stakeYes()`/`stakeNo()` transaction confirms.

#### Get user's stakes

```
GET /stakes/user/:address

→ 200 { "stakes": Stake[] }
```

Stake records include the related market via a Prisma `include`. All address queries are case-insensitive.

---

### Faucet

```
POST /faucet
Content-Type: application/json

{ "address": "0x53983C776D8e4e70dF2d5947b0A85375b94b9784" }

→ 200 {
    "success": true,
    "txHash": "0x...",
    "amount": "10000",
    "address": "0x..."
  }
→ 400 { "error": "Valid Ethereum address required" }
→ 429 {
    "error": "Cooldown active. Try again in 23 hours.",
    "remainingSeconds": 82800
  }
→ 500 { "error": "Faucet mint failed" }
```

**How it works:**

1. Checks Redis for key `faucet:{address}` — returns 429 if found
2. Calls `PredToken.mint(address, 10000 PRED)` using the deployer wallet
3. Waits for transaction confirmation
4. Stores `faucet:{address}` in Redis with 86400s TTL
5. Returns the transaction hash

---

## WebSocket

Real-time market updates. Connect to `ws://localhost:3001/ws/markets` (or `wss://` in production).

### Subscribe to a specific market

```json
→ send: { "type": "subscribe", "marketId": "uuid" }
← recv: { "type": "subscribed", "marketId": "uuid" }
```

### Subscribe to all markets

```json
→ send: { "type": "subscribe:all" }
← recv: { "type": "subscribed:all" }
```

### Events received

```json
// Market status changed
{ "type": "market:update", "data": { "id": "uuid", "status": "LOCKED", "outcome": null } }

// Pool totals updated after a stake
{ "type": "market:pool", "data": { "marketId": "uuid", "yesPool": "...", "noPool": "...", "probability": 68 } }

// Market resolved
{ "type": "market:resolved", "data": { "marketId": "uuid", "outcome": "YES" } }

// Keepalive ping (respond with pong)
{ "type": "ping" }
```

### Keepalive

The server sends a `ping` every 30 seconds. Clients must respond:

```json
→ send: { "type": "pong" }
```

Clients that don't respond are disconnected after 60 seconds.

---

## Auth Middleware

Protected routes use the `requireAuth` preHandler:

```ts
fastify.post(
  "/markets",
  { preHandler: [requireAuth] },
  async (request, reply) => {
    // request.user = { address: "0x..." }
  }
);
```

The middleware:

1. Reads `Authorization: Bearer <token>` header
2. Verifies JWT signature with `JWT_SECRET`
3. Checks token expiry
4. Attaches decoded payload to `request.user`

---

## CORS

Configured in `server.ts`. In production, only the Vercel frontend domain is allowed:

```ts
origin: process.env["NODE_ENV"] === "production"
  ? ["https://predchain-web.vercel.app"]
  : true; // Allow all in development
```

Update the allowed origin when deploying to a custom domain.

---

## Environment Variables

```bash
# Server
API_PORT=3001
JWT_SECRET=your-64-char-secret    # Min 32 chars
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:password@localhost:5432/predchain

# Redis
REDIS_URL=redis://localhost:6379

# Blockchain (for faucet)
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
DEPLOYER_PRIVATE_KEY=0x...
PRED_TOKEN_ADDRESS=0x...
CHAIN_ID=84532

# Frontend URL (for CORS)
FRONTEND_URL=https://predchain-web.vercel.app
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
├── middleware/
│   └── auth.middleware.ts      # JWT verification preHandler
├── routes/
│   ├── market.routes.ts        # /markets endpoints
│   └── stake.routes.ts         # /stakes + /faucet endpoints
├── ws/
│   └── market.socket.ts        # WebSocket server + subscription management
├── server.ts                   # Fastify instance, plugin registration
└── index.ts                    # Entry point — starts server
```
