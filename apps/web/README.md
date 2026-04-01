# @predchain/web

Next.js 15 frontend for Predchain. Built with the App Router, RainbowKit for wallet connections, Wagmi for blockchain interactions, and TanStack Query for server state management. Real-time market updates via WebSocket.

---

## Pages

| Route           | File                        | Description                                                                            |
| --------------- | --------------------------- | -------------------------------------------------------------------------------------- |
| `/`             | `app/page.tsx`              | Market dashboard — lists all markets with live probability bars and status filter tabs |
| `/create`       | `app/create/page.tsx`       | Create a market — plain English input, Claude parses it, contract deploys              |
| `/markets/[id]` | `app/markets/[id]/page.tsx` | Market detail — probability bar, resolution details, staking panel                     |
| `/portfolio`    | `app/portfolio/page.tsx`    | User's stakes — won/lost/pending status with payout info                               |

---

## Components

### Navbar

`components/Navbar.tsx`

Responsive navigation bar with:

- **Logo + nav links** — collapses to hamburger menu on mobile
- **PRED token balance** — reads `balanceOf` directly from the contract via `useReadContract`. Shows an amber dot indicator.
- **Faucet button** — only visible when PRED balance is below 1,000. Calls `POST /faucet` and auto-refreshes balance on success. Shows cooldown message if rate limited.
- **Wallet connect button** — RainbowKit `ConnectButton`. Shows full address on desktop, avatar only on mobile.

The Navbar uses `dynamic(() => import(...), { ssr: false })` for `ConnectButton` to prevent SSR errors from wagmi's browser-only APIs.

---

### MarketCard

`components/MarketCard.tsx`

Clickable card used in the market list. Shows:

- Market question (truncated at 2 lines)
- Live probability bar (YES % / NO %)
- Status badge
- Resolution source and time remaining

Clicking navigates to `/markets/:id`.

---

### ProbabilityBar

`components/ProbabilityBar.tsx`

Animated YES/NO probability bar calculated from pool totals:

```
probability = yesPool / (yesPool + noPool) × 100
```

Shows 50% when no stakes exist yet. Updates live via WebSocket when new stakes arrive (optimistic cache update in `useMarket` hook).

Props:

```ts
interface ProbabilityBarProps {
  yesPool: string; // Wei amount as string
  noPool: string; // Wei amount as string
  outcome?: "YES" | "NO" | "VOID"; // Shows resolution banner if set
}
```

---

### MarketStatus

`components/MarketStatus.tsx`

Colour-coded status badge:

| Status    | Colour | Note                             |
| --------- | ------ | -------------------------------- |
| PENDING   | Yellow | Pulsing dot — contract deploying |
| OPEN      | Green  | Pulsing dot — staking live       |
| LOCKED    | Blue   | Awaiting resolution              |
| RESOLVED  | Purple | Outcome determined               |
| SETTLED   | Grey   | Payouts distributed              |
| CANCELLED | Red    | Refunds available                |

---

### StakePanel

`components/StakePanel.tsx`

The staking UI on market detail pages. Handles the full 6-step staking flow:

1. **Authenticate** — sign message with MetaMask → get JWT
2. **Approve** — MetaMask popup #1: approve PRED token spend
3. **Wait** — confirm approval on-chain
4. **Stake** — MetaMask popup #2: call `stakeYes()` or `stakeNo()`
5. **Wait** — confirm stake on-chain
6. **Record** — POST to `/stakes` to persist in DB

At each step a status label updates: `"Approve token spend in MetaMask..."`, `"Waiting for confirmation..."` etc.

For non-OPEN markets, shows a contextual message instead:

- PENDING → "Contract deploying — staking opens shortly"
- LOCKED → "Staking is closed — market locked"
- RESOLVED → "Market resolved — claim your payout below"

---

## Hooks

### useIsMounted

`hooks/useIsMounted.ts`

Returns `true` only after the component has mounted on the client. **Must be the first hook called** in any component that uses wagmi hooks.

```ts
export default function MyPage() {
  const mounted = useIsMounted();       // ← always first

  const { address } = useAccount();     // ← wagmi hooks after
  const { data } = useMarkets();

  if (!mounted) return null;            // ← early return after ALL hooks

  return <div>...</div>;
}
```

**Why this is needed:** `WagmiProvider` is dynamically loaded with `ssr: false`. On the first render, it doesn't exist yet. Components calling `useAccount()` before it mounts will throw `WagmiProviderNotFoundError`. The mounted gate delays rendering until providers are available.

---

### useAuth

