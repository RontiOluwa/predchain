/**
 * Typed API client for the Predchain backend.
 *
 * All API calls go through these functions — no raw fetch() calls
 * scattered across components. This means:
 * - Types are centralised
 * - Auth headers are added in one place
 * - Base URL is configured in one place
 * - Error handling is consistent
 */

const BASE_URL = process.env["NEXT_PUBLIC_API_URL"]; // Proxied by Next.js rewrites to localhost:3001

function getAuthHeader(): Record<string, string> {
    const token = localStorage.getItem("predchain_jwt");
    return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(
    path: string,
    options?: RequestInit
): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
        headers: {
            "Content-Type": "application/json",
            ...getAuthHeader(),
            ...options?.headers,
        },
        ...options,
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(error.error ?? `Request failed: ${res.status}`);
    }

    return res.json();
}

// ─── Types (mirrors backend responses) ───────────────────────────

export interface ApiMarket {
    id: string;
    question: string;
    description: string;
    subject: string;
    conditionOperator: string;
    conditionThreshold: string;
    conditionUnit: string;
    deadline: string;
    resolutionSource: string;
    status: "PENDING" | "OPEN" | "LOCKED" | "RESOLVED" | "SETTLED" | "CANCELLED";
    outcome?: "YES" | "NO" | "VOID";
    contractAddress?: string;
    yesPool: string;
    noPool: string;
    confidence: number;
    creatorAddress: string;
    createdAt: string;
    resolvedAt?: string;
    resolutionEvidence?: {
        outcome: string;
        oracleValue: string;
        reasoning: string;
        fetchedAt: string;
        settlementTxHash?: string;
    };
}

export interface ApiStake {
    id: string;
    marketId: string;
    userAddress: string;
    side: "YES" | "NO";
    amount: string;
    txHash: string;
    createdAt: string;
    market?: ApiMarket;
}

// ─── Market endpoints ─────────────────────────────────────────────

export const marketsApi = {
    list(params?: { status?: string; limit?: number; offset?: number }) {
        const query = new URLSearchParams();
        if (params?.status) query.set("status", params.status);
        if (params?.limit) query.set("limit", String(params.limit));
        if (params?.offset) query.set("offset", String(params.offset));
        const qs = query.toString();
        return request<{ markets: ApiMarket[]; total: number }>(
            `/markets${qs ? `?${qs}` : ""}`
        );
    },

    get(id: string) {
        return request<{ market: ApiMarket }>(`/markets/${id}`);
    },

    create(rawInput: string, creatorAddress: string) {
        return request<{ market: ApiMarket; message: string }>("/markets", {
            method: "POST",
            body: JSON.stringify({ rawInput, creatorAddress }),
        });
    },

    byUser(address: string) {
        return request<{ markets: ApiMarket[] }>(`/markets/user/${address}`);
    },
};

// ─── Stake endpoints ──────────────────────────────────────────────

export const stakesApi = {
    record(data: {
        marketId: string;
        side: "YES" | "NO";
        amount: string;
        userAddress: string;
        txHash: string;
    }) {
        return request<{ stake: ApiStake }>("/stakes", {
            method: "POST",
            body: JSON.stringify(data),
        });
    },

    byUser(address: string) {
        return request<{ stakes: ApiStake[] }>(`/stakes/user/${address}`);
    },
};

// ─── Auth endpoints ───────────────────────────────────────────────

export const authApi = {
    getNonce(address: string) {
        return request<{ nonce: string; address: string }>("/auth/nonce", {
            method: "POST",
            body: JSON.stringify({ address }),
        });
    },

    verify(address: string, signature: string) {
        return request<{ token: string; address: string }>("/auth/verify", {
            method: "POST",
            body: JSON.stringify({ address, signature }),
        });
    },
};

// ─── Faucet endpoints ───────────────────────────────────────────────

export const faucetApi = {
    claim(address: string) {
        return request<{ success: boolean; txHash: string; amount: string }>(
            "/faucet",
            {
                method: "POST",
                body: JSON.stringify({ address }),
            }
        );
    },
};