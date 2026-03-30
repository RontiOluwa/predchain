"use client";

import { useState } from "react";
import Link from "next/link";
import { useMarkets } from "@/hooks/useMarkets";
import { MarketCard } from "@/components/MarketCard";
export const dynamic = "force-dynamic";
const STATUS_TABS = [
    { label: "All", value: undefined },
    { label: "Open", value: "OPEN" },
    { label: "Locked", value: "LOCKED" },
    { label: "Resolved", value: "RESOLVED" },
];

export default function HomePage() {
    const [status, setStatus] = useState<string | undefined>(undefined);
    const { data, isLoading, error } = useMarkets(status);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Prediction Markets</h1>
                    <p className="text-gray-500 text-sm mt-1">
                        Stake on real-world outcomes. Settled by AI + oracles.
                    </p>
                </div>
                <Link
                    href="/create"
                    className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
                >
                    + Create Market
                </Link>
            </div>

            {/* Status filter tabs */}
            <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
                {STATUS_TABS.map((tab) => (
                    <button
                        key={tab.label}
                        onClick={() => setStatus(tab.value)}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${status === tab.value
                            ? "bg-white text-gray-900 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Market grid */}
            {isLoading && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="border border-gray-200 rounded-xl p-5 animate-pulse">
                            <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
                            <div className="h-3 bg-gray-100 rounded w-full mb-2" />
                            <div className="h-3 bg-gray-100 rounded w-1/2" />
                        </div>
                    ))}
                </div>
            )}

            {error && (
                <div className="text-center py-12 text-gray-500">
                    <p>Failed to load markets. Is the API gateway running?</p>
                    <p className="text-sm mt-1 font-mono text-red-400">{error.message}</p>
                </div>
            )}

            {data && data.markets.length === 0 && (
                <div className="text-center py-16">
                    <p className="text-gray-500 mb-4">No markets yet.</p>
                    <Link
                        href="/create"
                        className="text-blue-600 hover:underline text-sm"
                    >
                        Create the first one →
                    </Link>
                </div>
            )}

            {data && data.markets.length > 0 && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {data.markets.map((market) => (
                            <MarketCard key={market.id} market={market} />
                        ))}
                    </div>
                    <p className="text-xs text-gray-400 text-center mt-6">
                        {data.total} total markets
                    </p>
                </>
            )}
        </div>
    );
}