`hooks/useAuth.ts`

Wallet authentication flow.

```ts
const { authenticate, isAuthenticated, isAuthenticating, error, logout } =
  useAuth();

// Trigger auth flow (opens MetaMask for signature)
const success = await authenticate();

// Check if JWT is valid and not expired
if (isAuthenticated) {
  // JWT is in localStorage, not expired, matches current address
}
```

**Flow:**

1. `POST /auth/nonce { address }` — get a unique nonce
2. `signMessageAsync({ message: nonce })` — trigger MetaMask signature popup
3. `POST /auth/verify { address, signature }` — verify and receive JWT
4. Store JWT in `localStorage` as `predchain_jwt`

JWT is automatically included in all API requests via `getAuthHeader()` in `lib/api.ts`.

---

### useMarkets

`hooks/useMarkets.ts`

TanStack Query hooks for market data.

```ts
// List markets (refetches every 30s)
const { data, isLoading, error } = useMarkets("OPEN");
// data = { markets: Market[], total: number }

// Single market with real-time WebSocket updates
const { data, isLoading, error } = useMarket(marketId);
// Pool totals update optimistically without refetch

// Create a market
const { mutateAsync, isPending, error } = useCreateMarket();
await mutateAsync({ rawInput, creatorAddress });

// User's created markets
const { data } = useUserMarkets(address);
```

**WebSocket integration in `useMarket`:**

When a `market:pool` event arrives for the current market, the hook updates the TanStack Query cache directly without a network request. When a `market:update` event arrives, it invalidates the cache to trigger a refetch.

**Helper functions:**

```ts
// Calculate YES probability from pool totals
calcProbability("12000000000000000000000", "8000000000000000000000"); // → 60

// Format wei to human-readable PRED
formatPred("100000000000000000000"); // → "100.0000"
```

---

### useStake

`hooks/useStake.ts`

Full on-chain staking flow.

```ts
const { stake, reset, step, error, isLoading, stepLabel } = useStake();

await stake({
  marketId: "uuid",
  contractAddress: "0x...",
  side: "YES",
  amount: "500", // Human readable — converted to wei internally
});

// Step labels for UI feedback:
// "idle" | "authenticating" | "approving" | "waiting-approve"
// "staking" | "waiting-stake" | "recording" | "done" | "error"
```

**Gas limits:**
Both contract calls use explicit gas limits to bypass viem's automatic estimation (which inflates on Base Sepolia):

- `approve()` → `gas: 100_000n`
- `stakeYes()`/`stakeNo()` → `gas: 150_000n`

**Transaction verification:**
Uses `publicClient.waitForTransactionReceipt()` to confirm each transaction. If `receipt.status === "reverted"`, throws an error with a clear message.

---

## lib

### api.ts

Typed fetch client for all backend API calls. All requests go through a single `request()` function that:

- Prepends the `NEXT_PUBLIC_API_URL` base URL
- Adds `Authorization: Bearer <token>` header if JWT exists
- Throws typed errors on non-2xx responses

```ts
import { marketsApi, stakesApi, authApi, faucetApi } from "@/lib/api";

// Markets
await marketsApi.list({ status: "OPEN", limit: 20 });
await marketsApi.get(id);
await marketsApi.create({ rawInput, creatorAddress });

// Stakes
await stakesApi.record({ marketId, side, amount, userAddress, txHash });
await stakesApi.byUser(address);

// Auth
await authApi.getNonce(address);
await authApi.verify(address, signature);

// Faucet
await faucetApi.claim(address);
```

---

### wagmi.config.ts

Wagmi configuration and contract ABIs.

```ts
import {
  wagmiConfig,
  PRED_TOKEN_ABI,
  PREDICTION_MARKET_ABI,
} from "@/lib/wagmi.config";

// Chain: Base Sepolia only
// WalletConnect project ID from NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
// ssr: true for Next.js App Router
```

**ABIs included:**

- `PRED_TOKEN_ABI` — `approve`, `balanceOf`
- `PREDICTION_MARKET_ABI` — `stakeYes`, `stakeNo`, `claimPayout`, `claimRefund`, `impliedProbabilityYes`, `getMarketInfo`

---

### websocket.ts

Auto-reconnecting WebSocket hook.

```ts
useMarketSocket({
  marketId: "uuid",           // Subscribe to a specific market
  subscribeAll: false,        // Or subscribe to all markets
  onMessage: (msg) => {
    // Handle incoming messages
    if (msg.type === "market:pool") { ... }
    if (msg.type === "market:resolved") { ... }
  }
});
```

