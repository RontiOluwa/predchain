"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { marketsApi, type ApiMarket } from "@/lib/api";
import { useMarketSocket } from "@/lib/websocket";

// ─── Query Keys ───────────────────────────────────────────────────

export const marketKeys = {
    all: ["markets"] as const,
    list: (status?: string) => ["markets", "list", status] as const,
    detail: (id: string) => ["markets", "detail", id] as const,
    byUser: (address: string) => ["markets", "user", address] as const,
};

// ─── Hooks ────────────────────────────────────────────────────────

/**
 * Lists all markets, optionally filtered by status.
 * Refetches every 30 seconds as a fallback to WebSocket updates.
 */
export function useMarkets(status?: string) {
    return useQuery({
        queryKey: marketKeys.list(status),
        queryFn: () => marketsApi.list({ status, limit: 50 }),
        refetchInterval: 30_000,
        staleTime: 10_000,
    });
}

/**
 * Fetches a single market by ID with real-time WebSocket updates.
 * Pool totals and status update live as events arrive.
 */
export function useMarket(id: string) {
    const queryClient = useQueryClient();

    // Real-time updates for this specific market
    useMarketSocket({
        marketId: id,
        onMessage: (msg) => {
            if (msg.type === "market:update" && msg.data.id === id) {
                // Invalidate to trigger a refetch with latest status
                queryClient.invalidateQueries({ queryKey: marketKeys.detail(id) });
            }

            if (msg.type === "market:pool" && msg.data.marketId === id) {
                // Optimistically update pool totals without a refetch
                queryClient.setQueryData(
                    marketKeys.detail(id),
                    (old: { market: ApiMarket } | undefined) => {
                        if (!old) return old;
                        return {
                            market: {
                                ...old.market,
                                yesPool: msg.data.yesPool,
                                noPool: msg.data.noPool,
                            },
                        };
                    }
                );
            }
        },
    });

    return useQuery({
        queryKey: marketKeys.detail(id),
        queryFn: () => marketsApi.get(id),
        staleTime: 5_000,
    });
}

/**
 * Creates a new prediction market.
 * Invalidates the market list on success so new market appears.
 */
export function useCreateMarket() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({
            rawInput,
            creatorAddress,
        }: {
            rawInput: string;
            creatorAddress: string;
        }) => marketsApi.create(rawInput, creatorAddress),

        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: marketKeys.all });
        },
    });
}

/**
 * Gets all markets created by a specific wallet address.
 */
export function useUserMarkets(address: string) {
    return useQuery({
        queryKey: marketKeys.byUser(address),
        queryFn: () => marketsApi.byUser(address),
        enabled: !!address,
    });
}

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Calculates implied probability of YES from pool totals.
 * Returns 50 if no stakes exist yet.
 */
export function calcProbability(yesPool: string, noPool: string): number {
    const yes = BigInt(yesPool);
    const no = BigInt(noPool);
    const total = yes + no;
    if (total === 0n) return 50;
    return Number((yes * 100n) / total);
}

/**
 * Formats a wei amount to a human-readable PRED amount.
 * e.g. "100000000000000000000" → "100.00"
 */
export function formatPred(wei: string): string {
    const num = BigInt(wei);
    const whole = num / BigInt(1e18);
    const frac = (num % BigInt(1e18)) / BigInt(1e14); // 4 decimal places
    return `${whole}.${frac.toString().padStart(4, "0")}`;
}