**Features:**

- Auto-reconnects after 1 second on disconnect
- Responds to server `ping` with `pong` for keepalive
- Always uses the latest `onMessage` callback via a ref (no stale closure issues)

---

## SSR / Hydration

Wagmi, RainbowKit, and WalletConnect use browser-only APIs that break Next.js SSR. The solution has three parts:

### 1. Dynamic imports with ssr: false

```ts
// WalletProviders.tsx
const WalletProviders = dynamic(() => import("./WalletProviders"), {
  ssr: false,
});

// ConnectButton in Navbar
const ConnectButton = dynamic(
  () => import("@rainbow-me/rainbowkit").then((m) => m.ConnectButton),
  { ssr: false }
);
```

### 2. Webpack module aliases

In `next.config.ts`, browser-incompatible packages are stubbed with an empty module:

```ts
config.resolve.alias = {
  "@react-native-async-storage/async-storage": path.resolve(
    process.cwd(),
    "lib/empty-module.js"
  ),
  "pino-pretty": emptyModule,
  "idb-keyval": emptyModule,
};
```

### 3. suppressHydrationWarning

Browser extensions (Leather wallet, MetaMask) inject `<script>` tags into `<body>` before React hydrates, causing mismatches:

```tsx
<html lang="en" suppressHydrationWarning>
  <body suppressHydrationWarning>
```

---

## Environment Variables

Create `apps/web/.env.local`:

```bash
# API Gateway URL (Next.js rewrites /api/* to this)
NEXT_PUBLIC_API_URL=http://localhost:3001

# WebSocket URL — use wss:// in production (HTTPS required)
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws/markets

# Deployed PredToken contract address
NEXT_PUBLIC_PRED_TOKEN_ADDRESS=0x...

# Base Sepolia RPC (same as backend)
NEXT_PUBLIC_RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY

# WalletConnect project ID — get free at cloud.walletconnect.com
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
```

**Important:** `NEXT_PUBLIC_WS_URL` must use `wss://` (not `ws://`) when the app is served over HTTPS. Browsers block insecure WebSocket connections from HTTPS pages.

---

## Running

```bash
# Development
pnpm dev          # http://localhost:3000

# Production build
pnpm build
pnpm start

# Type check only
pnpm typecheck
```

---

## Deployment (Vercel)

1. Import the GitHub repo in Vercel
2. Set **Root Directory** to `apps/web`
3. Add all `NEXT_PUBLIC_*` environment variables
4. Deploy

`NEXT_PUBLIC_API_URL` must point to the Railway API Gateway URL.
`NEXT_PUBLIC_WS_URL` must use `wss://` not `ws://`.

After updating env vars in Vercel, always **Redeploy** (env vars are baked in at build time).

---

## Structure

```
apps/web/
├── app/
│   ├── layout.tsx              # Root layout — providers, navbar, global CSS
│   ├── page.tsx                # / — market dashboard
│   ├── globals.css             # Tailwind directives
│   ├── create/
│   │   └── page.tsx            # /create — create market form
│   ├── markets/
│   │   └── [id]/
│   │       └── page.tsx        # /markets/:id — detail + staking
│   └── portfolio/
│       └── page.tsx            # /portfolio — user stakes
├── components/
│   ├── Navbar.tsx              # Responsive nav + balance + faucet
│   ├── MarketCard.tsx          # Market list card
│   ├── MarketStatus.tsx        # Status badge component
│   ├── ProbabilityBar.tsx      # YES/NO probability bar
│   ├── StakePanel.tsx          # Staking UI with step feedback
│   ├── Providers.tsx           # TanStack Query + mounted gate
│   └── WalletProviders.tsx     # WagmiProvider + RainbowKitProvider (ssr: false)
├── hooks/
│   ├── useIsMounted.ts         # Client-mount guard for wagmi hooks
│   ├── useAuth.ts              # Wallet signature → JWT
│   ├── useMarkets.ts           # TanStack Query + WebSocket
│   └── useStake.ts             # Full staking flow
├── lib/
│   ├── api.ts                  # Typed fetch client
│   ├── wagmi.config.ts         # Wagmi config + contract ABIs
│   ├── websocket.ts            # Auto-reconnecting WebSocket hook
│   └── empty-module.js         # Webpack stub for SSR-incompatible packages
├── next.config.ts              # Rewrites + webpack aliases
├── tailwind.config.ts          # Content paths
├── postcss.config.mjs          # Tailwind + autoprefixer
└── tsconfig.json               # TypeScript config (extends root)
```
